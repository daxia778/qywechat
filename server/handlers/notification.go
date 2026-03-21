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

// MarkNotificationRead 标记通知已读
func MarkNotificationRead(c *gin.Context) {
	idStr := c.Param("id")

	if idStr == "all" {
		// 批量全部已读
		userID := "admin"
		if v, exists := c.Get("wecom_userid"); exists {
			if uid, ok := v.(string); ok {
				userID = uid
			}
		}
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&models.Notification{}).Where("user_id = ? AND is_read = ?", userID, false).Update("is_read", true).Error
		})
		respondMessage(c, "全部已读")
		return
	}

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
			models.StatusPending:      "待接单",
			models.StatusGroupCreated: "已建群",
			models.StatusDesigning:    "设计中",
			models.StatusDelivered:    "已交付",
			models.StatusCompleted:    "已完成",
			models.StatusRefunded:     "已退款",
			models.StatusClosed:       "已关闭",
		}
		statusText := statusNames[newStatus]
		if statusText == "" {
			statusText = newStatus
		}

		title := fmt.Sprintf("订单 %s 状态更新", order.OrderSN)
		content := fmt.Sprintf("订单 %s (%s) 状态变更为: %s", order.OrderSN, order.Topic, statusText)

		// 通知设计师 (当客服完成/关闭/退款)
		if order.DesignerID != "" && (newStatus == models.StatusCompleted || newStatus == models.StatusClosed || newStatus == models.StatusRefunded) {
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   order.DesignerID,
					Title:    title,
					Content:  content,
					Category: "order",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			})
			if err := services.Wecom.SendTextMessage([]string{order.DesignerID}, content); err != nil {
				log.Printf("发送企微通知失败 (设计师 %s): %v", order.DesignerID, err)
			}
		}

		// 通知客服 (当设计师交付)
		if order.OperatorID != "" && newStatus == models.StatusDelivered {
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
				log.Printf("发送企微通知失败 (客服 %s): %v", order.OperatorID, err)
			}
		}

		// 通知管理员 (所有终态)
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
	}()
}
