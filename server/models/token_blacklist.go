package models

import (
	"log"
	"time"
)

// TokenBlacklist 存储被注销的 JWT token (持久化到数据库，重启后可恢复)
type TokenBlacklist struct {
	ID        uint      `gorm:"primaryKey"`
	JTI       string    `gorm:"column:jti;uniqueIndex;size:64;not null"`
	ExpAt     time.Time `gorm:"column:exp_at;index;not null"`
	CreatedAt time.Time
}

// UserMinIssuedAtRecord 存储用户级别的最小有效签发时间 (持久化到数据库)
type UserMinIssuedAtRecord struct {
	ID          uint      `gorm:"primaryKey"`
	UserID      string    `gorm:"column:user_id;uniqueIndex;size:64;not null"`
	MinIssuedAt time.Time `gorm:"column:min_issued_at;not null"`
	UpdatedAt   time.Time
}

func (UserMinIssuedAtRecord) TableName() string {
	return "user_min_issued_at"
}

// PersistRevokedToken 将被注销的 token 持久化到数据库
func PersistRevokedToken(jti string, expAt time.Time) {
	record := TokenBlacklist{JTI: jti, ExpAt: expAt}
	if err := DB.Create(&record).Error; err != nil {
		// 唯一键冲突（重复注销同一 token）可忽略
		log.Printf("Token 黑名单持久化 (jti=%s): %v", jti, err)
	}
}

// PersistUserMinIssuedAt 将用户最小签发时间持久化到数据库
func PersistUserMinIssuedAt(userID string, minTime time.Time) {
	var existing UserMinIssuedAtRecord
	result := DB.Where("user_id = ?", userID).First(&existing)
	if result.Error != nil {
		// 不存在，创建新记录
		if err := DB.Create(&UserMinIssuedAtRecord{
			UserID:      userID,
			MinIssuedAt: minTime,
		}).Error; err != nil {
			log.Printf("持久化用户最小签发时间失败 (user=%s): %v", userID, err)
		}
	} else {
		// 已存在，更新时间
		if err := DB.Model(&existing).Update("min_issued_at", minTime).Error; err != nil {
			log.Printf("更新用户最小签发时间失败 (user=%s): %v", userID, err)
		}
	}
}

// LoadTokenBlacklistFromDB 从数据库加载未过期的黑名单条目
func LoadTokenBlacklistFromDB() ([]TokenBlacklist, error) {
	var records []TokenBlacklist
	err := DB.Where("exp_at > ?", time.Now()).Find(&records).Error
	return records, err
}

// LoadUserMinIssuedAtFromDB 从数据库加载所有用户最小签发时间记录
func LoadUserMinIssuedAtFromDB() ([]UserMinIssuedAtRecord, error) {
	var records []UserMinIssuedAtRecord
	err := DB.Find(&records).Error
	return records, err
}

// CleanExpiredTokenBlacklist 清理数据库中过期的黑名单条目
func CleanExpiredTokenBlacklist() int64 {
	result := DB.Where("exp_at <= ?", time.Now()).Delete(&TokenBlacklist{})
	if result.Error != nil {
		log.Printf("清理过期 token 黑名单失败: %v", result.Error)
		return 0
	}
	return result.RowsAffected
}
