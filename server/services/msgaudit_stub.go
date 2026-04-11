//go:build !linux

package services

import "log"

// stubMsgAuditPoller macOS/Windows 下的空实现
// Finance SDK 的 C 动态库仅支持 Linux amd64，非 Linux 环境无法使用
type stubMsgAuditPoller struct{}

func newMsgAuditPoller() MsgAuditPoller {
	return &stubMsgAuditPoller{}
}

func (s *stubMsgAuditPoller) Init(corpID, secret, privateKey string) error {
	log.Println("⚠️  会话存档 SDK 不支持当前平台 (仅 Linux amd64)，使用 stub 模式")
	return nil
}

func (s *stubMsgAuditPoller) FetchMessages(lastSeq uint64, limit int) ([]RawArchiveMsg, uint64, error) {
	// stub: 永远返回空列表
	return nil, lastSeq, nil
}

func (s *stubMsgAuditPoller) DownloadMedia(sdkFileID, fileExt string) (string, error) {
	return "", nil
}
