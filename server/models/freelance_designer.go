package models

import "time"

// FreelanceDesigner 兼职设计师花名册（轻量，自动沉淀）
type FreelanceDesigner struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	Name            string    `json:"name" gorm:"size:64;not null;index"`
	WechatID        string    `json:"wechat_id" gorm:"size:64"`
	Mobile          string    `json:"mobile" gorm:"size:20"`
	ExternalUserID  string    `json:"external_user_id" gorm:"size:128;index"` // 企微外部联系人 ID（加好友后自动填充）
	Specialty       string    `json:"specialty" gorm:"size:128"`
	TotalOrders     int       `json:"total_orders" gorm:"default:0"`
	TotalCommission int       `json:"total_commission" gorm:"default:0"` // 累计佣金（分）
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
