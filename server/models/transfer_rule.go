package models

import "time"

// TransferRule 自动转接规则
type TransferRule struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	Name           string     `gorm:"column:name;size:64" json:"name"`
	HandoverUserID string     `gorm:"column:handover_user_id;size:64;index" json:"handover_user_id"`
	TakeoverUserID string     `gorm:"column:takeover_user_id;size:64" json:"takeover_user_id"`
	TriggerDays    int        `gorm:"column:trigger_days;default:30" json:"trigger_days"`
	TransferMsg    string     `gorm:"column:transfer_msg;size:256" json:"transfer_msg"`
	IsActive       bool       `gorm:"column:is_active;default:true" json:"is_active"`
	LastRunAt      *time.Time `gorm:"column:last_run_at" json:"last_run_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}
