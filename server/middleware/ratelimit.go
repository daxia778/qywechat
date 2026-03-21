package middleware

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// ipLimiter 存储每个 IP 的限流器
type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// rateLimiterStore 每个中间件实例独立的限流器存储
// 避免不同限速策略共享同一个 map 导致混淆
type rateLimiterStore struct {
	mu       sync.Mutex
	visitors map[string]*ipLimiter
	rps      rate.Limit
	burst    int
}

func newRateLimiterStore(ctx context.Context, rps rate.Limit, burst int) *rateLimiterStore {
	s := &rateLimiterStore{
		visitors: make(map[string]*ipLimiter),
		rps:      rps,
		burst:    burst,
	}
	// 后台每 3 分钟清理过期的 IP 限流器，防止内存泄漏
	go func() {
		ticker := time.NewTicker(3 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("限速器清理 goroutine 已停止")
				return
			case <-ticker.C:
				s.mu.Lock()
				for ip, v := range s.visitors {
					if time.Since(v.lastSeen) > 5*time.Minute {
						delete(s.visitors, ip)
					}
				}
				s.mu.Unlock()
			}
		}
	}()
	return s
}

func (s *rateLimiterStore) getLimiter(ip string) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()

	v, ok := s.visitors[ip]
	if !ok {
		limiter := rate.NewLimiter(s.rps, s.burst)
		s.visitors[ip] = &ipLimiter{limiter: limiter, lastSeen: time.Now()}
		return limiter
	}
	v.lastSeen = time.Now()
	return v.limiter
}

// rateLimiterCtxKey 用于从 gin.Engine 级别传递 context 给限速器
var rateLimiterCtx context.Context = context.Background()

// SetRateLimiterContext 设置限速器使用的 context（在 main.go 中调用）
func SetRateLimiterContext(ctx context.Context) {
	rateLimiterCtx = ctx
}

// RateLimitByIP 基于客户端 IP 的速率限制中间件
// rps: 每秒允许的请求数 (例如 0.083 ≈ 每分钟 5 次)
// burst: 允许的突发请求上限
// 每次调用都会创建独立的限流器存储，不同路由组的限速互不干扰
func RateLimitByIP(rps float64, burst int) gin.HandlerFunc {
	store := newRateLimiterStore(rateLimiterCtx, rate.Limit(rps), burst)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		limiter := store.getLimiter(ip)

		if !limiter.Allow() {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "请求过于频繁，请稍后再试",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// APIRateLimit 返回 API 通用限速中间件 (60 请求/分钟/IP)
func APIRateLimit() gin.HandlerFunc {
	// 60 requests per minute = 1 request per second, burst 10
	return RateLimitByIP(1.0, 10)
}

// LoginRateLimit 返回登录端点限速中间件 (5 请求/分钟/IP)
func LoginRateLimit() gin.HandlerFunc {
	// 5 requests per minute ≈ 0.083 rps, burst 5
	return RateLimitByIP(0.083, 5)
}
