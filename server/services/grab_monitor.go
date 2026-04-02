package services

import (
	"context"
	"fmt"
	"log"
	"time"

	"pdd-order-system/models"

	"gorm.io/gorm"
)

// GrabMonitor 恶意抢单检测
type GrabMonitor struct {
	// 超时阈值（默认30分钟）
	TimeoutThreshold time.Duration
	// 检查间隔（默认5分钟）
	CheckInterval time.Duration
	// DESIGNING 状态超时阈值（默认48小时）
	DesigningTimeoutThreshold time.Duration
}

var Monitor = &GrabMonitor{
	TimeoutThreshold:          30 * time.Minute,
	CheckInterval:             5 * time.Minute,
	DesigningTimeoutThreshold: 48 * time.Hour,
}

// Deprecated: v2.0 已移除抢单机制，GrabMonitor 不再启动
// Start 保留函数签名以避免编译错误，但不再执行任何监控逻辑
func (m *GrabMonitor) Start(ctx context.Context) {
	log.Println("⚠️ GrabMonitor.Start 已废弃 (v2.0 无抢单机制)，跳过启动")
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
		// 安全检查: AssignedAt 可能为 nil（数据库允许 NULL），跳过避免 panic
		if order.AssignedAt == nil {
			log.Printf("⚠️ 订单 %s AssignedAt 为 nil，跳过超时告警", order.OrderSN)
			continue
		}

		// 1. 创建站内通知给所有 admin
		for _, admin := range admins {
			if err := models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   admin.WecomUserID,
					Title:    "抢单超时告警",
					Content:  fmt.Sprintf("订单 %s 被设计师抢单已超过 %v 未推进", order.OrderSN, m.TimeoutThreshold),
					Category: "alert",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			}); err != nil {
				log.Printf("❌ 创建超时告警通知失败: sn=%s admin=%s err=%v", order.OrderSN, admin.WecomUserID, err)
			}
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
			if err := Wecom.SendTextMessage(adminIDs, msg); err != nil {
				log.Printf("⚠️ 发送抢单超时企微通知失败: sn=%s err=%v", order.OrderSN, err)
			}
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
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&order).Update("grab_alert_sent", true).Error
		}); err != nil {
			log.Printf("❌ 标记grab_alert_sent失败: sn=%s err=%v", order.OrderSN, err)
		}

		log.Printf("⚠️ 抢单超时告警已发送 | sn=%s | designer=%s | 超时 %v",
			order.OrderSN, order.DesignerID, time.Since(*order.AssignedAt).Round(time.Minute))
	}
}

// checkDesigningTimeout 检查 DESIGNING 状态超时未交付的订单
// 设计师抢单后长时间不交付，向管理员发送告警
func (m *GrabMonitor) checkDesigningTimeout() {
	threshold := time.Now().Add(-m.DesigningTimeoutThreshold)

	var orders []models.Order
	models.DB.Where(
		"status = ? AND updated_at < ? AND designing_alert_sent = ?",
		models.StatusDesigning, threshold, false,
	).Find(&orders)

	if len(orders) == 0 {
		return
	}

	// 查询所有 admin 用户
	var admins []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "admin", true).Find(&admins)

	// 批量查设计师姓名
	designerIDSet := make(map[string]struct{})
	for _, o := range orders {
		if o.DesignerID != "" {
			designerIDSet[o.DesignerID] = struct{}{}
		}
	}
	designerIDs := make([]string, 0, len(designerIDSet))
	for id := range designerIDSet {
		designerIDs = append(designerIDs, id)
	}
	nameMap := make(map[string]string)
	if len(designerIDs) > 0 {
		var emps []models.Employee
		models.DB.Select("wecom_userid, name").Where("wecom_userid IN ?", designerIDs).Find(&emps)
		for _, e := range emps {
			nameMap[e.WecomUserID] = e.Name
		}
	}

	for _, order := range orders {
		designerName := nameMap[order.DesignerID]
		if designerName == "" {
			designerName = order.DesignerID
		}

		elapsedHours := int(time.Since(order.UpdatedAt).Hours())

		// 1. 创建站内通知给所有 admin
		for _, admin := range admins {
			if err := models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   admin.WecomUserID,
					Title:    "设计超时告警",
					Content:  fmt.Sprintf("订单 %s 设计中已超过 %d 小时未交付，设计师：%s，请关注", order.OrderSN, elapsedHours, designerName),
					Category: "alert",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			}); err != nil {
				log.Printf("❌ 创建设计超时告警通知失败: sn=%s admin=%s err=%v", order.OrderSN, admin.WecomUserID, err)
			}
		}

		// 2. 企微消息通知所有 admin
		adminIDs := make([]string, len(admins))
		for i, a := range admins {
			adminIDs[i] = a.WecomUserID
		}
		if len(adminIDs) > 0 {
			msg := fmt.Sprintf("⚠️ 设计超时告警\n订单号：%s\n设计师：%s\n主题：%s\n已设计中：%d 小时\n━━━━━━━━━━━\n设计师抢单后长时间未交付，请及时跟进！",
				order.OrderSN,
				designerName,
				order.Topic,
				elapsedHours,
			)
			if err := Wecom.SendTextMessage(adminIDs, msg); err != nil {
				log.Printf("⚠️ 发送设计超时企微通知失败: sn=%s err=%v", order.OrderSN, err)
			}
		}

		// 3. WebSocket 广播
		Hub.Broadcast(WSEvent{
			Type: "designing_timeout_alert",
			Payload: map[string]any{
				"order_id":      order.ID,
				"order_sn":      order.OrderSN,
				"designer_id":   order.DesignerID,
				"designer_name": designerName,
				"topic":         order.Topic,
				"elapsed_hours": elapsedHours,
			},
		})

		// 4. 标记已告警，避免重复通知
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&order).Update("designing_alert_sent", true).Error
		}); err != nil {
			log.Printf("❌ 标记designing_alert_sent失败: sn=%s err=%v", order.OrderSN, err)
		}

		log.Printf("⚠️ 设计超时告警已发送 | sn=%s | designer=%s | 已超时 %d 小时",
			order.OrderSN, designerName, elapsedHours)
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

	// 批量查设计师姓名，避免 N+1
	designerIDs := make([]string, 0, len(orders))
	for _, o := range orders {
		if o.DesignerID != "" {
			designerIDs = append(designerIDs, o.DesignerID)
		}
	}
	nameMap := make(map[string]string)
	if len(designerIDs) > 0 {
		var emps []models.Employee
		models.DB.Select("wecom_userid, name").Where("wecom_userid IN ?", designerIDs).Find(&emps)
		for _, e := range emps {
			nameMap[e.WecomUserID] = e.Name
		}
	}

	results := make([]map[string]any, 0, len(orders))
	for _, o := range orders {
		// 安全检查: AssignedAt 可能为 nil，跳过避免 panic
		if o.AssignedAt == nil {
			continue
		}
		results = append(results, map[string]any{
			"order_id":        o.ID,
			"order_sn":        o.OrderSN,
			"designer_id":     o.DesignerID,
			"designer_name":   nameMap[o.DesignerID],
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

	// 单次聚合查询替代 N+1 循环
	type AggRow struct {
		DesignerID   string `gorm:"column:designer_id"`
		Total        int64  `gorm:"column:total"`
		TimeoutCount int64  `gorm:"column:timeout_count"`
	}
	var aggRows []AggRow
	models.DB.Model(&models.Order{}).
		Select("designer_id, COUNT(*) as total, SUM(CASE WHEN status = ? AND assigned_at IS NOT NULL AND assigned_at < ? THEN 1 ELSE 0 END) as timeout_count",
			models.StatusGroupCreated, time.Now().Add(-threshold)).
		Where("designer_id != ''").
		Group("designer_id").
		Find(&aggRows)

	aggMap := make(map[string]AggRow, len(aggRows))
	for _, r := range aggRows {
		aggMap[r.DesignerID] = r
	}

	results := make([]map[string]any, 0, len(designers))
	for _, d := range designers {
		agg := aggMap[d.WecomUserID]
		timeoutRate := 0.0
		if agg.Total > 0 {
			timeoutRate = float64(agg.TimeoutCount) / float64(agg.Total) * 100
		}

		results = append(results, map[string]any{
			"designer_id":        d.WecomUserID,
			"designer_name":      d.Name,
			"total_grabs":        agg.Total,
			"timeout_grabs":      agg.TimeoutCount,
			"timeout_rate":       timeoutRate,
			"active_order_count": d.ActiveOrderCount,
		})
	}
	return results, nil
}
