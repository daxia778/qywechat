package services

import (
	"context"
	"fmt"
	"log"
	"sort"
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
func CreateOrder(operatorID, orderSN, customerContact, topic, remark, screenshotPath, attachmentURLs string, price, pages int, deadline *time.Time) (*models.Order, error) {
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
		AttachmentURLs:  attachmentURLs,
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

	// 创建首笔收款记录（拼多多）
	if order.Price > 0 {
		now := time.Now()
		payment := models.PaymentRecord{
			TransactionID: fmt.Sprintf("PDD-%s-%d", order.OrderSN, now.Unix()),
			OrderID:       order.ID,
			CustomerID:    order.CustomerID,
			Amount:        order.Price,
			Source:        "pdd",
			PayeeUserID:   operatorID,
			PaidAt:        now,
			MatchedAt:     &now,
			MatchMethod:   "auto",
			TradeState:    "SUCCESS",
		}
		if pErr := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&payment).Error
		}); pErr != nil {
			log.Printf("⚠️  创建首笔收款记录失败: sn=%s err=%v", orderSN, pErr)
		} else {
			log.Printf("✅ 首笔收款记录已创建 | txn=%s | amount=%d", payment.TransactionID, payment.Amount)
		}
	}

	// 初始分润计算（异步，不阻塞订单创建响应）
	TriggerProfitRecalculation(order.ID)

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
		case models.StatusDesigning:
			// 重新进入 DESIGNING 时重置告警标记，保证再次超时能触发告警
			order.DesigningAlertSent = false
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

	// 分润触发: 根据目标状态决定分润动作
	switch newStatus {
	case models.StatusCompleted:
		// 订单完成 — 最终结算，重算并落库
		TriggerProfitRecalculation(order.ID)
	case models.StatusRefunded:
		// 退款 — 分润字段全部清零
		go func() {
			if err := models.WriteTx(func(tx *gorm.DB) error {
				return ClearProfitFields(tx, order.ID)
			}); err != nil {
				log.Printf("❌ 退款清零分润失败 | orderID=%d err=%v", order.ID, err)
			}
		}()
	}

	return &order, nil
}

// ReassignOrder 管理员转派订单给另一个设计师
func ReassignOrder(orderID uint, newDesignerUserID, operatorID string) (*models.Order, error) {
	var order models.Order

	err := models.WriteTx(func(tx *gorm.DB) error {
		// 1. 查询订单
		if err := tx.First(&order, orderID).Error; err != nil {
			return fmt.Errorf("订单不存在")
		}

		// 2. 校验状态: 只允许已分配设计师且非终态的订单转派
		allowedStatuses := map[string]bool{
			models.StatusGroupCreated: true,
			models.StatusConfirmed:    true,
			models.StatusDesigning:    true,
			models.StatusDelivered:    true,
			models.StatusRevision:     true,
			models.StatusAfterSale:    true,
		}
		if !allowedStatuses[order.Status] {
			return fmt.Errorf("当前状态 %s 不允许转派", order.Status)
		}

		// 3. 校验新设计师存在且 is_active=true 且 role=designer
		var newDesigner models.Employee
		if err := tx.Where("wecom_userid = ? AND is_active = ? AND role = ?",
			newDesignerUserID, true, "designer").First(&newDesigner).Error; err != nil {
			return fmt.Errorf("目标设计师不存在或未激活")
		}

		// 4. 不能转派给自己
		if order.DesignerID == newDesignerUserID {
			return fmt.Errorf("不能转派给当前设计师（相同人员）")
		}

		oldDesignerID := order.DesignerID

		// 5. 释放旧设计师负载
		if oldDesignerID != "" {
			if err := tx.Exec(
				"UPDATE employees SET active_order_count = MAX(active_order_count - 1, 0) WHERE wecom_userid = ?",
				oldDesignerID,
			).Error; err != nil {
				return fmt.Errorf("释放旧设计师负载失败: %w", err)
			}
			if err := tx.Exec(
				"UPDATE employees SET status = 'idle' WHERE wecom_userid = ? AND active_order_count <= 0",
				oldDesignerID,
			).Error; err != nil {
				return fmt.Errorf("更新旧设计师状态失败: %w", err)
			}
		}

		// 6. 更新订单 designer_id 和 assigned_at
		now := time.Now()
		order.DesignerID = newDesignerUserID
		order.AssignedAt = &now
		if err := tx.Save(&order).Error; err != nil {
			return fmt.Errorf("更新订单失败: %w", err)
		}

		// 7. 增加新设计师负载
		if err := tx.Exec(
			"UPDATE employees SET active_order_count = active_order_count + 1, status = 'busy' WHERE wecom_userid = ?",
			newDesignerUserID,
		).Error; err != nil {
			return fmt.Errorf("更新新设计师负载失败: %w", err)
		}

		// 8. 获取操作人姓名
		var operator models.Employee
		operatorName := operatorID
		if tx.Where("wecom_userid = ?", operatorID).First(&operator).Error == nil {
			operatorName = operator.Name
		}

		// 9. 写 OrderTimeline 记录
		return tx.Create(&models.OrderTimeline{
			OrderID:      order.ID,
			EventType:    "designer_reassigned",
			OldValue:     oldDesignerID,
			NewValue:     newDesignerUserID,
			OperatorID:   operatorID,
			OperatorName: operatorName,
			Remark:       fmt.Sprintf("订单转派: %s -> %s", oldDesignerID, newDesignerUserID),
		}).Error
	})

	if err != nil {
		return nil, err
	}

	log.Printf("✅ 订单转派 | sn=%s | %s -> %s | operator=%s", order.OrderSN, order.DesignerID, order.DesignerID, operatorID)
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
func StartOrderTimeoutWatcher(ctx context.Context) {
	timeoutDuration := time.Duration(config.C.GrabOrderTimeoutSeconds) * time.Second
	log.Printf("✅ 订单超时防漏兜底定时器已启动 (超时阈值: %v, 最大重试: %d)", timeoutDuration, MaxAssignRetries)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[TimeoutWatcher] panic recovered: %v", r)
			}
		}()
		ticker := time.NewTicker(30 * time.Second) // 每 30 秒轮询一次
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("订单超时防漏定时器已停止")
				return
			case <-ticker.C:
			}
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[TimeoutWatcher] tick panic recovered: %v", r)
					}
				}()
				thresholdTime := time.Now().Add(-timeoutDuration)
				var timeoutOrders []models.Order

				// 查找状态为 PENDING 且创建时间早于阈值、重试次数未超限的订单
				models.DB.Where("status = ? AND created_at < ? AND assign_retry_count < ?",
					models.StatusPending, thresholdTime, MaxAssignRetries).Find(&timeoutOrders)

				for _, o := range timeoutOrders {
					// 递增重试计数
					if err := models.WriteTx(func(tx *gorm.DB) error {
						return tx.Model(&o).Update("assign_retry_count", o.AssignRetryCount+1).Error
					}); err != nil {
						log.Printf("❌ 更新重试计数失败: sn=%s err=%v", o.OrderSN, err)
					}

					if o.AssignRetryCount+1 >= MaxAssignRetries {
						log.Printf("🚨 订单超时派单已达上限，跳过后续重试 | sn=%s | retries=%d", o.OrderSN, o.AssignRetryCount+1)

						// 向所有 admin 发送告警：派单重试已耗尽
						go func(orderSN string, orderID uint, retries int) {
							var admins []models.Employee
							models.DB.Where("role = ? AND is_active = ?", "admin", true).Find(&admins)
							if len(admins) == 0 {
								return
							}

							// 企微消息通知
							adminIDs := make([]string, len(admins))
							for i, a := range admins {
								adminIDs[i] = a.WecomUserID
							}
							msg := fmt.Sprintf("🚨 派单失败告警\n订单号：%s\n自动派单已重试 %d 次均失败\n━━━━━━━━━━━\n请立即手动处理此订单！",
								orderSN, retries)
							if err := Wecom.SendTextMessage(adminIDs, msg); err != nil {
								log.Printf("⚠️ 发送派单上限企微通知失败: sn=%s err=%v", orderSN, err)
							}

							// 站内通知
							for _, admin := range admins {
								if err := models.WriteTx(func(tx *gorm.DB) error {
									return tx.Create(&models.Notification{
										UserID:   admin.WecomUserID,
										Title:    "派单失败告警",
										Content:  fmt.Sprintf("订单 %s 自动派单已重试 %d 次均失败，请手动处理", orderSN, retries),
										Category: "alert",
										RefID:    fmt.Sprintf("%d", orderID),
									}).Error
								}); err != nil {
									log.Printf("❌ 创建派单上限告警通知失败: sn=%s admin=%s err=%v", orderSN, admin.WecomUserID, err)
								}
							}

							// WebSocket 广播
							Hub.Broadcast(WSEvent{
								Type: "assign_exhausted_alert",
								Payload: map[string]any{
									"order_id": orderID,
									"order_sn": orderSN,
									"retries":  retries,
								},
							})
						}(o.OrderSN, o.ID, o.AssignRetryCount+1)

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
					if err := Wecom.NotifyNewOrder(ord.OrderSN, ord.OperatorID, ord.Topic, ord.Pages, ord.Price, deadlineStr, []string{ord.DesignerID}); err != nil {
						log.Printf("⚠️ 发送超时派单企微通知失败: sn=%s err=%v", ord.OrderSN, err)
					}

					// 2. 自动建群并播报需求
					chatID, err := Wecom.SetupOrderGroup(
						ord.OrderSN, ord.OperatorID, ord.DesignerID,
						ord.Topic, ord.Pages, ord.Price, deadlineStr, ord.Remark,
					)
					if err == nil && chatID != "" {
						if wxErr := models.WriteTx(func(tx *gorm.DB) error {
							return tx.Model(ord).Update("wecom_chat_id", chatID).Error
						}); wxErr != nil {
							log.Printf("❌ 更新订单群聊ID失败: sn=%s err=%v", ord.OrderSN, wxErr)
						}
					}
				}(order)
			}
		}()
		}
	}()
}

// StartDeadlineReminderWatcher 启动交付截止倒计时提醒
// 距离约定交付时间 3 小时，企微机器人私信设计师进行告警催更
func StartDeadlineReminderWatcher(ctx context.Context) {
	log.Println("✅ 交付截止倒计时提醒系统已启动 (距交付 3h 自动催更)")

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[DeadlineReminder] panic recovered: %v", r)
			}
		}()
		ticker := time.NewTicker(5 * time.Minute) // 每 5 分钟检查一次
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("交付截止倒计时提醒已停止")
				return
			case <-ticker.C:
			}
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[DeadlineReminder] tick panic recovered: %v", r)
					}
				}()
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
					if err := Wecom.SendTextMessage([]string{o.DesignerID}, msg); err != nil {
						log.Printf("⚠️ 发送交付倒计时企微通知失败: sn=%s designer=%s err=%v", o.OrderSN, o.DesignerID, err)
					}

					// 2. 如果有群聊，也在群内提醒
					if o.WecomChatID != "" {
						if err := Wecom.SendGroupMessage(o.WecomChatID, msg); err != nil {
							log.Printf("⚠️ 发送交付倒计时群聊通知失败: sn=%s chat=%s err=%v", o.OrderSN, o.WecomChatID, err)
						}
					}

					// 标记已提醒，避免重复发送
					if err := models.WriteTx(func(tx *gorm.DB) error {
						return tx.Model(&o).Update("deadline_reminded", true).Error
					}); err != nil {
						log.Printf("❌ 标记deadline_reminded失败: sn=%s err=%v", o.OrderSN, err)
					}
					log.Printf("⏰ 已发送交付催更提醒 | sn=%s | designer=%s | 剩余 %dh%dm", o.OrderSN, o.DesignerID, hours, minutes)
				}
			}()
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

	// Phase 5: 收款流水统计
	TotalPaymentAmount  int `json:"total_payment_amount"`
	PddPaymentAmount    int `json:"pdd_payment_amount"`
	WecomPaymentAmount  int `json:"wecom_payment_amount"`
	ManualPaymentAmount int `json:"manual_payment_amount"`
	TotalPaymentCount   int `json:"total_payment_count"`

	// Phase 5: 售后统计
	AfterSaleCount int64 `json:"after_sale_count"`
	RevisionCount  int64 `json:"revision_count"`
	ConfirmedCount int64 `json:"confirmed_count"`

	// Phase 5: 今日/昨日收款
	TodayPaymentAmount     int `json:"today_payment_amount"`
	YesterdayPaymentAmount int `json:"yesterday_payment_amount"`
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

	// ── 订单状态分布 (单次 GROUP BY 替代 4+3=7 次独立 COUNT) ──
	type StatusCount struct {
		Status string `gorm:"column:status"`
		Cnt    int64  `gorm:"column:cnt"`
	}
	var statusCounts []StatusCount
	models.DB.Model(&models.Order{}).
		Select("status, COUNT(*) as cnt").
		Group("status").
		Find(&statusCounts)
	for _, sc := range statusCounts {
		stats.TotalOrders += sc.Cnt
		switch sc.Status {
		case models.StatusPending:
			stats.PendingOrders = sc.Cnt
		case models.StatusGroupCreated:
			stats.DesigningOrders += sc.Cnt
		case models.StatusDesigning:
			stats.DesigningOrders += sc.Cnt
		case models.StatusCompleted:
			stats.CompletedOrders = sc.Cnt
		case models.StatusAfterSale:
			stats.AfterSaleCount = sc.Cnt
		case models.StatusRevision:
			stats.RevisionCount = sc.Cnt
		case models.StatusConfirmed:
			stats.ConfirmedCount = sc.Cnt
		}
	}

	// ── 今日统计 (SQL 聚合替代全量加载) ──
	type CountSum struct {
		Cnt   int `gorm:"column:cnt"`
		Total int `gorm:"column:total"`
	}
	var todayStats CountSum
	models.DB.Model(&models.Order{}).
		Select("COUNT(*) as cnt, COALESCE(SUM(price), 0) as total").
		Where("created_at >= ?", todayStart).
		Scan(&todayStats)
	stats.TodayOrderCount = todayStats.Cnt
	stats.TodayRevenue = todayStats.Total

	// ── 设计师在线状态 (单次 GROUP BY 替代 2 次 COUNT) ──
	type DesignerStatusCount struct {
		Status string `gorm:"column:status"`
		Cnt    int64  `gorm:"column:cnt"`
	}
	var designerStatusCounts []DesignerStatusCount
	models.DB.Model(&models.Employee{}).
		Select("status, COUNT(*) as cnt").
		Where("role = ? AND is_active = ?", "designer", true).
		Group("status").
		Find(&designerStatusCounts)
	for _, dsc := range designerStatusCounts {
		switch dsc.Status {
		case "busy":
			stats.ActiveDesigners = dsc.Cnt
		case "idle":
			stats.IdleDesigners = dsc.Cnt
		}
	}

	// ── Phase 2: 本周/上周对比 ──
	now := time.Now()
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	thisWeekStart := todayStart.AddDate(0, 0, -(weekday - 1))
	lastWeekStart := thisWeekStart.AddDate(0, 0, -7)

	var thisWeekStats CountSum
	models.DB.Model(&models.Order{}).
		Select("COUNT(*) as cnt, COALESCE(SUM(price), 0) as total").
		Where("created_at >= ? AND created_at < ?", thisWeekStart, now).
		Scan(&thisWeekStats)
	stats.WeekOrderCount = thisWeekStats.Cnt
	stats.WeekRevenue = thisWeekStats.Total

	var lastWeekStats CountSum
	models.DB.Model(&models.Order{}).
		Select("COUNT(*) as cnt, COALESCE(SUM(price), 0) as total").
		Where("created_at >= ? AND created_at < ?", lastWeekStart, thisWeekStart).
		Scan(&lastWeekStats)
	stats.LastWeekOrderCount = lastWeekStats.Cnt
	stats.LastWeekRevenue = lastWeekStats.Total

	// ── 平均完成时长 (SQL 聚合替代加载100条到内存) ──
	type AvgCompletionResult struct {
		AvgHours float64 `gorm:"column:avg_hours"`
	}
	var avgCompletion AvgCompletionResult
	models.DB.Model(&models.Order{}).
		Select("AVG((julianday(completed_at) - julianday(created_at)) * 24) as avg_hours").
		Where("status = ? AND completed_at IS NOT NULL AND created_at IS NOT NULL", models.StatusCompleted).
		Scan(&avgCompletion)
	stats.AvgCompletionHours = avgCompletion.AvgHours

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
	sort.Slice(rankings, func(i, j int) bool {
		return rankings[i].CompletedCount > rankings[j].CompletedCount
	})
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

	// ── Phase 4: 昨日对比数据 (日环比, SQL 聚合替代全量加载) ──
	yesterdayStart := todayStart.AddDate(0, 0, -1)
	var yesterdayStats CountSum
	models.DB.Model(&models.Order{}).
		Select("COUNT(*) as cnt, COALESCE(SUM(price), 0) as total").
		Where("created_at >= ? AND created_at < ?", yesterdayStart, todayStart).
		Scan(&yesterdayStats)
	stats.YesterdayOrderCount = yesterdayStats.Cnt
	stats.YesterdayRevenue = yesterdayStats.Total

	// 昨日异常抢单
	yesterdayGrabThreshold := yesterdayStart.Add(-30 * time.Minute)
	models.DB.Model(&models.Order{}).Where(
		"assigned_at >= ? AND assigned_at < ? AND status = ? AND grab_alert_sent = ?",
		yesterdayGrabThreshold, todayStart, models.StatusGroupCreated, false,
	).Count(&stats.YesterdayGrabAlerts)

	// ── Phase 5: 收款流水统计 ──
	type PaymentAgg struct {
		Source string `gorm:"column:source"`
		Total  int    `gorm:"column:total"`
		Cnt    int    `gorm:"column:cnt"`
	}
	var paymentAggs []PaymentAgg
	models.DB.Model(&models.PaymentRecord{}).
		Select("source, COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt").
		Where("trade_state = 'SUCCESS'").
		Group("source").
		Find(&paymentAggs)
	for _, pa := range paymentAggs {
		stats.TotalPaymentAmount += pa.Total
		stats.TotalPaymentCount += pa.Cnt
		switch pa.Source {
		case "pdd":
			stats.PddPaymentAmount = pa.Total
		case "wecom":
			stats.WecomPaymentAmount = pa.Total
		case "manual":
			stats.ManualPaymentAmount = pa.Total
		}
	}

	// (售后统计 AfterSaleCount / RevisionCount / ConfirmedCount
	//  已在函数开头的 GROUP BY status 单次查询中一并计算，无需重复查询)

	// ── Phase 5: 今日/昨日收款金额 ──
	type AmountResult struct {
		Total int `gorm:"column:total"`
	}
	var todayPayment AmountResult
	models.DB.Model(&models.PaymentRecord{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("trade_state = 'SUCCESS' AND paid_at >= ?", todayStart).
		Scan(&todayPayment)
	stats.TodayPaymentAmount = todayPayment.Total

	var yesterdayPayment AmountResult
	models.DB.Model(&models.PaymentRecord{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("trade_state = 'SUCCESS' AND paid_at >= ? AND paid_at < ?", yesterdayStart, todayStart).
		Scan(&yesterdayPayment)
	stats.YesterdayPaymentAmount = yesterdayPayment.Total

	return stats
}
