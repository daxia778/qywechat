package models

import "time"

// OrderTimeline 订单状态流转时间线记录
type OrderTimeline struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	OrderID   uint      `gorm:"index;not null" json:"order_id"`
	FromStatus string   `gorm:"size:32" json:"from_status"`
	ToStatus  string    `gorm:"size:32;not null" json:"to_status"`
	OperatorID string   `gorm:"size:64" json:"operator_id"`   // 操作人 WecomUserID
	OperatorName string `gorm:"size:64" json:"operator_name"` // 操作人姓名
	Remark    string    `gorm:"size:500" json:"remark,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
