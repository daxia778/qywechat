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
	"pdd-order-system/models"
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
	if err := json.Unmarshal(body, &result); err != nil {
		log.Printf("wecom API response unmarshal error (CreateGroupChat): %v", err)
		return "", fmt.Errorf("解析创建群聊响应失败: %w", err)
	}
	if result.ErrCode != 0 {
		return "", fmt.Errorf("创建群聊失败: errcode=%d", result.ErrCode)
	}
	log.Printf("✅ 企微群聊创建成功 | chatid=%s", result.ChatID)

	// TODO: 企微应用群聊API(/cgi-bin/appchat/create)不支持直接设置"禁止互加好友"
	// 方案1: 在企微管理后台 → 客户联系 → 权限配置中全局设置"禁止通过群聊加好友"
	// 方案2: 使用客户群API(/cgi-bin/externalcontact/groupchat)替代应用群聊API，支持更多群管理选项
	// 方案3: 建群后调用 /cgi-bin/appchat/update 修改群设置（但该接口也不支持互加好友开关）
	// 当前结论: 需要在企微管理后台全局配置，API层面暂无法控制

	return result.ChatID, nil
}

// UpdateGroupChat 更新群聊（改名、加人、踢人）
// 文档: https://developer.work.weixin.qq.com/document/path/90258
func (w *WeComClient) UpdateGroupChat(chatID string, name string, addUsers []string, delUsers []string) error {
	if !w.IsConfigured() {
		return fmt.Errorf("企微未配置")
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]any{
		"chatid": chatID,
	}
	if name != "" {
		payload["name"] = name
	}
	if len(addUsers) > 0 {
		payload["add_user_list"] = addUsers
	}
	if len(delUsers) > 0 {
		payload["del_user_list"] = delUsers
	}

	err = w.postJSON(fmt.Sprintf("%s/appchat/update?access_token=%s", w.baseURL, token), payload)
	if err != nil {
		return fmt.Errorf("更新群聊失败: %w", err)
	}
	log.Printf("✅ 企微群聊更新成功 | chatid=%s name=%s add=%v del=%v", chatID, name, addUsers, delUsers)
	return nil
}

// GetGroupChatInfo 获取群聊详情
// 文档: https://developer.work.weixin.qq.com/document/path/90259
func (w *WeComClient) GetGroupChatInfo(chatID string) (map[string]any, error) {
	if !w.IsConfigured() {
		return nil, fmt.Errorf("企微未配置")
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/appchat/get?access_token=%s&chatid=%s", w.baseURL, token, chatID)
	resp, err := w.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("获取群聊详情失败: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result map[string]any
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, err
	}

	if errCode, ok := result["errcode"].(float64); ok && int(errCode) != 0 {
		errMsg, _ := result["errmsg"].(string)
		return nil, fmt.Errorf("获取群聊详情错误: %d %s", int(errCode), errMsg)
	}

	return result, nil
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

// Deprecated: NotifyNewOrder 已废弃，v2.0 不再有设计师抢单机制
// func (w *WeComClient) NotifyNewOrder(...) error { ... }

// SetupOrderGroup 建群 + 播报需求
// v2.0: 群成员 = 跟单客服 + 谈单客服 + 主管/管理员（设计师后续手动拉入）
func (w *WeComClient) SetupOrderGroup(orderSN, salesOperatorID, followOperatorID, topic string, pages int, priceFen int, deadlineStr, remark, customerContact string) (string, error) {
	// fallback: 如果没有跟单客服，使用谈单客服作为群主
	if followOperatorID == "" {
		followOperatorID = salesOperatorID
	}
	if followOperatorID == "" {
		return "", fmt.Errorf("建群失败: 缺少群主 (谈单客服和跟单客服均为空)")
	}

	topicShort := topic
	topicRunes := []rune(topicShort)
	if len(topicRunes) > 12 {
		topicShort = string(topicRunes[:12])
	}
	snShort := orderSN
	if len(snShort) > 6 {
		snShort = snShort[len(snShort)-6:]
	}

	// 构建群成员列表: 跟单客服 + 谈单客服 + 管理员/主管
	// 用 map 去重，避免重复成员导致建群失败
	memberSet := map[string]bool{followOperatorID: true}
	if salesOperatorID != "" {
		memberSet[salesOperatorID] = true
	}

	// 查询所有 admin 角色员工，自动拉入群聊（主管监督）
	var admins []models.Employee
	if err := models.DB.Where("role = ? AND is_active = ?", "admin", true).Find(&admins).Error; err != nil {
		log.Printf("⚠️ 查询管理员列表失败: %v，建群将不包含管理员", err)
	} else {
		for _, admin := range admins {
			if admin.WecomUserID != "" {
				memberSet[admin.WecomUserID] = true
			}
		}
	}

	members := make([]string, 0, len(memberSet))
	for uid := range memberSet {
		members = append(members, uid)
	}

	groupName := fmt.Sprintf("PPT-%s %s", snShort, topicShort)
	// 群主设为跟单客服（项目经理角色）
	chatID, err := w.CreateGroupChat(groupName, followOperatorID, members)
	if err != nil {
		return "", err
	}
	if chatID == "" {
		return "", nil
	}

	// 保存群聊快照到数据库
	SaveGroupChatSnapshot(chatID, groupName, followOperatorID, members, orderSN)

	priceYuan := float64(priceFen) / 100
	if remark == "" {
		remark = "无"
	}
	contactLine := ""
	if customerContact != "" {
		contactLine = fmt.Sprintf("\n👤 客户联系方式: %s", customerContact)
	}
	brief := fmt.Sprintf("📋 PPT 设计需求清单\n━━━━━━━━━━━━━━━━━\n📦 订单号: %s\n🎯 主题: %s\n📄 页数: %d页\n💰 金额: ¥%.2f%s\n⏰ 交付: %s\n📝 备注: %s\n━━━━━━━━━━━━━━━━━\n请跟进设计进度，确保按时交付！",
		orderSN, topic, pages, priceYuan, contactLine, deadlineStr, remark)
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

	payload := map[string]any{
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
func (w *WeComClient) GetExternalContactDetail(externalUserID string) (map[string]any, error) {
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

	var result map[string]any
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return nil, err
	}

	if errCode, ok := result["errcode"].(float64); ok && int(errCode) != 0 {
		errMsg, _ := result["errmsg"].(string)
		return nil, fmt.Errorf("获取外部联系人详情错误: %d %s", int(errCode), errMsg)
	}

	return result, nil
}

func (w *WeComClient) postJSON(url string, payload any) error {
	body, err := w.postJSONRaw(url, payload)
	if err != nil {
		return err
	}
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		log.Printf("wecom API response unmarshal error (postJSON): %v", err)
		return fmt.Errorf("解析企微API响应失败: %w", err)
	}
	if result.ErrCode != 0 {
		return fmt.Errorf("企微API错误: %d %s", result.ErrCode, result.ErrMsg)
	}
	return nil
}

func (w *WeComClient) postJSONRaw(url string, payload any) ([]byte, error) {
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

// TransferCustomer 在职继承-转移客户
// 文档: https://developer.work.weixin.qq.com/document/path/92125
func (w *WeComClient) TransferCustomer(handoverUserID, takeoverUserID string, externalUserIDs []string, transferMsg string) ([]map[string]any, error) {
	if !w.IsContactConfigured() {
		return nil, fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}

	token, err := w.GetContactAccessToken()
	if err != nil {
		return nil, err
	}

	payload := map[string]any{
		"handover_userid":      handoverUserID,
		"takeover_userid":      takeoverUserID,
		"external_userid":      externalUserIDs,
		"transfer_success_msg": transferMsg,
	}

	body, err := w.postJSONRaw(fmt.Sprintf("%s/externalcontact/transfer_customer?access_token=%s", w.baseURL, token), payload)
	if err != nil {
		return nil, err
	}

	var resp struct {
		ErrCode  int              `json:"errcode"`
		ErrMsg   string           `json:"errmsg"`
		Customer []map[string]any `json:"customer"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("解析转移客户响应失败: %w", err)
	}
	if resp.ErrCode != 0 {
		return nil, fmt.Errorf("转移客户失败: %d %s", resp.ErrCode, resp.ErrMsg)
	}

	log.Printf("✅ 在职继承转移客户 | handover=%s takeover=%s count=%d", handoverUserID, takeoverUserID, len(externalUserIDs))
	return resp.Customer, nil
}

// GetTransferResult 查询客户转移结果
// 文档: https://developer.work.weixin.qq.com/document/path/94088
func (w *WeComClient) GetTransferResult(handoverUserID, takeoverUserID string) ([]map[string]any, error) {
	if !w.IsContactConfigured() {
		return nil, fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}

	token, err := w.GetContactAccessToken()
	if err != nil {
		return nil, err
	}

	payload := map[string]any{
		"handover_userid": handoverUserID,
		"takeover_userid": takeoverUserID,
	}

	body, err := w.postJSONRaw(fmt.Sprintf("%s/externalcontact/transfer_result?access_token=%s", w.baseURL, token), payload)
	if err != nil {
		return nil, err
	}

	var resp struct {
		ErrCode  int              `json:"errcode"`
		ErrMsg   string           `json:"errmsg"`
		Customer []map[string]any `json:"customer"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("解析转移结果响应失败: %w", err)
	}
	if resp.ErrCode != 0 {
		return nil, fmt.Errorf("查询转移结果失败: %d %s", resp.ErrCode, resp.ErrMsg)
	}

	return resp.Customer, nil
}

