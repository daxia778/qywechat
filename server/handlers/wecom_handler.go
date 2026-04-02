package handlers

import (
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
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

			wxcpt := middleware.NewWXBizMsgCrypt(config.C.WecomToken, config.C.WecomEncodingAESKey, config.C.WecomCorpID, middleware.XmlType)
			echoStrBytes, err := wxcpt.VerifyURL(msgSignature, timestamp, nonce, echostr)
			if err != nil {
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

	// 文本消息且包含"已交付"或"已发货"
	if msg.MsgType == "text" && (strings.Contains(msg.Content, "已交付") || strings.Contains(msg.Content, "已发货")) {
		designerID := msg.FromUserName

		// 安全校验: 仅处理来自已关联订单群聊的消息
		// 通过 ChatID 匹配确保消息来源可信，防止任意用户触发状态变更
		var orders []models.Order
		query := models.DB.Where("designer_id = ? AND status IN ?", designerID, []string{models.StatusGroupCreated, models.StatusDesigning})

		// 如果消息携带 ChatID (群聊消息)，严格匹配订单所属群
		chatID := msg.ChatID
		if chatID != "" {
			query = query.Where("wecom_chat_id = ?", chatID)
		} else {
			// 非群聊消息 (私聊) 不触发自动交付，跳过
			log.Printf("⚠️ 忽略非群聊的交付消息 | from=%s", designerID)
			c.String(http.StatusOK, "success")
			return
		}

		query.Find(&orders)

		for _, o := range orders {
			_, err := services.UpdateOrderStatus(o.ID, models.StatusDelivered)
			if err == nil {
				log.Printf("📥 群聊交付确认，自动更新订单状态 | sn=%s | designer=%s | chat=%s", o.OrderSN, designerID, chatID)
			}
		}
	}

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

	log.Printf("📥 收到外部联系人添加事件 | external_user_id=%s | user_id=%s | state=%s", externalUserID, userID, msg.State)

	// 尝试从企微获取外部联系人详情（需要客户联系 Secret 已配置）
	nickname := ""
	if services.Wecom.IsContactConfigured() {
		detail, err := services.Wecom.GetExternalContactDetail(externalUserID)
		if err != nil {
			log.Printf("⚠️ 获取外部联系人详情失败: %v", err)
		} else if extContact, ok := detail["external_contact"].(map[string]any); ok {
			if name, ok := extContact["name"].(string); ok {
				nickname = name
			}
		}
	}

	// 查找是否已有该 ExternalUserID 的客户记录
	var customer models.Customer
	result := models.DB.Where("external_user_id = ?", externalUserID).First(&customer)
	if result.Error != nil {
		// 不存在，创建新客户记录
		customer = models.Customer{
			ExternalUserID: externalUserID,
			Nickname:       nickname,
			Remark:         "企微自动添加 (员工: " + userID + ")",
		}
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&customer).Error
		}); err != nil {
			log.Printf("❌ 创建客户记录失败: %v", err)
			return
		}
		log.Printf("✅ 新客户记录已创建 | id=%d | external_user_id=%s | nickname=%s", customer.ID, externalUserID, nickname)
	} else {
		// 已存在，更新昵称（如果之前为空）
		updates := map[string]any{}
		if customer.Nickname == "" && nickname != "" {
			updates["nickname"] = nickname
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

	// 通过 WebSocket 推送新好友通知给对应的客服，提示匹配订单
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
