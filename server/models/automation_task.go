package models

import (
	"time"
)

// AutomationTask 自动化任务队列
// 统一管理 add_friend / create_group / invite_to_group 三类任务
// Agent 通过 HTTPS 轮询拉取 pending 任务执行
type AutomationTask struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	TaskType       string     `gorm:"column:task_type;size:20;index;not null" json:"task_type"`       // add_friend / create_group
	OrderID        uint       `gorm:"column:order_id;index" json:"order_id"`
	OrderSN        string     `gorm:"column:order_sn;size:64" json:"order_sn"`
	Phone          string     `gorm:"column:phone;size:20;index" json:"phone"`                        // 手机号（add_friend 用）
	CustomerID     uint       `gorm:"column:customer_id;index" json:"customer_id"`                    // 顾客ID（create_group 用）
	FollowUserID   string     `gorm:"column:follow_user_id;size:64" json:"follow_user_id"`            // 跟单客服企微ID
	SalesUserID    string     `gorm:"column:sales_user_id;size:64" json:"sales_user_id"`              // 谈单客服企微ID
	Status         string     `gorm:"column:status;size:16;default:pending;index" json:"status"`      // pending/running/success/failed/cancelled
	RetryCount     int        `gorm:"column:retry_count;default:0" json:"retry_count"`
	MaxRetry       int        `gorm:"column:max_retry;default:3" json:"max_retry"`
	Result         string     `gorm:"column:result;type:text" json:"result"`                          // 执行结果/错误信息
	ScheduledAt    *time.Time `gorm:"column:scheduled_at" json:"scheduled_at"`                        // 计划执行时间（延迟重试用）
	ExecutedAt     *time.Time `gorm:"column:executed_at" json:"executed_at"`                           // 实际执行时间
	CompletedAt    *time.Time `gorm:"column:completed_at" json:"completed_at"`                        // 完成时间
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// 任务类型常量
const (
	TaskTypeAddFriend     = "add_friend"
	TaskTypeCreateGroup   = "create_group"
	TaskTypeInviteToGroup = "invite_to_group"
)

// 任务状态常量
const (
	TaskStatusPending   = "pending"
	TaskStatusRunning   = "running"
	TaskStatusSuccess   = "success"
	TaskStatusFailed    = "failed"
	TaskStatusCancelled = "cancelled"
)
