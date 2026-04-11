package models

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

// RiskAlert 风控告警记录
// 由风控引擎自动生成，管理员在看板上审阅和处理
type RiskAlert struct {
	ID            uint           `gorm:"primaryKey" json:"id"`
	AlertType     string         `gorm:"column:alert_type;size:32;index" json:"alert_type"`       // price_drop / high_refund / inactive_order / abnormal_time / frequent_reassign
	Severity      string         `gorm:"column:severity;size:16;index" json:"severity"`            // high / medium / low
	OrderID       uint           `gorm:"column:order_id;index" json:"order_id"`                    // 关联订单 (可为 0)
	OrderSN       string         `gorm:"column:order_sn;size:64" json:"order_sn"`                  // 关联订单号
	StaffUserID   string         `gorm:"column:staff_user_id;size:64;index" json:"staff_user_id"`  // 关联跟单客服 UserID
	StaffName     string         `gorm:"column:staff_name;size:64" json:"staff_name"`              // 跟单客服姓名
	Title         string         `gorm:"column:title;size:256" json:"title"`                       // 告警标题
	Detail        string         `gorm:"column:detail;type:text" json:"detail"`                    // 告警详情
	OldValue      string         `gorm:"column:old_value;size:128" json:"old_value,omitempty"`     // 原值
	NewValue      string         `gorm:"column:new_value;size:128" json:"new_value,omitempty"`     // 新值
	IsResolved    bool           `gorm:"column:is_resolved;default:false;index" json:"is_resolved"` // 是否已处理
	ResolvedBy    string         `gorm:"column:resolved_by;size:64" json:"resolved_by,omitempty"`  // 处理人
	ResolvedAt    *time.Time     `gorm:"column:resolved_at" json:"resolved_at,omitempty"`          // 处理时间
	ResolveRemark string         `gorm:"column:resolve_remark;type:text" json:"resolve_remark,omitempty"` // 处理备注
	CreatedAt     time.Time      `gorm:"index" json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`
}

// RiskAlertType 风控告警类型常量
const (
	RiskPriceDrop        = "price_drop"        // 金额异常下调
	RiskHighRefund       = "high_refund"       // 高退款率
	RiskInactiveOrder    = "inactive_order"    // 订单长期无操作
	RiskAbnormalTime     = "abnormal_time"     // 异常操作时间
	RiskFrequentReassign = "frequent_reassign" // 频繁换设计师
)

// RiskSeverity 风控严重程度
const (
	RiskSeverityHigh   = "high"
	RiskSeverityMedium = "medium"
	RiskSeverityLow    = "low"
)

// AuditConfig 审计播报配置（单行记录，由管理员在前端调整）
type AuditConfig struct {
	ID                     uint   `gorm:"primaryKey" json:"id"`
	BroadcastEnabled       bool   `gorm:"column:broadcast_enabled;default:true" json:"broadcast_enabled"`                       // 总开关
	EnabledEventTypes      string `gorm:"column:enabled_event_types;type:text" json:"enabled_event_types"`                      // 启用的事件类型 (逗号分隔，空=全部)
	MonitoredStaffIDs      string `gorm:"column:monitored_staff_ids;type:text" json:"monitored_staff_ids"`                      // 被监控的跟单客服 UserID (逗号分隔，空=全部)
	PriceDropThreshold     int    `gorm:"column:price_drop_threshold;default:20" json:"price_drop_threshold"`                   // 金额降幅告警阈值 (%)
	RefundRateThreshold    int    `gorm:"column:refund_rate_threshold;default:20" json:"refund_rate_threshold"`                  // 退款率告警阈值 (%)
	AbnormalTimeEnabled    bool   `gorm:"column:abnormal_time_enabled;default:true" json:"abnormal_time_enabled"`               // 异常时间检测开关
	InactiveOrderHours     int    `gorm:"column:inactive_order_hours;default:48" json:"inactive_order_hours"`                   // 死单检测时间 (小时)
	FrequentReassignCount  int    `gorm:"column:frequent_reassign_count;default:2" json:"frequent_reassign_count"`              // 频繁换设计师阈值 (次)
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

// GetAuditConfig 获取审计配置（自动创建默认记录）
func GetAuditConfig() *AuditConfig {
	var cfg AuditConfig
	if err := DB.First(&cfg, 1).Error; err != nil {
		// 首次访问，创建默认配置
		cfg = AuditConfig{
			BroadcastEnabled:      true,
			EnabledEventTypes:     "", // 空 = 全部启用
			MonitoredStaffIDs:     "", // 空 = 全部监控
			PriceDropThreshold:    20,
			RefundRateThreshold:   20,
			AbnormalTimeEnabled:   true,
			InactiveOrderHours:    48,
			FrequentReassignCount: 2,
		}
		DB.Create(&cfg)
	}
	return &cfg
}

// SaveAuditConfig 保存审计配置
func SaveAuditConfig(cfg *AuditConfig) error {
	cfg.ID = 1 // 始终使用 ID=1
	return WriteTx(func(tx *gorm.DB) error {
		return tx.Save(cfg).Error
	})
}

// IsEventEnabled 检查某事件类型是否启用
func (c *AuditConfig) IsEventEnabled(eventType string) bool {
	if c.EnabledEventTypes == "" {
		return true // 空 = 全部启用
	}
	for _, et := range splitTrimCSV(c.EnabledEventTypes) {
		if et == eventType {
			return true
		}
	}
	return false
}

// IsStaffMonitored 检查某员工是否在监控范围内
func (c *AuditConfig) IsStaffMonitored(staffUserID string) bool {
	if c.MonitoredStaffIDs == "" {
		return true // 空 = 全部监控
	}
	for _, sid := range splitTrimCSV(c.MonitoredStaffIDs) {
		if sid == staffUserID {
			return true
		}
	}
	return false
}

func splitTrimCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := make([]string, 0)
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			parts = append(parts, p)
		}
	}
	return parts
}
