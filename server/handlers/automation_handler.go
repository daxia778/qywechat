package handlers

import (
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ─── Agent 心跳状态（内存） ──────────────────────────────

var (
	agentStatus   AgentStatus
	agentStatusMu sync.RWMutex
)

type AgentStatus struct {
	Online     bool      `json:"online"`
	LastSeen   time.Time `json:"last_seen"`
	Platform   string    `json:"platform"`
	Version    string    `json:"version"`
	MachineID  string    `json:"machine_id"`
	TasksDone  int       `json:"tasks_done"`
	TasksFailed int      `json:"tasks_failed"`
}

// ─── Agent API ──────────────────────────────────────────

// AgentFetchPending Agent 拉取待执行任务（原子锁定，一次最多返回 1 条）
func AgentFetchPending(c *gin.Context) {
	taskType := c.DefaultQuery("task_type", "add_friend")

	var task models.AutomationTask
	now := time.Now()

	err := models.WriteTx(func(tx *gorm.DB) error {
		// 查找 pending 且已到计划执行时间的任务
		result := tx.Where(
			"task_type = ? AND status = ? AND (scheduled_at IS NULL OR scheduled_at <= ?)",
			taskType, models.TaskStatusPending, now,
		).Order("created_at ASC").First(&task)

		if result.Error != nil {
			return result.Error
		}

		// 原子锁定: 立即更新为 running
		return tx.Model(&task).Updates(map[string]any{
			"status":      models.TaskStatusRunning,
			"executed_at": &now,
		}).Error
	})

	if err != nil {
		// 没有待执行任务
		respondOK(c, gin.H{"task": nil})
		return
	}

	log.Printf("📤 Agent 拉取任务 | id=%d | type=%s | phone=%s | sn=%s", task.ID, task.TaskType, task.Phone, task.OrderSN)

	// create_group 任务：附加 group_info（显示名、群名等 UI 自动化所需数据）
	if task.TaskType == models.TaskTypeCreateGroup {
		var customer models.Customer
		if task.CustomerID > 0 {
			models.DB.First(&customer, task.CustomerID)
		}

		var followEmployee models.Employee
		if task.FollowUserID != "" {
			models.DB.Where("wecom_userid = ?", task.FollowUserID).First(&followEmployee)
		}

		var salesEmployee models.Employee
		if task.SalesUserID != "" {
			models.DB.Where("wecom_userid = ?", task.SalesUserID).First(&salesEmployee)
		}

		var order models.Order
		if task.OrderID > 0 {
			models.DB.First(&order, task.OrderID)
		}

		sn := task.OrderSN
		if len(sn) > 6 {
			sn = sn[len(sn)-6:]
		}
		topic := order.Topic
		if len([]rune(topic)) > 12 {
			topic = string([]rune(topic)[:12])
		}
		groupName := fmt.Sprintf("PPT-%s %s", sn, topic)

		respondOK(c, gin.H{
			"task": task,
			"group_info": gin.H{
				"group_name":        groupName,
				"customer_nickname": customer.Nickname,
				"follow_name":       followEmployee.Name,
				"sales_name":        salesEmployee.Name,
				"order_topic":       order.Topic,
			},
		})
		return
	}

	// invite_to_group 任务：附加群名和要邀请的联系人昵称
	if task.TaskType == models.TaskTypeInviteToGroup {
		var order models.Order
		if task.OrderID > 0 {
			models.DB.First(&order, task.OrderID)
		}

		var customer models.Customer
		if task.CustomerID > 0 {
			models.DB.First(&customer, task.CustomerID)
		}

		respondOK(c, gin.H{
			"task": task,
			"group_info": gin.H{
				"group_chat_id":     order.WecomChatID,
				"customer_nickname": customer.Nickname,
			},
		})
		return
	}

	respondOK(c, gin.H{"task": task})
}

// AgentFetchPending 中 invite_to_group 任务附加 group_info
// （已在上方 create_group 分支后追加）

// ─── 群管理 API ──────────────────────────────────────────

// AdminUpdateGroupSettings 修改客户群设置（群名/公告/禁止互加联系人）
func AdminUpdateGroupSettings(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "chat_id 不能为空")
		return
	}

	var req struct {
		Name            *string `json:"name"`
		Notice          *string `json:"notice"`
		ForbidAddFriend *bool   `json:"forbid_add_friend"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误")
		return
	}

	opts := map[string]any{}
	if req.Name != nil {
		opts["name"] = *req.Name
	}
	if req.Notice != nil {
		opts["notice"] = *req.Notice
	}
	if req.ForbidAddFriend != nil {
		permit := 0
		if *req.ForbidAddFriend {
			permit = 1
		}
		opts["add_member_permit"] = permit
	}

	if len(opts) == 0 {
		badRequest(c, "至少需要一个修改项")
		return
	}

	if err := services.Wecom.UpdateGroupChat(chatID, opts); err != nil {
		badRequest(c, err.Error())
		return
	}
	respondMessage(c, "群设置已更新")
}

// AdminTransferGroupOwner 转让客户群群主
func AdminTransferGroupOwner(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "chat_id 不能为空")
		return
	}

	var req struct {
		NewOwner string `json:"new_owner" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误: new_owner 必填")
		return
	}

	failedList, err := services.Wecom.TransferGroupOwner([]string{chatID}, req.NewOwner)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	if len(failedList) > 0 {
		respondOK(c, gin.H{"message": "部分转让失败", "failed": failedList})
		return
	}
	respondMessage(c, "群主已转让")
}

// AdminTransferCustomer 在职继承 — 将客户从一个员工转接到另一个员工
func AdminTransferCustomer(c *gin.Context) {
	var req struct {
		HandoverUserID string   `json:"handover_userid" binding:"required"` // 原跟进成员
		TakeoverUserID string   `json:"takeover_userid" binding:"required"` // 接替成员
		ExternalUserID []string `json:"external_userid" binding:"required"` // 客户列表
		TransferMsg    string   `json:"transfer_success_msg"`               // 转接提示语
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误: handover_userid, takeover_userid, external_userid 必填")
		return
	}

	if len(req.ExternalUserID) == 0 {
		badRequest(c, "客户列表不能为空")
		return
	}
	if len(req.ExternalUserID) > 100 {
		badRequest(c, "每次最多转接100个客户")
		return
	}

	result, err := services.Wecom.TransferCustomer(req.HandoverUserID, req.TakeoverUserID, req.ExternalUserID, req.TransferMsg)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	respondOK(c, gin.H{
		"message":  "客户转接已提交",
		"customer": result,
	})
}

// AdminGetTransferResult 查询客户转接结果
func AdminGetTransferResult(c *gin.Context) {
	handover := c.Query("handover_userid")
	takeover := c.Query("takeover_userid")
	if handover == "" || takeover == "" {
		badRequest(c, "handover_userid 和 takeover_userid 必填")
		return
	}

	result, err := services.Wecom.TransferCustomerResult(handover, takeover)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	respondOK(c, gin.H{"customer": result})
}

// AdminListExternalContacts 列出指定员工的外部联系人（含详情）
func AdminListExternalContacts(c *gin.Context) {
	userID := c.Query("userid")
	if userID == "" {
		badRequest(c, "userid 参数必填")
		return
	}

	// 获取外部联系人ID列表
	externalIDs, err := services.Wecom.GetExternalContactList(userID)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	// 获取每个联系人的详情
	type ContactInfo struct {
		ExternalUserID string `json:"external_userid"`
		Name           string `json:"name"`
		Avatar         string `json:"avatar"`
		Gender         int    `json:"gender"`
		CorpName       string `json:"corp_name"`
		Type           int    `json:"type"` // 1=微信用户 2=企微用户
	}

	contacts := make([]ContactInfo, 0, len(externalIDs))
	for _, eid := range externalIDs {
		detail, err := services.Wecom.GetExternalContactDetail(eid)
		if err != nil {
			contacts = append(contacts, ContactInfo{ExternalUserID: eid, Name: "(获取失败)"})
			continue
		}
		info := ContactInfo{ExternalUserID: eid}
		if ec, ok := detail["external_contact"].(map[string]any); ok {
			if v, ok := ec["name"].(string); ok {
				info.Name = v
			}
			if v, ok := ec["avatar"].(string); ok {
				info.Avatar = v
			}
			if v, ok := ec["gender"].(float64); ok {
				info.Gender = int(v)
			}
			if v, ok := ec["corp_name"].(string); ok {
				info.CorpName = v
			}
			if v, ok := ec["type"].(float64); ok {
				info.Type = int(v)
			}
		}
		contacts = append(contacts, info)
	}

	respondOK(c, gin.H{
		"userid":   userID,
		"total":    len(contacts),
		"contacts": contacts,
	})
}

// AgentUpdateStatus Agent 回写任务执行结果
func AgentUpdateStatus(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		badRequest(c, "无效的任务 ID")
		return
	}

	var req struct {
		Status string `json:"status" binding:"required"` // success / failed
		Result string `json:"result"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误")
		return
	}

	if req.Status != models.TaskStatusSuccess && req.Status != models.TaskStatusFailed {
		badRequest(c, "状态只能是 success 或 failed")
		return
	}

	now := time.Now()
	err = models.WriteTx(func(tx *gorm.DB) error {
		var task models.AutomationTask
		if err := tx.First(&task, uint(id)).Error; err != nil {
			return fmt.Errorf("任务不存在")
		}
		if task.Status != models.TaskStatusRunning {
			return fmt.Errorf("任务当前状态为 %s，无法更新", task.Status)
		}

		updates := map[string]any{
			"status":       req.Status,
			"result":       req.Result,
			"completed_at": &now,
		}

		if req.Status == models.TaskStatusFailed {
			task.RetryCount++
			updates["retry_count"] = task.RetryCount

			// 未超过重试上限则重新入队
			if task.RetryCount < task.MaxRetry {
				retryAt := now.Add(5 * time.Minute)
				updates["status"] = models.TaskStatusPending
				updates["scheduled_at"] = &retryAt
				updates["completed_at"] = nil
				log.Printf("🔄 任务重试入队 | id=%d | retry=%d/%d | next=%s", task.ID, task.RetryCount, task.MaxRetry, retryAt.Format("15:04:05"))
			}
		}

		return tx.Model(&task).Updates(updates).Error
	})

	if err != nil {
		badRequest(c, err.Error())
		return
	}

	log.Printf("📥 Agent 回写结果 | id=%d | status=%s | result=%s", id, req.Status, req.Result)

	// 建群成功后：异步触发群管理配置（设群名 + 禁止互加联系人 + 转让群主）
	if req.Status == models.TaskStatusSuccess {
		var task models.AutomationTask
		models.DB.First(&task, uint(id))

		if task.TaskType == models.TaskTypeCreateGroup {
			go services.PostGroupCreationSetup(task.OrderID, task.FollowUserID)
		}
	}

	// WebSocket 广播状态变更
	services.Hub.Broadcast(services.WSEvent{
		Type: "automation_task_updated",
		Payload: map[string]any{
			"task_id": id,
			"status":  req.Status,
		},
	})

	respondMessage(c, "ok")
}

// AgentHeartbeat Agent 心跳上报
func AgentHeartbeat(c *gin.Context) {
	var req struct {
		Platform    string `json:"platform"`
		Version     string `json:"version"`
		MachineID   string `json:"machine_id"`
		TasksDone   int    `json:"tasks_done"`
		TasksFailed int    `json:"tasks_failed"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误")
		return
	}

	agentStatusMu.Lock()
	agentStatus = AgentStatus{
		Online:      true,
		LastSeen:    time.Now(),
		Platform:    req.Platform,
		Version:     req.Version,
		MachineID:   req.MachineID,
		TasksDone:   req.TasksDone,
		TasksFailed: req.TasksFailed,
	}
	agentStatusMu.Unlock()

	respondMessage(c, "ok")
}

// ─── 管理端 API ──────────────────────────────────────────

// AdminListAutomationTasks 管理端查看任务列表（分页+筛选）
func AdminListAutomationTasks(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	status := c.Query("status")
	taskType := c.Query("task_type")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	query := models.DB.Model(&models.AutomationTask{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if taskType != "" {
		query = query.Where("task_type = ?", taskType)
	}

	var total int64
	query.Count(&total)

	var tasks []models.AutomationTask
	query.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&tasks)

	respondOK(c, gin.H{
		"data":  tasks,
		"total": total,
		"page":  page,
	})
}

// AdminRetryAutomationTask 手动重试失败任务
func AdminRetryAutomationTask(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		badRequest(c, "无效的任务 ID")
		return
	}

	err = models.WriteTx(func(tx *gorm.DB) error {
		var task models.AutomationTask
		if err := tx.First(&task, uint(id)).Error; err != nil {
			return fmt.Errorf("任务不存在")
		}
		if task.Status != models.TaskStatusFailed {
			return fmt.Errorf("只能重试失败的任务")
		}
		return tx.Model(&task).Updates(map[string]any{
			"status":       models.TaskStatusPending,
			"result":       "",
			"scheduled_at": nil,
			"completed_at": nil,
		}).Error
	})

	if err != nil {
		badRequest(c, err.Error())
		return
	}

	respondMessage(c, "已重新入队")
}

// AdminCancelAutomationTask 取消待执行任务
func AdminCancelAutomationTask(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		badRequest(c, "无效的任务 ID")
		return
	}

	now := time.Now()
	err = models.WriteTx(func(tx *gorm.DB) error {
		var task models.AutomationTask
		if err := tx.First(&task, uint(id)).Error; err != nil {
			return fmt.Errorf("任务不存在")
		}
		if task.Status != models.TaskStatusPending {
			return fmt.Errorf("只能取消待执行的任务")
		}
		return tx.Model(&task).Updates(map[string]any{
			"status":       models.TaskStatusCancelled,
			"completed_at": &now,
		}).Error
	})

	if err != nil {
		badRequest(c, err.Error())
		return
	}

	respondMessage(c, "已取消")
}

// AdminGetAutomationStats 任务统计
func AdminGetAutomationStats(c *gin.Context) {
	today := time.Now().Format("2006-01-02")

	type CountResult struct {
		Status string `gorm:"column:status"`
		Cnt    int64  `gorm:"column:cnt"`
	}

	// 今日各状态统计
	var todayCounts []CountResult
	models.DB.Model(&models.AutomationTask{}).
		Select("status, COUNT(*) as cnt").
		Where("DATE(created_at) = ?", today).
		Group("status").
		Find(&todayCounts)

	stats := map[string]int64{
		"pending":   0,
		"running":   0,
		"success":   0,
		"failed":    0,
		"cancelled": 0,
	}
	var todayTotal int64
	for _, c := range todayCounts {
		stats[c.Status] = c.Cnt
		todayTotal += c.Cnt
	}

	// 总任务数
	var totalTasks int64
	models.DB.Model(&models.AutomationTask{}).Count(&totalTasks)

	respondOK(c, gin.H{
		"today":       stats,
		"today_total": todayTotal,
		"total_tasks": totalTasks,
	})
}

// AdminGetAgentStatus Agent 在线状态
func AdminGetAgentStatus(c *gin.Context) {
	agentStatusMu.RLock()
	s := agentStatus
	agentStatusMu.RUnlock()

	// 超过 2 分钟未心跳则视为离线
	if time.Since(s.LastSeen) > 2*time.Minute {
		s.Online = false
	}

	respondOK(c, s)
}
