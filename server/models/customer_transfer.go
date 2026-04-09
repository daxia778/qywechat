package models

import "time"

// CustomerTransfer 客户转接记录
type CustomerTransfer struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	HandoverUserID string    `gorm:"column:handover_user_id;size:64;index" json:"handover_user_id"` // 原跟进人企微ID
	TakeoverUserID string    `gorm:"column:takeover_user_id;size:64;index" json:"takeover_user_id"` // 接手人企微ID
	ExternalUserID string    `gorm:"column:external_user_id;size:64" json:"external_user_id"`       // 被转移的外部联系人ID
	CustomerName   string    `gorm:"column:customer_name;size:128" json:"customer_name"`             // 客户名称
	Status         string    `gorm:"column:status;size:16;default:pending" json:"status"`             // pending/waiting/success/failed
	FailReason     string    `gorm:"column:fail_reason;size:256" json:"fail_reason"`
	TransferMsg    string    `gorm:"column:transfer_msg;size:256" json:"transfer_msg"` // 转移提示语
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
