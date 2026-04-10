package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"sort"
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

// StartCSRFCleanup 启动后台协程，定期清理过期 CSRF token（替代 init() goroutine）
func StartCSRFCleanup(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("CSRF token 清理协程已停止")
				return
			case <-ticker.C:
				csrf.mu.Lock()
				now := time.Now()
				for k, v := range csrf.tokens {
					if now.Sub(v) > 30*time.Minute {
						delete(csrf.tokens, k)
					}
				}
				csrf.mu.Unlock()
			}
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
// Token 在有效期内可多次使用（不再一次性消耗）
func CSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 跳过不需要 CSRF 保护的路径
		path := c.Request.URL.Path
		// API 回调、公开端点、设备登录、桌面端接口不需要 CSRF
		if path == "/api/v1/wecom/callback" ||
			path == "/api/v1/auth/device_login" ||
			path == "/api/v1/auth/admin_login" ||
			path == "/api/v1/auth/login" ||
			path == "/api/v1/app/version" ||
			path == "/api/v1/orders/upload_ocr" ||
			path == "/api/v1/orders/upload_attachment" ||
			path == "/api/v1/orders/parse_text" ||
			path == "/api/v1/orders/create" ||
			path == "/health" {
			c.Next()
			return
		}

		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			// 生成新 token 并返回在响应头
			token := generateCSRFToken()
			csrf.mu.Lock()
			// 防止内存耗尽: 如果 token 数量超过上限，清理最旧的 token
			const maxCSRFTokens = 10000
			if len(csrf.tokens) >= maxCSRFTokens {
				// 删除所有过期 token
				now := time.Now()
				for k, v := range csrf.tokens {
					if now.Sub(v) > 30*time.Minute {
						delete(csrf.tokens, k)
					}
				}
				// 仍超限时，淘汰最旧的 50% 而非全部清空
				if len(csrf.tokens) >= maxCSRFTokens {
					type entry struct {
						key string
						ts  time.Time
					}
					entries := make([]entry, 0, len(csrf.tokens))
					for k, v := range csrf.tokens {
						entries = append(entries, entry{k, v})
					}
					// 按时间升序排序（最旧的在前）
					sort.Slice(entries, func(i, j int) bool {
						return entries[i].ts.Before(entries[j].ts)
					})
					// 淘汰前 50%
					evictCount := len(entries) / 2
					for i := 0; i < evictCount; i++ {
						delete(csrf.tokens, entries[i].key)
					}
				}
			}
			csrf.tokens[token] = time.Now()
			csrf.mu.Unlock()
			c.Header("X-CSRF-Token", token)
			c.Next()
			return
		}

		// 写操作: 验证 CSRF token（可复用，不消耗）
		token := c.GetHeader("X-CSRF-Token")
		if token == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Missing CSRF token"})
			c.Abort()
			return
		}

		csrf.mu.RLock()
		created, exists := csrf.tokens[token]
		expired := !exists || time.Since(created) > 30*time.Minute
		csrf.mu.RUnlock()

		if expired {
			c.JSON(http.StatusForbidden, gin.H{"error": "Invalid or expired CSRF token"})
			c.Abort()
			return
		}

		c.Next()
	}
}
