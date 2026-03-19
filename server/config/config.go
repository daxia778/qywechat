package config

import (
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
	PlatformFeeRate       int // 平台扣点 (如 PDD 抽佣)
	DesignerCommissionRate int // 设计师抽成
	OperatorCommissionRate int // 客服提成

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
}

var C *Config

func Init() {
	C = &Config{
		DBType:                  getEnv("DB_TYPE", "sqlite"),
		DBPath:                  getEnv("DB_PATH", "./data/pdd_order.db"),
		PGHost:                  getEnv("PG_HOST", "localhost"),
		PGPort:                  getEnv("PG_PORT", "5432"),
		PGUser:                  getEnv("PG_USER", "pdd_user"),
		PGPassword:              getEnv("PG_PASSWORD", "pdd_password"),
		PGDBName:                getEnv("PG_DBNAME", "pdd_order"),
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
		JWTSecretKey:            getEnv("JWT_SECRET_KEY", "dev-secret-change-in-prod"),
		JWTExpireMinutes:        getEnvInt("JWT_EXPIRE_MINUTES", 1440),
		AdminDefaultUsername:    getEnv("ADMIN_DEFAULT_USERNAME", "admin"),
		AdminDefaultPassword:    getEnv("ADMIN_DEFAULT_PASSWORD", ""),
		CORSOrigins:             splitCSV(getEnv("CORS_ORIGINS", "http://localhost:8200")),
		GrabOrderTimeoutSeconds: getEnvInt("GRAB_ORDER_TIMEOUT_SECONDS", 300),
		PlatformFeeRate:         getEnvInt("PLATFORM_FEE_RATE", 5),
		DesignerCommissionRate:  getEnvInt("DESIGNER_COMMISSION_RATE", 50),
		OperatorCommissionRate:  getEnvInt("OPERATOR_COMMISSION_RATE", 10),
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
	}

	// 🔒 安全校验: 非 debug 模式下禁止使用默认 JWT 密钥
	if C.DeployMode != "debug" && C.JWTSecretKey == "dev-secret-change-in-prod" {
		log.Fatal("❌ 安全错误: 生产环境禁止使用默认 JWT_SECRET_KEY！请在 .env 中设置高强度的随机字符串。")
	} else if C.JWTSecretKey == "dev-secret-change-in-prod" {
		log.Println("⚠️  警告: JWT_SECRET_KEY 使用默认值 (仅允许 debug 模式)")
	}

	// 🔒 安全校验: 管理员默认密码不能为空或弱密码
	if C.AdminDefaultPassword == "" && C.DeployMode != "debug" {
		log.Fatal("❌ 安全错误: 生产环境必须设置 ADMIN_DEFAULT_PASSWORD！")
	} else if C.AdminDefaultPassword == "" {
		C.AdminDefaultPassword = "Admin123!"
		log.Println("⚠️  警告: ADMIN_DEFAULT_PASSWORD 未设置，使用临时默认值 (仅允许 debug 模式)")
	}

	log.Printf("✅ 配置加载完成 | DBType=%s | 企微=%v | OCR=%s | MODE=%s", C.DBType, C.WecomCorpID != "", C.OCRProvider, C.DeployMode)
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
