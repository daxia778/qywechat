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

// SendMarkdownMessage 发送 Markdown 消息给指定用户
// 企微 Markdown 支持: 标题、加粗、链接、引用、字体颜色(info/comment/warning)、行内代码
func (w *WeComClient) SendMarkdownMessage(userIDs []string, content string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]any{
		"touser":   strings.Join(userIDs, "|"),
		"msgtype":  "markdown",
		"agentid":  w.agentID,
		"markdown": map[string]string{"content": content},
	}
	return w.postJSON(fmt.Sprintf("%s/message/send?access_token=%s", w.baseURL, token), payload)
}

// SendGroupMarkdownMessage 群聊发送 Markdown 消息
func (w *WeComClient) SendGroupMarkdownMessage(chatID, content string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]any{
		"chatid":   chatID,
		"msgtype":  "markdown",
		"markdown": map[string]string{"content": content},
	}
	return w.postJSON(fmt.Sprintf("%s/appchat/send?access_token=%s", w.baseURL, token), payload)
}

// SendImageMessage 发送图片消息给指定用户
func (w *WeComClient) SendImageMessage(userIDs []string, mediaID string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]any{
		"touser":  strings.Join(userIDs, "|"),
		"msgtype": "image",
		"agentid": w.agentID,
		"image":   map[string]string{"media_id": mediaID},
	}
	return w.postJSON(fmt.Sprintf("%s/message/send?access_token=%s", w.baseURL, token), payload)
}

// SendGroupImageMessage 群聊发送图片消息
func (w *WeComClient) SendGroupImageMessage(chatID, mediaID string) error {
	if !w.IsConfigured() {
		return nil
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return err
	}

	payload := map[string]any{
		"chatid":  chatID,
		"msgtype": "image",
		"image":   map[string]string{"media_id": mediaID},
	}
	return w.postJSON(fmt.Sprintf("%s/appchat/send?access_token=%s", w.baseURL, token), payload)
}

// UploadMedia 上传临时素材到企微 (图片类型, media_id 3天有效)
// filePath 为服务器本地文件路径
func (w *WeComClient) UploadMedia(filePath string) (string, error) {
	if !w.IsConfigured() {
		return "", fmt.Errorf("企微未配置")
	}
	token, err := w.GetAccessToken()
	if err != nil {
		return "", err
	}

	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("打开文件失败: %w", err)
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("media", filepath.Base(filePath))
	if err != nil {
		return "", fmt.Errorf("创建表单字段失败: %w", err)
	}
	if _, err = io.Copy(part, file); err != nil {
		return "", fmt.Errorf("拷贝文件内容失败: %w", err)
	}
	writer.Close()

	url := fmt.Sprintf("%s/media/upload?access_token=%s&type=image", w.baseURL, token)
	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := w.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("上传素材请求失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
		MediaID string `json:"media_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.ErrCode != 0 {
		return "", fmt.Errorf("上传素材失败: %d %s", result.ErrCode, result.ErrMsg)
	}
	log.Printf("✅ 企微临时素材上传成功 | media_id=%s", result.MediaID)
	return result.MediaID, nil
}

// UploadMediaFromURL 从 URL 下载图片并上传到企微临时素材
// 用于将服务器上的附件图片转发到企微群聊
func (w *WeComClient) UploadMediaFromURL(imageURL string) (string, error) {
	if !w.IsConfigured() {
		return "", fmt.Errorf("企微未配置")
	}

	// 如果是本地相对路径，转换为文件系统路径直接上传
	if !strings.HasPrefix(imageURL, "http") {
		// 本地路径模式: uploads/attachments/xxx.jpg
		localPath := imageURL
		if strings.HasPrefix(localPath, "/") {
			localPath = localPath[1:]
		}
		return w.UploadMedia(localPath)
	}

	// 远程 URL: 下载到临时文件再上传
	resp, err := w.client.Get(imageURL)
	if err != nil {
		return "", fmt.Errorf("下载图片失败: %w", err)
	}
	defer resp.Body.Close()

	// 创建临时文件
	tmpFile, err := os.CreateTemp("", "wecom-media-*.jpg")
	if err != nil {
		return "", fmt.Errorf("创建临时文件失败: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	if _, err = io.Copy(tmpFile, resp.Body); err != nil {
		return "", fmt.Errorf("写入临时文件失败: %w", err)
	}
	tmpFile.Close()

	return w.UploadMedia(tmpFile.Name())
}

// Deprecated: NotifyNewOrder 已废弃，v2.0 不再有设计师抢单机制
// func (w *WeComClient) NotifyNewOrder(...) error { ... }

// SetupOrderGroup 建群 + 播报需求（Markdown 格式 + 附件图片转发）
// v2.0: 群成员 = 跟单客服 + 谈单客服 + 主管/管理员（设计师后续手动拉入）
// attachmentURLs: 订单附件图片URL列表（如客户微信二维码名片），建群后自动转发到群内
func (w *WeComClient) SetupOrderGroup(orderSN, salesOperatorID, followOperatorID, topic string, pages int, priceFen int, deadlineStr, remark, customerContact string, attachmentURLs []string) (string, error) {
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

	// 使用 Markdown 格式播报需求清单，联系方式以高亮可复制形式展示
	contactLine := ""
	if customerContact != "" {
		contactLine = fmt.Sprintf("\n>**客户联系方式**: <font color=\"info\">%s</font>", customerContact)
	}
	brief := fmt.Sprintf("# 📋 PPT 设计需求清单\n**订单号**: `%s`\n**主题**: %s\n**页数**: <font color=\"info\">%d页</font>\n**金额**: <font color=\"warning\">¥%.2f</font>%s\n**交付时间**: %s\n**备注**: %s\n\n> 请跟进设计进度，确保按时交付！",
		orderSN, topic, pages, priceYuan, contactLine, deadlineStr, remark)
	_ = w.SendGroupMarkdownMessage(chatID, brief)

	// 记录消息日志
	SaveMessageLog(chatID, "system", "markdown", brief, orderSN, "out")

	// 异步发送附件图片到群聊（如客户微信二维码名片）
	if len(attachmentURLs) > 0 {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[SetupOrderGroup] send attachments panic: %v", r)
				}
			}()
			for i, imgURL := range attachmentURLs {
				if imgURL == "" {
					continue
				}
				mediaID, err := w.UploadMediaFromURL(imgURL)
				if err != nil {
					log.Printf("⚠️ 群聊附件图片上传失败 [%d/%d]: url=%s err=%v", i+1, len(attachmentURLs), imgURL, err)
					continue
				}
				if err := w.SendGroupImageMessage(chatID, mediaID); err != nil {
					log.Printf("⚠️ 群聊发送附件图片失败 [%d/%d]: chatid=%s err=%v", i+1, len(attachmentURLs), chatID, err)
				} else {
					log.Printf("✅ 群聊附件图片已发送 [%d/%d] | chatid=%s", i+1, len(attachmentURLs), chatID)
					SaveMessageLog(chatID, "system", "image", fmt.Sprintf("[附件图片 %d] %s", i+1, imgURL), orderSN, "out")
				}
			}
		}()
	}

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

// WeComDeptUser 企微通讯录成员简要信息
type WeComDeptUser struct {
	UserID string `json:"userid"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

// GetDepartmentUsers 获取指定部门的成员列表（含子部门）
// departmentID=1 表示根部门（全公司）
func (w *WeComClient) GetDepartmentUsers(departmentID int) ([]WeComDeptUser, error) {
	if !w.IsConfigured() {
		return nil, fmt.Errorf("企微未配置")
	}

	token, err := w.GetAccessToken()
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/user/simplelist?access_token=%s&department_id=%d&fetch_child=1", w.baseURL, token, departmentID)
	resp, err := w.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("获取通讯录成员失败: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		ErrCode  int    `json:"errcode"`
		ErrMsg   string `json:"errmsg"`
		UserList []struct {
			UserID string `json:"userid"`
			Name   string `json:"name"`
		} `json:"userlist"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.ErrCode != 0 {
		return nil, fmt.Errorf("获取通讯录成员错误: %d %s", result.ErrCode, result.ErrMsg)
	}

	users := make([]WeComDeptUser, 0, len(result.UserList))
	for _, u := range result.UserList {
		users = append(users, WeComDeptUser{
			UserID: u.UserID,
			Name:   u.Name,
		})
	}

	log.Printf("✅ 获取企微通讯录成员 | dept=%d | count=%d", departmentID, len(users))
	return users, nil
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

