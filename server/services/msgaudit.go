package services

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"gorm.io/gorm"
)

// ─── 会话存档引擎（跨平台通用逻辑） ──────────────────────────

// MsgAuditPoller 会话存档拉取引擎接口
// Linux 版使用真实 Finance SDK，其他平台为空实现
type MsgAuditPoller interface {
	// Init 初始化 SDK 客户端
	Init(corpID, secret, privateKey string) error
	// FetchMessages 从指定 seq 开始拉取消息，返回解密后的消息列表和新 seq
	FetchMessages(lastSeq uint64, limit int) ([]RawArchiveMsg, uint64, error)
	// DownloadMedia 下载媒体文件，返回本地路径
	DownloadMedia(sdkFileID, fileExt string) (string, error)
}

// RawArchiveMsg Finance API 解密后的原始消息结构
type RawArchiveMsg struct {
	MsgID    string `json:"msgid"`
	Action   string `json:"action"`   // "send" / "recall" / "switch"
	From     string `json:"from"`     // 发送者 UserID
	ToList   []string `json:"tolist"` // 接收者列表（1v1时为对方ID）
	RoomID   string `json:"roomid"`   // 群聊 ID（私聊为空）
	MsgTime  int64  `json:"msgtime"`  // 消息时间戳（毫秒）
	MsgType  string `json:"msgtype"`  // text / image / voice / video / file / ...
	Seq      uint64 `json:"seq"`

	// 文本消息
	Text *struct {
		Content string `json:"content"`
	} `json:"text,omitempty"`

	// 图片消息
	Image *struct {
		SdkFileID string `json:"sdkfileid"`
		Md5Sum    string `json:"md5sum"`
		FileSize  uint32 `json:"filesize"`
	} `json:"image,omitempty"`

	// 其他类型的消息（voice, video, file 等）暂存原始 JSON
	RawJSON string `json:"-"`
}

// 全局会话存档引擎实例
var msgAuditPoller MsgAuditPoller

// InitMsgAudit 初始化会话存档引擎
func InitMsgAudit() {
	if !config.C.EnableMsgAudit {
		log.Println("ℹ️  会话存档引擎未启用 (ENABLE_MSG_AUDIT=false)")
		return
	}

	if config.C.WecomMsgAuditSecret == "" || config.C.WecomMsgAuditPrivateKey == "" {
		log.Println("⚠️  会话存档引擎配置不完整 (WECOM_MSGAUDIT_SECRET / WECOM_MSGAUDIT_PRIVATE_KEY)，已跳过")
		return
	}

	poller := newMsgAuditPoller() // 平台相关实现 (linux vs stub)
	if err := poller.Init(config.C.WecomCorpID, config.C.WecomMsgAuditSecret, config.C.WecomMsgAuditPrivateKey); err != nil {
		log.Printf("❌ 会话存档引擎初始化失败: %v", err)
		return
	}

	msgAuditPoller = poller
	log.Println("✅ 会话存档引擎初始化完成")
}

// StartMsgAuditPoller 启动会话存档定时拉取
func StartMsgAuditPoller(ctx context.Context) {
	if msgAuditPoller == nil {
		return // 未启用或初始化失败
	}

	log.Println("✅ 会话存档拉取调度器已启动 (间隔 60s)")

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[MsgAudit] panic recovered: %v", r)
			}
		}()

		// 启动 10 秒后首次拉取
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
		pollMsgAudit()

		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("会话存档拉取调度器已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[MsgAudit] tick panic recovered: %v", r)
						}
					}()
					pollMsgAudit()
				}()
			}
		}
	}()
}

// pollMsgAudit 单次拉取逻辑
func pollMsgAudit() {
	if msgAuditPoller == nil {
		return
	}

	// 1. 读取游标
	var cursor models.ChatArchiveCursor
	if err := models.DB.First(&cursor, 1).Error; err != nil {
		// 首次运行，创建游标记录
		cursor = models.ChatArchiveCursor{ID: 1, LastSeq: 0}
		models.DB.Create(&cursor)
	}

	// 2. 获取系统管理的所有群聊 ID (用于过滤)
	workGroupIDs := getWorkGroupChatIDs()

	// 3. 循环拉取直到没有新消息
	totalSaved := 0
	currentSeq := cursor.LastSeq

	for {
		msgs, newSeq, err := msgAuditPoller.FetchMessages(currentSeq, 1000)
		if err != nil {
			log.Printf("❌ 会话存档拉取失败: seq=%d err=%v", currentSeq, err)
			break
		}

		if len(msgs) == 0 {
			break // 没有新消息
		}

		// 4. 过滤+存储
		saved := processArchiveMessages(msgs, workGroupIDs)
		totalSaved += saved

		// 5. 更新游标
		currentSeq = newSeq
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&models.ChatArchiveCursor{}).Where("id = 1").Update("last_seq", newSeq).Error
		}); err != nil {
			log.Printf("❌ 更新会话存档游标失败: %v", err)
			break
		}

		// 如果拉取到的消息不足 1000 条，说明已经拉完
		if len(msgs) < 1000 {
			break
		}
	}

	if totalSaved > 0 {
		log.Printf("📥 会话存档拉取完成 | 新增 %d 条消息 | seq=%d→%d", totalSaved, cursor.LastSeq, currentSeq)
	}
}

// processArchiveMessages 处理拉取到的消息：过滤私聊、存储工作群消息
func processArchiveMessages(msgs []RawArchiveMsg, workGroupIDs map[string]bool) int {
	saved := 0

	for _, msg := range msgs {
		// 跳过非发送动作 (recall等)
		if msg.Action != "send" {
			continue
		}

		// ★ 核心过滤：只保留工作群消息，丢弃所有私聊
		if msg.RoomID == "" {
			continue // 私聊，跳过
		}

		// 只保留系统管理的工作群
		if !workGroupIDs[msg.RoomID] {
			continue // 非工作群，跳过
		}

		// 检查是否已存在 (去重)
		var count int64
		models.DB.Model(&models.ChatArchiveMessage{}).Where("msg_id = ?", msg.MsgID).Count(&count)
		if count > 0 {
			continue
		}

		// 解析消息内容
		content, mediaURL := extractMessageContent(msg)

		// 查找发送人姓名
		senderName := resolveSenderName(msg.From)

		// 存入数据库
		record := models.ChatArchiveMessage{
			Seq:        msg.Seq,
			MsgID:      msg.MsgID,
			ChatID:     msg.RoomID,
			SenderID:   msg.From,
			SenderName: senderName,
			MsgType:    msg.MsgType,
			Content:    content,
			MediaURL:   mediaURL,
			MsgTime:    time.UnixMilli(msg.MsgTime),
		}

		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Create(&record).Error
		}); err != nil {
			log.Printf("⚠️ 会话存档消息写入失败: msg_id=%s err=%v", msg.MsgID, err)
			continue
		}
		saved++
	}

	return saved
}

// extractMessageContent 从原始消息中提取内容和媒体 URL
func extractMessageContent(msg RawArchiveMsg) (content string, mediaURL string) {
	switch msg.MsgType {
	case "text":
		if msg.Text != nil {
			content = msg.Text.Content
		}
	case "image":
		if msg.Image != nil && msgAuditPoller != nil {
			// 下载图片
			localPath, err := msgAuditPoller.DownloadMedia(msg.Image.SdkFileID, ".jpg")
			if err != nil {
				log.Printf("⚠️ 会话存档图片下载失败: msg_id=%s err=%v", msg.MsgID, err)
				content = "[图片下载失败]"
			} else {
				mediaURL = localPath
				content = "[图片]"
			}
		} else {
			content = "[图片]"
		}
	default:
		// voice, video, file 等暂不下载，记录类型
		content = fmt.Sprintf("[%s]", msg.MsgType)
		if msg.RawJSON != "" {
			content = msg.RawJSON
		}
	}
	return
}

// resolveSenderName 查找发送人姓名
func resolveSenderName(userID string) string {
	// 先从企微成员快照中查
	var member models.WecomMember
	if err := models.DB.Where("userid = ?", userID).First(&member).Error; err == nil {
		return member.Name
	}

	// 再从员工表中查
	var emp models.Employee
	if err := models.DB.Where("wecom_userid = ?", userID).First(&emp).Error; err == nil {
		return emp.Name
	}

	return userID // 兜底返回 UserID
}

// getWorkGroupChatIDs 获取系统管理的所有工作群 chat_id
func getWorkGroupChatIDs() map[string]bool {
	ids := make(map[string]bool)

	// 从 WecomGroupChat 表获取所有活跃群聊
	var groups []models.WecomGroupChat
	models.DB.Where("status = ?", "active").Find(&groups)
	for _, g := range groups {
		ids[g.ChatID] = true
	}

	// 从 Order 表获取所有有群聊 ID 的订单
	var orders []models.Order
	models.DB.Where("wecom_chat_id != ''").Select("wecom_chat_id").Find(&orders)
	for _, o := range orders {
		ids[o.WecomChatID] = true
	}

	return ids
}

// SaveArchiveMediaFile 将媒体数据保存到本地文件
// 返回 uploads/archive/YYYY-MM/filename 格式的相对路径
func SaveArchiveMediaFile(data []byte, fileExt string) (string, error) {
	monthDir := time.Now().Format("2006-01")
	dir := filepath.Join("uploads", "archive", monthDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("创建存档目录失败: %w", err)
	}

	filename := fmt.Sprintf("%d%s", time.Now().UnixNano(), fileExt)
	fullPath := filepath.Join(dir, filename)

	if err := os.WriteFile(fullPath, data, 0o644); err != nil {
		return "", fmt.Errorf("写入存档文件失败: %w", err)
	}

	return fullPath, nil
}
