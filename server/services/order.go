package services

import (
	"fmt"
	"log"
	"strings"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
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

	// 查找或创建顾客
	var customerID uint
	if customerContact != "" {
		customer, err := FindOrCreateCustomer(customerContact)
		if err != nil {
			log.Printf("⚠️  顾客匹配失败，继续创建订单: %v", err)
		} else if customer != nil {
			customerID = customer.ID
		}
	}

	order := &models.Order{
		OrderSN:         orderSN,
		CustomerContact: customerContact,
		CustomerID:      customerID,
		Price:           price,
		OperatorID:      operatorID,
		Topic:           topic,
		Pages:           pages,
		Deadline:        deadline,
		Remark:          remark,
		ScreenshotPath:  screenshotPath,
		Status:          models.StatusPending,
	}

	err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(order).Error
	})

	if err != nil {
		// 识别 SQLite 的唯一约束冲突
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return nil, fmt.Errorf("此订单号 (%s) 已被录入，请检查是否重复", orderSN)
		}
		return nil, fmt.Errorf("创建订单失败: %w", err)
	}
	
	log.Printf("✅ 订单创建 | sn=%s | operator=%s | price=%d", orderSN, operatorID, price)

	// 异步更新顾客统计
	if customerID > 0 {
		go func() {
			if err := UpdateCustomerStats(customerID); err != nil {
				log.Printf("⚠️  更新顾客统计失败: customerID=%d err=%v", customerID, err)
			}
		}()
	}

	return order, nil
}

// GrabOrder 设计师抢单（先到先得，原子操作防并发冲突）
func GrabOrder(orderID uint, designerUserID string) (*models.Order, error) {
	var order models.Order
	now := time.Now()

	err := models.WriteTx(func(tx *gorm.DB) error {
		// 原子操作: 单条 UPDATE ... WHERE 保证并发场景下只有一个人能抢到
		result := tx.Model(&models.Order{}).
			Where("id = ? AND status = ?", orderID, models.StatusPending).
			Updates(map[string]any{
				"designer_id": designerUserID,
				"status":      models.StatusGroupCreated,
				"assigned_at": &now,
			})

		if result.Error != nil {
			return fmt.Errorf("抢单操作失败: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return fmt.Errorf("订单不存在或已被抢走")
		}

		// 抢单成功，读取完整订单信息
		if err := tx.First(&order, orderID).Error; err != nil {
			return err
		}

		// 更新设计师状态 (原子自增)
		return tx.Exec(
			"UPDATE employees SET status = 'busy', active_order_count = active_order_count + 1 WHERE wecom_userid = ?",
			designerUserID,
		).Error
	})

	if err != nil {
		return nil, err
	}

	log.Printf("✅ 订单锁定 | sn=%s | designer=%s", order.OrderSN, designerUserID)
	return &order, nil
}

// UpdateOrderStatus 状态流转 (目前鉴权在 Handler 中进行)
func UpdateOrderStatus(orderID uint, newStatus string) (*models.Order, error) {
	var order models.Order

	err := models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.First(&order, orderID).Error; err != nil {
			return fmt.Errorf("订单不存在")
		}

		allowed, ok := models.ValidTransitions[order.Status]
		if !ok {
			return fmt.Errorf("当前状态 %s 不支持转换", order.Status)
		}
		valid := false
		for _, s := range allowed {
			if s == newStatus {
				valid = true
				break
			}
		}
		if !valid {
			return fmt.Errorf("非法状态转换: %s → %s", order.Status, newStatus)
		}

		now := time.Now()
		order.Status = newStatus
		switch newStatus {
		case models.StatusDelivered:
			order.DeliveredAt = &now
		case models.StatusCompleted:
			order.CompletedAt = &now
		case models.StatusClosed:
			order.ClosedAt = &now
		case models.StatusRefunded:
			order.ClosedAt = &now
		}

		// 终态处理：释放设计师负载
		if models.IsTerminalStatus(newStatus) && order.DesignerID != "" {
			if err := tx.Exec(
				"UPDATE employees SET active_order_count = MAX(active_order_count - 1, 0) WHERE wecom_userid = ?",
				order.DesignerID,
			).Error; err != nil {
				return fmt.Errorf("释放设计师负载失败: %w", err)
			}
			if err := tx.Exec(
				"UPDATE employees SET status = 'idle' WHERE wecom_userid = ? AND active_order_count <= 0",
				order.DesignerID,
			).Error; err != nil {
				return fmt.Errorf("更新设计师状态失败: %w", err)
			}
		}

		return tx.Save(&order).Error
	})

	if err != nil {
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

// AssignToIdleDesigner 优先分配给空闲设计师（负载最低的idle设计师）
func AssignToIdleDesigner(orderID uint) (*models.Order, error) {
	var order models.Order
	var designer models.Employee
	now := time.Now()

	err := models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND status = ?", orderID, models.StatusPending).First(&order).Error; err != nil {
			return fmt.Errorf("订单不存在或已非PENDING状态")
		}

		result := tx.Where("role = ? AND is_active = ? AND status = ?", "designer", true, "idle").
			Order("active_order_count ASC").First(&designer)
		if result.Error != nil {
			return fmt.Errorf("无空闲设计师")
		}

		order.DesignerID = designer.WecomUserID
		order.Status = models.StatusGroupCreated
		order.AssignedAt = &now

		designer.Status = "busy"
		designer.ActiveOrderCount++

		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		return tx.Save(&designer).Error
	})

	if err != nil {
		return nil, err
	}

	log.Printf("✅ 订单自动指派(空闲) | sn=%s | designer=%s", order.OrderSN, designer.Name)
	return &order, nil
}

// ForceAssignOrder 强制派单（给负载最低的任意活跃设计师，不限idle状态）
func ForceAssignOrder(orderID uint) (*models.Order, error) {
	var order models.Order
	var designer models.Employee
	now := time.Now()

	err := models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.Where("id = ? AND status = ?", orderID, models.StatusPending).First(&order).Error; err != nil {
			return fmt.Errorf("订单不存在或已非PENDING状态")
		}

		result := tx.Where("role = ? AND is_active = ?", "designer", true).
			Order("active_order_count ASC").First(&designer)
		if result.Error != nil {
			return fmt.Errorf("无可用设计师")
		}

		order.DesignerID = designer.WecomUserID
		order.Status = models.StatusGroupCreated
		order.AssignedAt = &now

		designer.Status = "busy"
		designer.ActiveOrderCount++

		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		return tx.Save(&designer).Error
	})

	if err != nil {
		return nil, err
	}

	log.Printf("✅ 订单强制指派 | sn=%s | designer=%s", order.OrderSN, designer.Name)
	return &order, nil
}

// MaxAssignRetries 超时派单最大重试次数
const MaxAssignRetries = 5

// StartOrderTimeoutWatcher 启动超时未接单自动派发机制
func StartOrderTimeoutWatcher() {
	timeoutDuration := time.Duration(config.C.GrabOrderTimeoutSeconds) * time.Second
	log.Printf("✅ 订单超时防漏兜底定时器已启动 (超时阈值: %v, 最大重试: %d)", timeoutDuration, MaxAssignRetries)

	go func() {
		ticker := time.NewTicker(30 * time.Second) // 每 30 秒轮询一次
		defer ticker.Stop()

		for range ticker.C {
			thresholdTime := time.Now().Add(-timeoutDuration)
			var timeoutOrders []models.Order

			// 查找状态为 PENDING 且创建时间早于阈值、重试次数未超限的订单
			models.DB.Where("status = ? AND created_at < ? AND assign_retry_count < ?",
				models.StatusPending, thresholdTime, MaxAssignRetries).Find(&timeoutOrders)

			for _, o := range timeoutOrders {
				// 递增重试计数
				models.DB.Model(&o).Update("assign_retry_count", o.AssignRetryCount+1)

				if o.AssignRetryCount+1 >= MaxAssignRetries {
					log.Printf("🚨 订单超时派单已达上限，跳过后续重试 | sn=%s | retries=%d", o.OrderSN, o.AssignRetryCount+1)
					continue
				}

				retryCount := o.AssignRetryCount + 1
				log.Printf("⚠️  发现超时未接单: sn=%s (重试 %d/%d), 开始自动指派...", o.OrderSN, retryCount, MaxAssignRetries)

				// 两阶段派单: 前2次优先分配给空闲设计师，之后强制分配给负载最低的任意设计师
				var order *models.Order
				var err error
				if retryCount < 2 {
					order, err = AssignToIdleDesigner(o.ID)
				} else {
					log.Printf("⚠️  订单超过10分钟未接，强制指派 | sn=%s", o.OrderSN)
					order, err = ForceAssignOrder(o.ID)
				}
				if err != nil {
					log.Printf("❌ 自动指派失败 sn=%s: %v", o.OrderSN, err)
					continue
				}

				// 自动指派成功，异步建群和通知
				go func(ord *models.Order) {
					deadlineStr := "待定"
					if ord.Deadline != nil {
						deadlineStr = ord.Deadline.Format("2006-01-02 15:04")
					}

					// 1. 发送企微卡片通知给被强制指派的设计师
					_ = Wecom.NotifyNewOrder(ord.OrderSN, ord.OperatorID, ord.Topic, ord.Pages, ord.Price, deadlineStr, []string{ord.DesignerID})

					// 2. 自动建群并播报需求
					chatID, err := Wecom.SetupOrderGroup(
						ord.OrderSN, ord.OperatorID, ord.DesignerID,
						ord.Topic, ord.Pages, ord.Price, deadlineStr, ord.Remark,
					)
					if err == nil && chatID != "" {
						models.DB.Model(ord).Update("wecom_chat_id", chatID)
					}
				}(order)
			}
		}
	}()
}

// StartDeadlineReminderWatcher 启动交付截止倒计时提醒
// 距离约定交付时间 3 小时，企微机器人私信设计师进行告警催更
func StartDeadlineReminderWatcher() {
	log.Println("✅ 交付截止倒计时提醒系统已启动 (距交付 3h 自动催更)")

	go func() {
		ticker := time.NewTicker(5 * time.Minute) // 每 5 分钟检查一次
		defer ticker.Stop()

		for range ticker.C {
			now := time.Now()
			threshold := now.Add(3 * time.Hour)

			// 查找: 状态为 DESIGNING、有 deadline、deadline 在 3h 以内、且尚未提醒过
			var urgentOrders []models.Order
			models.DB.Where(
				"status IN ? AND deadline IS NOT NULL AND deadline <= ? AND deadline > ? AND deadline_reminded = ?",
				[]string{models.StatusGroupCreated, models.StatusDesigning},
				threshold, now, false,
			).Find(&urgentOrders)

			for _, o := range urgentOrders {
				if o.DesignerID == "" {
					continue
				}

				remaining := o.Deadline.Sub(now)
				hours := int(remaining.Hours())
				minutes := int(remaining.Minutes()) % 60

				msg := fmt.Sprintf(
					"⏰ 交付倒计时提醒\n━━━━━━━━━━━\n📦 订单: %s\n🎯 主题: %s\n⏳ 剩余: %d小时%d分钟\n━━━━━━━━━━━\n请尽快完成并在群内回复「已交付」！",
					o.OrderSN, o.Topic, hours, minutes,
				)

				// 1. 私信设计师
				_ = Wecom.SendTextMessage([]string{o.DesignerID}, msg)

				// 2. 如果有群聊，也在群内提醒
				if o.WecomChatID != "" {
					_ = Wecom.SendGroupMessage(o.WecomChatID, msg)
				}

				// 标记已提醒，避免重复发送
				models.DB.Model(&o).Update("deadline_reminded", true)
				log.Printf("⏰ 已发送交付催更提醒 | sn=%s | designer=%s | 剩余 %dh%dm", o.OrderSN, o.DesignerID, hours, minutes)
			}
		}
	}()
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

	// Phase 2: 增强字段
	WeekRevenue         int              `json:"week_revenue"`
	WeekOrderCount      int              `json:"week_order_count"`
	LastWeekRevenue     int              `json:"last_week_revenue"`
	LastWeekOrderCount  int              `json:"last_week_order_count"`
	AvgCompletionHours  float64          `json:"avg_completion_hours"`
	DesignerRankings    []DesignerRank   `json:"designer_rankings"`
	MonthlyData         []int            `json:"monthly_data"` // 当年 1~12 月订单数

	// Phase 3: 顾客与异常统计
	TotalCustomers    int64   `json:"total_customers"`
	TodayNewCustomers int64   `json:"today_new_customers"`
	RepeatCustomers   int64   `json:"repeat_customers"`
	RepeatRate        float64 `json:"repeat_rate"`
	GrabAlertCount    int64   `json:"grab_alert_count"`

	// Phase 4: 昨日对比 (日环比)
	YesterdayOrderCount int   `json:"yesterday_order_count"`
	YesterdayRevenue    int   `json:"yesterday_revenue"`
	YesterdayGrabAlerts int64 `json:"yesterday_grab_alerts"`
}

// DesignerRank 设计师绩效排名
type DesignerRank struct {
	Name            string `json:"name"`
	WecomUserID     string `json:"wecom_userid"`
	CompletedCount  int64  `json:"completed_count"`
	ActiveCount     int64  `json:"active_count"`
	AvgHours        float64 `json:"avg_hours"`
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

	// ── Phase 2: 本周/上周对比 ──
	now := time.Now()
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	thisWeekStart := todayStart.AddDate(0, 0, -(weekday - 1))
	lastWeekStart := thisWeekStart.AddDate(0, 0, -7)

	var thisWeekOrders []models.Order
	models.DB.Where("created_at >= ? AND created_at < ?", thisWeekStart, now).Find(&thisWeekOrders)
	stats.WeekOrderCount = len(thisWeekOrders)
	for _, o := range thisWeekOrders {
		stats.WeekRevenue += o.Price
	}

	var lastWeekOrders []models.Order
	models.DB.Where("created_at >= ? AND created_at < ?", lastWeekStart, thisWeekStart).Find(&lastWeekOrders)
	stats.LastWeekOrderCount = len(lastWeekOrders)
	for _, o := range lastWeekOrders {
		stats.LastWeekRevenue += o.Price
	}

	// ── 平均完成时长 ──
	var completedOrders []models.Order
	models.DB.Where("status = ? AND completed_at IS NOT NULL AND created_at IS NOT NULL", models.StatusCompleted).
		Order("completed_at DESC").Limit(100).Find(&completedOrders)
	if len(completedOrders) > 0 {
		var totalHours float64
		for _, o := range completedOrders {
			if o.CompletedAt != nil {
				totalHours += o.CompletedAt.Sub(o.CreatedAt).Hours()
			}
		}
		stats.AvgCompletionHours = totalHours / float64(len(completedOrders))
	}

	// ── 设计师绩效排名 (批量聚合，避免 N+1) ──
	var designers []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "designer", true).Find(&designers)
	rankings := make([]DesignerRank, 0, len(designers))

	// 批量查询: 每位设计师的已完成订单数
	type CountResult struct {
		DesignerID string
		Cnt        int64
	}
	var completedCounts []CountResult
	models.DB.Model(&models.Order{}).
		Select("designer_id, COUNT(*) as cnt").
		Where("status = ? AND designer_id != ''", models.StatusCompleted).
		Group("designer_id").
		Find(&completedCounts)
	completedMap := make(map[string]int64, len(completedCounts))
	for _, c := range completedCounts {
		completedMap[c.DesignerID] = c.Cnt
	}

	// 批量查询: 每位设计师的活跃订单数
	var activeCounts []CountResult
	models.DB.Model(&models.Order{}).
		Select("designer_id, COUNT(*) as cnt").
		Where("status IN ? AND designer_id != ''", []string{models.StatusGroupCreated, models.StatusDesigning}).
		Group("designer_id").
		Find(&activeCounts)
	activeMap := make(map[string]int64, len(activeCounts))
	for _, c := range activeCounts {
		activeMap[c.DesignerID] = c.Cnt
	}

	// 批量查询: 每位设计师的平均完成时长
	type AvgResult struct {
		DesignerID string
		AvgHours   float64
	}
	var avgResults []AvgResult
	models.DB.Model(&models.Order{}).
		Select("designer_id, AVG((julianday(completed_at) - julianday(created_at)) * 24) as avg_hours").
		Where("status = ? AND completed_at IS NOT NULL AND designer_id != ''", models.StatusCompleted).
		Group("designer_id").
		Find(&avgResults)
	avgMap := make(map[string]float64, len(avgResults))
	for _, a := range avgResults {
		avgMap[a.DesignerID] = a.AvgHours
	}

	for _, d := range designers {
		rankings = append(rankings, DesignerRank{
			Name:           d.Name,
			WecomUserID:    d.WecomUserID,
			CompletedCount: completedMap[d.WecomUserID],
			ActiveCount:    activeMap[d.WecomUserID],
			AvgHours:       avgMap[d.WecomUserID],
		})
	}

	// 按已完成数排序 (降序)
	for i := 0; i < len(rankings); i++ {
		for j := i + 1; j < len(rankings); j++ {
			if rankings[j].CompletedCount > rankings[i].CompletedCount {
				rankings[i], rankings[j] = rankings[j], rankings[i]
			}
		}
	}
	stats.DesignerRankings = rankings

	// ── Phase 3: 顾客统计 ──
	models.DB.Model(&models.Customer{}).Count(&stats.TotalCustomers)
	models.DB.Model(&models.Customer{}).Where("created_at >= ?", todayStart).Count(&stats.TodayNewCustomers)
	models.DB.Model(&models.Customer{}).Where("total_orders > 1").Count(&stats.RepeatCustomers)
	if stats.TotalCustomers > 0 {
		stats.RepeatRate = float64(stats.RepeatCustomers) / float64(stats.TotalCustomers) * 100
	}

	// ── 月度订单数 (当年 1~12 月) ──
	yearStart := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	yearEnd := yearStart.AddDate(1, 0, 0)
	type MonthRow struct {
		Month string `gorm:"column:month"`
		Cnt   int    `gorm:"column:cnt"`
	}
	var monthRows []MonthRow
	models.DB.Model(&models.Order{}).
		Select("strftime('%m', created_at) as month, COUNT(*) as cnt").
		Where("created_at >= ? AND created_at < ?", yearStart, yearEnd).
		Group("month").
		Find(&monthRows)
	monthMap := make(map[int]int, len(monthRows))
	for _, r := range monthRows {
		var m int
		fmt.Sscanf(r.Month, "%d", &m)
		monthMap[m] = r.Cnt
	}
	stats.MonthlyData = make([]int, 12)
	for i := 0; i < 12; i++ {
		stats.MonthlyData[i] = monthMap[i+1]
	}

	// ── 异常抢单数 ──
	grabThreshold := time.Now().Add(-30 * time.Minute)
	models.DB.Model(&models.Order{}).Where(
		"status = ? AND assigned_at IS NOT NULL AND assigned_at < ? AND grab_alert_sent = ?",
		models.StatusGroupCreated, grabThreshold, false,
	).Count(&stats.GrabAlertCount)

	// ── Phase 4: 昨日对比数据 (日环比) ──
	yesterdayStart := todayStart.AddDate(0, 0, -1)
	var yesterdayOrders []models.Order
	models.DB.Where("created_at >= ? AND created_at < ?", yesterdayStart, todayStart).Find(&yesterdayOrders)
	stats.YesterdayOrderCount = len(yesterdayOrders)
	for _, o := range yesterdayOrders {
		stats.YesterdayRevenue += o.Price
	}

	// 昨日异常抢单
	yesterdayGrabThreshold := yesterdayStart.Add(-30 * time.Minute)
	models.DB.Model(&models.Order{}).Where(
		"assigned_at >= ? AND assigned_at < ? AND status = ? AND grab_alert_sent = ?",
		yesterdayGrabThreshold, todayStart, models.StatusGroupCreated, false,
	).Count(&stats.YesterdayGrabAlerts)

	return stats
}
