package services

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"gorm.io/gorm"
)

// ─── 风控引擎 ──────────────────────────────────────
// 分为两种模式：
// A. 即时检测 — 在操作发生时同步调用，立即判断是否触发风险
// B. 定时扫描 — 每小时运行一次，扫描统计类风险（退款率、死单等）

const (
	riskScanInterval     = 1 * time.Hour  // 风控扫描间隔
	inactiveOrderTimeout = 48 * time.Hour // 订单无操作超时阈值
)

// ═══════════════════════════════════════════════════
// A. 即时检测
// ═══════════════════════════════════════════════════

// CheckPriceDrop 检测金额异常下调
// 当跟单客服修改订单金额时调用，如果降幅超过阈值则创建高风险告警
func CheckPriceDrop(orderID uint, orderSN string, oldPrice, newPrice int, operatorID, operatorName string) {
	if oldPrice <= 0 || newPrice >= oldPrice {
		return // 涨价或无变化，不预警
	}

	dropPct := (oldPrice - newPrice) * 100 / oldPrice
	threshold := config.C.RiskPriceDropThreshold

	if dropPct < threshold {
		return // 在阈值内，不告警
	}

	severity := models.RiskSeverityMedium
	if dropPct >= 40 {
		severity = models.RiskSeverityHigh
	}

	alert := models.RiskAlert{
		AlertType:   models.RiskPriceDrop,
		Severity:    severity,
		OrderID:     orderID,
		OrderSN:     orderSN,
		StaffUserID: operatorID,
		StaffName:   operatorName,
		Title:       fmt.Sprintf("金额异常下调 %d%% | %s", dropPct, orderSN),
		Detail: fmt.Sprintf(
			"订单 %s 金额从 ¥%.2f 下调至 ¥%.2f，降幅 %d%%（阈值 %d%%）。操作人: %s",
			orderSN, float64(oldPrice)/100, float64(newPrice)/100, dropPct, threshold, operatorName,
		),
		OldValue: strconv.Itoa(oldPrice),
		NewValue: strconv.Itoa(newPrice),
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&alert).Error
	}); err != nil {
		log.Printf("❌ 创建金额风控告警失败: %v", err)
		return
	}

	log.Printf("🚨 风控告警 | 金额下调 %d%% | sn=%s | %s | ¥%.2f→¥%.2f",
		dropPct, orderSN, operatorName, float64(oldPrice)/100, float64(newPrice)/100)

	// 高风险告警推送管理员企微
	if severity == models.RiskSeverityHigh {
		notifyAdminsRiskAlert(&alert)
	}
}

// CheckAbnormalTime 检测异常操作时间
// 凌晨 0:00-6:00 的金额修改/退款操作标记为中风险
func CheckAbnormalTime(orderID uint, orderSN, operationType, operatorID, operatorName string) {
	hour := time.Now().Hour()
	if hour >= 6 {
		return // 正常时间，不预警
	}

	opNames := map[string]string{
		"amount_changed":  "金额修改",
		"refund":          "退款操作",
		"commission":      "佣金调整",
	}
	opName := opNames[operationType]
	if opName == "" {
		opName = operationType
	}

	alert := models.RiskAlert{
		AlertType:   models.RiskAbnormalTime,
		Severity:    models.RiskSeverityMedium,
		OrderID:     orderID,
		OrderSN:     orderSN,
		StaffUserID: operatorID,
		StaffName:   operatorName,
		Title:       fmt.Sprintf("异常时间操作 %02d:%02d | %s", hour, time.Now().Minute(), opName),
		Detail: fmt.Sprintf(
			"跟单客服 %s 在凌晨 %02d:%02d 执行了 %s 操作（订单: %s）。非正常工作时间操作需关注。",
			operatorName, hour, time.Now().Minute(), opName, orderSN,
		),
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&alert).Error
	}); err != nil {
		log.Printf("❌ 创建异常时间风控告警失败: %v", err)
	}
}

// CheckFrequentReassign 检测频繁换设计师
// 同一订单换设计师 >= 2 次时触发
func CheckFrequentReassign(orderID uint, orderSN, operatorID, operatorName string) {
	var reassignCount int64
	models.DB.Model(&models.OrderTimeline{}).
		Where("order_id = ? AND event_type = ?", orderID, "designer_reassigned").
		Count(&reassignCount)

	if reassignCount < 2 {
		return
	}

	// 避免同一订单重复告警
	var existingCount int64
	models.DB.Model(&models.RiskAlert{}).
		Where("order_id = ? AND alert_type = ? AND is_resolved = ?",
			orderID, models.RiskFrequentReassign, false).
		Count(&existingCount)
	if existingCount > 0 {
		return
	}

	alert := models.RiskAlert{
		AlertType:   models.RiskFrequentReassign,
		Severity:    models.RiskSeverityMedium,
		OrderID:     orderID,
		OrderSN:     orderSN,
		StaffUserID: operatorID,
		StaffName:   operatorName,
		Title:       fmt.Sprintf("频繁换设计师 (%d次) | %s", reassignCount, orderSN),
		Detail: fmt.Sprintf(
			"订单 %s 已更换设计师 %d 次，可能存在利益输送或异常行为。最近操作人: %s",
			orderSN, reassignCount, operatorName,
		),
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&alert).Error
	}); err != nil {
		log.Printf("❌ 创建频繁换设计师风控告警失败: %v", err)
	}
}

// ═══════════════════════════════════════════════════
// B. 定时扫描
// ═══════════════════════════════════════════════════

// StartRiskScanner 启动风控定时扫描
func StartRiskScanner(ctx context.Context) {
	log.Printf("✅ 风控扫描引擎已启动 (间隔 %v)", riskScanInterval)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[RiskScanner] panic recovered: %v", r)
			}
		}()

		// 启动 2 分钟后首次扫描
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Minute):
		}
		runRiskScan()

		ticker := time.NewTicker(riskScanInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("风控扫描引擎已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[RiskScanner] tick panic recovered: %v", r)
						}
					}()
					runRiskScan()
				}()
			}
		}
	}()
}

func runRiskScan() {
	log.Println("🔍 风控扫描开始...")
	scanHighRefundRate()
	scanInactiveOrders()
	log.Println("🔍 风控扫描完成")
}

// scanHighRefundRate 扫描高退款率跟单客服
func scanHighRefundRate() {
	threshold := config.C.RiskRefundRateThreshold
	weekAgo := time.Now().Add(-7 * 24 * time.Hour)

	// 统计每个跟单客服过去 7 天的订单总数和退款数
	type StaffRefundStat struct {
		FollowOperatorID string `gorm:"column:follow_operator_id"`
		TotalOrders      int    `gorm:"column:total_orders"`
		RefundedOrders   int    `gorm:"column:refunded_orders"`
	}

	var stats []StaffRefundStat
	models.DB.Model(&models.Order{}).
		Select(`follow_operator_id,
			COUNT(*) as total_orders,
			SUM(CASE WHEN status = 'REFUNDED' THEN 1 ELSE 0 END) as refunded_orders`).
		Where("follow_operator_id != '' AND created_at >= ?", weekAgo).
		Group("follow_operator_id").
		Having("COUNT(*) >= 5"). // 至少 5 单才有统计意义
		Find(&stats)

	for _, stat := range stats {
		if stat.TotalOrders == 0 {
			continue
		}
		refundRate := stat.RefundedOrders * 100 / stat.TotalOrders
		if refundRate < threshold {
			continue
		}

		// 避免重复告警：检查本周是否已有同类未处理告警
		var existingCount int64
		models.DB.Model(&models.RiskAlert{}).
			Where("staff_user_id = ? AND alert_type = ? AND is_resolved = ? AND created_at >= ?",
				stat.FollowOperatorID, models.RiskHighRefund, false, weekAgo).
			Count(&existingCount)
		if existingCount > 0 {
			continue
		}

		staffName := BuildOperatorInfo(stat.FollowOperatorID)

		severity := models.RiskSeverityMedium
		if refundRate >= 30 {
			severity = models.RiskSeverityHigh
		}

		alert := models.RiskAlert{
			AlertType:   models.RiskHighRefund,
			Severity:    severity,
			StaffUserID: stat.FollowOperatorID,
			StaffName:   staffName,
			Title:       fmt.Sprintf("高退款率 %d%% | %s", refundRate, staffName),
			Detail: fmt.Sprintf(
				"跟单客服 %s 近 7 天退款率为 %d%%（%d/%d 单），超过阈值 %d%%。",
				staffName, refundRate, stat.RefundedOrders, stat.TotalOrders, threshold,
			),
			OldValue: fmt.Sprintf("%d%%", threshold),
			NewValue: fmt.Sprintf("%d%%", refundRate),
		}

		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&alert).Error
		}); err != nil {
			log.Printf("❌ 创建高退款率风控告警失败: %v", err)
			continue
		}

		log.Printf("🚨 风控告警 | 高退款率 %d%% | staff=%s | %d/%d单",
			refundRate, staffName, stat.RefundedOrders, stat.TotalOrders)

		if severity == models.RiskSeverityHigh {
			notifyAdminsRiskAlert(&alert)
		}
	}
}

// scanInactiveOrders 扫描长期无操作订单
func scanInactiveOrders() {
	threshold := time.Now().Add(-inactiveOrderTimeout)

	// 查找创建超过 48h、仍然是 PENDING 且有跟单客服的订单
	var orders []models.Order
	models.DB.Where(
		"status = ? AND follow_operator_id != '' AND created_at < ?",
		models.StatusPending, threshold,
	).Find(&orders)

	for _, order := range orders {
		// 避免重复告警
		var existingCount int64
		models.DB.Model(&models.RiskAlert{}).
			Where("order_id = ? AND alert_type = ? AND is_resolved = ?",
				order.ID, models.RiskInactiveOrder, false).
			Count(&existingCount)
		if existingCount > 0 {
			continue
		}

		staffName := BuildOperatorInfo(order.FollowOperatorID)
		hours := int(time.Since(order.CreatedAt).Hours())

		alert := models.RiskAlert{
			AlertType:   models.RiskInactiveOrder,
			Severity:    models.RiskSeverityLow,
			OrderID:     order.ID,
			OrderSN:     order.OrderSN,
			StaffUserID: order.FollowOperatorID,
			StaffName:   staffName,
			Title:       fmt.Sprintf("订单 %dh 无操作 | %s", hours, order.OrderSN),
			Detail: fmt.Sprintf(
				"订单 %s 创建 %d 小时仍处于待处理状态，跟单客服: %s。可能存在飞单风险。",
				order.OrderSN, hours, staffName,
			),
		}

		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&alert).Error
		}); err != nil {
			log.Printf("❌ 创建死单风控告警失败: %v", err)
		}
	}
}

// ═══════════════════════════════════════════════════
// 告警通知
// ═══════════════════════════════════════════════════

// notifyAdminsRiskAlert 向管理员推送高风险告警
func notifyAdminsRiskAlert(alert *models.RiskAlert) {
	if Wecom == nil || !Wecom.IsConfigured() {
		return
	}

	// 查找所有管理员
	var admins []models.Employee
	models.DB.Where("role = ? AND is_active = ? AND wecom_userid != ''", "admin", true).Find(&admins)

	if len(admins) == 0 {
		return
	}

	adminIDs := make([]string, 0, len(admins))
	for _, a := range admins {
		adminIDs = append(adminIDs, a.WecomUserID)
	}

	severityEmoji := map[string]string{
		models.RiskSeverityHigh:   "🔴",
		models.RiskSeverityMedium: "🟡",
		models.RiskSeverityLow:    "🔵",
	}
	emoji := severityEmoji[alert.Severity]
	if emoji == "" {
		emoji = "⚠️"
	}

	msg := fmt.Sprintf("%s 风控告警\n━━━━━━━━━━━━━━━━━\n📌 %s\n📝 %s\n━━━━━━━━━━━━━━━━━\n请登录管理后台查看详情",
		emoji, alert.Title, alert.Detail)

	if err := Wecom.SendTextMessage(adminIDs, msg); err != nil {
		log.Printf("⚠️ 推送管理员风控告警失败: %v", err)
	}

	// 同时推送到审计群
	BroadcastAuditEvent(AuditEvent{
		Type:         AuditEventType("risk_alert"),
		OrderSN:      alert.OrderSN,
		OperatorName: alert.StaffName,
		Extra: map[string]string{
			"severity": alert.Severity,
			"title":    alert.Title,
		},
	})

	// 创建站内通知
	for _, adminID := range adminIDs {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&models.Notification{
				UserID:   adminID,
				Title:    fmt.Sprintf("%s %s", emoji, alert.Title),
				Content:  alert.Detail,
				Category: "risk",
				RefID:    fmt.Sprintf("%d", alert.ID),
			}).Error
		})
	}

	// WebSocket 广播
	Hub.Broadcast(WSEvent{
		Type: "risk_alert",
		Payload: map[string]interface{}{
			"id":       alert.ID,
			"type":     alert.AlertType,
			"severity": alert.Severity,
			"title":    alert.Title,
		},
	})
}

// ─── 风控统计查询 ──────────────────────────────────────

// RiskDashboardStats 风控看板统计
type RiskDashboardStats struct {
	TodayFollowOps     int64 `json:"today_follow_ops"`      // 今日跟单操作次数
	PendingAlerts      int64 `json:"pending_alerts"`         // 待审核告警数
	HighRiskAlerts     int64 `json:"high_risk_alerts"`       // 高风险告警数
	WeekRefundAmount   int   `json:"week_refund_amount"`     // 本周退款总额（分）
	TotalAlerts        int64 `json:"total_alerts"`           // 全部告警数
	ResolvedAlerts     int64 `json:"resolved_alerts"`        // 已处理告警数
}

// GetRiskDashboardStats 获取风控看板统计数据
func GetRiskDashboardStats() *RiskDashboardStats {
	stats := &RiskDashboardStats{}
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	weekStart := todayStart.AddDate(0, 0, -(weekday - 1))

	// 今日跟单操作次数（从 OrderTimeline 统计 follow 角色操作）
	models.DB.Model(&models.OrderTimeline{}).
		Joins("JOIN employees ON employees.wecom_userid = order_timelines.operator_id").
		Where("employees.role = ? AND order_timelines.created_at >= ?", "follow", todayStart).
		Count(&stats.TodayFollowOps)

	// 待审核告警
	models.DB.Model(&models.RiskAlert{}).Where("is_resolved = ?", false).Count(&stats.PendingAlerts)

	// 高风险告警（未处理）
	models.DB.Model(&models.RiskAlert{}).
		Where("is_resolved = ? AND severity = ?", false, models.RiskSeverityHigh).
		Count(&stats.HighRiskAlerts)

	// 本周退款总额
	type AmountResult struct {
		Total int `gorm:"column:total"`
	}
	var refundAmount AmountResult
	models.DB.Model(&models.Order{}).
		Select("COALESCE(SUM(price), 0) as total").
		Where("status = ? AND updated_at >= ?", models.StatusRefunded, weekStart).
		Scan(&refundAmount)
	stats.WeekRefundAmount = refundAmount.Total

	// 全部/已处理告警
	models.DB.Model(&models.RiskAlert{}).Count(&stats.TotalAlerts)
	models.DB.Model(&models.RiskAlert{}).Where("is_resolved = ?", true).Count(&stats.ResolvedAlerts)

	return stats
}

// StaffRiskProfile 跟单客服风险画像
type StaffRiskProfile struct {
	UserID       string  `json:"user_id"`
	Name         string  `json:"name"`
	TotalOps     int64   `json:"total_ops"`      // 操作总数
	WeekOps      int64   `json:"week_ops"`       // 本周操作数
	TotalOrders  int64   `json:"total_orders"`   // 负责订单数
	RefundCount  int64   `json:"refund_count"`   // 退款订单数
	RefundRate   float64 `json:"refund_rate"`    // 退款率
	AlertCount   int64   `json:"alert_count"`    // 关联告警数
	UnresolvedAlerts int64 `json:"unresolved_alerts"` // 未处理告警
}

// GetStaffRiskProfiles 获取所有跟单客服的风险画像
func GetStaffRiskProfiles() []StaffRiskProfile {
	var followStaff []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "follow", true).Find(&followStaff)

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	weekStart := todayStart.AddDate(0, 0, -(weekday - 1))

	profiles := make([]StaffRiskProfile, 0, len(followStaff))

	for _, staff := range followStaff {
		profile := StaffRiskProfile{
			UserID: staff.WecomUserID,
			Name:   staff.Name,
		}

		// 操作总数
		models.DB.Model(&models.OrderTimeline{}).
			Where("operator_id = ?", staff.WecomUserID).
			Count(&profile.TotalOps)

		// 本周操作数
		models.DB.Model(&models.OrderTimeline{}).
			Where("operator_id = ? AND created_at >= ?", staff.WecomUserID, weekStart).
			Count(&profile.WeekOps)

		// 负责订单数
		models.DB.Model(&models.Order{}).
			Where("follow_operator_id = ?", staff.WecomUserID).
			Count(&profile.TotalOrders)

		// 退款订单数
		models.DB.Model(&models.Order{}).
			Where("follow_operator_id = ? AND status = ?", staff.WecomUserID, models.StatusRefunded).
			Count(&profile.RefundCount)

		if profile.TotalOrders > 0 {
			profile.RefundRate = float64(profile.RefundCount) / float64(profile.TotalOrders) * 100
		}

		// 关联告警数
		models.DB.Model(&models.RiskAlert{}).
			Where("staff_user_id = ?", staff.WecomUserID).
			Count(&profile.AlertCount)

		models.DB.Model(&models.RiskAlert{}).
			Where("staff_user_id = ? AND is_resolved = ?", staff.WecomUserID, false).
			Count(&profile.UnresolvedAlerts)

		profiles = append(profiles, profile)
	}

	return profiles
}
