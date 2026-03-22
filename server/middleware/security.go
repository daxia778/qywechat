package middleware

import (
	"context"
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

// StartFailMapCleaner 启动后台定期清理过期的封锁记录（替代 init() goroutine）
func StartFailMapCleaner(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("暴力破解记录清理器已停止")
				return
			case <-ticker.C:
				failMu.Lock()
				for ip, r := range failMap {
					if time.Since(r.FirstAt) > failWindow+lockDur {
						delete(failMap, ip)
					}
				}
				failMu.Unlock()
			}
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
// 同时过滤已知恶意 User-Agent
func SuspiciousRequestFilter() gin.HandlerFunc {
	blockedPatterns := []string{
		// 脚本/CMS 探测
		".php", ".asp", ".aspx", ".jsp", ".cgi",
		"wp-admin", "wp-login", "wp-content", "wordpress",
		"phpmyadmin", "adminer", "shell",
		"cgi-bin", "manager/html", "invoker/readonly",

		// 敏感文件探测
		".env", ".git", ".svn", ".htaccess", ".DS_Store",
		"config.yml", "config.yaml", "config.json",
		"web.config", "database.yml",

		// 路径穿越
		"../", "..\\",

		// XSS 探测
		"<script", "%3Cscript",

		// SQL 注入探测
		"union+select", "union%20select", "' or '1'='1",
		"1=1--", "' or 1=1", "select+from", "select%20from",
		"drop+table", "drop%20table",

		// 其他攻击特征
		"eval(", "exec(", "system(",
		"/actuator", "/jolokia", "/console",
		"/debug/", "/trace/",
	}

	// 已知扫描器 / 攻击工具 User-Agent 关键词 (小写匹配)
	blockedUAs := []string{
		"sqlmap", "nmap", "masscan", "nikto", "dirbuster",
		"gobuster", "wfuzz", "hydra", "metasploit",
		"burp", "zap", "acunetix", "nessus", "openvas",
		"shodan", "censys", "zgrab",
		// 注意: go-http-client 是桌面客户端的默认 UA，不能拦截
		// curl/wget 用于合法调试，也不拦截
	}

	return func(c *gin.Context) {
		path := strings.ToLower(c.Request.URL.Path)
		query := strings.ToLower(c.Request.URL.RawQuery)
		combined := path + "?" + query

		for _, pattern := range blockedPatterns {
			if strings.Contains(combined, pattern) {
				log.Printf("🛡️ 拦截可疑请求: IP=%s Path=%s UA=%s", c.ClientIP(), c.Request.URL.Path, c.Request.UserAgent())
				c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
				c.Abort()
				return
			}
		}

		// User-Agent 黑名单检查
		ua := strings.ToLower(c.Request.UserAgent())
		if ua == "" {
			// 空 UA 通常是扫描器，但某些合法工具也可能没有 UA
			// 仅记录不拦截，避免误伤（如企微回调可能无 UA）
			log.Printf("⚠️ 空 User-Agent 请求: IP=%s Path=%s", c.ClientIP(), c.Request.URL.Path)
		} else {
			for _, blocked := range blockedUAs {
				if strings.Contains(ua, blocked) {
					log.Printf("🛡️ 拦截恶意 UA: IP=%s UA=%s Path=%s", c.ClientIP(), c.Request.UserAgent(), c.Request.URL.Path)
					c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
					c.Abort()
					return
				}
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

		// HSTS 仅在 HTTPS 连接时发送（RFC 6797 Section 7.2）
		// 在纯 HTTP 环境下发送 HSTS 会导致浏览器缓存后强制跳转 HTTPS，造成站点不可访问
		if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		}

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
// 同时处理 Content-Length 已知和 chunked (Content-Length=-1) 的情况
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxBytes {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": "请求体过大",
			})
			c.Abort()
			return
		}
		// MaxBytesReader 同样限制 chunked 传输 (ContentLength == -1 时仍有效)
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
