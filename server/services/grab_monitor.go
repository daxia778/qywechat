package services

import (
	"fmt"
	"log"
	"time"

	"pdd-order-system/models"
)

// GrabMonitor 恶意抢单检测
type GrabMonitor struct {
	// 超时阈值（默认30分钟）
	TimeoutThreshold time.Duration
	// 检查间隔（默认5分钟）
	CheckInterval time.Duration
}

var Monitor = &GrabMonitor{
	TimeoutThreshold: 30 * time.Minute,
	CheckInterval:    5 * time.Minute,
}

// Start 启动定时检测
func (m *GrabMonitor) Start() {
	go func() {
		ticker := time.NewTicker(m.CheckInterval)
		defer ticker.Stop()
		for range ticker.C {
			m.checkTimeoutGrabs()
		}
	}()
	log.Printf("[GrabMonitor] 已启动，每 %v 检查一次，超时阈值 %v", m.CheckInterval, m.TimeoutThreshold)
}

// checkTimeoutGrabs 检查超时未推进的抢单（仅告警未告警过的订单）
func (m *GrabMonitor) checkTimeoutGrabs() {
	threshold := time.Now().Add(-m.TimeoutThreshold)

	var orders []models.Order
	models.DB.Where(
		"status = ? AND assigned_at IS NOT NULL AND assigned_at < ? AND grab_alert_sent = ?",
		models.StatusGroupCreated, threshold, false,
	).Find(&orders)

	if len(orders) == 0 {
		return
	}

	// 查询所有 admin 用户
	var admins []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "admin", true).Find(&admins)

	for _, order := range orders {
		// 1. 创建站内通知给所有 admin
		for _, admin := range admins {
			models.DB.Create(&models.Notification{
				UserID:   admin.WecomUserID,
				Title:    "抢单超时告警",
				Content:  fmt.Sprintf("订单 %s 被设计师抢单已超过 %v 未推进", order.OrderSN, m.TimeoutThreshold),
				Category: "alert",
				RefID:    fmt.Sprintf("%d", order.ID),
			})
		}

		// 2. 企微消息通知所有 admin
		adminIDs := make([]string, len(admins))
		for i, a := range admins {
			adminIDs[i] = a.WecomUserID
		}
		if len(adminIDs) > 0 {
			msg := fmt.Sprintf("⚠️ 抢单超时告警\n订单号：%s\n设计师：%s\n抢单时间：%s\n已超时：%v",
				order.OrderSN,
				order.DesignerID,
				order.AssignedAt.Format("01-02 15:04"),
				time.Since(*order.AssignedAt).Round(time.Minute),
			)
			_ = Wecom.SendTextMessage(adminIDs, msg)
		}

		// 3. WebSocket 广播
		Hub.Broadcast(WSEvent{
			Type: "grab_alert",
			Payload: map[string]any{
				"order_id":        order.ID,
				"order_sn":        order.OrderSN,
				"designer_id":     order.DesignerID,
				"assigned_at":     order.AssignedAt,
				"timeout_minutes": int(time.Since(*order.AssignedAt).Minutes()),
			},
		})

		// 4. 标记已告警，避免重复通知
		models.DB.Model(&order).Update("grab_alert_sent", true)

		log.Printf("⚠️ 抢单超时告警已发送 | sn=%s | designer=%s | 超时 %v",
			order.OrderSN, order.DesignerID, time.Since(*order.AssignedAt).Round(time.Minute))
	}
}

// GetGrabAlerts 获取当前超时抢单列表
func GetGrabAlerts() ([]map[string]any, error) {
	threshold := time.Now().Add(-Monitor.TimeoutThreshold)

	var orders []models.Order
	err := models.DB.Where(
		"status = ? AND assigned_at IS NOT NULL AND assigned_at < ?",
		models.StatusGroupCreated, threshold,
	).Find(&orders).Error
	if err != nil {
		return nil, err
	}

	// 查设计师姓名
	results := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		designerName := ""
		var emp models.Employee
		if models.DB.Where("wecom_userid = ?", o.DesignerID).First(&emp).Error == nil {
			designerName = emp.Name
		}
		results = append(results, map[string]any{
			"order_id":        o.ID,
			"order_sn":        o.OrderSN,
			"designer_id":     o.DesignerID,
			"designer_name":   designerName,
			"assigned_at":     o.AssignedAt,
			"timeout_minutes": int(time.Since(*o.AssignedAt).Minutes()),
			"price":           o.Price,
			"topic":           o.Topic,
		})
	}
	return results, nil
}

// GetDesignerGrabStats 获取设计师抢单统计（含超时率）
func GetDesignerGrabStats() ([]map[string]any, error) {
	var designers []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "designer", true).Find(&designers)

	threshold := Monitor.TimeoutThreshold
	results := make([]map[string]any, 0, len(designers))

	for _, d := range designers {
		var totalGrabs int64
		models.DB.Model(&models.Order{}).Where("designer_id = ?", d.WecomUserID).Count(&totalGrabs)

		var timeoutGrabs int64
		// 统计状态仍为 GROUP_CREATED 且超时的
		models.DB.Model(&models.Order{}).Where(
			"designer_id = ? AND status = ? AND assigned_at IS NOT NULL AND assigned_at < ?",
			d.WecomUserID, models.StatusGroupCreated, time.Now().Add(-threshold),
		).Count(&timeoutGrabs)

		timeoutRate := 0.0
		if totalGrabs > 0 {
			timeoutRate = float64(timeoutGrabs) / float64(totalGrabs) * 100
		}

		results = append(results, map[string]any{
			"designer_id":        d.WecomUserID,
			"designer_name":      d.Name,
			"total_grabs":        totalGrabs,
			"timeout_grabs":      timeoutGrabs,
			"timeout_rate":       timeoutRate,
			"active_order_count": d.ActiveOrderCount,
		})
	}
	return results, nil
}
