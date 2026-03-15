package models

import (
	"time"

	"gorm.io/gorm"
)

// Employee 员工（客服/设计师/管理员）
type Employee struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	WecomUserID      string         `gorm:"column:wecom_userid;uniqueIndex;size:64" json:"wecom_userid"`
	Name             string         `gorm:"column:name;size:64;not null" json:"name"`
	Role             string         `gorm:"column:role;size:16;not null" json:"role"` // operator / designer / admin
	MacAddress       string         `gorm:"column:mac_address;index;size:64" json:"mac_address,omitempty"`
	ActivationCode   string         `gorm:"column:activation_code;uniqueIndex;size:32" json:"activation_code,omitempty"`
	Status           string         `gorm:"column:status;size:16;default:idle" json:"status"` // idle / busy
	ActiveOrderCount int            `gorm:"column:active_order_count;default:0" json:"active_order_count"`
	IsActive         bool           `gorm:"column:is_active;default:true" json:"is_active"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
}

// Order PPT 制作订单
type Order struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	OrderSN         string     `gorm:"column:order_sn;uniqueIndex;size:64" json:"order_sn"`
	CustomerContact string     `gorm:"column:customer_contact;size:64" json:"customer_contact,omitempty"`
	Price           int        `gorm:"column:price;not null;default:0" json:"price"`
	OperatorID      string     `gorm:"column:operator_id;index;size:64;not null" json:"operator_id"`
	DesignerID      string     `gorm:"column:designer_id;index;size:64" json:"designer_id,omitempty"`
	Topic           string     `gorm:"column:topic;size:256" json:"topic,omitempty"`
	Pages           int        `gorm:"column:pages;default:0" json:"pages"`
	Deadline        *time.Time `gorm:"column:deadline" json:"deadline,omitempty"`
	Remark          string     `gorm:"column:remark;type:text" json:"remark,omitempty"`
	ScreenshotPath  string     `gorm:"column:screenshot_path;type:text" json:"screenshot_path,omitempty"`
	Status          string     `gorm:"column:status;size:32;default:PENDING;index" json:"status"`
	WecomChatID     string     `gorm:"column:wecom_chat_id;size:64" json:"wecom_chat_id,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	AssignedAt      *time.Time `json:"assigned_at,omitempty"`
	DeliveredAt     *time.Time `json:"delivered_at,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
}

// OrderStatus 状态机常量
const (
	StatusPending      = "PENDING"
	StatusGroupCreated = "GROUP_CREATED"
	StatusDesigning    = "DESIGNING"
	StatusDelivered    = "DELIVERED"
	StatusCompleted    = "COMPLETED"
)

// ValidTransitions 合法状态转换
var ValidTransitions = map[string][]string{
	StatusPending:      {StatusGroupCreated},
	StatusGroupCreated: {StatusDesigning},
	StatusDesigning:    {StatusDelivered},
	StatusDelivered:    {StatusCompleted},
}
