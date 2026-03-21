package models

import (
	"time"

	"gorm.io/gorm"
)

// PaymentRecord 收款流水记录
type PaymentRecord struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	TransactionID  string         `gorm:"column:transaction_id;size:64;uniqueIndex" json:"transaction_id"`   // 交易单号
	OrderID        uint           `gorm:"column:order_id;index" json:"order_id"`                             // 关联订单
	CustomerID     uint           `gorm:"column:customer_id;index" json:"customer_id"`                       // 关联顾客
	ExternalUserID string         `gorm:"column:external_user_id;size:64;index" json:"external_user_id"`     // 企微外部联系人ID
	Amount         int            `gorm:"column:amount;not null;default:0" json:"amount"`                    // 金额（分）
	Source         string         `gorm:"column:source;size:20" json:"source"`                               // pdd / wecom / manual
	PayeeUserID    string         `gorm:"column:payee_user_id;size:64" json:"payee_user_id"`                 // 收款员工ID
	Remark         string         `gorm:"column:remark;size:256" json:"remark"`                              // 备注
	TradeState     string         `gorm:"column:trade_state;size:20" json:"trade_state"`                     // 交易状态
	PaidAt         time.Time      `gorm:"column:paid_at" json:"paid_at"`                                    // 支付时间
	MatchedAt      *time.Time     `gorm:"column:matched_at" json:"matched_at"`                              // 系统匹配时间
	MatchMethod    string         `gorm:"column:match_method;size:20" json:"match_method"`                   // auto / manual
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// ValidPaymentSources 合法收款来源
var ValidPaymentSources = []string{"pdd", "wecom", "manual"}

// IsValidPaymentSource 校验收款来源是否合法
func IsValidPaymentSource(source string) bool {
	for _, s := range ValidPaymentSources {
		if s == source {
			return true
		}
	}
	return false
}
