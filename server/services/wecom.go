package services

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"pdd-order-system/config"
)

// WeComClient 企业微信 API 客户端
type WeComClient struct {
	corpID     string
	corpSecret string
	agentID    int
	baseURL    string
	token      string
	expiresAt  time.Time
	mu         sync.Mutex
	client     *http.Client
}

var Wecom *WeComClient

func InitWecom() {
	Wecom = &WeComClient{
		corpID:     config.C.WecomCorpID,
		corpSecret: config.C.WecomCorpSecret,
		agentID:    config.C.WecomAgentID,
		baseURL:    "https://qyapi.weixin.qq.com/cgi-bin",
		client:     &http.Client{Timeout: 15 * time.Second},
	}
	if Wecom.IsConfigured() {
		log.Println("✅ 企微客户端初始化完成")
	} else {
		log.Println("⚠️  企微未配置 (WECOM_CORP_ID / WECOM_CORP_SECRET)")
	}
}

func (w *WeComClient) IsConfigured() bool {
	return w.corpID != "" && w.corpSecret != ""
}

func (w *WeComClient) GetAccessToken() (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.token != "" && time.Now().Before(w.expiresAt) {
		return w.token, nil
	}

	url := fmt.Sprintf("%s/gettoken?corpid=%s&corpsecret=%s", w.baseURL, w.corpID, w.corpSecret)
	resp, err := w.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("获取企微token失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.ErrCode != 0 {
		return "", fmt.Errorf("企微token错误: %d %s", result.ErrCode, result.ErrMsg)
	}

	w.token = result.AccessToken
	w.expiresAt = time.Now().Add(time.Duration(result.ExpiresIn-300) * time.Second)
	log.Println("✅ 企微 access_token 获取成功")
	return w.token, nil
}

// SendTextMessage 发送文本消息
func (w *WeComClient) SendTextMessage(userIDs []string, content string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]interface{}{
		"touser":  strings.Join(userIDs, "|"),
		"msgtype": "text",
		"agentid": w.agentID,
		"text":    map[string]string{"content": content},
	}
	return w.postJSON(fmt.Sprintf("%s/message/send?access_token=%s", w.baseURL, token), payload)
}

// SendTextCardMessage 发送卡片消息（抢单用）
func (w *WeComClient) SendTextCardMessage(userIDs []string, title, desc, url string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]interface{}{
		"touser":  strings.Join(userIDs, "|"),
		"msgtype": "textcard",
		"agentid": w.agentID,
		"textcard": map[string]string{
			"title":       title,
			"description": desc,
			"url":         url,
			"btntxt":      "立即接单",
		},
	}
	return w.postJSON(fmt.Sprintf("%s/message/send?access_token=%s", w.baseURL, token), payload)
}

// CreateGroupChat 创建群聊
func (w *WeComClient) CreateGroupChat(name, ownerID string, memberIDs []string) (string, error) {
	if !w.IsConfigured() {
		return "", nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return "", err
	}

	payload := map[string]interface{}{
		"name":     name,
		"owner":    ownerID,
		"userlist": memberIDs,
	}

	body, err := w.postJSONRaw(fmt.Sprintf("%s/appchat/create?access_token=%s", w.baseURL, token), payload)
	if err != nil {
		return "", err
	}

	var result struct {
		ErrCode int    `json:"errcode"`
		ChatID  string `json:"chatid"`
	}
	json.Unmarshal(body, &result)
	if result.ErrCode != 0 {
		return "", fmt.Errorf("创建群聊失败: errcode=%d", result.ErrCode)
	}
	log.Printf("✅ 企微群聊创建成功 | chatid=%s", result.ChatID)
	return result.ChatID, nil
}

// SendGroupMessage 群聊发消息
func (w *WeComClient) SendGroupMessage(chatID, content string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]interface{}{
		"chatid":  chatID,
		"msgtype": "text",
		"text":    map[string]string{"content": content},
	}
	return w.postJSON(fmt.Sprintf("%s/appchat/send?access_token=%s", w.baseURL, token), payload)
}

// NotifyNewOrder 新订单通知设计师
func (w *WeComClient) NotifyNewOrder(orderSN, operatorName, topic string, pages, priceFen int, deadlineStr string, designerIDs []string) error {
	if !w.IsConfigured() || len(designerIDs) == 0 {
		return nil
	}

	priceYuan := float64(priceFen) / 100
	desc := fmt.Sprintf("📋 新PPT订单\n━━━━━━━━━━━\n订单号: %s\n客服: %s\n主题: %s\n页数: %d页\n金额: ¥%.2f\n交付: %s\n━━━━━━━━━━━\n点击下方按钮立即接单！",
		orderSN, operatorName, topic, pages, priceYuan, deadlineStr)

	titleTopic := topic
	if len(titleTopic) > 20 {
		titleTopic = titleTopic[:20]
	}

	return w.SendTextCardMessage(designerIDs,
		fmt.Sprintf("🔔 新订单 - %s", titleTopic),
		desc,
		fmt.Sprintf("https://your-domain.com/api/v1/orders/grab?order_sn=%s", orderSN),
	)
}

// SetupOrderGroup 建群 + 播报需求
func (w *WeComClient) SetupOrderGroup(orderSN, operatorID, designerID, topic string, pages, priceFen int, deadlineStr, remark string) (string, error) {
	topicShort := topic
	if len(topicShort) > 12 {
		topicShort = topicShort[:12]
	}
	snShort := orderSN
	if len(snShort) > 6 {
		snShort = snShort[len(snShort)-6:]
	}

	chatID, err := w.CreateGroupChat(
		fmt.Sprintf("PPT-%s %s", snShort, topicShort),
		designerID,
		[]string{operatorID, designerID},
	)
	if err != nil {
		return "", err
	}
	if chatID == "" {
		return "", nil
	}

	priceYuan := float64(priceFen) / 100
	if remark == "" {
		remark = "无"
	}
	brief := fmt.Sprintf("📋 PPT 设计需求清单\n━━━━━━━━━━━━━━━━━\n📦 订单号: %s\n🎯 主题: %s\n📄 页数: %d页\n💰 金额: ¥%.2f\n⏰ 交付: %s\n📝 备注: %s\n━━━━━━━━━━━━━━━━━\n请尽快开始设计，完成后在群内回复「已交付」！",
		orderSN, topic, pages, priceYuan, deadlineStr, remark)
	_ = w.SendGroupMessage(chatID, brief)

	return chatID, nil
}

func (w *WeComClient) postJSON(url string, payload interface{}) error {
	body, err := w.postJSONRaw(url, payload)
	if err != nil {
		return err
	}
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	json.Unmarshal(body, &result)
	if result.ErrCode != 0 {
		return fmt.Errorf("企微API错误: %d %s", result.ErrCode, result.ErrMsg)
	}
	return nil
}

func (w *WeComClient) postJSONRaw(url string, payload interface{}) ([]byte, error) {
	data, _ := json.Marshal(payload)
	resp, err := w.client.Post(url, "application/json", strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
