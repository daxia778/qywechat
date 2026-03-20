package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
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
	"strconv"
	"strings"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx        context.Context
	serverURL  string
	token      string
	empName    string
	wecomUID   string
	machineID  string // 缓存的设备指纹，启动时生成
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		serverURL: "http://120.26.139.90:8200",
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 生成并缓存设备指纹（多重 fallback 确保不为空）
	mid, err := GetMachineFingerprint()
	if err != nil || mid == "" {
		log.Printf("⚠️ 设备指纹生成失败，使用退化方案: %v", err)
		fallbackMAC := a.getFallbackMAC()
		if fallbackMAC != "" && fallbackMAC != "UNKNOWN" {
			a.machineID = "FALLBACK-" + fallbackMAC
		} else {
			// 最终兜底：用主机名+用户目录哈希
			hostname, _ := os.Hostname()
			home, _ := os.UserHomeDir()
			raw := hostname + ":" + home + ":pdd-fallback"
			h := fmt.Sprintf("%x", sha256.Sum256([]byte(raw)))
			a.machineID = "HOST-" + h[:32]
			log.Printf("⚠️ MAC 也获取失败，使用主机名哈希兜底: %s", a.machineID)
		}
	} else {
		a.machineID = mid
		log.Printf("✅ 设备指纹已生成: %s...", mid[:16])
	}

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
	plaintext, _ := json.Marshal(data)

	// 使用设备指纹加密 Session
	encrypted, err := EncryptSession(plaintext, a.machineID)
	if err != nil {
		log.Printf("❌ 会话加密失败: %v", err)
		return
	}

	_ = os.WriteFile(sessionFilePath(), []byte(encrypted), 0600)
	log.Println("✅ 会话已加密保存到本地")
}

func (a *App) loadSession() {
	// 1. 尝试从本地加密文件恢复
	b, err := os.ReadFile(sessionFilePath())
	if err == nil {
		plaintext, err := DecryptSession(string(b), a.machineID)
		if err == nil {
			var data sessionData
			if err := json.Unmarshal(plaintext, &data); err == nil && data.Token != "" {
				a.token = data.Token
				a.empName = data.EmpName
				a.wecomUID = data.WecomUID
				log.Printf("✅ 已恢复本地加密会话: %s", data.EmpName)
				return
			}
		}
		log.Printf("⚠️ 本地会话无效，尝试设备指纹静默登录")
		_ = os.Remove(sessionFilePath())
	}

	// 2. 本地会话不存在或无效，用设备指纹向服务端静默登录
	if a.machineID == "" {
		return
	}
	payload := map[string]string{
		"activation_code": "",
		"machine_id":      a.machineID,
		"mac_address":     a.getFallbackMAC(),
	}
	body, _ := json.Marshal(payload)
	resp, err := http.Post(a.serverURL+"/api/v1/auth/device_login", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("⚠️ 静默登录网络失败: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Printf("⚠️ 设备未绑定，需要输入激活码")
		return
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	a.token = result["token"].(string)
	a.empName = result["employee_name"].(string)
	a.wecomUID = result["wecom_userid"].(string)
	a.saveSession()
	log.Printf("✅ 设备指纹静默登录成功: %s", a.empName)
}

func (a *App) ClearSession() {
	a.token = ""
	a.empName = ""
	a.wecomUID = ""
	_ = os.Remove(sessionFilePath())
	log.Println("🗑️ 会话已清除")
}

// ─── 设备指纹 (替代弱 MAC 绑定) ─────────────────────────

// GetMachineID 返回缓存的设备指纹（已在 startup 中通过 crypto.go 生成）
func (a *App) GetMachineID() string {
	return a.machineID
}

// getFallbackMAC 退化方案：在无法获取硬件 UUID 时回退到 MAC 地址
func (a *App) getFallbackMAC() string {
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

// GetMacAddress 返回 MAC 地址（暴露给前端调用）
func (a *App) GetMacAddress() string {
	return a.getFallbackMAC()
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
	payload := map[string]string{
		"activation_code": activationCode,
		"machine_id":      a.machineID,
		"mac_address":     a.getFallbackMAC(),
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
	OrderTime  string  `json:"order_time"`
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
		result.Error = "OCR 解析失败: " + result.Error
	}
	return &result
}

// UploadScreenshotBase64 支持从剪贴板粘贴图片 (传入完整的 base64 data URI)
func (a *App) UploadScreenshotBase64(b64DataURL string) *OCRResult {
	// 去除前缀 data:image/png;base64,
	parts := strings.SplitN(b64DataURL, ",", 2)
	if len(parts) != 2 {
		return &OCRResult{Error: "无效的图片数据"}
	}
	
	b64Data := parts[1]
	imgBytes, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return &OCRResult{Error: "图片解码失败:" + err.Error()}
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", "clipboard.png")
	if err != nil {
		return &OCRResult{Error: "创建表单失败"}
	}
	
	if _, err := io.Copy(part, bytes.NewReader(imgBytes)); err != nil {
		return &OCRResult{Error: "复制文件失败"}
	}
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
		result.Error = "OCR 解析失败: HTTP " + strconv.Itoa(resp.StatusCode)
	}

	// 如果 OCR 没有提取出内容，给予明确提示
	if result.OrderSN == "" && result.RawPrice == "" && result.Error == "" {
		result.Error = "截图未识别到有效订单号或金额，请手动输入或重新截图"
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

// ─── OTA Update ────────────────────────

type AppUpdateInfo struct {
	Version      string `json:"version"`
	ForceUpdate  bool   `json:"force_update"`
	DownloadURL  string `json:"download_url"`
	ReleaseNotes string `json:"release_notes"`
	HasUpdate    bool   `json:"has_update"`
}

// CheckUpdate 检查更新
func (a *App) CheckUpdate(currentVersion string) (*AppUpdateInfo, error) {
	resp, err := http.Get(a.serverURL + "/api/v1/app/version")
	if err != nil {
		return nil, fmt.Errorf("网络超时: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("检查更新失败 (HTTP %d)", resp.StatusCode)
	}

	var info AppUpdateInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, err
	}

	if info.Version != currentVersion && info.Version != "" {
		info.HasUpdate = true
	}
	return &info, nil
}
