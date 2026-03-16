package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/config"
)

// OCRResult OCR 提取结果
type OCRResult struct {
	OrderSN    string  `json:"order_sn"`
	Price      int     `json:"price"`      // 分
	RawPrice   string  `json:"raw_price"`
	Confidence float64 `json:"confidence"`
}

// ExtractOrderFromImage 从截图提取订单信息
// 使用智谱 Files OCR API (https://open.bigmodel.cn/api/paas/v4/files/ocr)
func ExtractOrderFromImage(imagePath string) (*OCRResult, error) {
	if config.C.ZhipuAPIKey == "" {
		return nil, fmt.Errorf("ZHIPU_API_KEY 未配置")
	}

	// 1. 构建 multipart form
	file, err := os.Open(imagePath)
	if err != nil {
		return nil, fmt.Errorf("打开截图文件失败: %w", err)
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// 添加文件字段
	part, err := writer.CreateFormFile("file", filepath.Base(imagePath))
	if err != nil {
		return nil, fmt.Errorf("创建 form file 失败: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, fmt.Errorf("复制文件内容失败: %w", err)
	}

	// 添加 OCR 参数
	_ = writer.WriteField("tool_type", "hand_write")     // 通用手写+打印
	_ = writer.WriteField("language_type", "CHN_ENG")     // 中英文混合
	_ = writer.WriteField("probability", "true")          // 返回置信度

	writer.Close()

	// 2. 发送请求
	req, err := http.NewRequest("POST", "https://open.bigmodel.cn/api/paas/v4/files/ocr", &buf)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+config.C.ZhipuAPIKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OCR 请求发送失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取 OCR 响应失败: %w", err)
	}

	if resp.StatusCode != 200 {
		log.Printf("❌ 智谱 OCR API 返回 %d: %s", resp.StatusCode, string(respBody))
		return nil, fmt.Errorf("OCR API 返回错误 (HTTP %d)", resp.StatusCode)
	}

	log.Printf("✅ 智谱 OCR 原始响应: %s", string(respBody))

	// 3. 解析 OCR 返回
	return parseZhipuOCRResponse(respBody)
}

// parseZhipuOCRResponse 解析智谱 OCR 文件接口的返回
// 响应格式: {"words_result": [{"words": "...", "probability": {...}}, ...], "words_result_num": N}
func parseZhipuOCRResponse(body []byte) (*OCRResult, error) {
	var ocrResp struct {
		WordsResult []struct {
			Words       string `json:"words"`
			Probability struct {
				Average float64 `json:"average"`
			} `json:"probability"`
		} `json:"words_result"`
		WordsResultNum int `json:"words_result_num"`
	}

	if err := json.Unmarshal(body, &ocrResp); err != nil {
		// 尝试解析为其他可能的格式
		log.Printf("⚠️ 标准格式解析失败，尝试通用文本提取: %v", err)
		return extractFromRawText(string(body)), nil
	}

	if ocrResp.WordsResultNum == 0 || len(ocrResp.WordsResult) == 0 {
		return nil, fmt.Errorf("OCR 未识别到任何文字")
	}

	// 拼接所有识别出的文字行
	var allText strings.Builder
	var totalConf float64
	for _, w := range ocrResp.WordsResult {
		allText.WriteString(w.Words)
		allText.WriteString("\n")
		totalConf += w.Probability.Average
	}
	avgConf := totalConf / float64(len(ocrResp.WordsResult))

	fullText := allText.String()
	log.Printf("📝 OCR 识别文本:\n%s", fullText)

	result := extractFromRawText(fullText)
	if avgConf > 0 {
		result.Confidence = avgConf
	}

	return result, nil
}

// extractFromRawText 从原始文本中提取订单号和金额
func extractFromRawText(text string) *OCRResult {
	result := &OCRResult{Confidence: 0.5}

	// 提取订单号: 拼多多订单号通常是纯数字，15-20位
	orderRe := regexp.MustCompile(`(?:订单号|单号|订单编号|Order)[:\s：]*(\d{10,25})`)
	if m := orderRe.FindStringSubmatch(text); len(m) > 1 {
		result.OrderSN = m[1]
		result.Confidence += 0.2
	} else {
		// 退而求其次: 找最长的连续数字串 (>= 12 位)
		longNumRe := regexp.MustCompile(`\d{12,25}`)
		if m := longNumRe.FindString(text); m != "" {
			result.OrderSN = m
			result.Confidence += 0.1
		}
	}

	// 提取金额: 匹配 "实付" / "实付款" / "合计" / "总价" 后面的数字
	pricePatterns := []string{
		`(?:实付|实付款|合计|应付|总价|total|付款)[:\s：¥￥]*(\d+\.?\d{0,2})`,
		`[¥￥](\d+\.?\d{0,2})`,
		`(\d+\.\d{2})\s*元`,
	}

	for _, pattern := range pricePatterns {
		priceRe := regexp.MustCompile(pattern)
		if m := priceRe.FindStringSubmatch(text); len(m) > 1 {
			if priceYuan, err := strconv.ParseFloat(m[1], 64); err == nil && priceYuan > 0 {
				result.Price = int(priceYuan * 100) // 转为分
				result.RawPrice = m[1]
				result.Confidence += 0.2
				break
			}
		}
	}

	if result.Confidence > 1.0 {
		result.Confidence = 1.0
	}

	return result
}
