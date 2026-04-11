//go:build linux

package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	wxfinance "github.com/NICEXAI/WeWorkFinanceSDK"
)

// linuxMsgAuditPoller Linux 下使用真实 Finance SDK 实现
type linuxMsgAuditPoller struct {
	client     *wxfinance.Client
	privateKey string
}

func newMsgAuditPoller() MsgAuditPoller {
	return &linuxMsgAuditPoller{}
}

func (p *linuxMsgAuditPoller) Init(corpID, secret, privateKey string) error {
	// 处理私钥中的转义换行符
	privateKey = strings.ReplaceAll(privateKey, "\\n", "\n")

	client, err := wxfinance.NewClient(corpID, secret, privateKey)
	if err != nil {
		return fmt.Errorf("Finance SDK 初始化失败: %w", err)
	}

	p.client = client
	p.privateKey = privateKey
	log.Println("✅ Finance SDK 初始化成功 (Linux)")
	return nil
}

func (p *linuxMsgAuditPoller) FetchMessages(lastSeq uint64, limit int) ([]RawArchiveMsg, uint64, error) {
	if p.client == nil {
		return nil, lastSeq, fmt.Errorf("Finance SDK 未初始化")
	}

	// 拉取加密消息
	chatDatas, err := p.client.GetChatData(lastSeq, uint32(limit), "", "", 30)
	if err != nil {
		return nil, lastSeq, fmt.Errorf("GetChatData 失败: %w", err)
	}

	if len(chatDatas) == 0 {
		return nil, lastSeq, nil
	}

	var result []RawArchiveMsg
	var maxSeq uint64 = lastSeq

	for _, chatData := range chatDatas {
		// 解密消息
		decrypted, err := p.client.DecryptData(chatData.EncryptRandomKey, chatData.EncryptChatMsg)
		if err != nil {
			log.Printf("⚠️ 会话存档消息解密失败: seq=%d err=%v", chatData.Seq, err)
			continue
		}

		// 解析 JSON
		var msg RawArchiveMsg
		if err := json.Unmarshal(decrypted, &msg); err != nil {
			log.Printf("⚠️ 会话存档消息JSON解析失败: seq=%d err=%v", chatData.Seq, err)
			continue
		}
		msg.Seq = chatData.Seq
		msg.RawJSON = string(decrypted)

		result = append(result, msg)

		if chatData.Seq > maxSeq {
			maxSeq = chatData.Seq
		}
	}

	return result, maxSeq, nil
}

func (p *linuxMsgAuditPoller) DownloadMedia(sdkFileID, fileExt string) (string, error) {
	if p.client == nil {
		return "", fmt.Errorf("Finance SDK 未初始化")
	}

	var buf bytes.Buffer
	if err := p.client.GetMediaData("", "", sdkFileID, "", "", 30, &buf); err != nil {
		return "", fmt.Errorf("GetMediaData 失败: %w", err)
	}

	// 保存到本地
	localPath, err := SaveArchiveMediaFile(buf.Bytes(), fileExt)
	if err != nil {
		return "", err
	}

	return localPath, nil
}
