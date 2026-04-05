package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/ArtisanCloud/PowerLibs/v3/cache"
	"github.com/ArtisanCloud/PowerWeChat/v3/src/kernel/power"
	"github.com/ArtisanCloud/PowerWeChat/v3/src/work"
	cwReq "github.com/ArtisanCloud/PowerWeChat/v3/src/work/externalContact/contactWay/request"
	mtReq "github.com/ArtisanCloud/PowerWeChat/v3/src/work/externalContact/messageTemplate/request"
	ecReq "github.com/ArtisanCloud/PowerWeChat/v3/src/work/externalContact/request"
	msgReq "github.com/ArtisanCloud/PowerWeChat/v3/src/work/message/request"
)

// WeComClient 企业微信 API 客户端（基于 PowerWeChat SDK）
type WeComClient struct {
	workApp    *work.Work // corpSecret: 消息/群聊/部门
	contactApp *work.Work // contactSecret: 外部联系人

	corpID     string
	agentID    int
	baseURL    string
	httpClient *http.Client

	appConfigured     bool
	contactConfigured bool
}

// WelcomeAttachment 欢迎语附件
type WelcomeAttachment struct {
	MsgType string        `json:"msgtype"`
	Image   *WelcomeImage `json:"image,omitempty"`
	Link    *WelcomeLink  `json:"link,omitempty"`
}

type WelcomeImage struct {
	MediaID string `json:"media_id"`
	PicURL  string `json:"pic_url,omitempty"`
}

type WelcomeLink struct {
	Title  string `json:"title"`
	PicURL string `json:"picurl,omitempty"`
	Desc   string `json:"desc,omitempty"`
	URL    string `json:"url"`
}

// DiagResult 诊断结果
type DiagResult struct {
	Status  string `json:"status"`
	ErrCode int    `json:"err_code,omitempty"`
	ErrMsg  string `json:"err_msg,omitempty"`
}

var Wecom *WeComClient

func InitWecom() {
	corpID := config.C.WecomCorpID
	agentID := config.C.WecomAgentID
	corpSecret := config.C.WecomCorpSecret
	contactSecret := config.C.WecomContactSecret
	token := config.C.WecomToken
	aesKey := config.C.WecomEncodingAESKey

	w := &WeComClient{
		corpID:     corpID,
		agentID:    agentID,
		baseURL:    "https://qyapi.weixin.qq.com/cgi-bin",
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}

	// 初始化自建应用实例（消息/群聊/部门）
	if corpID != "" && corpSecret != "" {
		app, err := work.NewWork(&work.UserConfig{
			CorpID:  corpID,
			AgentID: agentID,
			Secret:  corpSecret,
			Token:   token,
			AESKey:  aesKey,
			Cache:   cache.NewMemCache("pdd-work", 0, ""),
		})
		if err != nil {
			log.Printf("企微应用实例初始化失败: %v", err)
		} else {
			w.workApp = app
			w.appConfigured = true
		}
	}

	// 初始化客户联系实例（外部联系人/联系我/欢迎语/客户群）
	if corpID != "" && contactSecret != "" {
		app, err := work.NewWork(&work.UserConfig{
			CorpID:  corpID,
			AgentID: agentID,
			Secret:  contactSecret,
			Token:   token,
			AESKey:  aesKey,
			Cache:   cache.NewMemCache("pdd-contact", 0, ""),
		})
		if err != nil {
			log.Printf("企微客户联系实例初始化失败: %v", err)
		} else {
			w.contactApp = app
			w.contactConfigured = true
		}
	}

	Wecom = w

	if w.appConfigured {
		log.Println("企微客户端初始化完成")
	} else {
		log.Println("企微未配置 (WECOM_CORP_ID / WECOM_CORP_SECRET)")
	}
	if w.contactConfigured {
		log.Println("企微客户联系功能已启用")
	} else {
		log.Println("企微客户联系未配置 (WECOM_CONTACT_SECRET)，相关功能已跳过")
	}
}

// ─── 配置检查 ──────────────────────────

func (w *WeComClient) IsConfigured() bool {
	return w.appConfigured
}

func (w *WeComClient) IsContactConfigured() bool {
	return w.contactConfigured
}

// ─── Token 获取（给 raw HTTP 调用方用） ──────────────────────────

func (w *WeComClient) GetAccessToken() (string, error) {
	if !w.appConfigured {
		return "", fmt.Errorf("企微应用未配置")
	}
	ctx := context.Background()
	tokenResp, err := w.workApp.GetAccessToken().GetToken(ctx, false)
	if err != nil {
		return "", fmt.Errorf("获取企微token失败: %w", err)
	}
	return tokenResp.AccessToken, nil
}

func (w *WeComClient) GetContactAccessToken() (string, error) {
	if !w.contactConfigured {
		return "", fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}
	ctx := context.Background()
	tokenResp, err := w.contactApp.GetAccessToken().GetToken(ctx, false)
	if err != nil {
		return "", fmt.Errorf("获取客户联系token失败: %w", err)
	}
	return tokenResp.AccessToken, nil
}

// ─── 消息发送 ──────────────────────────

func (w *WeComClient) SendTextMessage(userIDs []string, content string) error {
	if !w.appConfigured {
		return nil
	}
	ctx := context.Background()
	_, err := w.workApp.Message.SendText(ctx, &msgReq.RequestMessageSendText{
		RequestMessageSend: msgReq.RequestMessageSend{
			ToUser:  strings.Join(userIDs, "|"),
			MsgType: "text",
			AgentID: w.agentID,
		},
		Text: &msgReq.RequestText{Content: content},
	})
	if err != nil {
		return fmt.Errorf("发送文本消息失败: %w", err)
	}
	return nil
}

func (w *WeComClient) SendTextCardMessage(userIDs []string, title, desc, url string) error {
	if !w.appConfigured {
		return nil
	}
	ctx := context.Background()
	_, err := w.workApp.Message.SendTextCard(ctx, &msgReq.RequestMessageSendTextCard{
		RequestMessageSend: msgReq.RequestMessageSend{
			ToUser:  strings.Join(userIDs, "|"),
			MsgType: "textcard",
			AgentID: w.agentID,
		},
		TextCard: &msgReq.RequestTextCard{
			Title:       title,
			Description: desc,
			Url:         url,
			BtnTXT:      "立即接单",
		},
	})
	if err != nil {
		return fmt.Errorf("发送卡片消息失败: %w", err)
	}
	return nil
}

// ─── 群聊 ──────────────────────────

func (w *WeComClient) CreateGroupChat(name, ownerID string, memberIDs []string) (string, error) {
	if !w.appConfigured {
		return "", nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return "", fmt.Errorf("创建群聊获取token失败: %w", err)
	}
	url := fmt.Sprintf("%s/appchat/create?access_token=%s", w.baseURL, token)
	reqBody := map[string]any{
		"name":            name,
		"owner":           ownerID,
		"userlist":        memberIDs,
		"chat_add_friend": 0, // 禁止群内互加好友
	}
	respBytes, err := w.postJSONRaw(url, reqBody)
	if err != nil {
		return "", fmt.Errorf("创建群聊失败: %w", err)
	}
	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
		ChatID  string `json:"chatid"`
	}
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return "", fmt.Errorf("解析创建群聊响应失败: %w", err)
	}
	if result.ErrCode != 0 {
		return "", fmt.Errorf("创建群聊失败: errcode=%d errmsg=%s", result.ErrCode, result.ErrMsg)
	}
	log.Printf("企微群聊创建成功 | chatid=%s | chat_add_friend=0(禁止互加)", result.ChatID)
	return result.ChatID, nil
}

func (w *WeComClient) SendGroupMessage(chatID, content string) error {
	if !w.appConfigured {
		return nil
	}
	ctx := context.Background()
	_, err := w.workApp.MessageAppChat.Send(ctx, &power.HashMap{
		"chatid":  chatID,
		"msgtype": "text",
		"text":    power.HashMap{"content": content},
		"safe":    0,
	})
	if err != nil {
		return fmt.Errorf("群聊发消息失败: %w", err)
	}
	return nil
}

// ─── 外部联系人 ──────────────────────────

func (w *WeComClient) CreateContactWay(state string, userIDs []string) (configID, qrCode string, err error) {
	if !w.contactConfigured {
		return "", "", fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}
	ctx := context.Background()
	resp, err := w.contactApp.ExternalContactContactWay.Add(ctx, &cwReq.RequestAddContactWay{
		Type:  2,
		Scene: 2,
		Style: 1,
		State: state,
		User:  userIDs,
	})
	if err != nil {
		return "", "", fmt.Errorf("创建联系我失败: %w", err)
	}
	log.Printf("创建「联系我」渠道成功 | config_id=%s", resp.ConfigID)
	return resp.ConfigID, resp.QRCode, nil
}

func (w *WeComClient) GetExternalContactList(userID string) ([]string, error) {
	if !w.contactConfigured {
		return nil, fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}
	ctx := context.Background()
	resp, err := w.contactApp.ExternalContact.List(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("获取外部联系人列表失败: %w", err)
	}
	return resp.ExternalUserID, nil
}

func (w *WeComClient) GetExternalContactDetail(externalUserID string) (map[string]any, error) {
	if !w.contactConfigured {
		return nil, fmt.Errorf("客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
	}
	ctx := context.Background()
	resp, err := w.contactApp.ExternalContact.Get(ctx, externalUserID, "")
	if err != nil {
		return nil, fmt.Errorf("获取外部联系人详情失败: %w", err)
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return nil, fmt.Errorf("序列化外部联系人数据失败: %w", err)
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("反序列化外部联系人数据失败: %w", err)
	}
	return result, nil
}

func (w *WeComClient) SendWelcomeMessage(ctx context.Context, welcomeCode string, text string, attachments []WelcomeAttachment) error {
	if !w.contactConfigured {
		return fmt.Errorf("客户联系功能未配置")
	}
	req := &mtReq.RequestSendWelcomeMsg{
		WelcomeCode: welcomeCode,
	}
	if text != "" {
		req.Text = &mtReq.TextOfMessage{Content: text}
	}
	// attachments 暂时忽略（SDK 的 attachment 接口类型不同）
	_, err := w.contactApp.ExternalContactMessageTemplate.SendWelcomeMsg(ctx, req)
	if err != nil {
		return fmt.Errorf("发送欢迎语失败: %w", err)
	}
	return nil
}

func (w *WeComClient) UpdateExternalContactRemark(userID, externalUserID string, remark, description, remarkCompany string) error {
	if !w.contactConfigured {
		return fmt.Errorf("客户联系功能未配置")
	}
	ctx := context.Background()
	_, err := w.contactApp.ExternalContact.Remark(ctx, &ecReq.RequestExternalContactRemark{
		UserID:         userID,
		ExternalUserID: externalUserID,
		Remark:         remark,
		Description:    description,
		RemarkCompany:  remarkCompany,
	})
	if err != nil {
		return fmt.Errorf("更新外部联系人备注失败: %w", err)
	}
	return nil
}

func (w *WeComClient) GetGroupChatDetail(chatID string) (map[string]any, error) {
	if !w.contactConfigured {
		return nil, fmt.Errorf("客户联系功能未配置")
	}
	ctx := context.Background()
	resp, err := w.contactApp.ExternalContactGroupChat.Get(ctx, chatID, 1)
	if err != nil {
		return nil, fmt.Errorf("获取客户群详情失败: %w", err)
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return nil, fmt.Errorf("序列化客户群数据失败: %w", err)
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("反序列化客户群数据失败: %w", err)
	}
	return result, nil
}

// ─── 复合方法（调用已迁移的基础方法，逻辑不变） ──────────────────────────

// SetupOrderGroup 建群 + 播报需求
func (w *WeComClient) SetupOrderGroup(orderSN, salesOperatorID, followOperatorID, topic string, pages int, priceFen int, deadlineStr, remark string) (string, error) {
	if followOperatorID == "" {
		followOperatorID = salesOperatorID
	}
	if followOperatorID == "" {
		return "", fmt.Errorf("建群失败: 缺少群主 (谈单客服和跟单客服均为空)")
	}

	topicShort := topic
	if len(topicShort) > 12 {
		topicShort = topicShort[:12]
	}
	snShort := orderSN
	if len(snShort) > 6 {
		snShort = snShort[len(snShort)-6:]
	}

	memberSet := map[string]bool{followOperatorID: true}
	if salesOperatorID != "" {
		memberSet[salesOperatorID] = true
	}

	var admins []models.Employee
	if err := models.DB.Where("role = ? AND is_active = ?", "admin", true).Find(&admins).Error; err != nil {
		log.Printf("查询管理员列表失败: %v，建群将不包含管理员", err)
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
	chatID, err := w.CreateGroupChat(groupName, followOperatorID, members)
	if err != nil {
		return "", err
	}
	if chatID == "" {
		return "", nil
	}

	SaveGroupChatSnapshot(chatID, groupName, followOperatorID, members, orderSN)

	priceYuan := float64(priceFen) / 100
	if remark == "" {
		remark = "无"
	}
	brief := fmt.Sprintf("PPT 设计需求清单\n━━━━━━━━━━━━━━━━━\n订单号: %s\n主题: %s\n页数: %d页\n金额: ¥%.2f\n交付: %s\n备注: %s\n━━━━━━━━━━━━━━━━━\n请跟进设计进度，确保按时交付！",
		orderSN, topic, pages, priceYuan, deadlineStr, remark)
	_ = w.SendGroupMessage(chatID, brief)

	SaveMessageLog(chatID, "system", "text", brief, orderSN, "out")

	return chatID, nil
}

// CreateCustomerGroupChat 创建客户群（支持外部联系人入群）
func (w *WeComClient) CreateCustomerGroupChat(name, ownerUserID string, userList []string, externalUserList []string) (string, error) {
	chatID, err := w.CreateGroupChat(name, ownerUserID, userList)
	if err != nil {
		return "", err
	}
	log.Printf("客户服务群创建成功 | chatid=%s | 外部联系人需通过跟单客服邀请入群", chatID)
	return chatID, nil
}

// SetupCustomerOrderGroup 为订单创建客户服务群
func (w *WeComClient) SetupCustomerOrderGroup(orderSN, salesOperatorID, followOperatorID, topic string, pages int, priceFen int, deadlineStr, remark string, customerNickname string) (string, error) {
	chatID, err := w.SetupOrderGroup(orderSN, salesOperatorID, followOperatorID, topic, pages, priceFen, deadlineStr, remark)
	if err != nil {
		return "", err
	}
	if chatID == "" {
		return "", nil
	}

	if customerNickname != "" {
		customerInfo := fmt.Sprintf("客户信息\n━━━━━━━━━━━━━━━━━\n昵称: %s\n━━━━━━━━━━━━━━━━━\n请跟单客服将客户拉入群聊，方便直接沟通！", customerNickname)
		_ = w.SendGroupMessage(chatID, customerInfo)
		SaveMessageLog(chatID, "system", "text", customerInfo, orderSN, "out")
	}

	return chatID, nil
}

// ─── 诊断/测试方法 ──────────────────────────

func (w *WeComClient) TestDepartmentList(token string) (*DiagResult, error) {
	if !w.appConfigured {
		return &DiagResult{Status: "error", ErrMsg: "企微应用未配置"}, nil
	}
	ctx := context.Background()
	resp, err := w.workApp.Department.List(ctx, 0)
	if err != nil {
		return &DiagResult{Status: "error", ErrMsg: err.Error()}, nil
	}
	if resp.ErrCode != 0 {
		return &DiagResult{Status: "error", ErrCode: resp.ErrCode, ErrMsg: resp.ErrMsg}, nil
	}
	return &DiagResult{Status: "ok"}, nil
}

func (w *WeComClient) TestSendMessage(token string) (*DiagResult, error) {
	if !w.appConfigured {
		return &DiagResult{Status: "error", ErrMsg: "企微应用未配置"}, nil
	}

	// 查找管理员的 WecomUserID，诊断接口只发给管理员，禁止 @all
	var admin models.Employee
	if err := models.DB.Where("role = ? AND is_active = ? AND wecom_userid != ''", "admin", true).First(&admin).Error; err != nil {
		return &DiagResult{Status: "skipped", ErrMsg: "未找到有效管理员，跳过发送测试"}, nil
	}

	ctx := context.Background()
	resp, err := w.workApp.Message.SendText(ctx, &msgReq.RequestMessageSendText{
		RequestMessageSend: msgReq.RequestMessageSend{
			ToUser:  admin.WecomUserID,
			MsgType: "text",
			AgentID: w.agentID,
		},
		Text: &msgReq.RequestText{Content: "企微连通性测试 - PDD 派单系统诊断消息，请忽略"},
	})
	if err != nil {
		return &DiagResult{Status: "error", ErrMsg: err.Error()}, nil
	}
	if resp.ErrCode != 0 {
		return &DiagResult{Status: "error", ErrCode: resp.ErrCode, ErrMsg: resp.ErrMsg}, nil
	}
	return &DiagResult{Status: "ok"}, nil
}

// ─── 导出方法（给 wecom_sync.go / wecom_payment.go 用） ──────────────────────────

func (w *WeComClient) BaseURL() string {
	return w.baseURL
}

func (w *WeComClient) RawGet(url string) (*http.Response, error) {
	return w.httpClient.Get(url)
}

func (w *WeComClient) RawPostJSON(url string, payload any) ([]byte, error) {
	return w.postJSONRaw(url, payload)
}

// ─── 私有方法 ──────────────────────────

func (w *WeComClient) postJSONRaw(url string, payload any) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("JSON序列化失败: %w", err)
	}
	resp, err := w.httpClient.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
