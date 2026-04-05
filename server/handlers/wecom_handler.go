package handlers

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// WecomMessage XML 回调消息结构
type WecomMessage struct {
	ToUserName   string `xml:"ToUserName"`
	FromUserName string `xml:"FromUserName"`
	CreateTime   int64  `xml:"CreateTime"`
	MsgType      string `xml:"MsgType"`
	Content      string `xml:"Content"`
	MsgId        string `xml:"MsgId"`
	AgentID      int    `xml:"AgentID"`
	ChatID       string `xml:"ChatId"` // 群聊ID (群聊消息时存在)

	// 事件回调字段
	Event          string `xml:"Event"`
	ChangeType     string `xml:"ChangeType"`
	UserID         string `xml:"UserID"`
	ExternalUserID string `xml:"ExternalUserID"`
	State          string `xml:"State"`
	WelcomeCode    string `xml:"WelcomeCode"`
}

// WecomCallback 接收企微回调 (用于实现自动交付)
func WecomCallback(c *gin.Context) {
	// 企微验证 URL 时会带上 msg_signature, timestamp, nonce, echostr
	if c.Request.Method == http.MethodGet {
		echostr := c.Query("echostr")
		// 如果配置了凭证，验证签名并解密 echostr
		if config.C.WecomToken != "" && config.C.WecomEncodingAESKey != "" && config.C.WecomCorpID != "" {
			msgSignature := c.Query("msg_signature")
			timestamp := c.Query("timestamp")
			nonce := c.Query("nonce")

			tokenPrefix := "***"
			if len(config.C.WecomToken) > 6 {
				tokenPrefix = config.C.WecomToken[:6] + "..."
			}
			log.Printf("[WecomCallback] VerifyURL attempt | token=%s aeskey_len=%d corpid=%s", tokenPrefix, len(config.C.WecomEncodingAESKey), config.C.WecomCorpID)
			log.Printf("[WecomCallback] params | msg_signature=%s timestamp=%s nonce=%s echostr=%s", msgSignature, timestamp, nonce, echostr)
			wxcpt := middleware.NewWXBizMsgCrypt(config.C.WecomToken, config.C.WecomEncodingAESKey, config.C.WecomCorpID, middleware.XmlType)
			echoStrBytes, err := wxcpt.VerifyURL(msgSignature, timestamp, nonce, echostr)
			if err != nil {
				log.Printf("[WecomCallback] VerifyURL FAILED | errcode=%d errmsg=%s", err.ErrCode, err.ErrMsg)
				c.String(http.StatusBadRequest, "verify url failed")
				return
			}
			c.String(http.StatusOK, string(echoStrBytes))
			return
		}

		// 未配置凭证，拒绝回调验证
		c.String(http.StatusServiceUnavailable, "wecom callback not configured")
		return
	}

	// 接收消息回调
	if config.C.WecomToken == "" || config.C.WecomEncodingAESKey == "" || config.C.WecomCorpID == "" {
		c.String(http.StatusOK, "success")
		return
	}

	msgSignature := c.Query("msg_signature")
	timestamp := c.Query("timestamp")
	nonce := c.Query("nonce")

	// 时间戳重放保护: 拒绝超过 5 分钟的旧消息
	ts, tsErr := strconv.ParseInt(timestamp, 10, 64)
	if tsErr != nil || abs64(time.Now().Unix()-ts) > 300 {
		log.Printf("[WecomCallback] timestamp expired or invalid | ts=%s", timestamp)
		c.String(http.StatusForbidden, "timestamp expired")
		return
	}

	reqBody, _ := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20)) // 限制 1MB
	wxcpt := middleware.NewWXBizMsgCrypt(config.C.WecomToken, config.C.WecomEncodingAESKey, config.C.WecomCorpID, middleware.XmlType)

	msgBytes, err := wxcpt.DecryptMsg(msgSignature, timestamp, nonce, reqBody)
	if err != nil {
		c.String(http.StatusBadRequest, "decrypt msg failed")
		return
	}

	var msg WecomMessage
	if err := xml.Unmarshal(msgBytes, &msg); err != nil {
		c.String(http.StatusBadRequest, "xml parse failed")
		return
	}

	// ─── 入站消息日志采集（AI 客服语料积累） ──────────
	// 记录所有群聊文本消息（direction=in），关联订单号
	// 订单状态机天然充当标注标签：PENDING/DESIGNING/DELIVERED 等阶段的消息
	// 可直接用于后续 AI 客服知识库构建，无需额外人工标注
	if msg.MsgType == "text" && msg.ChatID != "" {
		orderSN := ""
		var matchedOrder models.Order
		if err := models.DB.Where("wecom_chat_id = ?", msg.ChatID).First(&matchedOrder).Error; err == nil {
			orderSN = matchedOrder.OrderSN
		}
		inboundLog := models.WecomMessageLog{
			ChatID:    msg.ChatID,
			SenderID:  msg.FromUserName,
			MsgType:   msg.MsgType,
			Content:   msg.Content,
			OrderSN:   orderSN,
			Direction: "in",
			CreatedAt: time.Unix(msg.CreateTime, 0),
		}
		if err := models.DB.Create(&inboundLog).Error; err != nil {
			log.Printf("⚠️ 入站消息日志写入失败: %v", err)
		}
	}

	// 事件回调: 外部联系人添加
	if msg.MsgType == "event" && msg.Event == "change_external_contact" && msg.ChangeType == "add_external_contact" {
		handleAddExternalContact(msg)
		c.String(http.StatusOK, "success")
		return
	}

	// 事件回调: 外部联系人删除（客户删除了员工）
	if msg.MsgType == "event" && msg.Event == "change_external_contact" && msg.ChangeType == "del_external_contact" {
		handleDelExternalContact(msg)
		c.String(http.StatusOK, "success")
		return
	}

	// 事件回调: 员工删除了外部联系人
	if msg.MsgType == "event" && msg.Event == "change_external_contact" && msg.ChangeType == "del_follow_user" {
		handleDelFollowUser(msg)
		c.String(http.StatusOK, "success")
		return
	}

	// v2.0: 已移除"已交付"文本自动改状态逻辑（DELIVERED 状态已废弃）
	// 群聊文本消息暂不做自动处理

	c.String(http.StatusOK, "success")
}

// handleAddExternalContact 处理外部联系人添加事件
// 当客户通过「联系我」二维码添加企业员工时触发
func handleAddExternalContact(msg WecomMessage) {
	externalUserID := msg.ExternalUserID
	userID := msg.UserID
	if externalUserID == "" {
		log.Println("⚠️ add_external_contact 事件缺少 ExternalUserID，跳过")
		return
	}

	log.Printf("📥 收到外部联系人添加事件 | external_user_id=%s | user_id=%s | state=%s | welcome_code=%s", externalUserID, userID, msg.State, msg.WelcomeCode)

	// 从企微获取外部联系人详情
	nickname := ""
	avatar := ""
	gender := 0
	corpName := ""
	if services.Wecom.IsContactConfigured() {
		detail, err := services.Wecom.GetExternalContactDetail(externalUserID)
		if err != nil {
			log.Printf("⚠️ 获取外部联系人详情失败: %v", err)
		} else if extContact, ok := detail["external_contact"].(map[string]any); ok {
			if name, ok := extContact["name"].(string); ok {
				nickname = name
			}
			if av, ok := extContact["avatar"].(string); ok {
				avatar = av
			}
			if g, ok := extContact["gender"].(float64); ok {
				gender = int(g)
			}
			if cn, ok := extContact["corp_name"].(string); ok {
				corpName = cn
			}
		}
	}

	// 原子查找或创建客户记录（防止并发回调 TOCTOU 竞态）
	now := time.Now()
	var customer models.Customer
	defaults := models.Customer{
		ExternalUserID:  externalUserID,
		Nickname:        nickname,
		Avatar:          avatar,
		Gender:          gender,
		CorpName:        corpName,
		FollowUserID:    userID,
		AddWay:          "contact_way",
		ContactWayState: msg.State,
		AddedAt:         &now,
		Remark:          "企微自动添加 (员工: " + userID + ")",
	}
	var created bool
	if err := models.WriteTx(func(tx *gorm.DB) error {
		result := tx.Where("external_user_id = ?", externalUserID).FirstOrCreate(&customer, defaults)
		if result.Error != nil {
			return result.Error
		}
		created = result.RowsAffected > 0
		return nil
	}); err != nil {
		log.Printf("❌ 查找或创建客户记录失败: %v", err)
		return
	}

	if created {
		log.Printf("✅ 新客户记录已创建 | id=%d | external_user_id=%s | nickname=%s | follow=%s", customer.ID, externalUserID, nickname, userID)
	} else {
		// 已存在，补充空字段
		updates := map[string]any{}
		if customer.Nickname == "" && nickname != "" {
			updates["nickname"] = nickname
		}
		if customer.Avatar == "" && avatar != "" {
			updates["avatar"] = avatar
		}
		if customer.FollowUserID == "" {
			updates["follow_user_id"] = userID
		}
		if customer.Gender == 0 && gender != 0 {
			updates["gender"] = gender
		}
		if customer.CorpName == "" && corpName != "" {
			updates["corp_name"] = corpName
		}
		if len(updates) > 0 {
			if err := models.WriteTx(func(tx *gorm.DB) error {
				return tx.Model(&customer).Updates(updates).Error
			}); err != nil {
				log.Printf("❌ 更新客户记录失败: %v", err)
				return
			}
			log.Printf("✅ 客户记录已更新 | id=%d | external_user_id=%s", customer.ID, externalUserID)
		} else {
			log.Printf("ℹ️ 客户记录已存在，无需更新 | id=%d | external_user_id=%s", customer.ID, externalUserID)
		}
	}

	// 发送欢迎语（必须在 20s 内完成）
	if msg.WelcomeCode != "" {
		go sendWelcomeToCustomer(msg.WelcomeCode, msg.State, nickname, userID, customer.ID)
	}

	// 自动匹配订单: 用 UserID（添加人=跟单客服）查找待处理订单并关联
	go autoMatchOrderForCustomer(userID, &customer, nickname)

	// 通过 WebSocket 推送新好友通知
	services.Hub.SendTo(userID, services.WSEvent{
		Type: "new_external_contact",
		Payload: map[string]string{
			"external_user_id": externalUserID,
			"nickname":         nickname,
			"staff_userid":     userID,
		},
	})
	log.Printf("📤 已推送新好友匹配通知 | staff=%s | external_user_id=%s | nickname=%s", userID, externalUserID, nickname)
}

// sendWelcomeToCustomer 异步发送欢迎语
func sendWelcomeToCustomer(welcomeCode, contactWayState, customerNickname, staffUserID string, customerID uint) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("❌ sendWelcomeToCustomer panic: %v", r)
		}
	}()

	// 查找匹配的欢迎语模板
	var tmpl models.WelcomeTemplate
	found := false

	// 优先按渠道 state 匹配
	if contactWayState != "" {
		if err := models.DB.Where("contact_way_state = ? AND is_active = ?", contactWayState, true).First(&tmpl).Error; err == nil {
			found = true
		}
	}
	// 降级到默认模板
	if !found {
		if err := models.DB.Where("is_default = ? AND is_active = ?", true, true).First(&tmpl).Error; err == nil {
			found = true
		}
	}

	if !found {
		log.Printf("⚠️ 未找到可用的欢迎语模板，跳过发送 | state=%s", contactWayState)
		return
	}

	// 变量替换
	content := tmpl.Content
	content = strings.ReplaceAll(content, "{{客户昵称}}", customerNickname)

	// 查询员工姓名用于替换
	staffName := staffUserID
	var emp models.Employee
	if models.DB.Where("wecom_userid = ?", staffUserID).First(&emp).Error == nil {
		staffName = emp.Name
	}
	content = strings.ReplaceAll(content, "{{员工姓名}}", staffName)

	// 构建附件
	var attachments []services.WelcomeAttachment
	if tmpl.AttachmentType == "image" && tmpl.AttachmentURL != "" {
		attachments = append(attachments, services.WelcomeAttachment{
			MsgType: "image",
			Image:   &services.WelcomeImage{MediaID: tmpl.AttachmentURL},
		})
	} else if tmpl.AttachmentType == "link" && tmpl.AttachmentURL != "" {
		attachments = append(attachments, services.WelcomeAttachment{
			MsgType: "link",
			Link: &services.WelcomeLink{
				Title:  tmpl.LinkTitle,
				PicURL: tmpl.LinkPicURL,
				Desc:   tmpl.LinkDesc,
				URL:    tmpl.AttachmentURL,
			},
		})
	}

	// 发送欢迎语（企微要求 20s 内完成，否则 welcome_code 失效）
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := services.Wecom.SendWelcomeMessage(ctx, welcomeCode, content, attachments); err != nil {
		log.Printf("❌ 发送欢迎语失败: %v | welcome_code=%s", err, welcomeCode)
		return
	}

	// 标记已发送
	if customerID > 0 {
		_ = models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&models.Customer{}).Where("id = ?", customerID).Update("welcome_sent", true).Error
		})
	}

	log.Printf("✅ 欢迎语已发送 | customer=%s | template=%s | staff=%s", customerNickname, tmpl.Name, staffUserID)
}

// autoMatchOrderForCustomer 自动匹配订单
// 当跟单客服添加客户好友后，自动将客户关联到该客服名下的待处理订单
// 匹配策略:
//   1. 用 UserID（添加人）查找其名下 PENDING 状态且 customer_wx_added=false 的订单
//   2. 如果只有一个匹配 → 直接关联
//   3. 如果有多个 → 按创建时间最近的关联（最新订单优先）
//   4. 同时也检查 follow_operator_id 为空但 operator_id 匹配的订单（谈单客服自己加好友的场景）
func autoMatchOrderForCustomer(staffUserID string, customer *models.Customer, nickname string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("❌ autoMatchOrderForCustomer panic: %v", r)
		}
	}()

	if customer == nil || customer.ID == 0 {
		return
	}

	// 查找该员工名下待处理且未添加好友的订单
	var candidates []models.Order
	models.DB.Where(
		"(follow_operator_id = ? OR operator_id = ?) AND status = ? AND customer_wx_added = ?",
		staffUserID, staffUserID, models.StatusPending, false,
	).Order("created_at DESC").Find(&candidates)

	if len(candidates) == 0 {
		log.Printf("ℹ️ 自动匹配: 员工 %s 无待处理订单，跳过关联", staffUserID)
		return
	}

	// 取最近创建的订单
	order := candidates[0]

	// 更新订单: 关联客户 + 标记已添加好友 + 回写跟单客服（如果为空）
	updates := map[string]any{
		"customer_id":       customer.ID,
		"customer_wx_added": true,
	}
	if order.FollowOperatorID == "" {
		updates["follow_operator_id"] = staffUserID
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&order).Updates(updates).Error
	}); err != nil {
		log.Printf("❌ 自动匹配: 更新订单失败 | sn=%s err=%v", order.OrderSN, err)
		return
	}

	// 更新客户的 FollowUserID（如果为空）
	if customer.FollowUserID == "" {
		_ = models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(customer).Update("follow_user_id", staffUserID).Error
		})
	}

	log.Printf("✅ 自动匹配订单成功 | sn=%s | customer_id=%d | nickname=%s | follow=%s",
		order.OrderSN, customer.ID, nickname, staffUserID)

	// 触发自动建群检查（如果订单已分配设计师）
	go services.TriggerAutoGroupCreation(order.ID)

	// WebSocket 通知前端刷新
	services.Hub.Broadcast(services.WSEvent{
		Type: "order_customer_matched",
		Payload: map[string]string{
			"order_sn":    order.OrderSN,
			"customer_id": fmt.Sprintf("%d", customer.ID),
			"nickname":    nickname,
			"staff":       staffUserID,
		},
	})
}
func handleDelExternalContact(msg WecomMessage) {
	log.Printf("📤 客户删除了员工 | external_user_id=%s | user_id=%s", msg.ExternalUserID, msg.UserID)

	if msg.ExternalUserID == "" {
		return
	}

	// 更新客户记录备注
	var customer models.Customer
	if models.DB.Where("external_user_id = ?", msg.ExternalUserID).First(&customer).Error == nil {
		_ = models.WriteTx(func(tx *gorm.DB) error {
			remark := customer.Remark
			if remark != "" {
				remark += "; "
			}
			remark += "客户已删除好友 (员工: " + msg.UserID + ")"
			return tx.Model(&customer).Update("remark", remark).Error
		})
		log.Printf("✅ 已标记客户删除好友 | id=%d | external_user_id=%s", customer.ID, msg.ExternalUserID)
	}

	// 通知对应员工
	services.Hub.SendTo(msg.UserID, services.WSEvent{
		Type: "external_contact_deleted",
		Payload: map[string]string{
			"external_user_id": msg.ExternalUserID,
			"direction":        "customer_deleted",
		},
	})
}

// handleDelFollowUser 员工删除了外部联系人
func handleDelFollowUser(msg WecomMessage) {
	log.Printf("📤 员工删除了客户 | external_user_id=%s | user_id=%s", msg.ExternalUserID, msg.UserID)

	if msg.ExternalUserID == "" {
		return
	}

	// 更新客户记录
	var customer models.Customer
	if models.DB.Where("external_user_id = ?", msg.ExternalUserID).First(&customer).Error == nil {
		_ = models.WriteTx(func(tx *gorm.DB) error {
			remark := customer.Remark
			if remark != "" {
				remark += "; "
			}
			remark += "员工已删除客户 (员工: " + msg.UserID + ")"
			updates := map[string]any{
				"remark": remark,
			}
			// 如果删除的是关联跟单客服，清空 follow_user_id
			if customer.FollowUserID == msg.UserID {
				updates["follow_user_id"] = ""
			}
			return tx.Model(&customer).Updates(updates).Error
		})
	}
}

// maskSensitive 对敏感字符串进行部分脱敏，保留前4位，其余用***替代
func maskSensitive(s string) string {
	if len(s) <= 4 {
		return "***"
	}
	return s[:4] + "***"
}

// maskAgentID 对 AgentID (int) 进行脱敏，只取第一位数字
func maskAgentID(id int) string {
	s := fmt.Sprintf("%d", id)
	if len(s) <= 1 {
		return "***"
	}
	return s[:1] + "***"
}

// abs64 返回 int64 的绝对值
func abs64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

// WecomDiagnostic 企微 API 连通性诊断
// 管理员可通过此接口快速检查企微配置和各 API 的可用状态
func WecomDiagnostic(c *gin.Context) {
	type apiResult struct {
		Name    string `json:"name"`
		Status  string `json:"status"` // "ok" | "error" | "skipped"
		ErrCode int    `json:"err_code,omitempty"`
		ErrMsg  string `json:"err_msg,omitempty"`
		Latency string `json:"latency"`
	}

	results := []apiResult{}

	// 基础配置检查
	configured := config.C.WecomCorpID != "" && config.C.WecomCorpSecret != ""
	callbackConfigured := config.C.WecomToken != "" && config.C.WecomEncodingAESKey != ""

	if !configured {
		c.JSON(http.StatusOK, gin.H{
			"configured":          false,
			"callback_configured": false,
			"message":             "企微未配置 (WECOM_CORP_ID / WECOM_CORP_SECRET 为空)",
			"results":             results,
		})
		return
	}

	// 1. 测试 gettoken
	t0 := time.Now()
	token, err := services.Wecom.GetAccessToken()
	d0 := time.Since(t0)
	if err != nil {
		results = append(results, apiResult{
			Name:    "获取 access_token",
			Status:  "error",
			ErrMsg:  err.Error(),
			Latency: d0.Round(time.Millisecond).String(),
		})
		c.JSON(http.StatusOK, gin.H{
			"configured":          true,
			"callback_configured": callbackConfigured,
			"corp_id":             maskSensitive(config.C.WecomCorpID),
			"agent_id":            maskAgentID(config.C.WecomAgentID),
			"results":             results,
		})
		return
	}
	results = append(results, apiResult{
		Name:    "获取 access_token",
		Status:  "ok",
		Latency: d0.Round(time.Millisecond).String(),
	})

	// 2. 测试 department/list (需要 IP 白名单)
	t1 := time.Now()
	resp1, err1 := services.Wecom.TestDepartmentList(token)
	d1 := time.Since(t1)
	if err1 != nil {
		results = append(results, apiResult{
			Name:    "获取部门列表 (IP白名单测试)",
			Status:  "error",
			ErrMsg:  err1.Error(),
			Latency: d1.Round(time.Millisecond).String(),
		})
	} else {
		results = append(results, apiResult{
			Name:    "获取部门列表 (IP白名单测试)",
			Status:  resp1.Status,
			ErrCode: resp1.ErrCode,
			ErrMsg:  resp1.ErrMsg,
			Latency: d1.Round(time.Millisecond).String(),
		})
	}

	// 3. 测试发送消息 (dry run - 发给管理员自己)
	t2 := time.Now()
	resp2, err2 := services.Wecom.TestSendMessage(token)
	d2 := time.Since(t2)
	if err2 != nil {
		results = append(results, apiResult{
			Name:    "发送应用消息",
			Status:  "error",
			ErrMsg:  err2.Error(),
			Latency: d2.Round(time.Millisecond).String(),
		})
	} else {
		results = append(results, apiResult{
			Name:    "发送应用消息",
			Status:  resp2.Status,
			ErrCode: resp2.ErrCode,
			ErrMsg:  resp2.ErrMsg,
			Latency: d2.Round(time.Millisecond).String(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"configured":          true,
		"callback_configured": callbackConfigured,
		"corp_id":             maskSensitive(config.C.WecomCorpID),
		"agent_id":            maskAgentID(config.C.WecomAgentID),
		"callback_url":        fmt.Sprintf("%s/api/v1/wecom/callback", config.C.BaseURL),
		"results":             results,
	})
}
