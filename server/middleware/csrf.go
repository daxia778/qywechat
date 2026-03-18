package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// CSRFToken 存储
type csrfStore struct {
	mu     sync.RWMutex
	tokens map[string]time.Time
}

var csrf = &csrfStore{tokens: make(map[string]time.Time)}

func init() {
	// 每 10 分钟清理过期 CSRF token
	go func() {
		for {
			time.Sleep(10 * time.Minute)
			csrf.mu.Lock()
			now := time.Now()
			for k, v := range csrf.tokens {
				if now.Sub(v) > 30*time.Minute {
					delete(csrf.tokens, k)
				}
			}
			csrf.mu.Unlock()
		}
	}()
}

func generateCSRFToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// CSRFMiddleware CSRF Token 防护中间件
// GET 请求会在响应头 X-CSRF-Token 中返回新 token
// POST/PUT/DELETE 请求需要在请求头 X-CSRF-Token 中携带有效 token
func CSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 跳过不需要 CSRF 保护的路径
		path := c.Request.URL.Path
		// API 回调、公开端点、设备登录、桌面端接口不需要 CSRF
		if path == "/api/v1/wecom/callback" ||
			path == "/api/v1/auth/device_login" ||
			path == "/api/v1/auth/admin_login" ||
			path == "/api/v1/app/version" ||
			path == "/api/v1/orders/upload_ocr" ||
			path == "/api/v1/orders/create" ||
			path == "/health" {
			c.Next()
			return
		}

		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			// 生成新 token 并返回在响应头
			token := generateCSRFToken()
			csrf.mu.Lock()
			csrf.tokens[token] = time.Now()
			csrf.mu.Unlock()
			c.Header("X-CSRF-Token", token)
			c.Next()
			return
		}

		// 写操作: 验证 CSRF token
		token := c.GetHeader("X-CSRF-Token")
		if token == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Missing CSRF token"})
			c.Abort()
			return
		}

		// 原子化 check-and-delete，防止 TOCTOU 竞态条件
		csrf.mu.Lock()
		created, exists := csrf.tokens[token]
		if !exists || time.Since(created) > 30*time.Minute {
			csrf.mu.Unlock()
			c.JSON(http.StatusForbidden, gin.H{"error": "Invalid or expired CSRF token"})
			c.Abort()
			return
		}
		delete(csrf.tokens, token)
		csrf.mu.Unlock()

		c.Next()
	}
}
