package services

import (
	"log"
	"regexp"
	"time"

	"pdd-order-system/models"

	"gorm.io/gorm"
)

var phoneRegex = regexp.MustCompile(`^1[3-9]\d{9}$`)

// EnqueueAddFriendTask 订单创建时自动入队 add_friend 任务
func EnqueueAddFriendTask(order *models.Order, customerContact string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("❌ EnqueueAddFriendTask panic: %v", r)
		}
	}()

	// 只处理手机号格式
	if !phoneRegex.MatchString(customerContact) {
		log.Printf("ℹ️ 自动添加: 联系方式非手机号格式，跳过 | contact=%s | sn=%s", customerContact, order.OrderSN)
		return
	}

	// 查重：同手机号 pending/running 任务已存在则跳过
	var existing int64
	models.DB.Model(&models.AutomationTask{}).Where(
		"task_type = ? AND phone = ? AND status IN ?",
		models.TaskTypeAddFriend, customerContact,
		[]string{models.TaskStatusPending, models.TaskStatusRunning},
	).Count(&existing)
	if existing > 0 {
		log.Printf("ℹ️ 自动添加: 手机号 %s 已有待执行任务，跳过重复创建", customerContact)
		return
	}

	// 检查每日上限
	today := time.Now().Format("2006-01-02")
	var todayCount int64
	models.DB.Model(&models.AutomationTask{}).Where(
		"task_type = ? AND DATE(created_at) = ? AND status != ?",
		models.TaskTypeAddFriend, today, models.TaskStatusCancelled,
	).Count(&todayCount)

	// 默认上限 30/天
	dailyLimit := 30
	if todayCount >= int64(dailyLimit) {
		log.Printf("⚠️ 自动添加: 今日任务已达上限 %d，跳过 | phone=%s", dailyLimit, customerContact)
		return
	}

	task := models.AutomationTask{
		TaskType:     models.TaskTypeAddFriend,
		OrderID:      order.ID,
		OrderSN:      order.OrderSN,
		Phone:        customerContact,
		FollowUserID: order.FollowOperatorID,
		SalesUserID:  order.OperatorID,
		Status:       models.TaskStatusPending,
		MaxRetry:     3,
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&task).Error
	}); err != nil {
		log.Printf("❌ 自动添加任务入队失败: %v | phone=%s | sn=%s", err, customerContact, order.OrderSN)
		return
	}

	log.Printf("✅ 自动添加任务已入队 | id=%d | phone=%s | sn=%s", task.ID, customerContact, order.OrderSN)

	// WebSocket 广播
	Hub.Broadcast(WSEvent{
		Type: "automation_task_created",
		Payload: map[string]any{
			"task_id":   task.ID,
			"task_type": task.TaskType,
			"phone":     customerContact,
			"order_sn":  order.OrderSN,
		},
	})
}

// EnqueueCreateGroupTask 客户添加好友后自动入队 create_group 任务
func EnqueueCreateGroupTask(order *models.Order, customer *models.Customer) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("❌ EnqueueCreateGroupTask panic: %v", r)
		}
	}()

	if order == nil || customer == nil {
		return
	}

	// 查重：同订单 pending/running 的建群任务已存在则跳过
	var existing int64
	models.DB.Model(&models.AutomationTask{}).Where(
		"task_type = ? AND order_id = ? AND status IN ?",
		models.TaskTypeCreateGroup, order.ID,
		[]string{models.TaskStatusPending, models.TaskStatusRunning},
	).Count(&existing)
	if existing > 0 {
		log.Printf("ℹ️ 自动建群: 订单 %s 已有待执行建群任务，跳过", order.OrderSN)
		return
	}

	// 订单已有群 → 跳过
	if order.WecomChatID != "" {
		log.Printf("ℹ️ 自动建群: 订单 %s 已有企微群，跳过", order.OrderSN)
		return
	}

	task := models.AutomationTask{
		TaskType:     models.TaskTypeCreateGroup,
		OrderID:      order.ID,
		OrderSN:      order.OrderSN,
		CustomerID:   customer.ID,
		Phone:        customer.Mobile,
		FollowUserID: order.FollowOperatorID,
		SalesUserID:  order.OperatorID,
		Status:       models.TaskStatusPending,
		MaxRetry:     3,
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&task).Error
	}); err != nil {
		log.Printf("❌ 自动建群任务入队失败: %v | sn=%s", err, order.OrderSN)
		return
	}

	log.Printf("✅ 自动建群任务已入队 | id=%d | sn=%s | customer=%d", task.ID, order.OrderSN, customer.ID)

	Hub.Broadcast(WSEvent{
		Type: "automation_task_created",
		Payload: map[string]any{
			"task_id":   task.ID,
			"task_type": task.TaskType,
			"order_sn":  order.OrderSN,
		},
	})
}
