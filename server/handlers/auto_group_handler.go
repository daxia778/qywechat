package handlers

import (
	"log"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetPendingAutoGroupTasks 获取待处理的自动建群任务
// GET /api/v1/admin/auto-group/pending
func GetPendingAutoGroupTasks(c *gin.Context) {
	var tasks []models.AutoGroupTask

	err := models.WriteTx(func(tx *gorm.DB) error {
		// 查找 pending 或 failed 且未超过最大重试次数的任务
		if err := tx.Where(
			"status IN ? AND retry_count < max_retry",
			[]string{"pending", "failed"},
		).Find(&tasks).Error; err != nil {
			return err
		}
		// 原子更新为 checking 状态
		for i := range tasks {
			tx.Model(&tasks[i]).Update("status", "checking")
			tasks[i].Status = "checking"
		}
		return nil
	})
	if err != nil {
		internalError(c, "查询自动建群任务失败: "+err.Error())
		return
	}

	respondOK(c, gin.H{"tasks": tasks, "count": len(tasks)})
}

// CheckAutoGroupDuplicate 检查外部联系人是否已在群中（判重）
// POST /api/v1/admin/auto-group/check-dup
func CheckAutoGroupDuplicate(c *gin.Context) {
	var req struct {
		TaskID         uint   `json:"task_id" binding:"required"`
		ExternalUserID string `json:"external_user_id" binding:"required"`
		StaffUserID    string `json:"staff_userid" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误: "+err.Error())
		return
	}

	duplicate, groupChatID, err := services.Wecom.CheckExternalUserInGroups(req.StaffUserID, req.ExternalUserID)
	if err != nil {
		log.Printf("⚠️ 判重检查失败 task=%d: %v", req.TaskID, err)
		internalError(c, "判重检查失败: "+err.Error())
		return
	}

	respondOK(c, gin.H{
		"task_id":       req.TaskID,
		"duplicate":     duplicate,
		"group_chat_id": groupChatID,
	})
}

// CompleteAutoGroupTask 完成自动建群任务
// POST /api/v1/admin/auto-group/complete
func CompleteAutoGroupTask(c *gin.Context) {
	var req struct {
		TaskID      uint   `json:"task_id" binding:"required"`
		Success     bool   `json:"success"`
		GroupChatID string `json:"group_chat_id"`
		FailReason  string `json:"fail_reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误: "+err.Error())
		return
	}

	var task models.AutoGroupTask
	if err := models.DB.First(&task, req.TaskID).Error; err != nil {
		notFound(c, "任务不存在")
		return
	}

	now := time.Now()
	if req.Success {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&task).Updates(map[string]any{
				"status":        "done",
				"group_chat_id": req.GroupChatID,
				"completed_at":  &now,
			}).Error
		})
		log.Printf("✅ 自动建群任务完成 task=%d group=%s", req.TaskID, req.GroupChatID)
	} else {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&task).Updates(map[string]any{
				"status":      "failed",
				"fail_reason": req.FailReason,
				"retry_count": task.RetryCount + 1,
			}).Error
		})
		log.Printf("⚠️ 自动建群任务失败 task=%d retry=%d reason=%s", req.TaskID, task.RetryCount+1, req.FailReason)
	}

	respondMessage(c, "任务状态已更新")
}
