package models

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"time"
)

var DB *gorm.DB

// InitDB 初始化数据库连接（SQLite + WAL 模式）
func InitDB(dbPath string) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Fatalf("❌ 创建数据库目录失败: %v", err)
	}

	var err error
	DB, err = gorm.Open(sqlite.Open(fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=30000&_synchronous=NORMAL&_cache_size=-64000", dbPath)), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("❌ 数据库连接失败: %v", err)
	}

	// 获取通用数据库对象 sql.DB，设置连接池
	sqlDB, err := DB.DB()
	if err != nil {
		log.Fatalf("❌ 获取 sql.DB 失败: %v", err)
	}

	// 针对 SQLite WAL，适度限制连接池
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// 自动建表
	if err := DB.AutoMigrate(&Employee{}, &Order{}); err != nil {
		log.Fatalf("❌ 数据库迁移失败: %v", err)
	}

	log.Println("✅ 数据库初始化完成 (SQLite WAL 模式)")
}
