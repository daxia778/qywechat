package models

import (
	"time"

	"gorm.io/gorm"
)

// Notification 站内通知
type Notification struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	UserID    string         `gorm:"index;not null" json:"user_id"`    // 接收者 (WecomUserID 或 "admin")
	Title     string         `gorm:"size:200" json:"title"`
	Content   string         `gorm:"size:2000" json:"content"`
	Category  string         `gorm:"size:50;default:'system'" json:"category"` // order / system / alert
	RefID     string         `gorm:"size:100" json:"ref_id"`           // 关联ID (如订单ID)
	IsRead    bool           `gorm:"default:false" json:"is_read"`
	CreatedAt time.Time      `json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}
