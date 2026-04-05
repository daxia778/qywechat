package models

import "time"

// ContactWay 企微「联系我」渠道记录
type ContactWay struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ConfigID  string    `gorm:"column:config_id;uniqueIndex;size:128" json:"config_id"`
	QRCode    string    `gorm:"column:qr_code;type:text" json:"qr_code"`
	State     string    `gorm:"column:state;size:64" json:"state"`
	UserIDs   string    `gorm:"column:user_ids;type:text" json:"user_ids"`     // JSON 数组
	CreatorID string    `gorm:"column:creator_id;size:64" json:"creator_id"`
	CreatedAt time.Time `json:"created_at"`
}
