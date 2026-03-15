package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"pdd-order-system/config"
)

var systemPrompt = `你是一个专业的电商订单截图解析助手。请从下方的PDD(拼多多)订单截图中提取以下信息：
1. 订单编号（通常是一串数字）
2. 实付金额（实际支付的金额，单位：元）

请严格以下方 JSON 格式返回结果，不要有多余文字：
{"order_sn": "订单编号", "price": "金额数字(不含单位符号)"}

如果无法识别某个字段，对应值填空字符串。`

// OCRResult OCR 提取结果
type OCRResult struct {
	OrderSN    string  `json:"order_sn"`
	Price      int     `json:"price"`      // 分
	RawPrice   string  `json:"raw_price"`
	Confidence float64 `json:"confidence"`
}

// ExtractOrderFromImage 从截图提取订单信息
func ExtractOrderFromImage(imagePath string) (*OCRResult, error) {
	data, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, fmt.Errorf("读取截图失败: %w", err)
	}

	b64 := base64.StdEncoding.EncodeToString(data)
	mime := "image/jpeg"
	if strings.HasSuffix(strings.ToLower(imagePath), ".png") {
		mime = "image/png"
	}
	dataURL := fmt.Sprintf("data:%s;base64,%s", mime, b64)

	switch config.C.OCRProvider {
	case "zhipu":
		return callZhipuVision(dataURL)
	case "dashscope":
		return callDashscopeVision(dataURL)
	default:
		return nil, fmt.Errorf("不支持的 OCR provider: %s", config.C.OCRProvider)
	}
}

func callZhipuVision(dataURL string) (*OCRResult, error) {
	if config.C.ZhipuAPIKey == "" {
		return nil, fmt.Errorf("ZHIPU_API_KEY 未配置")
	}

	payload := map[string]interface{}{
		"model": "glm-4v-flash",
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "text", "text": systemPrompt},
					{"type": "image_url", "image_url": map[string]string{"url": dataURL}},
				},
			},
		},
		"temperature": 0.1,
		"max_tokens":  256,
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "https://open.bigmodel.cn/api/paas/v4/chat/completions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.C.ZhipuAPIKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("GLM-4V 返回空结果")
	}

	return parseLLMResponse(result.Choices[0].Message.Content), nil
}

func callDashscopeVision(dataURL string) (*OCRResult, error) {
	if config.C.DashscopeAPIKey == "" {
		return nil, fmt.Errorf("DASHSCOPE_API_KEY 未配置")
	}

	payload := map[string]interface{}{
		"model": "qwen-vl-plus",
		"messages": []map[string]interface{}{
			{
				"role": "user",
				"content": []map[string]interface{}{
					{"type": "text", "text": systemPrompt},
					{"type": "image_url", "image_url": map[string]string{"url": dataURL}},
				},
			},
		},
		"temperature": 0.1,
		"max_tokens":  256,
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.C.DashscopeAPIKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if len(result.Choices) == 0 {
		return nil, fmt.Errorf("Qwen-VL 返回空结果")
	}

	return parseLLMResponse(result.Choices[0].Message.Content), nil
}

func parseLLMResponse(content string) *OCRResult {
	result := &OCRResult{}

	re := regexp.MustCompile(`\{[^}]+\}`)
	match := re.FindString(content)
	if match == "" {
		preview := content
		if len(preview) > 200 {
			preview = preview[:200]
		}
		log.Printf("⚠️ OCR 响应无 JSON: %s", preview)
		return result
	}

	var parsed map[string]string
	if err := json.Unmarshal([]byte(match), &parsed); err != nil {
		log.Printf("⚠️ OCR JSON 解析失败: %v", err)
		return result
	}

	result.OrderSN = strings.TrimSpace(parsed["order_sn"])
	result.RawPrice = strings.TrimSpace(parsed["price"])

	priceRe := regexp.MustCompile(`[\d.]+`)
	priceMatch := priceRe.FindString(result.RawPrice)
	if priceMatch != "" {
		if priceYuan, err := strconv.ParseFloat(priceMatch, 64); err == nil {
			result.Price = int(priceYuan * 100)
			result.Confidence = 0.9
		}
	}

	if result.OrderSN != "" {
		c := result.Confidence + 0.05
		if c > 1.0 {
			c = 1.0
		}
		result.Confidence = c
	}

	return result
}
