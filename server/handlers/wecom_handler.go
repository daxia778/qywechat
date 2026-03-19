package handlers

import (
	"encoding/xml"
	"io"
	"log"
	"net/http"
	"strings"

	"pdd-order-system/config"
	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
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

		// 降级：如果未配置完全，直接返回 (可能无法通过企微验证)
		c.String(http.StatusOK, echostr)
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
