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

// ocrClient OCR 专用 HTTP 客户端
var ocrClient = &http.Client{
	Timeout: 120 * time.Second,
}

// OCRResult OCR 提取结果
type OCRResult struct {
	OrderSN    string  `json:"order_sn"`
	Price      int     `json:"price"`      // 分
	RawPrice   string  `json:"raw_price"`
	OrderTime  string  `json:"order_time"` // 下单时间
	Confidence float64 `json:"confidence"`
}

// ocrPrompt 统一的 OCR 提取 prompt
const ocrPrompt = `请仔细分析这张电商订单截图，提取以下3个关键信息：

1. order_sn: 订单号（一串连续数字，通常15-20位，可能出现在"订单号"、"单号"附近）
2. price: 实付金额（找"¥"或"￥"符号后面的数字，或"实付"、"合计"、"应付"后面的金额，单位是元，如 "183.98"）
3. order_time: 下单/付款时间（格式如 "2026-01-15 14:30:00"）

注意：
- price 是买家实际支付的金额，不是商品原价，请仔细查找带有¥符号的金额
- 如果截图中有多个金额，取"实付"或最终支付的那个
- 严格只返回JSON，不要任何其他文字

{"order_sn": "123456789012345", "price": "183.98", "order_time": "2026-01-15 14:30:00"}`

// ExtractOrderFromImage 从截图提取订单信息（智谱GLM-4V优先，DashScope备用）
func ExtractOrderFromImage(imagePath string) (*OCRResult, error) {
	// 读取图片转 base64（两个模型都需要）
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

	// 1. 优先智谱 GLM-4V 多模态聊天（比 Files OCR 接口稳定）
	if config.C.ZhipuAPIKey != "" {
		result, err := extractViaZhipuVL(b64Img)
		if err == nil {
			return result, nil
		}
		log.Printf("⚠️ 智谱 GLM-4V 失败: %v", err)
	}

	// 2. 回退通义千问 VL
	if config.C.DashscopeAPIKey != "" {
		result, err := extractViaDashscope(b64Img)
		if err == nil {
			return result, nil
		}
		log.Printf("❌ 通义千问 VL 也失败: %v", err)
		return nil, fmt.Errorf("所有 OCR 模型均失败")
	}

	if config.C.ZhipuAPIKey == "" && config.C.DashscopeAPIKey == "" {
		return nil, fmt.Errorf("未配置任何 OCR 密钥 (ZHIPU_API_KEY 或 DASHSCOPE_API_KEY)")
	}

	return nil, fmt.Errorf("OCR 解析失败")
}

// extractViaZhipuVL 使用智谱 GLM-4V 多模态聊天接口（OpenAI 兼容格式，base64 传图）
func extractViaZhipuVL(b64Img string) (*OCRResult, error) {
	payload := map[string]interface{}{
		"model": "glm-4v-plus",
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "image_url", "image_url": map[string]string{"url": b64Img}},
					{"type": "text", "text": ocrPrompt},
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
		log.Printf("❌ 智谱 GLM-4V API 返回 %d: %s", resp.StatusCode, string(respBody))
		return nil, fmt.Errorf("API 返回错误 (HTTP %d)", resp.StatusCode)
	}

	log.Printf("✅ 智谱 GLM-4V 原始响应: %s", string(respBody))
	return parseChatResponse(respBody)
}

// extractViaDashscope 使用通义千问 VL 多模态大模型
func extractViaDashscope(b64Img string) (*OCRResult, error) {
	payload := map[string]interface{}{
		"model": "qwen-vl-max",
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "image_url", "image_url": map[string]string{"url": b64Img}},
					{"type": "text", "text": ocrPrompt},
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
		log.Printf("❌ DashScope API 返回 %d: %s", resp.StatusCode, string(respBody))
		return nil, fmt.Errorf("API 返回错误 (HTTP %d)", resp.StatusCode)
	}

	log.Printf("✅ 通义千问 VL 原始响应: %s", string(respBody))
	return parseChatResponse(respBody)
}

// parseChatResponse 统一解析 OpenAI 兼容的聊天响应
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

	// 尝试从 content 中解析 JSON
	result := parseOCRJSON(content)
	if result != nil {
		return result, nil
	}

	// JSON 解析失败，用正则兜底
	return extractFromRawText(content), nil
}

// parseOCRJSON 从模型返回的文本中解析 JSON
func parseOCRJSON(content string) *OCRResult {
	// 提取 JSON 块（可能被 markdown code fence 包裹）
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

// extractFromRawText 从原始文本中用正则提取订单号、金额、时间（兜底方案）
func extractFromRawText(text string) *OCRResult {
	result := &OCRResult{Confidence: 0.5}

	// 提取订单号
	orderRe := regexp.MustCompile(`(?:订单号|单号|订单编号|Order)[:\s：]*(\d{10,25})`)
	if m := orderRe.FindStringSubmatch(text); len(m) > 1 {
		result.OrderSN = m[1]
		result.Confidence += 0.2
	} else {
		longNumRe := regexp.MustCompile(`\d{12,25}`)
		if m := longNumRe.FindString(text); m != "" {
			result.OrderSN = m
			result.Confidence += 0.1
		}
	}

	// 提取金额
	pricePatterns := []string{
		`(?:实付|实付款|合计|应付|总价|total|付款)[:\s：¥￥]*(\d+\.?\d{0,2})`,
		`[¥￥](\d+\.?\d{0,2})`,
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
