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
	DBPath string

	// 企业微信
	WecomCorpID            string
	WecomCorpSecret        string
	WecomAgentID           int
	WecomDefaultNotifyIDs  []string

	// OCR / AI Vision
	OCRProvider    string // "zhipu" | "dashscope"
	ZhipuAPIKey    string
	DashscopeAPIKey string

	// Auth
	JWTSecretKey     string
	JWTExpireMinutes int

	// CORS
	CORSOrigins []string

	// 派单
	GrabOrderTimeoutSeconds int

	// Server
	ServerPort string
}

var C *Config

func Init() {
	C = &Config{
		DBPath:                  getEnv("DB_PATH", "./data/pdd_order.db"),
		WecomCorpID:             getEnv("WECOM_CORP_ID", ""),
		WecomCorpSecret:         getEnv("WECOM_CORP_SECRET", ""),
		WecomAgentID:            getEnvInt("WECOM_AGENT_ID", 0),
		WecomDefaultNotifyIDs:   splitCSV(getEnv("WECOM_DEFAULT_NOTIFY_IDS", "")),
		OCRProvider:             getEnv("OCR_PROVIDER", "zhipu"),
		ZhipuAPIKey:             getEnv("ZHIPU_API_KEY", ""),
		DashscopeAPIKey:         getEnv("DASHSCOPE_API_KEY", ""),
		JWTSecretKey:            getEnv("JWT_SECRET_KEY", "dev-secret-change-in-prod"),
		JWTExpireMinutes:        getEnvInt("JWT_EXPIRE_MINUTES", 1440),
		CORSOrigins:             splitCSV(getEnv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")),
		GrabOrderTimeoutSeconds: getEnvInt("GRAB_ORDER_TIMEOUT_SECONDS", 600),
		ServerPort:              getEnv("SERVER_PORT", "8200"),
	}

	if C.JWTSecretKey == "dev-secret-change-in-prod" {
		log.Println("⚠️  警告: JWT_SECRET_KEY 使用默认值，请在 .env 中配置！")
	}

	log.Printf("✅ 配置加载完成 | DB=%s | 企微=%v | OCR=%s", C.DBPath, C.WecomCorpID != "", C.OCRProvider)
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
