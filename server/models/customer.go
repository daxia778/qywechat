package models

import (
	"time"

	"gorm.io/gorm"
)

// Customer 顾客实体
type Customer struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	WechatID       string         `gorm:"size:64;index" json:"wechat_id"`
	Mobile         string         `gorm:"size:20;index" json:"mobile"`
	Nickname       string         `gorm:"size:100" json:"nickname"`
	ExternalUserID string         `gorm:"size:64;index" json:"external_user_id"` // 条件唯一索引在 ensureIndexes 中创建
	TotalOrders    int            `gorm:"default:0" json:"total_orders"`
	TotalAmount    int            `gorm:"default:0" json:"total_amount"`
	TotalPayments  int            `gorm:"default:0" json:"total_payments"`
	IsRepurchase   bool           `gorm:"default:false" json:"is_repurchase"`
	Tags           string         `gorm:"size:500" json:"tags"`
	Source         string         `gorm:"size:20" json:"source"` // pdd / referral / other
	FirstOrderAt   *time.Time     `json:"first_order_at"`
	LastOrderAt    *time.Time     `json:"last_order_at"`
	Remark          string         `gorm:"size:500" json:"remark"`
	FollowUserID    string         `gorm:"size:64;index" json:"follow_user_id"`
	AddWay          string         `gorm:"size:32" json:"add_way"`
	ContactWayState string         `gorm:"size:64" json:"contact_way_state"`
	WelcomeSent     bool           `gorm:"default:false" json:"welcome_sent"`
	GroupChatID     string         `gorm:"size:64" json:"group_chat_id"`
	Avatar          string         `gorm:"size:512" json:"avatar"`
	Gender          int            `gorm:"default:0" json:"gender"`
	CorpName        string         `gorm:"size:100" json:"corp_name"`
	AddedAt         *time.Time     `json:"added_at"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

// WelcomeTemplate 欢迎语模板
type WelcomeTemplate struct {
	ID              uint           `gorm:"primaryKey" json:"id"`
	Name            string         `gorm:"size:64;not null" json:"name"`
	Content         string         `gorm:"type:text;not null" json:"content"`
	AttachmentType  string         `gorm:"size:16" json:"attachment_type"`
	AttachmentURL   string         `gorm:"size:512" json:"attachment_url"`
	LinkTitle       string         `gorm:"size:128" json:"link_title"`
	LinkDesc        string         `gorm:"size:256" json:"link_desc"`
	LinkPicURL      string         `gorm:"size:512" json:"link_pic_url"`
	ContactWayState string         `gorm:"size:64;index" json:"contact_way_state"`
	IsDefault       bool           `gorm:"default:false" json:"is_default"`
	IsActive        bool           `gorm:"default:true" json:"is_active"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
}
