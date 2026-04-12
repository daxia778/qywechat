package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"pdd-order-system/models"

	"gorm.io/gorm"
)

const (
	wecomDataRetention  = 80 * 24 * time.Hour // 保留 80 天
	wecomCleanInterval  = 24 * time.Hour       // 每 24 小时清理一次
	wecomSyncInterval   = 1 * time.Hour        // 每 1 小时同步一次通讯录
)

// ─── 数据采集与存储 ──────────────────────────

// SaveGroupChatSnapshot 保存/更新群聊快照到数据库
// 在创建群聊或发送群消息时自动调用
func SaveGroupChatSnapshot(chatID, name, ownerID string, memberIDs []string, orderSN string) {
	membersStr := strings.Join(memberIDs, ",")
	now := time.Now()

	var existing models.WecomGroupChat
	result := models.DB.Where("chat_id = ?", chatID).First(&existing)

	if result.Error != nil {
		// 新建记录
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&models.WecomGroupChat{
				ChatID:    chatID,
				Name:      name,
				OwnerID:   ownerID,
				MemberIDs: membersStr,
				OrderSN:   orderSN,
				Status:    "active",
				SyncedAt:  now,
			}).Error
		}); err != nil {
			log.Printf("❌ 保存群聊快照失败: chatid=%s err=%v", chatID, err)
			return
		}
		log.Printf("📝 群聊快照已保存 | chatid=%s | name=%s", chatID, name)
	} else {
		// 更新已有记录
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&existing).Updates(map[string]interface{}{
				"name":       name,
				"owner_id":   ownerID,
				"member_ids": membersStr,
				"synced_at":  now,
			}).Error
		}); err != nil {
			log.Printf("❌ 更新群聊快照失败: chatid=%s err=%v", chatID, err)
		}
	}
}

// SaveMessageLog 记录一条发出的企微消息
func SaveMessageLog(chatID, senderID, msgType, content, orderSN, direction string) {
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&models.WecomMessageLog{
			ChatID:    chatID,
			SenderID:  senderID,
			MsgType:   msgType,
			Content:   content,
			OrderSN:   orderSN,
			Direction: direction,
		}).Error
	}); err != nil {
		log.Printf("❌ 记录企微消息失败: chatid=%s err=%v", chatID, err)
	}
}

// SyncWecomMembers 从企微通讯录 API 拉取部门成员列表并存入数据库
func SyncWecomMembers() {
	if !Wecom.IsConfigured() {
		return
	}

	token, err := Wecom.GetAccessToken()
	if err != nil {
		log.Printf("❌ 同步通讯录失败 (Token): %v", err)
		return
	}

	// 获取根部门下所有成员详情 (department_id=1 为根部门)
	url := fmt.Sprintf("%s/user/list?access_token=%s&department_id=1&fetch_child=1", Wecom.baseURL, token)
	resp, err := Wecom.client.Get(url)
	if err != nil {
		log.Printf("❌ 同步通讯录失败 (HTTP): %v", err)
		return
	}
	defer resp.Body.Close()

	var result struct {
		ErrCode  int    `json:"errcode"`
		ErrMsg   string `json:"errmsg"`
		UserList []struct {
			UserID     string `json:"userid"`
			Name       string `json:"name"`
			Department []int  `json:"department"`
			Position   string `json:"position"`
			Mobile     string `json:"mobile"`
			Email      string `json:"email"`
			Avatar     string `json:"avatar"`
			Status     int    `json:"status"`
			IsLeader   int    `json:"isleader"`
		} `json:"userlist"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("❌ 同步通讯录失败 (JSON): %v", err)
		return
	}
	if result.ErrCode != 0 {
		log.Printf("❌ 同步通讯录失败 (API): errcode=%d errmsg=%s", result.ErrCode, result.ErrMsg)
		return
	}

	now := time.Now()
	count := 0

	for _, u := range result.UserList {
		// 部门ID转字符串
		deptParts := make([]string, len(u.Department))
		for i, d := range u.Department {
			deptParts[i] = fmt.Sprintf("%d", d)
		}
		deptStr := strings.Join(deptParts, ",")

		var existing models.WecomMember
		if err := models.DB.Where("userid = ?", u.UserID).First(&existing).Error; err != nil {
			// 新成员
			if createErr := models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.WecomMember{
					UserID:     u.UserID,
					Name:       u.Name,
					Department: deptStr,
					Position:   u.Position,
					Mobile:     u.Mobile,
					Email:      u.Email,
					Avatar:     u.Avatar,
					Status:     u.Status,
					IsLeader:   u.IsLeader,
					SyncedAt:   now,
				}).Error
			}); createErr != nil {
				log.Printf("❌ 创建企微成员失败: userid=%s err=%v", u.UserID, createErr)
				continue
			}
			count++
		} else {
			// 更新已有成员
			if updateErr := models.WriteTx(func(tx *gorm.DB) error {
				return tx.Model(&existing).Updates(map[string]interface{}{
					"name":       u.Name,
					"department": deptStr,
					"position":   u.Position,
					"mobile":     u.Mobile,
					"email":      u.Email,
					"avatar":     u.Avatar,
					"status":     u.Status,
					"is_leader":  u.IsLeader,
					"synced_at":  now,
				}).Error
			}); updateErr != nil {
				log.Printf("❌ 更新企微成员失败: userid=%s err=%v", u.UserID, updateErr)
			}
		}
	}

	log.Printf("✅ 企微通讯录同步完成 | 总计 %d 人, 新增 %d 人", len(result.UserList), count)
}

// ─── 定时同步调度器 ──────────────────────────

// StartWecomSyncScheduler 启动企微数据定时同步
func StartWecomSyncScheduler(ctx context.Context) {
	log.Printf("✅ 企微通讯录同步调度器已启动 (间隔 %v)", wecomSyncInterval)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[WecomSync] panic recovered: %v", r)
			}
		}()
		// 启动 2 秒后立即预热缓存
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}

		// 1) 同步通讯录到数据库
		SyncWecomMembers()

		// 2) 预热内存缓存，避免首次搜索触发 API 调用
		_ = getWeComTeamMembers()

		ticker := time.NewTicker(wecomSyncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("企微通讯录同步调度器已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[WecomSync] tick panic recovered: %v", r)
						}
					}()
					SyncWecomMembers()
				}()
			}
		}
	}()
}

// ─── 90 天数据清理 ──────────────────────────

// StartWecomDataCleanupScheduler 启动企微历史数据 90 天过期清理
func StartWecomDataCleanupScheduler(ctx context.Context) {
	log.Printf("✅ 企微数据清理调度器已启动 (保留 %v, 间隔 %v)", wecomDataRetention, wecomCleanInterval)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[WecomDataCleanup] panic recovered: %v", r)
			}
		}()
		ticker := time.NewTicker(wecomCleanInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("企微数据清理调度器已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[WecomDataCleanup] tick panic recovered: %v", r)
						}
					}()
					cleanWecomData()
				}()
			}
		}
	}()
}

func cleanWecomData() {
	threshold := time.Now().Add(-wecomDataRetention)

	var r1Affected, r2Affected, r3Affected, r4Affected int64
	if err := models.WriteTx(func(tx *gorm.DB) error {
		// 清理过期群聊快照
		r1 := tx.Where("synced_at < ?", threshold).Delete(&models.WecomGroupChat{})
		if r1.Error != nil {
			return r1.Error
		}
		r1Affected = r1.RowsAffected

		// 清理过期成员快照
		r2 := tx.Where("synced_at < ?", threshold).Delete(&models.WecomMember{})
		if r2.Error != nil {
			return r2.Error
		}
		r2Affected = r2.RowsAffected

		// 清理过期消息日志
		r3 := tx.Where("created_at < ?", threshold).Delete(&models.WecomMessageLog{})
		if r3.Error != nil {
			return r3.Error
		}
		r3Affected = r3.RowsAffected

		// 清理过期会话存档消息
		r4 := tx.Where("msg_time < ?", threshold).Delete(&models.ChatArchiveMessage{})
		if r4.Error != nil {
			return r4.Error
		}
		r4Affected = r4.RowsAffected

		return nil
	}); err != nil {
		log.Printf("❌ 企微数据清理失败: %v", err)
		return
	}

	total := r1Affected + r2Affected + r3Affected + r4Affected
	if total > 0 {
		log.Printf("🗑️ 企微数据清理完成 | 群聊快照=%d, 成员快照=%d, 消息日志=%d, 会话存档=%d",
			r1Affected, r2Affected, r3Affected, r4Affected)
	}

	// 清理过期的存档媒体文件
	cleanArchiveMedia(threshold)
}

// cleanArchiveMedia 清理过期的存档媒体文件 (uploads/archive/ 目录下按月份组织)
func cleanArchiveMedia(threshold time.Time) {
	archiveDir := "uploads/archive"
	if _, err := os.Stat(archiveDir); os.IsNotExist(err) {
		return // 目录不存在，跳过
	}

	removed := 0
	// 遍历 uploads/archive/ 下的月份子目录
	entries, err := os.ReadDir(archiveDir)
	if err != nil {
		log.Printf("⚠️ 读取存档目录失败: %v", err)
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		subDir := filepath.Join(archiveDir, entry.Name())
		files, err := os.ReadDir(subDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			if info.ModTime().Before(threshold) {
				fullPath := filepath.Join(subDir, f.Name())
				if err := os.Remove(fullPath); err == nil {
					removed++
				}
			}
		}
		// 如果子目录为空，删除子目录
		remaining, _ := os.ReadDir(subDir)
		if len(remaining) == 0 {
			os.Remove(subDir)
		}
	}

	if removed > 0 {
		log.Printf("🗑️ 存档媒体文件清理完成 | 删除 %d 个过期文件", removed)
	}
}
