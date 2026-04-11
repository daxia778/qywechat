package handlers

import (
	"bytes"
	"crypto/sha1"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"pdd-order-system/config"
	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"
)

// setupWecomTestEnv 初始化测试环境（内存 SQLite + 测试 Gin Engine）
func setupWecomTestEnv(t *testing.T) *gin.Engine {
	t.Helper()

	config.C = &config.Config{
		DBType:              "sqlite",
		DBPath:              ":memory:",
		WecomToken:          "test_token",
		WecomEncodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
		WecomCorpID:         "test_corpid",
		WecomContactSecret:  "test_contact_secret",
	}
	models.InitDB()
	services.InitWecom()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Any("/wecom/callback", WecomCallback)
	return r
}

// encryptHelper 封装加密并返回加密消息和 URL 参数
func encryptHelper(t *testing.T, plaintext, timestamp, nonce string) ([]byte, string) {
	t.Helper()

	wxcpt := middleware.NewWXBizMsgCrypt(
		config.C.WecomToken,
		config.C.WecomEncodingAESKey,
		config.C.WecomCorpID,
		middleware.XmlType,
	)

	encryptedBytes, cryptErr := wxcpt.EncryptMsg(plaintext, timestamp, nonce)
	if cryptErr != nil {
		t.Fatalf("EncryptMsg failed: code=%d msg=%s", cryptErr.ErrCode, cryptErr.ErrMsg)
	}

	// 从加密结果中提取 MsgSignature
	var envelope struct {
		Encrypt      string `xml:"Encrypt"`
		MsgSignature string `xml:"MsgSignature"`
		TimeStamp    string `xml:"TimeStamp"`
		Nonce        string `xml:"Nonce"`
	}
	if err := xml.Unmarshal(encryptedBytes, &envelope); err != nil {
		t.Fatalf("failed to parse encrypted envelope: %v", err)
	}

	urlParams := fmt.Sprintf("msg_signature=%s&timestamp=%s&nonce=%s",
		envelope.MsgSignature, envelope.TimeStamp, envelope.Nonce)

	return encryptedBytes, urlParams
}

// ─── TestWecomCallback_VerifyURL ──────────────────────────
func TestWecomCallback_VerifyURL(t *testing.T) {
	r := setupWecomTestEnv(t)

	wxcpt := middleware.NewWXBizMsgCrypt(
		config.C.WecomToken,
		config.C.WecomEncodingAESKey,
		config.C.WecomCorpID,
		middleware.XmlType,
	)

	echoStr := "hello_wecom_verify"
	timestamp := "1234567890"
	nonce := "nonce123"

	// EncryptMsg 把 echoStr 加密，返回 XML 包含 Encrypt
	encryptedBytes, cryptErr := wxcpt.EncryptMsg(echoStr, timestamp, nonce)
	if cryptErr != nil {
		t.Fatalf("EncryptMsg failed: code=%d msg=%s", cryptErr.ErrCode, cryptErr.ErrMsg)
	}

	var envelope struct {
		Encrypt      string `xml:"Encrypt"`
		MsgSignature string `xml:"MsgSignature"`
	}
	xml.Unmarshal(encryptedBytes, &envelope)

	// VerifyURL uses the raw encrypted string as echostr, and its signature uses that exact string
	// We need to compute the raw signature for the URL validation manually because calSignature is private.
	sort_arr := []string{config.C.WecomToken, timestamp, nonce, envelope.Encrypt}
	sort.Strings(sort_arr)
	var buffer bytes.Buffer
	for _, value := range sort_arr {
		buffer.WriteString(value)
	}
	sha := sha1.New()
	sha.Write(buffer.Bytes())
	rawSignature := fmt.Sprintf("%x", sha.Sum(nil))

	// GET 请求 — URL 验证模式，注意参数需 URL 编码（尤其是 echostr 含有 base64 的 + 和 =）
	urlStr := fmt.Sprintf("/wecom/callback?msg_signature=%s&timestamp=%s&nonce=%s&echostr=%s",
		rawSignature, timestamp, nonce, url.QueryEscape(envelope.Encrypt))

	req, _ := http.NewRequest("GET", urlStr, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, echoStr, w.Body.String())
}

// ─── TestWecomCallback_InvalidSignatureRejected ──────────
func TestWecomCallback_InvalidSignatureRejected(t *testing.T) {
	r := setupWecomTestEnv(t)

	// 发送一个伪造签名的 GET 验证请求
	url := "/wecom/callback?msg_signature=bad_sig&timestamp=123&nonce=abc&echostr=fake_data"
	req, _ := http.NewRequest("GET", url, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "verify url failed")
}

// ─── TestWecomCallback_InboundGroupMessage ───────────────
func TestWecomCallback_InboundGroupMessage(t *testing.T) {
	r := setupWecomTestEnv(t)

	// 预置一个带有 wecom_chat_id 的订单
	models.DB.Create(&models.Order{
		OrderSN:     "PPT-TEST-001",
		WecomChatID: "chat_test_001",
		Status:      "PENDING",
		OperatorID:  "staff_test",
	})

	rawMsg := `<xml>
		<ToUserName><![CDATA[toUser]]></ToUserName>
		<FromUserName><![CDATA[user_sender_1]]></FromUserName>
		<CreateTime>1700000000</CreateTime>
		<MsgType><![CDATA[text]]></MsgType>
		<Content><![CDATA[这个设计要怎么修改？]]></Content>
		<MsgId>msg_inbound_001</MsgId>
		<ChatId><![CDATA[chat_test_001]]></ChatId>
	</xml>`

	encryptedBody, urlParams := encryptHelper(t, rawMsg, "1700000000", "nonce_inbound")

	req, _ := http.NewRequest("POST", "/wecom/callback?"+urlParams, bytes.NewBuffer(encryptedBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", w.Body.String())

	// 验证入站消息日志已写入
	var logRecord models.WecomMessageLog
	result := models.DB.Where("chat_id = ? AND direction = ?", "chat_test_001", "in").First(&logRecord)
	assert.NoError(t, result.Error, "should find inbound message log")
	assert.Equal(t, "PPT-TEST-001", logRecord.OrderSN)
	assert.Equal(t, "这个设计要怎么修改？", logRecord.Content)
	assert.Equal(t, "user_sender_1", logRecord.SenderID)
}

// ─── TestWecomCallback_AddExternalContact ────────────────
func TestWecomCallback_AddExternalContact(t *testing.T) {
	r := setupWecomTestEnv(t)

	// 预置花名册中已有一个设计师（通过 ExternalUserID 精确匹配）
	models.DB.Create(&models.FreelanceDesigner{
		Name:           "李四设计师",
		ExternalUserID: "ex_designer_existing",
	})

	// 预置一位跟单客服
	models.DB.Create(&models.Employee{
		WecomUserID: "staff_follow_001",
		Name:        "跟单小王",
		Role:        "follow",
		Username:    "wang_follow",
	})

	rawMsg := `<xml>
		<ToUserName><![CDATA[test_corpid]]></ToUserName>
		<FromUserName><![CDATA[sys]]></FromUserName>
		<CreateTime>1700000001</CreateTime>
		<MsgType><![CDATA[event]]></MsgType>
		<Event><![CDATA[change_external_contact]]></Event>
		<ChangeType><![CDATA[add_external_contact]]></ChangeType>
		<UserID><![CDATA[staff_follow_001]]></UserID>
		<ExternalUserID><![CDATA[ex_designer_existing]]></ExternalUserID>
		<State><![CDATA[test_state]]></State>
	</xml>`

	encryptedBody, urlParams := encryptHelper(t, rawMsg, "1700000001", "nonce_event")

	req, _ := http.NewRequest("POST", "/wecom/callback?"+urlParams, bytes.NewBuffer(encryptedBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", w.Body.String())

	// 验证 handleAddExternalContact 被执行
	// 由于 services.Wecom 未初始化，不会走到 GetExternalContactDetail，但不应 panic
}

// ─── TestWecomCallback_AutoMatchSingleOrder ──────────────
func TestWecomCallback_AutoMatchSingleOrder(t *testing.T) {
	r := setupWecomTestEnv(t)

	// 预置一个跟单客服员工
	models.DB.Create(&models.Employee{
		WecomUserID: "staff_auto_match",
		Name:        "自动匹配测试员工",
		Role:        "follow",
		Username:    "auto_match",
	})

	// 预置一个 PENDING 订单关联到该客服
	models.DB.Create(&models.Order{
		OrderSN:          "PPT-AUTO-001",
		Status:           "PENDING",
		OperatorID:       "staff_auto_match",
		FollowOperatorID: "staff_auto_match",
	})

	// 模拟添加一个新外部联系人（不在设计师花名册中 → 应判定为客户）
	rawMsg := `<xml>
		<ToUserName><![CDATA[test_corpid]]></ToUserName>
		<FromUserName><![CDATA[sys]]></FromUserName>
		<CreateTime>1700000002</CreateTime>
		<MsgType><![CDATA[event]]></MsgType>
		<Event><![CDATA[change_external_contact]]></Event>
		<ChangeType><![CDATA[add_external_contact]]></ChangeType>
		<UserID><![CDATA[staff_auto_match]]></UserID>
		<ExternalUserID><![CDATA[ex_new_customer_001]]></ExternalUserID>
		<State><![CDATA[auto_test]]></State>
	</xml>`

	encryptedBody, urlParams := encryptHelper(t, rawMsg, "1700000002", "nonce_auto")

	req, _ := http.NewRequest("POST", "/wecom/callback?"+urlParams, bytes.NewBuffer(encryptedBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", w.Body.String())

	// 验证不应该 panic，即使 services.Wecom 未初始化
}
