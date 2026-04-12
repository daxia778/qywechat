package services

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"pdd-order-system/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ─── 企微联系人缓存同步服务 ──────────────────────────────
// 将企微外部联系人数据拉取到本地缓存表，供接单时搜索使用。
// 避免每次搜索都调用企微 API 被限流（API 频率限制约 600次/分钟）。

const (
	contactCacheTTL       = 6 * time.Hour  // 缓存有效期
	contactSyncInterval   = 6 * time.Hour  // 定时同步间隔
	contactSyncBatchDelay = 200 * time.Millisecond // 批量拉取详情时每条间隔，防限流
)

// syncLock 防止多个请求并发触发同步
var syncLock sync.Mutex
var syncInProgress = make(map[string]bool)

// SyncExternalContacts 同步指定员工的企微外部联系人到本地缓存
// 如果缓存足够新（< contactCacheTTL），直接跳过
func SyncExternalContacts(userID string) error {
	if Wecom == nil || !Wecom.IsContactConfigured() {
		return nil
	}

	// 检查是否已有足够新的缓存
	var latestSync models.WeComExternalContact
	err := models.DB.Where("follow_user_id = ?", userID).
		Order("synced_at DESC").First(&latestSync).Error
	if err == nil && time.Since(latestSync.SyncedAt) < contactCacheTTL {
		log.Printf("📦 外部联系人缓存命中 | user=%s | synced=%v前", userID, time.Since(latestSync.SyncedAt).Round(time.Minute))
		return nil
	}

	// 防止并发同步
	syncLock.Lock()
	if syncInProgress[userID] {
		syncLock.Unlock()
		log.Printf("⏳ 外部联系人同步进行中 | user=%s", userID)
		return nil
	}
	syncInProgress[userID] = true
	syncLock.Unlock()
	defer func() {
		syncLock.Lock()
		delete(syncInProgress, userID)
		syncLock.Unlock()
	}()

	log.Printf("🔄 开始同步外部联系人 | user=%s", userID)

	// 1. 获取外部联系人 ID 列表
	externalIDs, err := Wecom.GetExternalContactList(userID)
	if err != nil {
		log.Printf("❌ 获取外部联系人列表失败 | user=%s err=%v", userID, err)
		return err
	}

	if len(externalIDs) == 0 {
		log.Printf("📭 该员工暂无外部联系人 | user=%s", userID)
		return nil
	}

	// 2. 逐个获取详情并写入缓存
	now := time.Now()
	saved := 0
	for _, extID := range externalIDs {
		detail, err := Wecom.GetExternalContactDetail(extID)
		if err != nil {
			log.Printf("⚠️ 获取外部联系人详情失败 | ext_id=%s err=%v", extID, err)
			continue
		}

		// 解析响应
		contact := parseExternalContactDetail(detail, userID, now)
		if contact == nil {
			continue
		}

		// Upsert 到数据库
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "external_user_id"}},
				DoUpdates: clause.AssignmentColumns([]string{"name", "remark_name", "avatar", "follow_user_id", "type", "corp_name", "gender", "synced_at"}),
			}).Create(contact).Error
		}); err != nil {
			log.Printf("⚠️ 保存外部联系人缓存失败 | ext_id=%s err=%v", extID, err)
			continue
		}
		saved++

		// 控流：每条之间间隔 200ms
		time.Sleep(contactSyncBatchDelay)
	}

	log.Printf("✅ 外部联系人同步完成 | user=%s | total=%d saved=%d", userID, len(externalIDs), saved)
	return nil
}

// parseExternalContactDetail 解析企微外部联系人详情 API 响应
func parseExternalContactDetail(detail map[string]any, followUserID string, syncTime time.Time) *models.WeComExternalContact {
	extContact, ok := detail["external_contact"].(map[string]any)
	if !ok {
		return nil
	}

	externalUserID, _ := extContact["external_userid"].(string)
	if externalUserID == "" {
		return nil
	}

	name, _ := extContact["name"].(string)
	avatar, _ := extContact["avatar"].(string)
	contactType := 1 // 默认微信用户
	if t, ok := extContact["type"].(float64); ok {
		contactType = int(t)
	}
	corpName, _ := extContact["corp_name"].(string)
	gender := 0
	if g, ok := extContact["gender"].(float64); ok {
		gender = int(g)
	}

	// 获取备注名（在 follow_user 的关系信息中）
	remarkName := ""
	if followInfo, ok := detail["follow_user"].([]any); ok && len(followInfo) > 0 {
		for _, fi := range followInfo {
			if fiMap, ok := fi.(map[string]any); ok {
				uid, _ := fiMap["userid"].(string)
				if uid == followUserID {
					remarkName, _ = fiMap["remark"].(string)
					break
				}
			}
		}
	}

	return &models.WeComExternalContact{
		ExternalUserID: externalUserID,
		Name:           name,
		RemarkName:     remarkName,
		Avatar:         avatar,
		FollowUserID:   followUserID,
		Type:           contactType,
		CorpName:       corpName,
		Gender:         gender,
		SyncedAt:       syncTime,
	}
}

// SearchCachedExternalContacts 从缓存表中搜索外部联系人
func SearchCachedExternalContacts(keyword string, limit int) ([]models.WeComExternalContact, error) {
	var contacts []models.WeComExternalContact
	query := models.DB.Model(&models.WeComExternalContact{})

	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR remark_name LIKE ? OR corp_name LIKE ?", like, like, like)
	}

	err := query.Order("synced_at DESC").Limit(limit).Find(&contacts).Error
	return contacts, err
}

// ── 企微通讯录成员缓存 ──
var (
	wecomTeamCache     []WeComDeptUser
	wecomTeamCacheTime time.Time
	wecomTeamCacheMu   sync.Mutex
	wecomTeamCacheTTL  = 10 * time.Minute // 内存缓存 10 分钟
)

// getWeComTeamMembers 获取企微通讯录全员（带内存缓存）
func getWeComTeamMembers() []WeComDeptUser {
	wecomTeamCacheMu.Lock()
	defer wecomTeamCacheMu.Unlock()

	if len(wecomTeamCache) > 0 && time.Since(wecomTeamCacheTime) < wecomTeamCacheTTL {
		return wecomTeamCache
	}

	if Wecom == nil || !Wecom.IsConfigured() {
		return nil
	}

	users, err := Wecom.GetDepartmentUsers(1) // 1=根部门=全公司
	if err != nil {
		log.Printf("⚠️ 获取企微通讯录成员失败: %v", err)
		return wecomTeamCache // 返回旧缓存
	}

	wecomTeamCache = users
	wecomTeamCacheTime = time.Now()
	log.Printf("📦 企微通讯录缓存已刷新 | count=%d", len(users))
	return users
}

// TeamMemberResult 团队成员搜索结果（合并本地+企微通讯录）
type TeamMemberResult struct {
	ID          uint   `json:"id"`
	Name        string `json:"name"`
	WecomUserID string `json:"wecom_userid"`
	Role        string `json:"role"`
	FromWecom   bool   `json:"from_wecom"` // 是否来自企微通讯录（vs 本地表）
}

// SearchTeamMembers 搜索团队成员（本地 employees 表 + 企微通讯录 API）
func SearchTeamMembers(keyword string, limit int) ([]TeamMemberResult, error) {
	var results []TeamMemberResult
	seen := make(map[string]bool) // 用 name 去重

	// ── Source A: 本地 employees 表 ──
	var employees []models.Employee
	query := models.DB.Model(&models.Employee{}).Where("is_active = ?", true)
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR wecom_userid LIKE ?", like, like)
	}
	if err := query.Order("name ASC").Limit(limit).Find(&employees).Error; err != nil {
		log.Printf("SearchTeamMembers 本地查询失败: %v", err)
	}
	for _, emp := range employees {
		results = append(results, TeamMemberResult{
			ID:          emp.ID,
			Name:        emp.Name,
			WecomUserID: emp.WecomUserID,
			Role:        emp.Role,
			FromWecom:   false,
		})
		seen[emp.Name] = true
		if emp.WecomUserID != "" {
			seen[emp.WecomUserID] = true
		}
	}

	// ── Source B: 企微通讯录 API（内存缓存） ──
	wecomUsers := getWeComTeamMembers()
	kwLower := strings.ToLower(keyword)
	for _, u := range wecomUsers {
		// 去重：跳过已在本地结果中的
		if seen[u.Name] || seen[u.UserID] {
			continue
		}
		// 关键词匹配
		if keyword != "" {
			nameLower := strings.ToLower(u.Name)
			uidLower := strings.ToLower(u.UserID)
			if !strings.Contains(nameLower, kwLower) && !strings.Contains(uidLower, kwLower) {
				continue
			}
		}
		results = append(results, TeamMemberResult{
			ID:          0, // 企微通讯录成员无本地 ID
			Name:        u.Name,
			WecomUserID: u.UserID,
			Role:        "", // 通讯录不返回角色
			FromWecom:   true,
		})
		seen[u.Name] = true
		if len(results) >= limit {
			break
		}
	}

	return results, nil
}

// StartExternalContactSync 启动外部联系人定时缓存同步
func StartExternalContactSync(ctx context.Context) {
	if Wecom == nil || !Wecom.IsContactConfigured() {
		log.Println("⚠️ 企微客户联系未配置，外部联系人缓存同步已跳过")
		return
	}

	log.Printf("✅ 外部联系人缓存同步已启动 (间隔 %v)", contactSyncInterval)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[ExternalContactSync] panic recovered: %v", r)
			}
		}()

		// 启动后 3 分钟首次同步
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Minute):
		}
		syncAllFollowStaffContacts()

		ticker := time.NewTicker(contactSyncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("外部联系人缓存同步已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[ExternalContactSync] tick panic recovered: %v", r)
						}
					}()
					syncAllFollowStaffContacts()
				}()
			}
		}
	}()
}

// syncAllFollowStaffContacts 同步所有跟单客服的外部联系人
func syncAllFollowStaffContacts() {
	var followStaff []models.Employee
	models.DB.Where("role = ? AND is_active = ? AND wecom_userid != ''", "follow", true).Find(&followStaff)

	log.Printf("🔄 批量同步外部联系人 | 跟单客服数量=%d", len(followStaff))
	for _, staff := range followStaff {
		if err := SyncExternalContacts(staff.WecomUserID); err != nil {
			log.Printf("⚠️ 同步外部联系人失败 | staff=%s err=%v", staff.WecomUserID, err)
		}
		// 每个员工之间间隔 1 秒，防止 API 限流
		time.Sleep(1 * time.Second)
	}
}
