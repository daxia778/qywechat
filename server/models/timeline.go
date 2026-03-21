package models

import "time"

// OrderTimeline 订单状态流转 / 变更审计时间线记录
type OrderTimeline struct {
	ID           uint      `gorm:"primarykey" json:"id"`
	OrderID      uint      `gorm:"index;not null" json:"order_id"`
	EventType    string    `gorm:"size:32;default:status_changed" json:"event_type"` // status_changed / amount_changed / pages_changed
	FromStatus   string    `gorm:"size:32" json:"from_status"`
	ToStatus     string    `gorm:"size:32" json:"to_status"`
	OldValue     string    `gorm:"size:128" json:"old_value,omitempty"` // 变更前数值（用于 amount_changed / pages_changed）
	NewValue     string    `gorm:"size:128" json:"new_value,omitempty"` // 变更后数值
	OperatorID   string    `gorm:"size:64" json:"operator_id"`          // 操作人 WecomUserID
	OperatorName string    `gorm:"size:64" json:"operator_name"`        // 操作人姓名
	Remark       string    `gorm:"size:500" json:"remark,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
