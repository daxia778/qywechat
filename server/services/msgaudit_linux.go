//go:build linux

package services

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	wxfinance "github.com/NICEXAI/WeWorkFinanceSDK"
)

// linuxMsgAuditPoller Linux 下使用真实 Finance SDK 实现
type linuxMsgAuditPoller struct {
	client     wxfinance.Client
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

	// 拉取加密消息 (v1.3.0 API: seq uint64, limit uint64, proxy, passwd string, timeout int)
	chatDatas, err := p.client.GetChatData(lastSeq, uint64(limit), "", "", 30)
	if err != nil {
		return nil, lastSeq, fmt.Errorf("GetChatData 失败: %w", err)
	}

	if len(chatDatas) == 0 {
		return nil, lastSeq, nil
	}

	var result []RawArchiveMsg
	var maxSeq uint64 = lastSeq

	for _, chatData := range chatDatas {
		// 解密消息 (v1.3.0 API: encryptRandomKey, encryptMsg, specificPrivateKey string)
		chatMsg, err := p.client.DecryptData(chatData.EncryptRandomKey, chatData.EncryptChatMsg, p.privateKey)
		if err != nil {
			log.Printf("⚠️ 会话存档消息解密失败: seq=%d err=%v", chatData.Seq, err)
			continue
		}

		// ChatMessage 结构体转 JSON 再解析为 RawArchiveMsg
		jsonBytes, err := json.Marshal(chatMsg)
		if err != nil {
			log.Printf("⚠️ 会话存档消息序列化失败: seq=%d err=%v", chatData.Seq, err)
			continue
		}

		var msg RawArchiveMsg
		if err := json.Unmarshal(jsonBytes, &msg); err != nil {
			log.Printf("⚠️ 会话存档消息JSON解析失败: seq=%d err=%v", chatData.Seq, err)
			continue
		}
		msg.Seq = chatData.Seq
		msg.RawJSON = string(jsonBytes)

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

	// v1.3.0 API: GetMediaData(indexBuf, sdkFileId, proxy, passwd string, timeout int) (*MediaData, error)
	// 需要循环拉取直到 IsFinish
	var allData []byte
	indexBuf := ""

	for {
		mediaData, err := p.client.GetMediaData(indexBuf, sdkFileID, "", "", 30)
		if err != nil {
			return "", fmt.Errorf("GetMediaData 失败: %w", err)
		}

		allData = append(allData, mediaData.Data...)

		if mediaData.IsFinish {
			break
		}
		indexBuf = mediaData.OutIndexBuf
	}

	// 保存到本地
	localPath, err := SaveArchiveMediaFile(allData, fileExt)
	if err != nil {
		return "", err
	}

	return localPath, nil
}
