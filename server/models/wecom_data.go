package models

import (
	"time"

	"gorm.io/gorm"
)

// WecomGroupChat 企微群聊快照
// 存储通过企微 API 读取到的群聊信息，用于历史追溯和统计分析
// 90 天后自动清理
type WecomGroupChat struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	ChatID    string         `gorm:"column:chat_id;uniqueIndex;size:128" json:"chat_id"` // 企微群聊 ID
	Name      string         `gorm:"column:name;size:256" json:"name"`                   // 群名称
	OwnerID   string         `gorm:"column:owner_id;size:64;index" json:"owner_id"`      // 群主企微 UserID
	MemberIDs string         `gorm:"column:member_ids;type:text" json:"member_ids"`      // 群成员列表 (逗号分隔)
	OrderSN   string         `gorm:"column:order_sn;size:64;index" json:"order_sn"`      // 关联订单号 (如有)
	Status    string         `gorm:"column:status;size:16;default:active" json:"status"`  // active / dismissed
	SyncedAt  time.Time      `gorm:"column:synced_at;index" json:"synced_at"`            // 最近一次同步时间
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// WecomMember 企微成员/联系人快照
// 存储通过企微通讯录 API 读取到的员工信息
// 90 天后自动清理
type WecomMember struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	UserID      string         `gorm:"column:userid;uniqueIndex;size:64" json:"userid"`       // 企微 UserID
	Name        string         `gorm:"column:name;size:64" json:"name"`                       // 成员名称
	Department  string         `gorm:"column:department;size:256" json:"department,omitempty"` // 所属部门 (逗号分隔ID)
	Position    string         `gorm:"column:position;size:128" json:"position,omitempty"`     // 职位
	Mobile      string         `gorm:"column:mobile;size:32" json:"mobile,omitempty"`          // 手机号
	Email       string         `gorm:"column:email;size:128" json:"email,omitempty"`           // 邮箱
	Avatar      string         `gorm:"column:avatar;type:text" json:"avatar,omitempty"`        // 头像 URL
	Status      int            `gorm:"column:status;default:1" json:"status"`                  // 1=已激活 2=已禁用 4=未激活 5=退出
	IsLeader    int            `gorm:"column:is_leader;default:0" json:"is_leader"`            // 是否是部门上级
	ExternalProfile string     `gorm:"column:external_profile;type:text" json:"external_profile,omitempty"` // 对外信息
	SyncedAt    time.Time      `gorm:"column:synced_at;index" json:"synced_at"`                // 最近一次同步时间
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

// WecomMessageLog 企微消息日志
// 记录通过群聊发送的重要消息，供审计和追溯
// 90 天后自动清理
type WecomMessageLog struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ChatID    string    `gorm:"column:chat_id;size:128;index" json:"chat_id"`   // 群聊 ID
	SenderID  string    `gorm:"column:sender_id;size:64;index" json:"sender_id"` // 发送者
	MsgType   string    `gorm:"column:msg_type;size:16" json:"msg_type"`         // text / textcard
	Content   string    `gorm:"column:content;type:text" json:"content"`         // 消息内容
	OrderSN   string    `gorm:"column:order_sn;size:64;index" json:"order_sn"`   // 关联订单号
	Direction string    `gorm:"column:direction;size:8;default:out" json:"direction"` // out=发出 / in=收到
	CreatedAt time.Time `gorm:"index" json:"created_at"`
}
