package models

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Employee 员工（谈单客服/设计师/跟单客服/管理员）
type Employee struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	WecomUserID      string         `gorm:"column:wecom_userid;uniqueIndex;size:64" json:"wecom_userid"`
	Name             string         `gorm:"column:name;size:64;not null" json:"name"`
	Role             string         `gorm:"column:role;size:16;not null" json:"role"` // sales / designer / follow / admin
	Username         string         `gorm:"column:username;uniqueIndex;size:64" json:"username,omitempty"`       // 所有角色登录用户名
	PasswordHash     string         `gorm:"column:password_hash;size:128" json:"-"`                             // bcrypt 哈希密码
	MachineID        string         `gorm:"column:machine_id;index;size:128" json:"machine_id,omitempty"`       // 复合设备指纹哈希 (桌面端设备绑定)
	MacAddress       string         `gorm:"column:mac_address;size:64" json:"mac_address,omitempty"`            // 真实 MAC 地址（管理看板展示用）
	ActivationCode       string     `gorm:"column:activation_code;size:128" json:"-"`                           // [废弃] 保留字段兼容旧数据
	ActivationCodePrefix string     `gorm:"column:activation_code_prefix;index;size:8" json:"-"`                // [废弃] 保留字段兼容旧数据
	Status           string         `gorm:"column:status;size:16;default:idle" json:"status"`                   // idle / busy
	ActiveOrderCount int            `gorm:"column:active_order_count;default:0" json:"active_order_count"`
	IsActive         bool           `gorm:"column:is_active;default:true" json:"is_active"`
	LastLoginAt      *time.Time     `gorm:"column:last_login_at" json:"last_login_at,omitempty"`                // 最后登录时间
	LastLoginIP      string         `gorm:"column:last_login_ip;size:45" json:"last_login_ip,omitempty"`        // 最后登录 IP
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
}

// ValidRoles 合法角色值
var ValidRoles = []string{"sales", "follow", "admin"}

// IsValidRole 校验角色是否合法
func IsValidRole(role string) bool {
	for _, r := range ValidRoles {
		if r == role {
			return true
		}
	}
	return false
}

// Order PPT 制作订单
type Order struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	OrderSN         string     `gorm:"column:order_sn;uniqueIndex;size:64" json:"order_sn"`
	CustomerContact string     `gorm:"column:customer_contact;size:64" json:"customer_contact,omitempty"`
	CustomerID      uint       `gorm:"column:customer_id;index" json:"customer_id"`
	Price           int        `gorm:"column:price;not null;default:0" json:"price"`
	OperatorID      string     `gorm:"column:operator_id;size:64;not null" json:"operator_id"`       // 谈单客服 (sales)
	DesignerID      string     `gorm:"column:designer_id;size:64" json:"designer_id,omitempty"`      // [旧] 设计师，保留兼容旧数据
	FreelanceDesignerID   uint   `gorm:"column:freelance_designer_id;index" json:"freelance_designer_id"`           // 关联花名册
	FreelanceDesignerName string `gorm:"column:freelance_designer_name;size:64" json:"freelance_designer_name"`     // 冗余名字方便展示
	FollowOperatorID string   `gorm:"column:follow_operator_id;size:64" json:"follow_operator_id,omitempty"` // 跟单客服 (follow)
	Topic           string     `gorm:"column:topic;size:256" json:"topic,omitempty"`
	Pages           int        `gorm:"column:pages;default:0" json:"pages"`
	ExtraPages      int        `gorm:"column:extra_pages;default:0" json:"extra_pages"`              // 加页数量
	ExtraPrice      int        `gorm:"column:extra_price;default:0" json:"extra_price"`              // 加页费用 (分)
	CostPrice       int        `gorm:"column:cost_price;default:0" json:"cost_price"`                // 成本价 (设计师接受价格，分)
	DesignerExtraCommission int `gorm:"column:designer_extra_commission;default:0" json:"designer_extra_commission"` // 设计师加页额外分成 (分)
	Deadline        *time.Time `gorm:"column:deadline" json:"deadline,omitempty"`
	Remark          string     `gorm:"column:remark;type:text" json:"remark,omitempty"`
	ScreenshotPath  string     `gorm:"column:screenshot_path;type:text" json:"screenshot_path,omitempty"`
	AttachmentURLs  string     `gorm:"column:attachment_urls;type:text" json:"attachment_urls,omitempty"` // JSON 数组，备注图片URL列表
	Status          string     `gorm:"column:status;size:32;default:PENDING;index:idx_status_created,priority:1" json:"status"`
	WecomChatID     string     `gorm:"column:wecom_chat_id;size:64" json:"wecom_chat_id,omitempty"`
	RefundReason    string     `gorm:"column:refund_reason;type:text" json:"refund_reason,omitempty"`
	CommissionAdjusted    bool `gorm:"column:commission_adjusted;default:false" json:"commission_adjusted"`       // 佣金是否被调整过
	OriginalDesignerRate  int  `gorm:"-" json:"original_designer_rate"`                                           // 不存数据库，展示用

	// 分润结果字段（由分润引擎自动计算，单位：分）
	PlatformFee        int `gorm:"column:platform_fee;default:0" json:"platform_fee"`
	DesignerCommission int `gorm:"column:designer_commission;default:0" json:"designer_commission"`
	SalesCommission    int `gorm:"column:sales_commission;default:0" json:"sales_commission"`
	FollowCommission   int `gorm:"column:follow_commission;default:0" json:"follow_commission"`
	NetProfit          int `gorm:"column:net_profit;default:0" json:"net_profit"`

	CreatedAt       time.Time  `gorm:"index:idx_status_created,priority:2" json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	AssignedAt      *time.Time `json:"assigned_at,omitempty"`
	DeliveredAt     *time.Time `json:"delivered_at,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`
	DeadlineReminded bool      `gorm:"column:deadline_reminded;default:false" json:"deadline_reminded"`
	AssignRetryCount int       `gorm:"column:assign_retry_count;default:0" json:"assign_retry_count"`
	GrabAlertSent        bool      `gorm:"column:grab_alert_sent;default:false" json:"grab_alert_sent"`
	DesigningAlertSent   bool      `gorm:"column:designing_alert_sent;default:false" json:"designing_alert_sent"`
}

// OrderStatus 状态机常量（v2.0 简化: 3+1）
const (
	StatusPending   = "PENDING"
	StatusDesigning = "DESIGNING"
	StatusCompleted = "COMPLETED"
	StatusRefunded  = "REFUNDED"
)

// [废弃] 旧状态常量，保留仅供历史数据查询兼容
const (
	StatusGroupCreated = "GROUP_CREATED"
	StatusConfirmed    = "CONFIRMED"
	StatusDelivered    = "DELIVERED"
	StatusRevision     = "REVISION"
	StatusAfterSale    = "AFTER_SALE"
	StatusClosed       = "CLOSED"
)

// ValidTransitions 合法状态转换（v2.0 简化）
// 正向: PENDING → DESIGNING → COMPLETED
// 标记: COMPLETED → REFUNDED
var ValidTransitions = map[string][]string{
	StatusPending:   {StatusDesigning},
	StatusDesigning: {StatusCompleted},
	StatusCompleted: {StatusRefunded},
}

// StatusChangePermission 定义每个目标状态所需的操作权限（v2.0 简化）
// key = 目标状态, value = 允许执行此操作的角色列表
var StatusChangePermission = map[string][]string{
	StatusDesigning: {"admin", "follow"},
	StatusCompleted: {"admin", "follow"},
	StatusRefunded:  {"admin", "follow"},
}

// IsTerminalStatus 判断是否为终态（不可再转换）
func IsTerminalStatus(status string) bool {
	return status == StatusRefunded
}

// ValidateStatusTransition 校验状态流转是否合法，返回 nil 表示合法，否则返回错误描述
func ValidateStatusTransition(currentStatus, newStatus string) error {
	allowed, ok := ValidTransitions[currentStatus]
	if !ok {
		return fmt.Errorf("当前状态 %s 不支持转换", currentStatus)
	}
	for _, s := range allowed {
		if s == newStatus {
			return nil
		}
	}
	return fmt.Errorf("非法状态转换: %s -> %s", currentStatus, newStatus)
}

// ─── 业务常量 ──────────────────────────────────────────
const (
	MaxOrderPrice     = 999999 // 订单最大价格（分）
	BatchOperationMax = 100    // 单次批量操作最大数量
	PaginationMax     = 200    // 分页查询最大条数
	PaginationDefault = 50     // 分页查询默认条数
)
