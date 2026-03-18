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
	Username         string         `gorm:"column:username;uniqueIndex;size:64" json:"username,omitempty"`       // Web 后台登录用户名 (仅 admin 角色)
	PasswordHash     string         `gorm:"column:password_hash;size:128" json:"-"`                             // bcrypt 哈希密码
	MachineID        string         `gorm:"column:machine_id;index;size:128" json:"machine_id,omitempty"`       // 复合设备指纹哈希 (替代弱 MAC 绑定)
	MacAddress       string         `gorm:"column:mac_address;size:64" json:"mac_address,omitempty"`            // 真实 MAC 地址（管理看板展示用）
	ActivationCode       string         `gorm:"column:activation_code;size:128" json:"activation_code,omitempty"`        // 桌面端激活码 (bcrypt)
	ActivationCodePrefix string         `gorm:"column:activation_code_prefix;index;size:8" json:"-"`                   // 激活码明文前缀 (用于缩小 bcrypt 扫描范围)
	Status           string         `gorm:"column:status;size:16;default:idle" json:"status"`                   // idle / busy
	ActiveOrderCount int            `gorm:"column:active_order_count;default:0" json:"active_order_count"`
	IsActive         bool           `gorm:"column:is_active;default:true" json:"is_active"`
	LastLoginAt      *time.Time     `gorm:"column:last_login_at" json:"last_login_at,omitempty"`                // 最后登录时间
	LastLoginIP      string         `gorm:"column:last_login_ip;size:45" json:"last_login_ip,omitempty"`        // 最后登录 IP
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
	OperatorID      string     `gorm:"column:operator_id;size:64;not null" json:"operator_id"`
	DesignerID      string     `gorm:"column:designer_id;size:64" json:"designer_id,omitempty"`
	Topic           string     `gorm:"column:topic;size:256" json:"topic,omitempty"`
	Pages           int        `gorm:"column:pages;default:0" json:"pages"`
	Deadline        *time.Time `gorm:"column:deadline" json:"deadline,omitempty"`
	Remark          string     `gorm:"column:remark;type:text" json:"remark,omitempty"`
	ScreenshotPath  string     `gorm:"column:screenshot_path;type:text" json:"screenshot_path,omitempty"`
	Status          string     `gorm:"column:status;size:32;default:PENDING;index:idx_status_created,priority:1" json:"status"`
	WecomChatID     string     `gorm:"column:wecom_chat_id;size:64" json:"wecom_chat_id,omitempty"`
	RefundReason    string     `gorm:"column:refund_reason;type:text" json:"refund_reason,omitempty"`
	CreatedAt       time.Time  `gorm:"index:idx_status_created,priority:2" json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	AssignedAt      *time.Time `json:"assigned_at,omitempty"`
	DeliveredAt     *time.Time `json:"delivered_at,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`
	DeadlineReminded bool      `gorm:"column:deadline_reminded;default:false" json:"deadline_reminded"`
	AssignRetryCount int       `gorm:"column:assign_retry_count;default:0" json:"assign_retry_count"`
}

// OrderStatus 状态机常量
const (
	StatusPending      = "PENDING"
	StatusGroupCreated = "GROUP_CREATED"
	StatusDesigning    = "DESIGNING"
	StatusDelivered    = "DELIVERED"
	StatusCompleted    = "COMPLETED"
	StatusRefunded     = "REFUNDED"
	StatusClosed       = "CLOSED"
)

// ValidTransitions 合法状态转换
// 正向: PENDING → GROUP_CREATED → DESIGNING → DELIVERED → COMPLETED
// 逆向: 任意进行中状态 → REFUNDED / CLOSED
var ValidTransitions = map[string][]string{
	StatusPending:      {StatusGroupCreated, StatusRefunded, StatusClosed},
	StatusGroupCreated: {StatusDesigning, StatusRefunded, StatusClosed},
	StatusDesigning:    {StatusDelivered, StatusRefunded, StatusClosed},
	StatusDelivered:    {StatusCompleted, StatusRefunded, StatusClosed},
}

// StatusChangePermission 定义每个目标状态所需的操作权限
// key = 目标状态, value = 允许执行此操作的角色列表
var StatusChangePermission = map[string][]string{
	StatusGroupCreated: {"admin", "operator"},
	StatusDesigning:    {"admin", "operator"},
	StatusDelivered:    {"admin", "designer"},
	StatusCompleted:    {"admin", "operator"},
	StatusRefunded:     {"admin", "operator"},
	StatusClosed:       {"admin"},
}

// IsTerminalStatus 判断是否为终态（不可再转换）
func IsTerminalStatus(status string) bool {
	return status == StatusCompleted || status == StatusRefunded || status == StatusClosed
}
