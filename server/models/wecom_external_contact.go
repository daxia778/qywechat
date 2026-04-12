package models

import "time"

// WeComExternalContact 企微外部联系人缓存表
// 用于接单时从企微客户列表中搜索设计师，避免高频调用企微 API
type WeComExternalContact struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ExternalUserID string    `gorm:"size:128;uniqueIndex" json:"external_user_id"` // 企微外部联系人 ID
	Name           string    `gorm:"size:100;index" json:"name"`                   // 外部联系人名字
	RemarkName     string    `gorm:"size:100" json:"remark_name"`                  // 跟单客服给的备注名
	Avatar         string    `gorm:"size:500" json:"avatar"`                       // 头像 URL
	FollowUserID   string    `gorm:"size:64;index" json:"follow_user_id"`          // 添加此好友的企微员工 UserID
	Type           int       `gorm:"default:1" json:"type"`                        // 1=微信用户 2=企业微信用户
	CorpName       string    `gorm:"size:200" json:"corp_name"`                    // 所在企业名称（企微用户）
	Gender         int       `gorm:"default:0" json:"gender"`
	SyncedAt       time.Time `json:"synced_at"` // 最后同步时间
	CreatedAt      time.Time `json:"created_at"`
}
