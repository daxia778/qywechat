package handlers

import (
	"fmt"
	"log"
	"strconv"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ListNotifications 获取当前用户的通知列表
func ListNotifications(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	unreadOnly := c.Query("unread") == "true"

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	// 管理员看所有通知，普通用户只看自己的
	userID := "admin"
	if v, exists := c.Get("wecom_userid"); exists {
		if uid, ok := v.(string); ok {
			userID = uid
		}
	}

	query := models.DB.Model(&models.Notification{}).Where("user_id = ?", userID)
	if unreadOnly {
		query = query.Where("is_read = ?", false)
	}

	var total int64
	query.Count(&total)

	var notifications []models.Notification
	query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&notifications)

	// 未读数
	var unreadCount int64
	models.DB.Model(&models.Notification{}).Where("user_id = ? AND is_read = ?", userID, false).Count(&unreadCount)

	respondOK(c, gin.H{
		"data":         notifications,
		"total":        total,
		"unread_count": unreadCount,
	})
}

// MarkAllNotificationsRead 批量标记所有通知已读
func MarkAllNotificationsRead(c *gin.Context) {
	userID := "admin"
	if v, exists := c.Get("wecom_userid"); exists {
		if uid, ok := v.(string); ok {
			userID = uid
		}
	}
	var count int64
	models.WriteTx(func(tx *gorm.DB) error {
		r := tx.Model(&models.Notification{}).Where("user_id = ? AND is_read = ?", userID, false).Update("is_read", true)
		count = r.RowsAffected
		return r.Error
	})
	respondOK(c, gin.H{
		"message": "ok",
		"count":   count,
	})
}

// MarkNotificationRead 标记通知已读
func MarkNotificationRead(c *gin.Context) {
	idStr := c.Param("id")

	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的通知ID")
		return
	}

	// 获取当前用户ID，防止 IDOR 越权
	userID := "admin"
	if v, exists := c.Get("wecom_userid"); exists {
		if uid, ok := v.(string); ok {
			userID = uid
		}
	}

	var rowsAffected int64
	models.WriteTx(func(tx *gorm.DB) error {
		r := tx.Model(&models.Notification{}).Where("id = ? AND user_id = ?", uint(id), userID).Update("is_read", true)
		rowsAffected = r.RowsAffected
		return r.Error
	})
	if rowsAffected == 0 {
		notFound(c, "通知不存在或无权操作")
		return
	}
	respondMessage(c, "已标记已读")
}

// SendOrderStatusNotification 订单状态变更后发送通知
// 异步调用，不阻塞接口响应
func SendOrderStatusNotification(order *models.Order, newStatus string) {
	go func() {
		statusNames := map[string]string{
			models.StatusPending:   "待接单",
			models.StatusDesigning: "设计中",
			models.StatusCompleted: "已完成",
			models.StatusRefunded:  "已退款",
		}
		statusText := statusNames[newStatus]
		if statusText == "" {
			statusText = newStatus
		}

		title := fmt.Sprintf("订单 %s 状态更新", order.OrderSN)
		content := fmt.Sprintf("订单 %s (%s) 状态变更为: %s", order.OrderSN, order.Topic, statusText)

		// 通知跟单客服 (所有状态变更)
		if order.FollowOperatorID != "" {
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   order.FollowOperatorID,
					Title:    title,
					Content:  content,
					Category: "order",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			})
			if err := services.Wecom.SendTextMessage([]string{order.FollowOperatorID}, content); err != nil {
				log.Printf("发送企微通知失败 (跟单客服 %s): %v", order.FollowOperatorID, err)
			}
		}

		// 通知谈单客服 (完成/退款时)
		if order.OperatorID != "" && order.OperatorID != order.FollowOperatorID &&
			(newStatus == models.StatusCompleted || newStatus == models.StatusRefunded) {
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   order.OperatorID,
					Title:    title,
					Content:  content,
					Category: "order",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			})
			if err := services.Wecom.SendTextMessage([]string{order.OperatorID}, content); err != nil {
				log.Printf("发送企微通知失败 (谈单客服 %s): %v", order.OperatorID, err)
			}
		}

		// 通知管理员 (终态: 退款)
		if models.IsTerminalStatus(newStatus) {
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   "admin",
					Title:    title,
					Content:  content,
					Category: "order",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			})
		}

		// 如果有群聊，也在群内推送状态变更
		if order.WecomChatID != "" {
			groupMsg := fmt.Sprintf("📢 订单状态变更\n订单: %s\n状态: %s", order.OrderSN, statusText)
			if err := services.Wecom.SendGroupMessage(order.WecomChatID, groupMsg); err != nil {
				log.Printf("发送群聊状态通知失败: sn=%s chat=%s err=%v", order.OrderSN, order.WecomChatID, err)
			}
		}
	}()
}
