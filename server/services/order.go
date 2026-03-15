package services

import (
	"fmt"
	"log"
	"time"

	"pdd-order-system/models"

	"github.com/google/uuid"
)

// GenerateOrderSN 生成系统订单号
func GenerateOrderSN() string {
	ts := time.Now().Format("20060102150405")
	return fmt.Sprintf("SYS-%s-%s", ts, uuid.New().String()[:6])
}

// CreateOrder 创建订单
func CreateOrder(operatorID, orderSN, customerContact, topic, remark, screenshotPath string, price, pages int, deadline *time.Time) (*models.Order, error) {
	if orderSN == "" {
		orderSN = GenerateOrderSN()
	}

	order := &models.Order{
		OrderSN:         orderSN,
		CustomerContact: customerContact,
		Price:           price,
		OperatorID:      operatorID,
		Topic:           topic,
		Pages:           pages,
		Deadline:        deadline,
		Remark:          remark,
		ScreenshotPath:  screenshotPath,
		Status:          models.StatusPending,
	}

	if err := models.DB.Create(order).Error; err != nil {
		return nil, fmt.Errorf("创建订单失败: %w", err)
	}
	log.Printf("✅ 订单创建 | sn=%s | operator=%s | price=%d", orderSN, operatorID, price)
	return order, nil
}

// GrabOrder 设计师抢单（先到先得）
func GrabOrder(orderID uint, designerUserID string) (*models.Order, error) {
	var order models.Order
	// 乐观锁: 只有 PENDING 状态才能抢
	result := models.DB.Where("id = ? AND status = ?", orderID, models.StatusPending).First(&order)
	if result.Error != nil {
		return nil, fmt.Errorf("订单不存在或已被抢走")
	}

	now := time.Now()
	order.DesignerID = designerUserID
	order.Status = models.StatusGroupCreated
	order.AssignedAt = &now

	if err := models.DB.Save(&order).Error; err != nil {
		return nil, err
	}

	// 更新设计师状态
	models.DB.Model(&models.Employee{}).
		Where("wecom_userid = ?", designerUserID).
		Updates(map[string]interface{}{
			"status":             "busy",
			"active_order_count": models.DB.Raw("active_order_count + 1"),
		})

	log.Printf("✅ 订单锁定 | sn=%s | designer=%s", order.OrderSN, designerUserID)
	return &order, nil
}

// UpdateOrderStatus 状态流转
func UpdateOrderStatus(orderID uint, newStatus string) (*models.Order, error) {
	var order models.Order
	if err := models.DB.First(&order, orderID).Error; err != nil {
		return nil, fmt.Errorf("订单不存在")
	}

	allowed, ok := models.ValidTransitions[order.Status]
	if !ok {
		return nil, fmt.Errorf("当前状态 %s 不支持转换", order.Status)
	}
	valid := false
	for _, s := range allowed {
		if s == newStatus {
			valid = true
			break
		}
	}
	if !valid {
		return nil, fmt.Errorf("非法状态转换: %s → %s", order.Status, newStatus)
	}

	now := time.Now()
	order.Status = newStatus
	switch newStatus {
	case models.StatusDelivered:
		order.DeliveredAt = &now
	case models.StatusCompleted:
		order.CompletedAt = &now
		// 释放设计师负载
		if order.DesignerID != "" {
			models.DB.Exec(
				"UPDATE employees SET active_order_count = MAX(active_order_count - 1, 0) WHERE wecom_userid = ?",
				order.DesignerID,
			)
			models.DB.Exec(
				"UPDATE employees SET status = 'idle' WHERE wecom_userid = ? AND active_order_count <= 0",
				order.DesignerID,
			)
		}
	}

	if err := models.DB.Save(&order).Error; err != nil {
		return nil, err
	}
	log.Printf("✅ 订单状态更新 | sn=%s | %s", order.OrderSN, newStatus)
	return &order, nil
}

// GetIdleDesigners 获取空闲设计师
func GetIdleDesigners() []models.Employee {
	var designers []models.Employee
	models.DB.Where("role = ? AND is_active = ? AND status = ?", "designer", true, "idle").Find(&designers)
	return designers
}

// ForceAssignOrder 强制派单（给负载最低的设计师）
func ForceAssignOrder(orderID uint) (*models.Order, error) {
	var order models.Order
	if err := models.DB.Where("id = ? AND status = ?", orderID, models.StatusPending).First(&order).Error; err != nil {
		return nil, fmt.Errorf("订单不存在或已非PENDING状态")
	}

	var designer models.Employee
	result := models.DB.Where("role = ? AND is_active = ?", "designer", true).
		Order("active_order_count ASC").First(&designer)
	if result.Error != nil {
		return nil, fmt.Errorf("无可用设计师")
	}

	now := time.Now()
	order.DesignerID = designer.WecomUserID
	order.Status = models.StatusGroupCreated
	order.AssignedAt = &now

	designer.Status = "busy"
	designer.ActiveOrderCount++

	models.DB.Save(&order)
	models.DB.Save(&designer)

	log.Printf("✅ 订单强制指派 | sn=%s | designer=%s", order.OrderSN, designer.Name)
	return &order, nil
}

// DashboardStats 仪表盘数据
type DashboardStats struct {
	TotalOrders     int64 `json:"total_orders"`
	PendingOrders   int64 `json:"pending_orders"`
	DesigningOrders int64 `json:"designing_orders"`
	CompletedOrders int64 `json:"completed_orders"`
	TodayRevenue    int   `json:"today_revenue"`
	TodayOrderCount int   `json:"today_order_count"`
	ActiveDesigners int64 `json:"active_designers"`
	IdleDesigners   int64 `json:"idle_designers"`
}

// GetDashboardStats 获取看板统计
func GetDashboardStats() *DashboardStats {
	stats := &DashboardStats{}
	todayStart := time.Now().Truncate(24 * time.Hour)

	models.DB.Model(&models.Order{}).Count(&stats.TotalOrders)
	models.DB.Model(&models.Order{}).Where("status = ?", models.StatusPending).Count(&stats.PendingOrders)
	models.DB.Model(&models.Order{}).Where("status IN ?", []string{models.StatusGroupCreated, models.StatusDesigning}).Count(&stats.DesigningOrders)
	models.DB.Model(&models.Order{}).Where("status = ?", models.StatusCompleted).Count(&stats.CompletedOrders)

	// 今日统计
	var todayOrders []models.Order
	models.DB.Where("created_at >= ?", todayStart).Find(&todayOrders)
	stats.TodayOrderCount = len(todayOrders)
	for _, o := range todayOrders {
		stats.TodayRevenue += o.Price
	}

	models.DB.Model(&models.Employee{}).Where("role = ? AND is_active = ? AND status = ?", "designer", true, "busy").Count(&stats.ActiveDesigners)
	models.DB.Model(&models.Employee{}).Where("role = ? AND is_active = ? AND status = ?", "designer", true, "idle").Count(&stats.IdleDesigners)

	return stats
}
