package config

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"strconv"
	"strings"
)

// Config 全局配置
type Config struct {
	// 数据库
	DBType     string // "sqlite" | "postgres"
	DBPath     string // 仅 sqlite 用
	PGHost     string
	PGPort     string
	PGUser     string
	PGPassword string
	PGDBName   string
	PGSSLMode  string

	// 企业微信
	WecomCorpID            string
	WecomCorpSecret        string
	WecomAgentID           int
	WecomDefaultNotifyIDs  []string
	WecomToken             string // 回调 Token (用于签名验证)
	WecomEncodingAESKey    string // 回调 EncodingAESKey (用于消息解密)
	WecomContactSecret     string // 客户联系 Secret（与应用 Secret 不同）

	// OCR / AI Vision
	OCRProvider    string // "zhipu" | "dashscope"
	ZhipuAPIKey    string
	DashscopeAPIKey string

	// Auth
	JWTSecretKey         string
	JWTExpireMinutes     int
	AdminDefaultUsername string
	AdminDefaultPassword string

	// CORS
	CORSOrigins []string

	// 派单
	GrabOrderTimeoutSeconds int

	// 分润配置 (百分比，0-100)
	PlatformFeeRate        int // 平台扣点 (如 PDD 抽佣)
	DesignerCommissionRate  int // 设计师抽成
	SalesCommissionRate     int // 谈单客服提成
	FollowCommissionRate    int // 跟单客服提成

	// Server
	ServerPort string
	BaseURL    string // 部署域名 (如 https://pdd.example.com)

	// OSS 云存储
	OSSProvider  string // "local" | "aliyun" | "s3"
	OSSEndpoint  string
	OSSAccessKey string
	OSSSecretKey string
	OSSBucket    string
	OSSRegion    string
	OSSBaseURL   string // 公网访问前缀 (CDN 或直连)

	// Deploy
	DeployMode string // "debug" | "production"

	// Security
	AdminAllowedIPs []string // IP 白名单 (逗号分隔), 空则不限制

	// 自动化 Agent
	AutoAddAgentToken string // Agent 认证 Token
	AutoAddDailyLimit int    // 每日自动添加上限 (防风控)
}

var C *Config

func Init() {
	C = &Config{
		DBType:                  getEnv("DB_TYPE", "sqlite"),
		DBPath:                  getEnv("DB_PATH", "./data/pdd_order.db"),
		PGHost:                  getEnv("PG_HOST", "localhost"),
		PGPort:                  getEnv("PG_PORT", "5432"),
		PGUser:                  getEnv("PG_USER", "pdd_user"),
		PGPassword:              getEnv("PG_PASSWORD", ""),
		PGDBName:                getEnv("PG_DBNAME", "pdd_order"),
		PGSSLMode:               getEnv("PG_SSLMODE", "require"),
		WecomCorpID:             getEnv("WECOM_CORP_ID", ""),
		WecomCorpSecret:         getEnv("WECOM_CORP_SECRET", ""),
		WecomAgentID:            getEnvInt("WECOM_AGENT_ID", 0),
		WecomDefaultNotifyIDs:   splitCSV(getEnv("WECOM_DEFAULT_NOTIFY_IDS", "")),
		WecomToken:              getEnv("WECOM_TOKEN", ""),
		WecomEncodingAESKey:     getEnv("WECOM_ENCODING_AES_KEY", ""),
		WecomContactSecret:     getEnv("WECOM_CONTACT_SECRET", ""),
		OCRProvider:             getEnv("OCR_PROVIDER", "zhipu"),
		ZhipuAPIKey:             getEnv("ZHIPU_API_KEY", ""),
		DashscopeAPIKey:         getEnv("DASHSCOPE_API_KEY", ""),
		JWTSecretKey:            getEnv("JWT_SECRET_KEY", ""),
		JWTExpireMinutes:        getEnvInt("JWT_EXPIRE_MINUTES", 1440),
		AdminDefaultUsername:    getEnv("ADMIN_DEFAULT_USERNAME", "admin"),
		AdminDefaultPassword:    getEnv("ADMIN_DEFAULT_PASSWORD", ""),
		CORSOrigins:             splitCSV(getEnv("CORS_ORIGINS", "http://localhost:8200")),
		GrabOrderTimeoutSeconds: getEnvInt("GRAB_ORDER_TIMEOUT_SECONDS", 300),
		PlatformFeeRate:         getEnvInt("PLATFORM_FEE_RATE", 30),
		DesignerCommissionRate:  getEnvInt("DESIGNER_COMMISSION_RATE", 25),
		SalesCommissionRate:     getEnvInt("SALES_COMMISSION_RATE", 10),
		FollowCommissionRate:    getEnvInt("FOLLOW_COMMISSION_RATE", 5),
		ServerPort:              getEnv("SERVER_PORT", "8201"),
		BaseURL:                 getEnv("BASE_URL", "http://localhost:8200"),
		OSSProvider:             getEnv("OSS_PROVIDER", "local"),
		OSSEndpoint:             getEnv("OSS_ENDPOINT", ""),
		OSSAccessKey:            getEnv("OSS_ACCESS_KEY", ""),
		OSSSecretKey:            getEnv("OSS_SECRET_KEY", ""),
		OSSBucket:               getEnv("OSS_BUCKET", ""),
		OSSRegion:               getEnv("OSS_REGION", ""),
		OSSBaseURL:              getEnv("OSS_BASE_URL", ""),
		DeployMode:              getEnv("DEPLOY_MODE", "debug"),
		AdminAllowedIPs:         splitCSV(getEnv("ADMIN_ALLOWED_IPS", "")),
		AutoAddAgentToken:       getEnv("AUTO_ADD_AGENT_TOKEN", ""),
		AutoAddDailyLimit:       getEnvInt("AUTO_ADD_DAILY_LIMIT", 30),
	}

	// 🔒 安全校验: JWT 密钥
	if C.JWTSecretKey == "" {
		if C.DeployMode != "debug" {
			log.Fatal("FATAL: JWT_SECRET_KEY is not set. In production you MUST provide a strong secret via environment variable.")
		}
		// debug 模式: 动态生成随机密钥，每次启动不同
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("FATAL: failed to generate random JWT secret: %v", err)
		}
		C.JWTSecretKey = hex.EncodeToString(b)
		log.Println("WARNING: JWT_SECRET_KEY not set, using auto-generated random secret (debug mode only, will change on restart)")
	}

	// 🔒 安全校验: PG 密码
	if C.DBType == "postgres" && C.PGPassword == "" {
		log.Fatal("FATAL: PG_PASSWORD is not set. PostgreSQL requires a password.")
	}

	// 🔒 安全校验: 管理员默认密码不能为空或弱密码
	if C.AdminDefaultPassword == "" && C.DeployMode != "debug" {
		log.Fatal("❌ 安全错误: 生产环境必须设置 ADMIN_DEFAULT_PASSWORD！")
	} else if C.AdminDefaultPassword == "" {
		// debug 模式也生成随机密码，防止硬编码弱密码被利用
		pwdBytes := make([]byte, 12)
		if _, err := rand.Read(pwdBytes); err != nil {
			log.Fatalf("FATAL: failed to generate random admin password: %v", err)
		}
		C.AdminDefaultPassword = hex.EncodeToString(pwdBytes)[:16]
		log.Printf("⚠️  警告: ADMIN_DEFAULT_PASSWORD 未设置，已生成随机密码: %s (仅本次启动有效，请立即记录！)", C.AdminDefaultPassword)
	}

	log.Printf("✅ 配置加载完成 | DBType=%s | 企微=%v | OCR=%s | MODE=%s", C.DBType, C.WecomCorpID != "", C.OCRProvider, C.DeployMode)

	// 分润费率范围校验 (0-100)
	validateRate := func(name string, val int) {
		if val < 0 || val > 100 {
			log.Fatalf("❌ 配置错误: %s 必须在 0-100 之间，当前值: %d", name, val)
		}
	}
	validateRate("PLATFORM_FEE_RATE", C.PlatformFeeRate)
	validateRate("DESIGNER_COMMISSION_RATE", C.DesignerCommissionRate)
	validateRate("SALES_COMMISSION_RATE", C.SalesCommissionRate)
	validateRate("FOLLOW_COMMISSION_RATE", C.FollowCommissionRate)

	totalRate := C.PlatformFeeRate + C.DesignerCommissionRate + C.SalesCommissionRate + C.FollowCommissionRate
	if totalRate > 100 {
		log.Printf("⚠️ 警告: 分润费率总和 (%d%%) 超过 100%%，净利润将为负", totalRate)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}
