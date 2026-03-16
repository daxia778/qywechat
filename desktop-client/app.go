package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx       context.Context
	serverURL string
	token     string
	empName   string
	wecomUID  string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		serverURL: "http://localhost:8200",
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 自动恢复上次的登录会话
	a.loadSession()
}

// ─── 会话持久化 ─────────────────────────

type sessionData struct {
	Token    string `json:"token"`
	EmpName  string `json:"emp_name"`
	WecomUID string `json:"wecom_uid"`
}

func sessionFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".pdd-session.json")
}

func (a *App) saveSession() {
	data := sessionData{
		Token:    a.token,
		EmpName:  a.empName,
		WecomUID: a.wecomUID,
	}
	b, _ := json.Marshal(data)
	_ = os.WriteFile(sessionFilePath(), b, 0600)
	log.Println("✅ 会话已保存到本地")
}

func (a *App) loadSession() {
	b, err := os.ReadFile(sessionFilePath())
	if err != nil {
		return // 无会话文件，需要重新登录
	}

	var data sessionData
	if err := json.Unmarshal(b, &data); err != nil {
		return
	}

	if data.Token != "" {
		a.token = data.Token
		a.empName = data.EmpName
		a.wecomUID = data.WecomUID
		log.Printf("✅ 已恢复登录会话: %s", data.EmpName)
	}
}

func (a *App) ClearSession() {
	a.token = ""
	a.empName = ""
	a.wecomUID = ""
	_ = os.Remove(sessionFilePath())
	log.Println("🗑️ 会话已清除")
}

// ─── MAC 地址获取 ─────────────────────────

func (a *App) GetMacAddress() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return "UNKNOWN"
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagLoopback == 0 {
			mac := iface.HardwareAddr.String()
			if mac != "" {
				return strings.ToUpper(mac)
			}
		}
	}
	return "UNKNOWN"
}

func (a *App) GetPlatform() string {
	return runtime.GOOS
}

// ─── 设备登录 ──────────────────────────────

type LoginResult struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	Name     string `json:"name"`
	WecomUID string `json:"wecom_uid"`
}

func (a *App) DeviceLogin(activationCode string) *LoginResult {
	mac := a.GetMacAddress()

	payload := map[string]string{
		"activation_code": activationCode,
		"mac_address":     mac,
	}
	body, _ := json.Marshal(payload)

	resp, err := http.Post(a.serverURL+"/api/v1/auth/device_login", "application/json", bytes.NewReader(body))
	if err != nil {
		return &LoginResult{Success: false, Message: "无法连接服务器: " + err.Error()}
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode != 200 {
		msg := "登录失败"
		if e, ok := result["error"]; ok {
			msg = e.(string)
		}
		return &LoginResult{Success: false, Message: msg}
	}

	a.token = result["token"].(string)
	a.empName = result["employee_name"].(string)
	a.wecomUID = result["wecom_userid"].(string)

	// 持久化会话到本地文件
	a.saveSession()

	return &LoginResult{
		Success:  true,
		Message:  "登录成功",
		Name:     a.empName,
		WecomUID: a.wecomUID,
	}
}

func (a *App) IsLoggedIn() bool {
	return a.token != ""
}

func (a *App) GetEmployeeName() string {
	return a.empName
}

// ─── OCR 截图上传 ──────────────────────────

type OCRResult struct {
	OrderSN    string  `json:"order_sn"`
	Price      int     `json:"price"`
	RawPrice   string  `json:"raw_price"`
	Confidence float64 `json:"confidence"`
	Error      string  `json:"error,omitempty"`
}

func (a *App) UploadScreenshot(filePath string) *OCRResult {
	file, err := os.Open(filePath)
	if err != nil {
		return &OCRResult{Error: "文件打开失败: " + err.Error()}
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return &OCRResult{Error: "创建表单失败"}
	}
	io.Copy(part, file)
	writer.Close()

	req, _ := http.NewRequest("POST", a.serverURL+"/api/v1/orders/upload_ocr", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return &OCRResult{Error: "上传失败: " + err.Error()}
	}
	defer resp.Body.Close()

	var result OCRResult
	json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode != 200 {
		result.Error = "OCR 解析失败"
	}
	return &result
}

// ─── 选择文件对话框 ─────────────────────────

func (a *App) SelectScreenshotFile() string {
	selection, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "选择拼多多订单截图",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "Images (*.png;*.jpg;*.jpeg;*.webp)",
				Pattern:     "*.png;*.jpg;*.jpeg;*.webp",
			},
		},
	})
	if err != nil {
		return ""
	}
	return selection
}

// ─── 提交订单 ──────────────────────────────

type SubmitResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	OrderSN string `json:"order_sn"`
}

func (a *App) SubmitOrder(orderSN, customerContact, topic, remark, deadline string, price, pages int) *SubmitResult {
	payload := map[string]interface{}{
		"order_sn":         orderSN,
		"customer_contact": customerContact,
		"price":            price,
		"topic":            topic,
		"pages":            pages,
		"deadline":         deadline,
		"remark":           remark,
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("%s/api/v1/orders/create?operator_id=%s", a.serverURL, a.wecomUID)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return &SubmitResult{Success: false, Message: "提交失败: " + err.Error()}
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode != 200 {
		msg := "提交失败"
		if e, ok := result["error"]; ok {
			msg = e.(string)
		}
		return &SubmitResult{Success: false, Message: msg}
	}

	sn := ""
	if v, ok := result["order_sn"]; ok {
		sn = v.(string)
	}
	return &SubmitResult{
		Success: true,
		Message: "订单提交成功！",
		OrderSN: sn,
	}
}

// ─── 配置服务器地址 ────────────────────────

func (a *App) SetServerURL(url string) {
	if url != "" {
		a.serverURL = url
	}
}

func (a *App) GetServerURL() string {
	return a.serverURL
}
