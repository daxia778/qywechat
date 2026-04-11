package models

import "time"

// ─── 会话存档数据模型 ──────────────────────────────────

// ChatArchiveMessage 企微会话存档消息
// 通过 Finance API 拉取并解密后的消息记录，仅保留工作群消息
// 80 天后自动清理
type ChatArchiveMessage struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	Seq        uint64    `gorm:"column:seq;index" json:"seq"`                                    // Finance API 拉取游标
	MsgID      string    `gorm:"column:msg_id;uniqueIndex;size:128" json:"msg_id"`               // 企微消息唯一 ID
	ChatID     string    `gorm:"column:chat_id;size:128;index:idx_archive_chat_msgtime" json:"chat_id"` // 群聊 roomid
	SenderID   string    `gorm:"column:sender_id;size:64;index" json:"sender_id"`                // 发送人 UserID
	SenderName string    `gorm:"column:sender_name;size:64" json:"sender_name"`                  // 发送人姓名 (冗余)
	MsgType    string    `gorm:"column:msg_type;size:32" json:"msg_type"`                        // text / image / voice / video / file / mixed 等
	Content    string    `gorm:"column:content;type:text" json:"content"`                        // 文本内容 或 JSON 结构化
	MediaURL   string    `gorm:"column:media_url;type:text" json:"media_url,omitempty"`          // 下载后的本地图片/文件路径
	MsgTime    time.Time `gorm:"column:msg_time;index:idx_archive_chat_msgtime" json:"msg_time"` // 消息发送时间
	CreatedAt  time.Time `gorm:"index" json:"created_at"`                                        // 入库时间
}

// ChatArchiveCursor 会话存档拉取游标
// 记录上次拉取的最大 seq，保证重启后断点续传
// 整个表只有一行 (id=1)
type ChatArchiveCursor struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	LastSeq   uint64    `gorm:"column:last_seq;default:0" json:"last_seq"` // 上次拉取的最大 seq
	UpdatedAt time.Time `json:"updated_at"`
}
