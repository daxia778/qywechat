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

	// 客户联系专用 token（与自建应用 token 独立）
	contactSecret      string
	contactToken       string
	contactTokenExpiry time.Time
	contactTokenMu     sync.Mutex
}

var Wecom *WeComClient

func InitWecom() {
	Wecom = &WeComClient{
		corpID:        config.C.WecomCorpID,
		corpSecret:    config.C.WecomCorpSecret,
		agentID:       config.C.WecomAgentID,
		baseURL:       "https://qyapi.weixin.qq.com/cgi-bin",
		client:        &http.Client{Timeout: 15 * time.Second},
		contactSecret: config.C.WecomContactSecret,
	}
	if Wecom.IsConfigured() {
		log.Println("✅ 企微客户端初始化完成")
	} else {
		log.Println("⚠️  企微未配置 (WECOM_CORP_ID / WECOM_CORP_SECRET)")
	}
	if Wecom.IsContactConfigured() {
		log.Println("✅ 企微客户联系功能已启用")
	} else {
		log.Println("⚠️  企微客户联系未配置 (WECOM_CONTACT_SECRET)，相关功能已跳过")
	}
}

func (w *WeComClient) IsConfigured() bool {
	return w.corpID != "" && w.corpSecret != ""
}

// IsContactConfigured 客户联系功能是否已配置
func (w *WeComClient) IsContactConfigured() bool {
	return w.corpID != "" && w.contactSecret != ""
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

	payload := map[string]any{
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

	payload := map[string]any{
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

	payload := map[string]any{
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

	payload := map[string]any{
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
		fmt.Sprintf("%s/grab?order_sn=%s", config.C.BaseURL, orderSN),
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

	// 去重: 当 operatorID == designerID 时避免重复成员导致建群失败
	members := []string{operatorID}
	if designerID != operatorID {
		members = append(members, designerID)
	}

	chatID, err := w.CreateGroupChat(
		fmt.Sprintf("PPT-%s %s", snShort, topicShort),
		designerID,
		members,
	)
	if err != nil {
		return "", err
	}
	if chatID == "" {
		return "", nil
	}

	// 保存群聊快照到数据库
	SaveGroupChatSnapshot(chatID, fmt.Sprintf("PPT-%s %s", snShort, topicShort), designerID, members, orderSN)

	priceYuan := float64(priceFen) / 100
	if remark == "" {
		remark = "无"
	}
	brief := fmt.Sprintf("📋 PPT 设计需求清单\n━━━━━━━━━━━━━━━━━\n📦 订单号: %s\n🎯 主题: %s\n📄 页数: %d页\n💰 金额: ¥%.2f\n⏰ 交付: %s\n📝 备注: %s\n━━━━━━━━━━━━━━━━━\n请尽快开始设计，完成后在群内回复「已交付」！",
		orderSN, topic, pages, priceYuan, deadlineStr, remark)
	_ = w.SendGroupMessage(chatID, brief)

	// 记录消息日志
	SaveMessageLog(chatID, "system", "text", brief, orderSN, "out")

	return chatID, nil
}

// GetContactAccessToken 获取客户联系专用 access_token
// 客户联系 Secret 与普通自建应用 Secret 不同，需要单独获取 token
func (w *WeComClient) GetContactAccessToken() (string, error) {
	if !w.IsContactConfigured() {
		return "", fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}

	w.contactTokenMu.Lock()
	defer w.contactTokenMu.Unlock()

	if w.contactToken != "" && time.Now().Before(w.contactTokenExpiry) {
		return w.contactToken, nil
	}

	url := fmt.Sprintf("%s/gettoken?corpid=%s&corpsecret=%s", w.baseURL, w.corpID, w.contactSecret)
	resp, err := w.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("获取客户联系token失败: %w", err)
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
		return "", fmt.Errorf("客户联系token错误: %d %s", result.ErrCode, result.ErrMsg)
	}

	w.contactToken = result.AccessToken
	w.contactTokenExpiry = time.Now().Add(time.Duration(result.ExpiresIn-300) * time.Second)
	log.Println("✅ 企微客户联系 access_token 获取成功")
	return w.contactToken, nil
}

// CreateContactWay 创建「联系我」渠道
// 返回 config_id 和 qr_code URL
func (w *WeComClient) CreateContactWay(state string, userIDs []string) (configID, qrCode string, err error) {
	if !w.IsContactConfigured() {
		return "", "", fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}

	token, err := w.GetContactAccessToken()
	if err != nil {
		return "", "", err
	}

	payload := map[string]interface{}{
		"type":  2, // 企业自定义渠道
		"scene": 2, // 小程序/二维码
		"style": 1,
		"state": state,
		"user":  userIDs,
	}

	body, err := w.postJSONRaw(fmt.Sprintf("%s/externalcontact/add_contact_way?access_token=%s", w.baseURL, token), payload)
	if err != nil {
		return "", "", err
	}

	var result struct {
		ErrCode  int    `json:"errcode"`
		ErrMsg   string `json:"errmsg"`
		ConfigID string `json:"config_id"`
		QRCode   string `json:"qr_code"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("解析联系我响应失败: %w", err)
	}
	if result.ErrCode != 0 {
		return "", "", fmt.Errorf("创建联系我失败: %d %s", result.ErrCode, result.ErrMsg)
	}

	log.Printf("✅ 创建「联系我」渠道成功 | config_id=%s", result.ConfigID)
	return result.ConfigID, result.QRCode, nil
}

// GetExternalContactList 获取员工的外部联系人列表
func (w *WeComClient) GetExternalContactList(userID string) ([]string, error) {
	if !w.IsContactConfigured() {
		return nil, fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}

	token, err := w.GetContactAccessToken()
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/externalcontact/list?access_token=%s&userid=%s", w.baseURL, token, userID)
	resp, err := w.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("获取外部联系人列表失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		ErrCode        int      `json:"errcode"`
		ErrMsg         string   `json:"errmsg"`
		ExternalUserID []string `json:"external_userid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.ErrCode != 0 {
		return nil, fmt.Errorf("获取外部联系人列表错误: %d %s", result.ErrCode, result.ErrMsg)
	}

	return result.ExternalUserID, nil
}

// GetExternalContactDetail 获取外部联系人详情
func (w *WeComClient) GetExternalContactDetail(externalUserID string) (map[string]interface{}, error) {
	if !w.IsContactConfigured() {
		return nil, fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}

	token, err := w.GetContactAccessToken()
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/externalcontact/get?access_token=%s&external_userid=%s", w.baseURL, token, externalUserID)
	resp, err := w.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("获取外部联系人详情失败: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, err
	}

	if errCode, ok := result["errcode"].(float64); ok && int(errCode) != 0 {
		errMsg, _ := result["errmsg"].(string)
		return nil, fmt.Errorf("获取外部联系人详情错误: %d %s", int(errCode), errMsg)
	}

	return result, nil
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
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("JSON序列化失败: %w", err)
	}
	resp, err := w.client.Post(url, "application/json", strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// ─── 诊断/测试方法 ──────────────────────────

// DiagResult 诊断结果
type DiagResult struct {
	Status  string `json:"status"` // "ok" | "error"
	ErrCode int    `json:"err_code,omitempty"`
	ErrMsg  string `json:"err_msg,omitempty"`
}

// TestDepartmentList 测试获取部门列表 (检测 IP 白名单)
func (w *WeComClient) TestDepartmentList(token string) (*DiagResult, error) {
	url := fmt.Sprintf("%s/department/list?access_token=%s", w.baseURL, token)
	resp, err := w.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("HTTP请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	if result.ErrCode != 0 {
		return &DiagResult{
			Status:  "error",
			ErrCode: result.ErrCode,
			ErrMsg:  result.ErrMsg,
		}, nil
	}
	return &DiagResult{Status: "ok"}, nil
}

// TestSendMessage 测试发送应用消息 (发送测试通知给全员)
func (w *WeComClient) TestSendMessage(token string) (*DiagResult, error) {
	payload := map[string]any{
		"touser":  "@all",
		"msgtype": "text",
		"agentid": w.agentID,
		"text":    map[string]string{"content": "🧪 企微连通性测试 — PDD 派单系统诊断消息，请忽略"},
	}

	body, err := w.postJSONRaw(fmt.Sprintf("%s/message/send?access_token=%s", w.baseURL, token), payload)
	if err != nil {
		return nil, fmt.Errorf("HTTP请求失败: %w", err)
	}

	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	json.Unmarshal(body, &result)

	if result.ErrCode != 0 {
		return &DiagResult{
			Status:  "error",
			ErrCode: result.ErrCode,
			ErrMsg:  result.ErrMsg,
		}, nil
	}
	return &DiagResult{Status: "ok"}, nil
}

