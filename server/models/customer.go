package models

import (
	"time"

	"gorm.io/gorm"
)

// Customer 顾客实体
type Customer struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	WechatID       string         `gorm:"size:64;index" json:"wechat_id"`
	Mobile         string         `gorm:"size:20;index" json:"mobile"`
	Nickname       string         `gorm:"size:100" json:"nickname"`
	ExternalUserID string         `gorm:"size:64;index" json:"external_user_id"`
	TotalOrders    int            `gorm:"default:0" json:"total_orders"`
	TotalAmount    int            `gorm:"default:0" json:"total_amount"`
	FirstOrderAt   *time.Time     `json:"first_order_at"`
	LastOrderAt    *time.Time     `json:"last_order_at"`
	Remark         string         `gorm:"size:500" json:"remark"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}
