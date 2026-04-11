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
	httpClient *http.Client // 复用连接，避免重复 TLS 握手
	ocrClient  *http.Client // OCR 专用，超时 120s
}

// NewApp creates a new App application struct
func NewApp() *App {
	// 自定义 DNS 解析器：zhiyuanshijue.ltd 直连真实 IP
	// 绕过 Clash TUN fake-ip 劫持导致的 TLS 超时
	directDialer := &net.Dialer{Timeout: 10 * time.Second}
	customDialContext := func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, _ := net.SplitHostPort(addr)
		if host == "zhiyuanshijue.ltd" || host == "www.zhiyuanshijue.ltd" {
			addr = net.JoinHostPort("118.31.56.141", port)
		}
		return directDialer.DialContext(ctx, network, addr)
	}

	apiTransport := &http.Transport{
		DialContext:         customDialContext,
		MaxIdleConns:        5,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     90 * time.Second,
	}
	ocrTransport := &http.Transport{
		DialContext:         customDialContext,
		MaxIdleConns:        2,
		MaxIdleConnsPerHost: 2,
		IdleConnTimeout:     60 * time.Second,
	}
	return &App{
		serverURL: "https://zhiyuanshijue.ltd",
		httpClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: apiTransport,
		},
		ocrClient: &http.Client{
			Timeout:   120 * time.Second,
			Transport: ocrTransport,
		},
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
	// Windows: %APPDATA%/pdd-dispatch/session.json
	// macOS:   ~/Library/Application Support/pdd-dispatch/session.json
	// Linux:   ~/.config/pdd-dispatch/session.json
	dir := ""
	if runtime.GOOS == "windows" {
		dir = os.Getenv("APPDATA")
		if dir == "" {
			dir, _ = os.UserHomeDir()
		}
	} else if runtime.GOOS == "darwin" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, "Library", "Application Support")
	} else {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, ".config")
	}
	appDir := filepath.Join(dir, "pdd-dispatch")
	_ = os.MkdirAll(appDir, 0700)
	return filepath.Join(appDir, "session.json")
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
				// 检查 token 是否过期（解析 JWT payload 的 exp 字段）
				if a.isTokenExpired(data.Token) {
					log.Printf("⚠️ 本地 token 已过期，尝试静默刷新")
					_ = os.Remove(sessionFilePath())
				} else {
					a.token = data.Token
					a.empName = data.EmpName
					a.wecomUID = data.WecomUID
					log.Printf("✅ 已恢复本地加密会话: %s", data.EmpName)
					return
				}
			}
		} else {
			log.Printf("⚠️ 本地会话无效，尝试设备指纹静默登录")
			_ = os.Remove(sessionFilePath())
		}
	}

	// 2. 本地会话不存在、无效或已过期，用设备指纹向服务端静默登录
	a.deviceLogin()
}

// deviceLogin 使用设备指纹静默登录获取新 token
func (a *App) deviceLogin() {
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

// ensureFreshToken 在发起认证请求前检查 token 是否即将过期，提前刷新
func (a *App) ensureFreshToken() {
	if a.token == "" || a.isTokenExpired(a.token) {
		log.Println("⚠️ Token 已过期或不存在，主动刷新")
		a.deviceLogin()
	}
}

// isAuthError 判断错误是否为认证失败（401 或 Token 相关错误）
func isAuthError(errMsg string) bool {
	return strings.Contains(errMsg, "401") ||
		strings.Contains(errMsg, "Token") ||
		strings.Contains(errMsg, "token") ||
		strings.Contains(errMsg, "未授权") ||
		strings.Contains(errMsg, "Unauthorized")
}

// isConnectionError 判断是否为连接层错误（EOF/reset/timeout），可重试
func isConnectionError(errMsg string) bool {
	return strings.Contains(errMsg, "EOF") ||
		strings.Contains(errMsg, "connection reset") ||
		strings.Contains(errMsg, "broken pipe") ||
		strings.Contains(errMsg, "connection refused") ||
		strings.Contains(errMsg, "stream error")
}

// isTokenExpired 解析 JWT payload 检查是否过期（提前5分钟判定为过期）
func (a *App) isTokenExpired(tokenStr string) bool {
	parts := strings.SplitN(tokenStr, ".", 3)
	if len(parts) != 3 {
		return true
	}
	// JWT payload 是 base64url 编码
	payload := parts[1]
	// 补齐 padding
	switch len(payload) % 4 {
	case 2:
		payload += "=="
	case 3:
		payload += "="
	}
	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		return true
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return true
	}
	exp, ok := claims["exp"].(float64)
	if !ok {
		return true
	}
	// 提前5分钟判定为过期，留出刷新窗口
	return time.Now().Unix() >= int64(exp)-300
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
	OrderSN        string  `json:"order_sn"`
	Price          int     `json:"price"`
	RawPrice       string  `json:"raw_price"`
	OrderTime      string  `json:"order_time"`
	Confidence     float64 `json:"confidence"`
	ScreenshotURL  string  `json:"screenshot_url"`
	ScreenshotHash string  `json:"screenshot_hash"`
	Error          string  `json:"error,omitempty"`
}

func (a *App) UploadScreenshot(filePath string) *OCRResult {
	total := time.Now()
	a.ensureFreshToken()
	result := a.doUploadScreenshotFile(filePath)

	// EOF/连接重置 → 自动重试（Nginx 关闭了空闲连接）
	if result.Error != "" && isConnectionError(result.Error) {
		log.Println("⚠️ OCR 连接异常 (EOF/reset)，重试中...")
		time.Sleep(500 * time.Millisecond)
		result = a.doUploadScreenshotFile(filePath)
	}

	// 401 认证失败 → 刷新 token 重试
	if result.Error != "" && isAuthError(result.Error) {
		log.Println("⚠️ OCR 上传认证失败，尝试刷新 token 重试")
		a.deviceLogin()
		if a.token != "" {
			result = a.doUploadScreenshotFile(filePath)
		}
	}
	log.Printf("⏱️ UploadScreenshot 总耗时: %v", time.Since(total))
	return result
}

func (a *App) doUploadScreenshotFile(filePath string) *OCRResult {
	t0 := time.Now()
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
	log.Printf("⏱️ 构建表单: %v (大小: %d bytes)", time.Since(t0), buf.Len())

	req, _ := http.NewRequest("POST", a.serverURL+"/api/v1/orders/upload_ocr", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	t1 := time.Now()
	resp, err := a.ocrClient.Do(req)
	if err != nil {
		return &OCRResult{Error: "上传失败: " + err.Error()}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	log.Printf("⏱️ HTTP 请求: %v | status=%d | 响应=%d bytes", time.Since(t1), resp.StatusCode, len(respBody))
	log.Printf("📡 upload_ocr 响应: status=%d body=%s", resp.StatusCode, string(respBody))

	if resp.StatusCode != 200 {
		var errResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		json.Unmarshal(respBody, &errResp)
		errMsg := "OCR 解析失败: HTTP " + strconv.Itoa(resp.StatusCode)
		if errResp.Message != "" {
			errMsg = errResp.Message
		}
		return &OCRResult{Error: errMsg}
	}

	var result OCRResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return &OCRResult{Error: "解析响应失败: " + err.Error()}
	}
	return &result
}

// UploadScreenshotBase64 支持从剪贴板粘贴图片 (传入完整的 base64 data URI)
func (a *App) UploadScreenshotBase64(b64DataURL string) *OCRResult {
	total := time.Now()
	a.ensureFreshToken()
	result := a.doUploadScreenshotBase64(b64DataURL)

	// EOF/连接重置 → 自动重试
	if result.Error != "" && isConnectionError(result.Error) {
		log.Println("⚠️ OCR(base64) 连接异常，重试中...")
		time.Sleep(500 * time.Millisecond)
		result = a.doUploadScreenshotBase64(b64DataURL)
	}

	// 401 认证失败 → 刷新 token 重试
	if result.Error != "" && isAuthError(result.Error) {
		log.Println("⚠️ OCR 上传认证失败，尝试刷新 token 重试")
		a.deviceLogin()
		if a.token != "" {
			result = a.doUploadScreenshotBase64(b64DataURL)
		}
	}
	log.Printf("⏱️ UploadScreenshotBase64 总耗时: %v", time.Since(total))
	return result
}

func (a *App) doUploadScreenshotBase64(b64DataURL string) *OCRResult {
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

	t1 := time.Now()
	resp, err := a.ocrClient.Do(req)
	if err != nil {
		return &OCRResult{Error: "上传失败: " + err.Error()}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	log.Printf("⏱️ HTTP 请求(base64): %v | status=%d", time.Since(t1), resp.StatusCode)
	log.Printf("📡 upload_ocr(base64) 响应: status=%d body=%s", resp.StatusCode, string(respBody))

	if resp.StatusCode != 200 {
		var errResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		json.Unmarshal(respBody, &errResp)
		errMsg := "OCR 解析失败: HTTP " + strconv.Itoa(resp.StatusCode)
		if errResp.Message != "" {
			errMsg = errResp.Message
		}
		return &OCRResult{Error: errMsg}
	}

	var result OCRResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return &OCRResult{Error: "解析响应失败: " + err.Error()}
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

// ─── 获取跟单客服列表 ──────────────────────────

type FollowStaffItem struct {
	ID           uint   `json:"id"`
	Name         string `json:"name"`
	WecomUserID  string `json:"wecom_userid"`
	Status       string `json:"status"`
	IsOnline     bool   `json:"is_online"`
	ActiveOrders int    `json:"active_orders"`
}

func (a *App) GetFollowStaffList() []FollowStaffItem {
	result := a.doGetFollowStaff()
	// 401 时自动刷新 token 重试一次
	if result == nil {
		a.deviceLogin()
		if a.token != "" {
			return a.doGetFollowStaff()
		}
	}
	return result
}

func (a *App) doGetFollowStaff() []FollowStaffItem {
	req, _ := http.NewRequest("GET", a.serverURL+"/api/v1/orders/follow-staff", nil)
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	client := a.httpClient
	resp, err := client.Do(req)
	if err != nil {
		log.Println("获取跟单客服列表失败:", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Println("获取跟单客服列表 HTTP", resp.StatusCode)
		return nil
	}

	var body struct {
		Data []FollowStaffItem `json:"data"`
	}
	json.NewDecoder(resp.Body).Decode(&body)
	return body.Data
}

// ─── 提交订单 ──────────────────────────────

type SubmitResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	OrderSN string `json:"order_sn"`
}

func (a *App) SubmitOrder(orderSN, customerContact, followStaffUID string, price int, attachmentURLs []string, screenshotPath string, screenshotHash string, topic string, pages int, deadline string, remark string) *SubmitResult {
	result := a.doSubmitOrder(orderSN, customerContact, followStaffUID, price, attachmentURLs, screenshotPath, screenshotHash, topic, pages, deadline, remark)
	// 401 时自动刷新 token 重试一次
	if !result.Success && strings.Contains(result.Message, "401") {
		log.Println("⚠️ 提交订单 401，尝试刷新 token 重试")
		a.deviceLogin()
		if a.token != "" {
			return a.doSubmitOrder(orderSN, customerContact, followStaffUID, price, attachmentURLs, screenshotPath, screenshotHash, topic, pages, deadline, remark)
		}
	}
	return result
}

func (a *App) doSubmitOrder(orderSN, customerContact, followStaffUID string, price int, attachmentURLs []string, screenshotPath string, screenshotHash string, topic string, pages int, deadline string, remark string) *SubmitResult {
	payload := map[string]interface{}{
		"order_sn":         orderSN,
		"customer_contact": customerContact,
		"price":            price,
		"follow_uid":       followStaffUID,
		"attachment_urls":  attachmentURLs,
		"screenshot_url":   screenshotPath,
		"screenshot_hash":  screenshotHash,
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

	client := a.httpClient
	resp, err := client.Do(req)
	if err != nil {
		return &SubmitResult{Success: false, Message: "提交失败: " + err.Error()}
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	if resp.StatusCode != 200 {
		msg := "提交失败: HTTP " + strconv.Itoa(resp.StatusCode)
		if e, ok := result["error"]; ok {
			if s, ok2 := e.(string); ok2 {
				msg = s
			}
		}
		// 409 订单号重复时给更明确的提示
		if resp.StatusCode == 409 {
			msg = "该订单号已存在，请勿重复提交。如需重新录入，请更换截图。"
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

// ─── 备注图片上传 ──────────────────────────

type UploadAttachmentResult struct {
	URL   string `json:"url"`
	Error string `json:"error,omitempty"`
}

// UploadAttachmentBase64 上传备注图片（base64），返回服务端 URL
func (a *App) UploadAttachmentBase64(b64DataURL string) *UploadAttachmentResult {
	a.ensureFreshToken()
	result := a.doUploadAttachmentBase64(b64DataURL)
	if result.Error != "" && isAuthError(result.Error) {
		log.Println("⚠️ 附件上传认证失败，尝试刷新 token 重试")
		a.deviceLogin()
		if a.token != "" {
			return a.doUploadAttachmentBase64(b64DataURL)
		}
	}
	return result
}

func (a *App) doUploadAttachmentBase64(b64DataURL string) *UploadAttachmentResult {
	parts := strings.SplitN(b64DataURL, ",", 2)
	if len(parts) != 2 {
		return &UploadAttachmentResult{Error: "无效的图片数据"}
	}

	imgBytes, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return &UploadAttachmentResult{Error: "图片解码失败"}
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", "attachment.png")
	if err != nil {
		return &UploadAttachmentResult{Error: "创建表单失败"}
	}
	io.Copy(part, bytes.NewReader(imgBytes))
	writer.Close()

	req, _ := http.NewRequest("POST", a.serverURL+"/api/v1/orders/upload_attachment", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	client := a.httpClient
	resp, err := client.Do(req)
	if err != nil {
		return &UploadAttachmentResult{Error: "上传失败: " + err.Error()}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		var errResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		json.Unmarshal(respBody, &errResp)
		errMsg := "上传失败: HTTP " + strconv.Itoa(resp.StatusCode)
		if errResp.Message != "" {
			errMsg = errResp.Message
		}
		return &UploadAttachmentResult{Error: errMsg}
	}

	var result map[string]interface{}
	json.Unmarshal(respBody, &result)

	url := ""
	if v, ok := result["url"]; ok {
		url, _ = v.(string)
	}
	return &UploadAttachmentResult{URL: url}
}

// UploadAttachmentFile 通过文件路径上传备注图片
func (a *App) UploadAttachmentFile(filePath string) *UploadAttachmentResult {
	a.ensureFreshToken()
	result := a.doUploadAttachmentFile(filePath)
	if result.Error != "" && isAuthError(result.Error) {
		log.Println("⚠️ 附件上传认证失败，尝试刷新 token 重试")
		a.deviceLogin()
		if a.token != "" {
			return a.doUploadAttachmentFile(filePath)
		}
	}
	return result
}

func (a *App) doUploadAttachmentFile(filePath string) *UploadAttachmentResult {
	file, err := os.Open(filePath)
	if err != nil {
		return &UploadAttachmentResult{Error: "文件打开失败"}
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return &UploadAttachmentResult{Error: "创建表单失败"}
	}
	io.Copy(part, file)
	writer.Close()

	req, _ := http.NewRequest("POST", a.serverURL+"/api/v1/orders/upload_attachment", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	client := a.httpClient
	resp, err := client.Do(req)
	if err != nil {
		return &UploadAttachmentResult{Error: "上传失败: " + err.Error()}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		var errResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		json.Unmarshal(respBody, &errResp)
		errMsg := "上传失败: HTTP " + strconv.Itoa(resp.StatusCode)
		if errResp.Message != "" {
			errMsg = errResp.Message
		}
		return &UploadAttachmentResult{Error: errMsg}
	}

	var result map[string]interface{}
	json.Unmarshal(respBody, &result)

	url := ""
	if v, ok := result["url"]; ok {
		url, _ = v.(string)
	}
	return &UploadAttachmentResult{URL: url}
}

// SelectAttachmentFile 弹出文件选择框选择备注图片
func (a *App) SelectAttachmentFile() string {
	selection, err := wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "选择备注图片",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "Images (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp)",
				Pattern:     "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp",
			},
		},
	})
	if err != nil {
		return ""
	}
	return selection
}

// ─── AI 文本智能解析 ────────────────────────

type ParseTextResult struct {
	Contact     string `json:"contact"`
	ContactType string `json:"contact_type"`
	Theme       string `json:"theme"`
	Pages       int    `json:"pages"`
	Deadline    string `json:"deadline"`
	Remark      string `json:"remark"`
	RawText     string `json:"raw_text"`
	Confidence  string `json:"confidence"`
	FromCache   bool   `json:"from_cache"`
	Error       string `json:"error,omitempty"`
}

// ParseOrderText 调用后端 AI 文本解析接口
func (a *App) ParseOrderText(text string) *ParseTextResult {
	a.ensureFreshToken()
	result := a.doParseOrderText(text)
	if result.Error != "" && isAuthError(result.Error) {
		log.Println("⚠️ 文本解析认证失败，尝试刷新 token 重试")
		a.deviceLogin()
		if a.token != "" {
			return a.doParseOrderText(text)
		}
	}
	return result
}

func (a *App) doParseOrderText(text string) *ParseTextResult {
	payload := map[string]string{"text": text}
	body, _ := json.Marshal(payload)

	req, _ := http.NewRequest("POST", a.serverURL+"/api/v1/orders/parse_text", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}

	client := a.ocrClient
	resp, err := client.Do(req)
	if err != nil {
		return &ParseTextResult{Error: "网络请求失败: " + err.Error()}
	}
	defer resp.Body.Close()

	// 读取原始响应用于调试
	respBody, _ := io.ReadAll(resp.Body)
	log.Printf("📡 parse_text 响应: status=%d body=%s", resp.StatusCode, string(respBody))

	if resp.StatusCode != 200 {
		// 错误响应格式: {"code":"BAD_REQUEST","message":"..."}
		var errResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Error   string `json:"error"`
		}
		json.Unmarshal(respBody, &errResp)
		errMsg := "解析失败: HTTP " + strconv.Itoa(resp.StatusCode)
		if errResp.Message != "" {
			errMsg = errResp.Message
		} else if errResp.Error != "" {
			errMsg = errResp.Error
		}
		return &ParseTextResult{Error: errMsg}
	}

	// 成功响应: respondOK 直接返回结构体（不包裹 data 字段）
	var result ParseTextResult
	if err := json.Unmarshal(respBody, &result); err != nil {
		return &ParseTextResult{Error: "解析响应失败: " + err.Error()}
	}

	return &result
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
