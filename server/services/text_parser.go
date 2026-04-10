package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"pdd-order-system/config"
)

// TextParseResult 文本解析结果
type TextParseResult struct {
	Contact     string `json:"contact"`      // 联系方式（微信号或手机号）
	ContactType string `json:"contact_type"` // "wechat" | "phone" | ""
	Theme       string `json:"theme"`        // PPT主题
	Pages       int    `json:"pages"`        // 页数
	Deadline    string `json:"deadline"`     // 交付时间（原文）
	Remark      string `json:"remark"`       // 其他备注
	RawText     string `json:"raw_text"`     // 原始文本（保留）
	Confidence  string `json:"confidence"`   // "high" | "medium" | "low"
	FromCache   bool   `json:"from_cache"`   // 是否来自缓存
}

// ─── 解析缓存（按文本哈希隔离，防止重复消耗 token）────────────

type parseCache struct {
	mu    sync.RWMutex
	items map[string]*parseCacheItem
}

type parseCacheItem struct {
	result    *TextParseResult
	createdAt time.Time
}

var textParseCache = &parseCache{
	items: make(map[string]*parseCacheItem),
}

const parseCacheTTL = 30 * time.Minute // 缓存 30 分钟

func textHash(text string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(text)))
	return fmt.Sprintf("%x", h[:16]) // 前 16 字节足够
}

func (pc *parseCache) get(hash string) (*TextParseResult, bool) {
	pc.mu.RLock()
	defer pc.mu.RUnlock()
	item, ok := pc.items[hash]
	if !ok {
		return nil, false
	}
	if time.Since(item.createdAt) > parseCacheTTL {
		return nil, false
	}
	result := *item.result // 返回副本
	result.FromCache = true
	return &result, true
}

func (pc *parseCache) set(hash string, result *TextParseResult) {
	pc.mu.Lock()
	defer pc.mu.Unlock()
	pc.items[hash] = &parseCacheItem{
		result:    result,
		createdAt: time.Now(),
	}
	// 简单清理：超过 200 条时删除最旧的一半
	if len(pc.items) > 200 {
		for k, v := range pc.items {
			if time.Since(v.createdAt) > parseCacheTTL {
				delete(pc.items, k)
			}
		}
	}
}

// ─── 对外接口 ────────────────────────────────────────

// ParseOrderText 从自由文本中提取订单结构化信息
// 策略：正则优先 → LLM 兜底
func ParseOrderText(rawText string) (*TextParseResult, error) {
	text := strings.TrimSpace(rawText)
	if text == "" {
		return nil, fmt.Errorf("文本不能为空")
	}

	// 1. 检查缓存
	hash := textHash(text)
	if cached, ok := textParseCache.get(hash); ok {
		log.Printf("📦 文本解析命中缓存: hash=%s", hash[:8])
		return cached, nil
	}

	// 2. 先用正则提取高确定性字段
	regexResult := extractByRegex(text)

	// 3. 始终尝试 LLM 解析以提取主题等正则无法捕获的字段
	//    缓存机制已确保同一文本不会重复消耗 token

	// 4. 调用 GLM-4-Air 做全量解析
	if config.C.ZhipuAPIKey != "" {
		llmResult, err := parseViaLLM(text)
		if err != nil {
			log.Printf("⚠️ LLM 文本解析失败: %v, 回退到正则结果", err)
		} else {
			// 合并：正则结果 + LLM 结果，正则提取的联系方式优先（更可靠）
			merged := mergeParsedResults(regexResult, llmResult)
			merged.Confidence = "high"
			merged.RawText = text
			textParseCache.set(hash, merged)
			return merged, nil
		}
	}

	// 5. LLM 不可用或失败，返回纯正则结果
	regexResult.Confidence = "low"
	regexResult.RawText = text
	textParseCache.set(hash, regexResult)
	return regexResult, nil
}

// ─── 正则提取 ────────────────────────────────────────

// 手机号正则
var phoneRe = regexp.MustCompile(`(?:手机|电话|tel|phone)?[：:\s]*?(1[3-9]\d{9})`)

// wxid_ 专用正则（最高优先级，独立匹配，不需要前缀关键词）
var wxidRe = regexp.MustCompile(`(wxid_[\w]{6,30})`)

// 微信号正则：字母开头6-20位，必须有"微信/vx/weixin"等前缀关键词
// 注意：不含 "wx" 前缀，因为会误吞 wxid_ 中的 wx。wxid_ 由 wxidRe 单独处理
var wechatRe = regexp.MustCompile(`(?:微信|weixin|vx)[号是：:\s]*?([a-zA-Z][\w-]{5,19})`)

// 页数正则
var pagesRe = regexp.MustCompile(`(\d{1,4})\s*[页pP张]`)

// 交付时间正则：匹配常见中文时间表达
var deadlinePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?:交付|交稿|截止|deadline|完成|要)[时间日期：:\s]*?(\d{1,2}[月/.-]\d{1,2}[日号]?(?:\s*\d{1,2}[点:时]\d{0,2})?)`),
	regexp.MustCompile(`(今[天日]|明[天日]|后[天日]|大后[天日]|下?周[一二三四五六日天]|(?:\d{1,2}[月/.-]\d{1,2}[日号]?))`),
}

func extractByRegex(text string) *TextParseResult {
	result := &TextParseResult{}

	// 提取手机号
	if m := phoneRe.FindStringSubmatch(text); len(m) > 1 {
		result.Contact = m[1]
		result.ContactType = "phone"
	}

	// 最高优先级：wxid_ 开头的微信ID（不需要关键词前缀）
	if m := wxidRe.FindStringSubmatch(text); len(m) > 1 {
		result.Contact = m[1]
		result.ContactType = "wechat"
	} else if m := wechatRe.FindStringSubmatch(text); len(m) > 1 {
		// 有关键词前缀的普通微信号
		result.Contact = m[1]
		result.ContactType = "wechat"
	}

	// 如果上面都没匹配到，尝试宽松匹配：独立的11位手机号
	if result.Contact == "" {
		loosePhone := regexp.MustCompile(`\b(1[3-9]\d{9})\b`)
		if m := loosePhone.FindStringSubmatch(text); len(m) > 1 {
			result.Contact = m[1]
			result.ContactType = "phone"
		}
	}

	// 提取页数
	if m := pagesRe.FindStringSubmatch(text); len(m) > 1 {
		if p, err := strconv.Atoi(m[1]); err == nil && p > 0 && p < 9999 {
			result.Pages = p
		}
	}

	// 提取交付时间
	for _, re := range deadlinePatterns {
		if m := re.FindStringSubmatch(text); len(m) > 1 {
			result.Deadline = strings.TrimSpace(m[1])
			break
		}
	}

	return result
}

// ─── LLM 解析 ────────────────────────────────────────

const parsePrompt = `你是一个订单信息提取助手。请从用户输入的文本中提取以下结构化字段。

提取规则：
1. contact: 客户联系方式（手机号或微信号）。手机号是11位数字(1开头)，微信号通常是字母数字组合。
2. contact_type: 联系方式类型。手机号填"phone"，微信号填"wechat"，无法确定填""。
3. theme: PPT主题或设计需求描述。提取核心需求，简明扼要。
4. pages: 页数（纯数字）。无法确定填0。
5. deadline: 交付时间。保留用户原文表述（如"明天""后天""周五"等）。无法确定填""。
6. remark: 除以上字段外的其他补充信息。无额外信息填""。

严格只返回 JSON，不要任何其他文字：
{"contact":"","contact_type":"","theme":"","pages":0,"deadline":"","remark":""}`

// textParseClient LLM 文本解析专用 HTTP 客户端（独立于 OCR 客户端）
var textParseClient = &http.Client{
	Timeout: 15 * time.Second,
}

func parseViaLLM(text string) (*TextParseResult, error) {
	payload := map[string]interface{}{
		"model": "glm-4-air",
		"messages": []map[string]interface{}{
			{"role": "system", "content": parsePrompt},
			{"role": "user", "content": text},
		},
		"temperature": 0.1, // 低温度，确保确定性输出
		"max_tokens":  256,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", "https://open.bigmodel.cn/api/paas/v4/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.C.ZhipuAPIKey)

	resp, err := textParseClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求发送失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != 200 {
		log.Printf("❌ GLM-4-Air 文本解析 API 返回 %d: %s", resp.StatusCode, string(respBody))
		return nil, fmt.Errorf("API 返回错误 (HTTP %d)", resp.StatusCode)
	}

	log.Printf("✅ GLM-4-Air 文本解析响应: status=%d len=%d", resp.StatusCode, len(respBody))

	// 解析 OpenAI 兼容响应
	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &chatResp); err != nil || len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("解析响应 JSON 失败")
	}

	content := chatResp.Choices[0].Message.Content
	log.Printf("📝 LLM 文本解析内容: %s", content)

	// 提取 JSON（可能被 markdown code fence 包裹）
	jsonStr := content
	if idx := strings.Index(content, "{"); idx >= 0 {
		if end := strings.LastIndex(content, "}"); end > idx {
			jsonStr = content[idx : end+1]
		}
	}

	var parsed struct {
		Contact     string      `json:"contact"`
		ContactType string      `json:"contact_type"`
		Theme       string      `json:"theme"`
		Pages       interface{} `json:"pages"` // 可能是 int 或 string
		Deadline    string      `json:"deadline"`
		Remark      string      `json:"remark"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil, fmt.Errorf("解析 LLM 返回的 JSON 失败: %w", err)
	}

	// 处理页数：可能是 int 或 string
	pages := 0
	switch v := parsed.Pages.(type) {
	case float64:
		pages = int(v)
	case string:
		if p, err := strconv.Atoi(v); err == nil {
			pages = p
		}
	}

	return &TextParseResult{
		Contact:     strings.TrimSpace(parsed.Contact),
		ContactType: strings.TrimSpace(parsed.ContactType),
		Theme:       strings.TrimSpace(parsed.Theme),
		Pages:       pages,
		Deadline:    strings.TrimSpace(parsed.Deadline),
		Remark:      strings.TrimSpace(parsed.Remark),
	}, nil
}

// ─── 结果合并 ────────────────────────────────────────

// mergeParsedResults 合并正则结果和 LLM 结果
// 原则：联系方式以正则优先（更可靠），其他字段以 LLM 优先（更智能）
func mergeParsedResults(regex, llm *TextParseResult) *TextParseResult {
	result := &TextParseResult{}

	// 联系方式：正则优先
	if regex.Contact != "" {
		result.Contact = regex.Contact
		result.ContactType = regex.ContactType
	} else if llm.Contact != "" {
		result.Contact = llm.Contact
		result.ContactType = llm.ContactType
	}

	// 主题：LLM 优先
	if llm.Theme != "" {
		result.Theme = llm.Theme
	}

	// 页数：优先正则（数字提取更准），LLM 兜底
	if regex.Pages > 0 {
		result.Pages = regex.Pages
	} else if llm.Pages > 0 {
		result.Pages = llm.Pages
	}

	// 交付时间：LLM 优先（能理解"后天"等自然语言）
	if llm.Deadline != "" {
		result.Deadline = llm.Deadline
	} else if regex.Deadline != "" {
		result.Deadline = regex.Deadline
	}

	// 备注：LLM 提取
	result.Remark = llm.Remark

	return result
}
