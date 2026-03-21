package services

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
)

const (
	backupDir      = "data/backups"
	maxBackups     = 7
	backupInterval = 24 * time.Hour
)

// StartBackupScheduler 启动 SQLite 定时备份调度器
// 每 24 小时执行一次，保留最近 7 份
func StartBackupScheduler(ctx context.Context) {
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		log.Printf("❌ 创建备份目录失败: %v", err)
		return
	}

	// 启动时立即执行一次备份
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Backup] panic recovered: %v", r)
			}
		}()
		performBackup()

		ticker := time.NewTicker(backupInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("备份调度器已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[Backup] tick panic recovered: %v", r)
						}
					}()
					performBackup()
				}()
			}
		}
	}()

	log.Printf("✅ SQLite 备份调度器已启动 (间隔 %v, 保留 %d 份)", backupInterval, maxBackups)
}

func performBackup() {
	_ = config.C.DBPath // 保留引用以确认配置可用

	// 生成备份文件名: pdd_order_20260316_103000.db
	timestamp := time.Now().Format("20060102_150405")
	backupName := fmt.Sprintf("pdd_order_%s.db", timestamp)
	backupPath := filepath.Join(backupDir, backupName)

	// 使用 SQLite 原生 VACUUM INTO 安全备份（不会受正在进行的事务影响）
	if err := models.DB.Exec("VACUUM INTO ?", backupPath).Error; err != nil {
		log.Printf("❌ 备份失败: %v", err)
		return
	}

	log.Printf("✅ 数据库备份完成: %s", backupPath)

	// 清理旧备份
	cleanOldBackups()
}

func cleanOldBackups() {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return
	}

	// 过滤出备份文件
	var backups []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "pdd_order_") && strings.HasSuffix(e.Name(), ".db") {
			backups = append(backups, e.Name())
		}
	}

	// 按名称排序 (文件名包含时间戳，字典序即时间序)
	sort.Strings(backups)

	// 删除超出保留数量的旧备份
	if len(backups) > maxBackups {
		toDelete := backups[:len(backups)-maxBackups]
		for _, name := range toDelete {
			path := filepath.Join(backupDir, name)
			if err := os.Remove(path); err != nil {
				log.Printf("⚠️  清理旧备份失败: %s - %v", name, err)
			} else {
				log.Printf("🗑️  已清理旧备份: %s", name)
			}
		}
	}
}
