package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/config"
)

var ocrClient = &http.Client{Timeout: 15 * time.Second}
var visionClient = &http.Client{Timeout: 30 * time.Second}

// OCRResult OCR 提取结果
type OCRResult struct {
	OrderSN    string  `json:"order_sn"`
	Price      int     `json:"price"`      // 分
	RawPrice   string  `json:"raw_price"`
	OrderTime  string  `json:"order_time"` // 下单时间
	Confidence float64 `json:"confidence"`
}

// ExtractOrderFromImage 从截图提取订单信息
// 优先级：GLM-OCR（快速文字提取~2s）→ GLM-4V-Flash（视觉理解~5s）→ 通义千问 VL
func ExtractOrderFromImage(imagePath string) (*OCRResult, error) {
	if config.C.ZhipuAPIKey == "" && config.C.DashscopeAPIKey == "" {
		return nil, fmt.Errorf("未配置任何 OCR 密钥 (ZHIPU_API_KEY 或 DASHSCOPE_API_KEY)")
	}

	imgData, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, fmt.Errorf("读取截图文件失败: %w", err)
	}
	ext := strings.ToLower(filepath.Ext(imagePath))
	mimeType := "image/png"
	switch ext {
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".webp":
		mimeType = "image/webp"
	}
	b64Img := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(imgData))

	// 1. 优先 GLM-OCR（专用 OCR 模型，速度最快 ~2s，文字识别最准）
	if config.C.ZhipuAPIKey != "" {
		start := time.Now()
		result, err := extractViaGLMOCR(b64Img)
		if err == nil && result.OrderSN != "" {
			log.Printf("✅ GLM-OCR 提取成功 (%v) | 订单号=%s 金额=%s 时间=%s",
				time.Since(start), result.OrderSN, result.RawPrice, result.OrderTime)
			return result, nil
		}
		if err != nil {
			log.Printf("⚠️ GLM-OCR 失败 (%v): %v", time.Since(start), err)
		} else {
			log.Printf("⚠️ GLM-OCR 未提取到订单号 (%v)，尝试视觉模型", time.Since(start))
		}
	}

	// 2. 回退 GLM-4V-Flash 视觉理解（准确率高但较慢 ~5s）
	if config.C.ZhipuAPIKey != "" {
		start := time.Now()
		result, err := extractViaZhipuVL(b64Img)
		if err == nil {
			log.Printf("✅ GLM-4V-Flash 视觉识别成功 (%v)", time.Since(start))
			return result, nil
		}
		log.Printf("⚠️ GLM-4V-Flash 失败 (%v): %v", time.Since(start), err)
	}

	// 3. 回退通义千问 VL
	if config.C.DashscopeAPIKey != "" {
		result, err := extractViaDashscope(b64Img)
		if err == nil {
			return result, nil
		}
		log.Printf("❌ 通义千问 VL 也失败: %v", err)
	}

	return nil, fmt.Errorf("所有 OCR 模型均失败")
}

// ─── GLM-OCR 专用文字提取（最快）─────────────────────────

func extractViaGLMOCR(b64Img string) (*OCRResult, error) {
	payload := map[string]interface{}{
		"model": "glm-ocr",
		"file":  b64Img,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", "https://open.bigmodel.cn/api/paas/v4/layout_parsing", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.C.ZhipuAPIKey)

	resp, err := ocrClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求发送失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API 返回错误 (HTTP %d): %s", resp.StatusCode, string(respBody[:min(len(respBody), 200)]))
	}

	// 解析 layout_parsing 响应，拼接所有文本块
	var ocrResp struct {
		LayoutDetails [][]struct {
			Content string `json:"content"`
			Label   string `json:"label"`
		} `json:"layout_details"`
	}
	if err := json.Unmarshal(respBody, &ocrResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	var texts []string
	for _, page := range ocrResp.LayoutDetails {
		for _, item := range page {
			if item.Content != "" {
				texts = append(texts, item.Content)
			}
		}
	}

	if len(texts) == 0 {
		return nil, fmt.Errorf("未识别到任何文字")
	}

	fullText := strings.Join(texts, " ")
	log.Printf("📝 GLM-OCR 文本 (%d块): %s", len(texts), truncate(fullText, 200))

	result := extractFromRawText(fullText)
	result.Confidence += 0.1 // GLM-OCR 文字准确度高，加分
	if result.Confidence > 1.0 {
		result.Confidence = 1.0
	}
	return result, nil
}

func truncate(s string, maxLen int) string {
	r := []rune(s)
	if len(r) <= maxLen {
		return s
	}
	return string(r[:maxLen]) + "..."
}

// ─── GLM-4V-Flash 视觉理解（回退）────────────────────────

const visionPrompt = `提取订单截图中的3个字段，严格只返回JSON：
{"order_sn":"订单号数字","price":"实付金额如183.98","order_time":"2026-01-15 14:30:00"}
注意：price取实付/合计金额，不是原价。`

func extractViaZhipuVL(b64Img string) (*OCRResult, error) {
	payload := map[string]interface{}{
		"model":       "glm-4v-flash",
		"max_tokens":  150,
		"temperature": 0.1,
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "image_url", "image_url": map[string]string{"url": b64Img}},
					{"type": "text", "text": visionPrompt},
				},
			},
		},
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", "https://open.bigmodel.cn/api/paas/v4/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.C.ZhipuAPIKey)

	resp, err := visionClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求发送失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API 返回错误 (HTTP %d)", resp.StatusCode)
	}

	return parseChatResponse(respBody)
}

// ─── 通义千问 VL（最终回退）─────────────────────────────

func extractViaDashscope(b64Img string) (*OCRResult, error) {
	payload := map[string]interface{}{
		"model":       "qwen-vl-max",
		"max_tokens":  150,
		"temperature": 0.1,
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "image_url", "image_url": map[string]string{"url": b64Img}},
					{"type": "text", "text": visionPrompt},
				},
			},
		},
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.C.DashscopeAPIKey)

	resp, err := visionClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求发送失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API 返回错误 (HTTP %d)", resp.StatusCode)
	}

	return parseChatResponse(respBody)
}

// ─── 解析工具函数 ─────────────────────────────────────

func parseChatResponse(respBody []byte) (*OCRResult, error) {
	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &chatResp); err != nil || len(chatResp.Choices) == 0 {
		return extractFromRawText(string(respBody)), nil
	}

	content := chatResp.Choices[0].Message.Content
	log.Printf("📝 模型提取内容: %s", content)

	if result := parseOCRJSON(content); result != nil {
		return result, nil
	}
	return extractFromRawText(content), nil
}

func parseOCRJSON(content string) *OCRResult {
	jsonStr := content
	if idx := strings.Index(content, "{"); idx >= 0 {
		if end := strings.LastIndex(content, "}"); end > idx {
			jsonStr = content[idx : end+1]
		}
	}

	var parsed struct {
		OrderSN   string `json:"order_sn"`
		Price     string `json:"price"`
		OrderTime string `json:"order_time"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil
	}

	result := &OCRResult{
		OrderSN:    parsed.OrderSN,
		OrderTime:  parsed.OrderTime,
		Confidence: 0.9,
	}

	if parsed.Price != "" {
		if priceYuan, err := strconv.ParseFloat(parsed.Price, 64); err == nil && priceYuan > 0 {
			result.Price = int(priceYuan * 100)
			result.RawPrice = parsed.Price
		}
	}

	return result
}

func extractFromRawText(text string) *OCRResult {
	result := &OCRResult{Confidence: 0.5}

	// 提取订单号（订单编号优先，然后尝试长数字串）
	orderRe := regexp.MustCompile(`(?:订单号|单号|订单编号|Order)[：:\s]*(\d[\d-]{9,25})`)
	if m := orderRe.FindStringSubmatch(text); len(m) > 1 {
		result.OrderSN = strings.ReplaceAll(m[1], "-", "")
		result.Confidence += 0.2
	} else {
		longNumRe := regexp.MustCompile(`\d{12,25}`)
		if m := longNumRe.FindString(text); m != "" {
			result.OrderSN = m
			result.Confidence += 0.1
		}
	}

	// 提取金额（商品标价优先，因为实付可能是0）
	pricePatterns := []string{
		`[¥￥](\d+\.\d{2})`,
		`(?:实付|实付款|合计|应付|总价|付款)[：:\s¥￥]*(\d+\.?\d{0,2})`,
		`(\d+\.\d{2})\s*元`,
	}
	for _, pattern := range pricePatterns {
		priceRe := regexp.MustCompile(pattern)
		if m := priceRe.FindStringSubmatch(text); len(m) > 1 {
			if priceYuan, err := strconv.ParseFloat(m[1], 64); err == nil && priceYuan > 0 {
				result.Price = int(priceYuan * 100)
				result.RawPrice = m[1]
				result.Confidence += 0.2
				break
			}
		}
	}

	// 提取下单时间
	timePatterns := []string{
		`(?:下单时间|付款时间|支付时间|创建时间|拍下时间|成交时间|订单时间)[：:\s]*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*\d{1,2}:\d{2}(?::\d{2})?)`,
		`(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)`,
	}
	for _, pattern := range timePatterns {
		timeRe := regexp.MustCompile(pattern)
		if m := timeRe.FindStringSubmatch(text); len(m) > 1 {
			result.OrderTime = strings.TrimSpace(m[1])
			break
		}
	}

	if result.Confidence > 1.0 {
		result.Confidence = 1.0
	}
	return result
}
