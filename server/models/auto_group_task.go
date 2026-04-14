package models

import (
	"time"

	"gorm.io/gorm"
)

// AutoGroupTask 自动建群任务队列
type AutoGroupTask struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	ExternalUserID string         `gorm:"size:64;index;not null" json:"external_user_id"`
	CustomerID     uint           `gorm:"index" json:"customer_id"`
	CustomerName   string         `gorm:"size:100" json:"customer_name"`
	StaffUserID    string         `gorm:"size:64;index" json:"staff_userid"`
	FixedMembers   string         `gorm:"size:500" json:"fixed_members"`
	Status         string         `gorm:"size:16;default:pending;index" json:"status"`
	GroupChatID    string         `gorm:"size:128" json:"group_chat_id"`
	FailReason     string         `gorm:"size:500" json:"fail_reason"`
	RetryCount     int            `gorm:"default:0" json:"retry_count"`
	MaxRetry       int            `gorm:"default:3" json:"max_retry"`
	CreatedAt      time.Time      `gorm:"index" json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	CompletedAt    *time.Time     `json:"completed_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
