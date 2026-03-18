package middleware

import (
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── 暴力破解防护 (Fail2Ban 思想) ─────────────────────────

type failRecord struct {
	Count    int
	FirstAt  time.Time
	LockedAt time.Time
}

var (
	failMap    = make(map[string]*failRecord) // key = IP
	failMu     sync.Mutex
	maxFails   = 10                      // 触发封锁的失败次数
	failWindow = 10 * time.Minute        // 记录窗口
	lockDur    = 30 * time.Minute        // 封锁时长
)

func init() {
	// 后台定期清理过期的封锁记录
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			failMu.Lock()
			for ip, r := range failMap {
				if time.Since(r.FirstAt) > failWindow+lockDur {
					delete(failMap, ip)
				}
			}
			failMu.Unlock()
		}
	}()
}

// RecordLoginFail 记录一次登录失败 (由 handler 主动调用)
func RecordLoginFail(ip string) {
	failMu.Lock()
	defer failMu.Unlock()

	r, ok := failMap[ip]
	if !ok {
		failMap[ip] = &failRecord{Count: 1, FirstAt: time.Now()}
		return
	}

	// 窗口过期则重置
	if time.Since(r.FirstAt) > failWindow {
		r.Count = 1
		r.FirstAt = time.Now()
		r.LockedAt = time.Time{}
		return
	}

	r.Count++
	if r.Count >= maxFails {
		r.LockedAt = time.Now()
		log.Printf("🚨 安全告警: IP %s 在 %v 内登录失败 %d 次，已被封锁 %v", ip, failWindow, r.Count, lockDur)
	}
}

// BruteForceGuard 暴力破解防护中间件
// 超过 maxFails 次失败后，该 IP 被封锁 lockDur 时长
func BruteForceGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()

		failMu.Lock()
		r, ok := failMap[ip]
		// 在持锁状态下完成所有共享数据读取，避免竞态条件
		locked := ok && !r.LockedAt.IsZero() && time.Since(r.LockedAt) < lockDur
		var remaining time.Duration
		if locked {
			remaining = lockDur - time.Since(r.LockedAt)
		}
		failMu.Unlock()

		if locked {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":               "由于多次登录失败，您的 IP 已被临时封锁",
				"retry_after_seconds": int(remaining.Seconds()),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ─── 恶意请求过滤 ────────────────────────────────────────

// SuspiciousRequestFilter 可疑请求过滤中间件
// 拦截常见的攻击探测路径 (如 PHP/wp-admin/env 等扫描器)
func SuspiciousRequestFilter() gin.HandlerFunc {
	blockedPatterns := []string{
		".php", ".asp", ".aspx", ".jsp",
		"wp-admin", "wp-login", "wp-content", "wordpress",
		".env", ".git", ".svn", ".htaccess",
		"phpmyadmin", "adminer", "shell",
		"../", "..\\",         // 路径穿越
		"<script", "%3Cscript", // XSS 探测
	}

	return func(c *gin.Context) {
		path := strings.ToLower(c.Request.URL.Path)
		query := strings.ToLower(c.Request.URL.RawQuery)
		combined := path + "?" + query

		for _, pattern := range blockedPatterns {
			if strings.Contains(combined, pattern) {
				log.Printf("🛡️ 拦截可疑请求: IP=%s Path=%s", c.ClientIP(), c.Request.URL.Path)
				c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}

// ─── 安全响应头 ──────────────────────────────────────────

// SecurityHeaders 设置安全响应头中间件
// 包含: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
//
//	Strict-Transport-Security, Content-Security-Policy, Referrer-Policy, Permissions-Policy
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-XSS-Protection", "1; mode=block")
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		// 缓存策略: 静态资源缓存 1 天，其他不缓存
		if len(c.Request.URL.Path) > 7 && c.Request.URL.Path[:7] == "/assets" {
			c.Header("Cache-Control", "public, max-age=86400")
		} else {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		}

		c.Next()
	}
}

// ─── 请求体大小防护 ─────────────────────────────────────

// MaxBodySize 限制请求体大小 (防止 DoS 大包攻击)
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": "请求体过大",
			})
			c.Abort()
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
