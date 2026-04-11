package handlers

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ─── 风控看板 API ──────────────────────────────────────

// GetRiskDashboard 获取风控看板统计数据
// GET /api/v1/admin/risk/dashboard
func GetRiskDashboard(c *gin.Context) {
	stats := services.GetRiskDashboardStats()
	respondOK(c, stats)
}

// ListRiskAlerts 获取风控告警列表（支持筛选）
// GET /api/v1/admin/risk/alerts?type=&severity=&resolved=&staff=&limit=&offset=
func ListRiskAlerts(c *gin.Context) {
	alertType := c.Query("type")
	severity := c.Query("severity")
	resolved := c.Query("resolved")
	staffID := c.Query("staff")
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > models.PaginationMax {
		limit = models.PaginationDefault
	}

	query := models.DB.Model(&models.RiskAlert{})

	if alertType != "" {
		query = query.Where("alert_type = ?", alertType)
	}
	if severity != "" {
		query = query.Where("severity = ?", severity)
	}
	if resolved == "true" {
		query = query.Where("is_resolved = ?", true)
	} else if resolved == "false" {
		query = query.Where("is_resolved = ?", false)
	}
	if staffID != "" {
		query = query.Where("staff_user_id = ?", staffID)
	}

	var total int64
	query.Count(&total)

	var alerts []models.RiskAlert
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&alerts).Error; err != nil {
		log.Printf("ListRiskAlerts 查询失败: %v", err)
		internalError(c, "查询告警失败")
		return
	}

	respondOK(c, gin.H{
		"data":  alerts,
		"total": total,
	})
}

// ResolveRiskAlert 标记风控告警已处理
// PUT /api/v1/admin/risk/alerts/:id/resolve
func ResolveRiskAlert(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的告警ID")
		return
	}

	var body struct {
		Remark string `json:"remark"`
	}
	c.ShouldBindJSON(&body)

	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	now := time.Now()
	result := models.DB.Model(&models.RiskAlert{}).Where("id = ? AND is_resolved = ?", uint(id), false).
		Updates(map[string]interface{}{
			"is_resolved":    true,
			"resolved_by":    uidStr,
			"resolved_at":    &now,
			"resolve_remark": body.Remark,
		})

	if result.Error != nil {
		log.Printf("ResolveRiskAlert 失败: id=%d err=%v", id, result.Error)
		internalError(c, "处理告警失败")
		return
	}
	if result.RowsAffected == 0 {
		notFound(c, "告警不存在或已处理")
		return
	}

	respondMessage(c, "告警已标记为已处理")
}

// GetRiskAuditLog 获取跟单操作流水
// GET /api/v1/admin/risk/audit-log?staff=&start_date=&end_date=&limit=&offset=
func GetRiskAuditLog(c *gin.Context) {
	staffID := c.Query("staff")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > models.PaginationMax {
		limit = models.PaginationDefault
	}

	// 查询所有 follow 角色员工的操作记录
	query := models.DB.Model(&models.OrderTimeline{}).
		Joins("JOIN employees ON employees.wecom_userid = order_timelines.operator_id").
		Where("employees.role = ?", "follow")

	if staffID != "" {
		query = query.Where("order_timelines.operator_id = ?", staffID)
	}
	if startDate != "" {
		if t, err := time.Parse("2006-01-02", startDate); err == nil {
			query = query.Where("order_timelines.created_at >= ?", t)
		}
	}
	if endDate != "" {
		if t, err := time.Parse("2006-01-02", endDate); err == nil {
			query = query.Where("order_timelines.created_at < ?", t.Add(24*time.Hour))
		}
	}

	var total int64
	query.Count(&total)

	// 返回关联的订单号
	type AuditLogEntry struct {
		models.OrderTimeline
		OrderSN string `json:"order_sn"`
	}

	var timelines []models.OrderTimeline
	if err := query.Select("order_timelines.*").Order("order_timelines.created_at DESC").
		Offset(offset).Limit(limit).Find(&timelines).Error; err != nil {
		log.Printf("GetRiskAuditLog 查询失败: %v", err)
		internalError(c, "查询操作流水失败")
		return
	}

	// 批量获取订单号
	orderIDs := make([]uint, 0, len(timelines))
	for _, t := range timelines {
		orderIDs = append(orderIDs, t.OrderID)
	}

	orderSNMap := make(map[uint]string)
	if len(orderIDs) > 0 {
		type OrderSNResult struct {
			ID      uint   `gorm:"column:id"`
			OrderSN string `gorm:"column:order_sn"`
		}
		var orderSNs []OrderSNResult
		models.DB.Model(&models.Order{}).Select("id, order_sn").Where("id IN ?", orderIDs).Find(&orderSNs)
		for _, o := range orderSNs {
			orderSNMap[o.ID] = o.OrderSN
		}
	}

	entries := make([]AuditLogEntry, 0, len(timelines))
	for _, t := range timelines {
		entries = append(entries, AuditLogEntry{
			OrderTimeline: t,
			OrderSN:       orderSNMap[t.OrderID],
		})
	}

	respondOK(c, gin.H{
		"data":  entries,
		"total": total,
	})
}

// GetStaffRiskStats 获取各跟单客服风险画像
// GET /api/v1/admin/risk/staff-stats
func GetStaffRiskStats(c *gin.Context) {
	profiles := services.GetStaffRiskProfiles()
	respondOK(c, gin.H{
		"data": profiles,
	})
}

// GetRiskSummary 获取风控概要（用于侧边栏徽章）
// GET /api/v1/admin/risk/summary
func GetRiskSummary(c *gin.Context) {
	var pendingAlerts int64
	models.DB.Model(&models.RiskAlert{}).Where("is_resolved = ?", false).Count(&pendingAlerts)

	var highRiskAlerts int64
	models.DB.Model(&models.RiskAlert{}).
		Where("is_resolved = ? AND severity = ?", false, models.RiskSeverityHigh).
		Count(&highRiskAlerts)

	respondOK(c, gin.H{
		"pending_alerts":   pendingAlerts,
		"high_risk_alerts": highRiskAlerts,
	})
}

// BatchResolveRiskAlerts 批量处理告警
// PUT /api/v1/admin/risk/alerts/batch-resolve
func BatchResolveRiskAlerts(c *gin.Context) {
	var body struct {
		AlertIDs []uint `json:"alert_ids" binding:"required,min=1"`
		Remark   string `json:"remark"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供 alert_ids")
		return
	}

	if len(body.AlertIDs) > models.BatchOperationMax {
		badRequest(c, fmt.Sprintf("单次最多处理 %d 条告警", models.BatchOperationMax))
		return
	}

	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)
	now := time.Now()

	var rowsAffected int64
	if err := models.WriteTx(func(tx *gorm.DB) error {
		result := tx.Model(&models.RiskAlert{}).
			Where("id IN ? AND is_resolved = ?", body.AlertIDs, false).
			Updates(map[string]interface{}{
				"is_resolved":    true,
				"resolved_by":    uidStr,
				"resolved_at":    &now,
				"resolve_remark": body.Remark,
			})
		rowsAffected = result.RowsAffected
		return result.Error
	}); err != nil {
		log.Printf("BatchResolveRiskAlerts 失败: %v", err)
		internalError(c, "批量处理告警失败")
		return
	}

	respondOK(c, gin.H{
		"message": fmt.Sprintf("已处理 %d 条告警", rowsAffected),
		"count":   rowsAffected,
	})
}

// ─── 审计配置 API ──────────────────────────────────────

// GetAuditConfig 获取审计播报配置
// GET /api/v1/admin/risk/audit-config
func GetAuditConfig(c *gin.Context) {
	cfg := models.GetAuditConfig()

	// 解析逗号分隔的字段为数组，方便前端使用
	enabledTypes := []string{}
	if cfg.EnabledEventTypes != "" {
		for _, t := range strings.Split(cfg.EnabledEventTypes, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				enabledTypes = append(enabledTypes, t)
			}
		}
	}

	monitoredIDs := []string{}
	if cfg.MonitoredStaffIDs != "" {
		for _, id := range strings.Split(cfg.MonitoredStaffIDs, ",") {
			id = strings.TrimSpace(id)
			if id != "" {
				monitoredIDs = append(monitoredIDs, id)
			}
		}
	}

	// 获取被监控员工的名字列表
	monitoredStaff := []gin.H{}
	if len(monitoredIDs) > 0 {
		var employees []models.Employee
		models.DB.Where("wecom_userid IN ?", monitoredIDs).Find(&employees)
		for _, e := range employees {
			monitoredStaff = append(monitoredStaff, gin.H{
				"user_id": e.WecomUserID,
				"name":    e.Name,
			})
		}
	}

	respondOK(c, gin.H{
		"config":               cfg,
		"enabled_event_types":  enabledTypes,
		"monitored_staff_ids":  monitoredIDs,
		"monitored_staff":      monitoredStaff,
		"audit_chat_id":        services.GetAuditChatID(),
		"audit_ready":          services.IsAuditReady(),
	})
}

// UpdateAuditConfig 更新审计播报配置
// PUT /api/v1/admin/risk/audit-config
func UpdateAuditConfig(c *gin.Context) {
	var body struct {
		BroadcastEnabled      *bool    `json:"broadcast_enabled"`
		EnabledEventTypes     []string `json:"enabled_event_types"`     // 数组
		MonitoredStaffIDs     []string `json:"monitored_staff_ids"`     // 数组
		PriceDropThreshold    *int     `json:"price_drop_threshold"`
		RefundRateThreshold   *int     `json:"refund_rate_threshold"`
		AbnormalTimeEnabled   *bool    `json:"abnormal_time_enabled"`
		InactiveOrderHours    *int     `json:"inactive_order_hours"`
		FrequentReassignCount *int     `json:"frequent_reassign_count"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请求参数格式错误")
		return
	}

	cfg := models.GetAuditConfig()

	if body.BroadcastEnabled != nil {
		cfg.BroadcastEnabled = *body.BroadcastEnabled
	}
	if body.EnabledEventTypes != nil {
		cfg.EnabledEventTypes = strings.Join(body.EnabledEventTypes, ",")
	}
	if body.MonitoredStaffIDs != nil {
		cfg.MonitoredStaffIDs = strings.Join(body.MonitoredStaffIDs, ",")
	}
	if body.PriceDropThreshold != nil && *body.PriceDropThreshold >= 0 && *body.PriceDropThreshold <= 100 {
		cfg.PriceDropThreshold = *body.PriceDropThreshold
	}
	if body.RefundRateThreshold != nil && *body.RefundRateThreshold >= 0 && *body.RefundRateThreshold <= 100 {
		cfg.RefundRateThreshold = *body.RefundRateThreshold
	}
	if body.AbnormalTimeEnabled != nil {
		cfg.AbnormalTimeEnabled = *body.AbnormalTimeEnabled
	}
	if body.InactiveOrderHours != nil && *body.InactiveOrderHours > 0 {
		cfg.InactiveOrderHours = *body.InactiveOrderHours
	}
	if body.FrequentReassignCount != nil && *body.FrequentReassignCount > 0 {
		cfg.FrequentReassignCount = *body.FrequentReassignCount
	}

	if err := models.SaveAuditConfig(cfg); err != nil {
		log.Printf("UpdateAuditConfig 保存失败: %v", err)
		internalError(c, "保存审计配置失败")
		return
	}

	respondOK(c, gin.H{"message": "审计配置已更新", "config": cfg})
}

// Note: ListFollowStaff is defined in order_handler.go and reused for /risk/follow-staff route
func SendTestBroadcast(c *gin.Context) {
	if !services.IsAuditReady() {
		badRequest(c, "审计监控群未就绪，请先配置 WECOM_AUDIT_CHAT_ID")
		return
	}

	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}
	if operatorName == "" {
		operatorName = "管理员"
	}

	services.BroadcastAuditEvent(services.AuditEvent{
		Type:         services.AuditStatusChanged,
		OrderSN:      "TEST-" + time.Now().Format("150405"),
		OperatorID:   "admin",
		OperatorName: operatorName,
		OperatorRole: "admin",
		OldValue:     "PENDING",
		NewValue:     "DESIGNING",
		Extra:        map[string]string{},
	})

	respondMessage(c, "测试播报已发送，请在监控群查看")
}
