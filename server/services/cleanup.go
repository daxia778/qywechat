package services

import (
	"log"
	"os"
	"path/filepath"
	"time"
)

const (
	uploadsDir     = "uploads"
	uploadMaxAge   = 7 * 24 * time.Hour // 保留 7 天
	cleanupInterval = 6 * time.Hour      // 每 6 小时检查一次
)

// StartUploadCleanupScheduler 启动定时清理旧上传文件的调度器
// 删除超过 7 天的 OCR 截图文件，防止磁盘占满
func StartUploadCleanupScheduler() {
	log.Printf("✅ 上传文件清理调度器已启动 (保留 %v, 间隔 %v)", uploadMaxAge, cleanupInterval)

	go func() {
		// 启动时立即执行一次
		cleanOldUploads()

		ticker := time.NewTicker(cleanupInterval)
		defer ticker.Stop()

		for range ticker.C {
			cleanOldUploads()
		}
	}()
}

func cleanOldUploads() {
	threshold := time.Now().Add(-uploadMaxAge)
	count := 0

	entries, err := os.ReadDir(uploadsDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(threshold) {
			path := filepath.Join(uploadsDir, entry.Name())
			if err := os.Remove(path); err == nil {
				count++
			}
		}
	}

	if count > 0 {
		log.Printf("🗑️ 已清理 %d 个过期上传文件", count)
	}
}
