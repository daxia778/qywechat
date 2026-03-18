package models

import "time"

// AppVersion 客户端版本管理 (OTA 更新)
type AppVersion struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	VersionCode  string    `gorm:"column:version_code;size:32;not null;uniqueIndex" json:"version_code"` // 如 "1.3.0"
	DownloadURL  string    `gorm:"column:download_url;size:512;not null" json:"download_url"`
	ReleaseNotes string    `gorm:"column:release_notes;type:text" json:"release_notes"`
	ForceUpdate  bool      `gorm:"column:force_update;default:false" json:"force_update"`
	IsActive     bool      `gorm:"column:is_active;default:true" json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
}
