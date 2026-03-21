package models

import (
	stdlog "log"
	"time"

	"gorm.io/gorm"
)

// AuditLog 操作审计日志
// 记录关键业务操作（登录、建单、状态变更、解绑等），用于事后追溯和责任认定
type AuditLog struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	UserID    string         `gorm:"column:user_id;size:64;index" json:"user_id"`     // 操作人企微ID
	UserName  string         `gorm:"column:user_name;size:64" json:"user_name"`       // 操作人姓名
	Action    string         `gorm:"column:action;size:64;index" json:"action"`       // 操作类型
	TargetID  string         `gorm:"column:target_id;size:64" json:"target_id"`       // 被操作对象ID
	Detail    string         `gorm:"column:detail;type:text" json:"detail,omitempty"` // 附加信息
	IP        string         `gorm:"column:ip;size:45" json:"ip"`                     // 客户端IP
	CreatedAt time.Time      `gorm:"index" json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// 审计日志操作类型常量
const (
	AuditLogin         = "LOGIN"
	AuditLoginFail     = "LOGIN_FAIL"
	AuditOrderCreate   = "ORDER_CREATE"
	AuditOrderGrab     = "ORDER_GRAB"
	AuditOrderStatus   = "ORDER_STATUS"
	AuditEmployeeAdd          = "EMPLOYEE_ADD"
	AuditEmployeeToggle       = "EMPLOYEE_TOGGLE"
	AuditDeviceUnbind         = "DEVICE_UNBIND"
	AuditSecurityAlert        = "SECURITY_ALERT"
	AuditPasswordReset        = "PASSWORD_RESET"
	AuditActivationCodeRegen  = "ACTIVATION_CODE_REGEN"
)

// WriteAuditLog 写入一条审计日志
func WriteAuditLog(userID, userName, action, targetID, detail, ip string) {
	log := &AuditLog{
		UserID:   userID,
		UserName: userName,
		Action:   action,
		TargetID: targetID,
		Detail:   detail,
		IP:       ip,
	}
	// 审计日志写入失败不阻塞主业务，但必须记录到标准日志
	if err := WriteTx(func(tx *gorm.DB) error {
		return tx.Create(log).Error
	}); err != nil {
		stdlog.Printf("CRITICAL: audit log write failed: action=%s user=%s err=%v", action, userID, err)
	}
}
