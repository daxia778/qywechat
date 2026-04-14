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

			log.Printf("[WecomCallback] VerifyURL attempt | token=%s aeskey_len=%d corpid=%s", config.C.WecomToken[:6]+"...", len(config.C.WecomEncodingAESKey), config.C.WecomCorpID)
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

	// v2.0: 已移除"已交付"文本自动改状态逻辑（DELIVERED 状态已废弃）
	// 群聊文本消息暂不做自动处理

	c.String(http.StatusOK, "success")
}

// handleAddExternalContact 处理外部联系人添加事件
// 当客户通过「联系我」二维码添加企业员工时触发，或员工主动扫码添加返回
func handleAddExternalContact(msg WecomMessage) {
	externalUserID := msg.ExternalUserID
	userID := msg.UserID
	if externalUserID == "" {
		log.Println("⚠️ add_external_contact 事件缺少 ExternalUserID，跳过")
		return
	}

	log.Printf("📥 收到外部联系人添加事件 | external_user_id=%s | user_id=%s | state=%s", externalUserID, userID, msg.State)

	// 1. 尝试从企微获取外部联系人详情
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

	// 2. 查出跟单客服当前负责的活跃订单
	var activeOrders []models.Order
	models.DB.Where(
		"(follow_operator_id = ? OR operator_id = ?) AND status IN ?",
		userID, userID, []string{models.StatusPending, models.StatusDesigning},
	).Find(&activeOrders)

	// 获取操作人姓名（也就是收到事件的员工）
	var emp models.Employee
	operatorName := userID
	if err := models.DB.Where("wecom_userid = ?", userID).First(&emp).Error; err == nil {
		operatorName = emp.Name
	}

	// 3. 智能识别：是设计师还是客户？
	var matchedDesigner *models.FreelanceDesigner
	var designers []models.FreelanceDesigner
	models.DB.Find(&designers)
	
	// 首先查 external_user_id 精确匹配
	for i, d := range designers {
		if d.ExternalUserID == externalUserID {
			matchedDesigner = &designers[i]
			break
		}
	}
	// 如果 external_user_id 没找到，再看昵称包含匹配
	if matchedDesigner == nil && nickname != "" {
		for i, d := range designers {
			// 企微昵称包含了系统内名册的名字（如："专业修图-张三" 包含了 "张三"）
			if strings.Contains(nickname, d.Name) {
				matchedDesigner = &designers[i]
				break
			}
		}
	}

	if matchedDesigner != nil {
		// ======= 场景 A：添加了设计师 =======
		// 如果该设计师还没绑定 external_user_id，顺手更新上
		if matchedDesigner.ExternalUserID == "" {
			models.DB.Model(matchedDesigner).Update("external_user_id", externalUserID)
		}

		log.Printf("✅ 识别为设计师添加 | designer=%s | external_user_id=%s", matchedDesigner.Name, externalUserID)

		// 写入该跟单的所有活跃订单时间线
		for _, order := range activeOrders {
			models.DB.Create(&models.OrderTimeline{
				OrderID:      order.ID,
				EventType:    "designer_contact_added",
				OperatorID:   userID,
				OperatorName: operatorName,
				Remark:       fmt.Sprintf("已在企业微信上成功添加兼职设计师为好友: %s (昵称: %s)", matchedDesigner.Name, nickname),
			})
		}
	} else {
		// ======= 场景 B：添加了客户 =======
		log.Printf("✅ 识别为客户添加 | external_user_id=%s | nickname=%s", externalUserID, nickname)

		var customer models.Customer
		result := models.DB.Where("external_user_id = ?", externalUserID).First(&customer)
		if result.Error != nil {
			customer = models.Customer{
				ExternalUserID: externalUserID,
				Nickname:       nickname,
				Remark:         "企微自动添加 (员工: " + userID + ")",
			}
			models.DB.Create(&customer)
		} else {
			if customer.Nickname == "" && nickname != "" {
				models.DB.Model(&customer).Update("nickname", nickname)
			}
		}

		// 挑选出需要建群/关联客户的订单 (PENDING)
		var pendingOrders []models.Order
		for _, o := range activeOrders {
			if o.Status == models.StatusPending {
				pendingOrders = append(pendingOrders, o)
			}
		}

		// 自动绑定逻辑：如果正好只有 1 个 PENDING 个且 CustomerID 为 0，就帮他自动绑定
		if len(pendingOrders) == 1 && pendingOrders[0].CustomerID == 0 {
			targetOrder := pendingOrders[0]
			models.DB.Model(&targetOrder).Update("customer_id", customer.ID)
			
			models.DB.Create(&models.OrderTimeline{
				OrderID:      targetOrder.ID,
				EventType:    "customer_matched",
				OperatorID:   userID,
				OperatorName: operatorName,
				Remark:       fmt.Sprintf("智能识别唯一待处理订单，自动关联客户: %s", nickname),
			})

			// 广播订单更新
			services.Hub.Broadcast(services.WSEvent{
				Type:    "order_updated",
				Payload: targetOrder,
			})
			log.Printf("🎯 智能自动匹配唯一活跃订单 | sn=%s", targetOrder.OrderSN)
		} else {
			// 如果有 0 个或者多个，就不自动绑定，只写 Timeline 提醒记录
			for _, order := range pendingOrders {
				models.DB.Create(&models.OrderTimeline{
					OrderID:      order.ID,
					EventType:    "customer_contact_added",
					OperatorID:   userID,
					OperatorName: operatorName,
					Remark:       fmt.Sprintf("有新外部联系人添加: %s，疑似本单客户，需手动确认", nickname),
				})
			}
		}

		// ── 新增：创建自动建群任务 ──
		var existingTask models.AutoGroupTask
		taskResult := models.DB.Where(
			"external_user_id = ? AND staff_user_id = ? AND status IN ?",
			externalUserID, userID,
			[]string{"pending", "checking", "building"},
		).First(&existingTask)

		if taskResult.Error != nil {
			task := models.AutoGroupTask{
				ExternalUserID: externalUserID,
				CustomerID:     customer.ID,
				CustomerName:   nickname,
				StaffUserID:    userID,
				Status:         "pending",
				MaxRetry:       3,
			}
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&task).Error
			})
			log.Printf("✅ 自动建群任务已创建: customer=%s, staff=%s", nickname, userID)
		}
	}

	// websocket 发送原有的匹配提醒，供前端显示通知
	services.Hub.SendTo(userID, services.WSEvent{
		Type: "new_external_contact",
		Payload: map[string]string{
			"external_user_id": externalUserID,
			"nickname":         nickname,
			"staff_userid":     userID,
		},
	})
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

	// 判断客户联系 Secret 配置状态
	contactSecretStatus := "未配置"
	if config.C.WecomContactSecret != "" {
		if config.C.WecomContactSecret == config.C.WecomCorpSecret {
			contactSecretStatus = "与应用 Secret 相同 (建议分离)"
		} else {
			contactSecretStatus = "独立配置 ✅"
		}
	}

	// 会话存档引擎状态
	msgAuditStatus := "未启用"
	if config.C.EnableMsgAudit {
		if config.C.WecomMsgAuditSecret != "" && config.C.WecomMsgAuditPrivateKey != "" {
			msgAuditStatus = "已启用 ✅"
		} else {
			msgAuditStatus = "已启用但配置不完整"
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"configured":            true,
		"callback_configured":   callbackConfigured,
		"corp_id":               maskSensitive(config.C.WecomCorpID),
		"agent_id":              maskAgentID(config.C.WecomAgentID),
		"callback_url":          fmt.Sprintf("%s/api/v1/wecom/callback", config.C.BaseURL),
		"contact_secret_status": contactSecretStatus,
		"msg_audit_status":      msgAuditStatus,
		"results":               results,
	})
}
