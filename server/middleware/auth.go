package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// ─── Token 黑名单 ──────────────────────────────────────────

// revokedEntry 存储被注销的 jti 及其原始过期时间
type revokedEntry struct {
	ExpAt time.Time // token 原始过期时间，过期后可从黑名单中清除
}

// tokenBlacklist 存储被注销的 jti -> revokedEntry
var tokenBlacklist sync.Map

// userMinIssuedAt 存储 userID -> 最小有效签发时间
// 签发时间早于此值的 token 一律视为无效（用于密码重置/禁用账号时批量失效）
var userMinIssuedAt sync.Map

// RevokeToken 将单个 token 的 jti 加入黑名单（内存 + 数据库双写）
func RevokeToken(jti string, expAt time.Time) {
	tokenBlacklist.Store(jti, revokedEntry{ExpAt: expAt})
	// 异步持久化到数据库，避免阻塞请求
	go models.PersistRevokedToken(jti, expAt)
}

// RevokeAllUserTokens 使某用户在此刻之前签发的所有 token 失效
// 用于密码重置、账号禁用等场景（内存 + 数据库双写）
func RevokeAllUserTokens(userID string) {
	now := time.Now()
	userMinIssuedAt.Store(userID, now)
	// 异步持久化到数据库
	go models.PersistUserMinIssuedAt(userID, now)
}

// isTokenRevoked 检查 jti 是否在黑名单中
func isTokenRevoked(jti string) bool {
	_, ok := tokenBlacklist.Load(jti)
	return ok
}

// IsTokenRevoked 导出版本，供 WebSocket 等非中间件模块使用
func IsTokenRevoked(jti string) bool {
	return isTokenRevoked(jti)
}

// isIssuedBeforeMinValid 检查 token 签发时间是否早于用户的最小有效签发时间
func isIssuedBeforeMinValid(userID string, iat time.Time) bool {
	val, ok := userMinIssuedAt.Load(userID)
	if !ok {
		return false
	}
	minTime := val.(time.Time)
	return iat.Before(minTime)
}

// IsIssuedBeforeMinValid 导出版本，供 WebSocket 等非中间件模块使用
func IsIssuedBeforeMinValid(userID string, iat time.Time) bool {
	return isIssuedBeforeMinValid(userID, iat)
}

// LoadTokenBlacklistFromDB 启动时从数据库恢复黑名单到内存
func LoadTokenBlacklistFromDB() {
	records, err := models.LoadTokenBlacklistFromDB()
	if err != nil {
		log.Printf("加载 Token 黑名单失败: %v", err)
		return
	}
	for _, r := range records {
		tokenBlacklist.Store(r.JTI, revokedEntry{ExpAt: r.ExpAt})
	}
	if len(records) > 0 {
		log.Printf("从数据库恢复 %d 条 Token 黑名单记录", len(records))
	}

	uRecords, err := models.LoadUserMinIssuedAtFromDB()
	if err != nil {
		log.Printf("加载用户最小签发时间失败: %v", err)
		return
	}
	for _, r := range uRecords {
		userMinIssuedAt.Store(r.UserID, r.MinIssuedAt)
	}
	if len(uRecords) > 0 {
		log.Printf("从数据库恢复 %d 条用户最小签发时间记录", len(uRecords))
	}
}

// StartTokenCleanup 启动后台协程，定期清理过期的黑名单条目，防止内存泄漏
func StartTokenCleanup(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("Token 黑名单清理协程已停止")
				return
			case <-ticker.C:
				now := time.Now()
				cleaned := 0
				tokenBlacklist.Range(func(key, value any) bool {
					entry := value.(revokedEntry)
					if now.After(entry.ExpAt) {
						tokenBlacklist.Delete(key)
						cleaned++
					}
					return true
				})
				// 同步清理数据库中的过期记录
				dbCleaned := models.CleanExpiredTokenBlacklist()
				if cleaned > 0 || dbCleaned > 0 {
					log.Printf("Token 黑名单清理: 内存移除 %d 条, 数据库移除 %d 条", cleaned, dbCleaned)
				}
			}
		}
	}()
	log.Println("Token 黑名单清理协程已启动 (每10分钟)")
}

// ─── JWT 中间件 ──────────────────────────────────────────

// JWTAuth JWT 认证中间件
func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "缺少 Authorization 头"})
			c.Abort()
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			// 校验签名算法，防止 algorithm confusion 攻击
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return []byte(config.C.JWTSecretKey), nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token 无效或已过期"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token 解析失败"})
			c.Abort()
			return
		}

		// 检查 jti 是否在黑名单中
		jti, _ := claims["jti"].(string)
		if jti != "" && isTokenRevoked(jti) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Token 已注销"})
			c.Abort()
			return
		}

		// 检查 iat 是否早于该用户的最小有效签发时间
		sub, _ := claims["sub"].(string)
		if iatFloat, ok := claims["iat"].(float64); ok && sub != "" {
			iat := time.Unix(int64(iatFloat), 0)
			if isIssuedBeforeMinValid(sub, iat) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token 已失效，请重新登录"})
				c.Abort()
				return
			}
		}

		c.Set("wecom_userid", claims["sub"])
		c.Set("name", claims["name"])
		c.Set("role", claims["role"])
		c.Set("jwt_claims", claims) // 供 logout/refresh 使用
		c.Next()
	}
}

// ─── Token 生成 ──────────────────────────────────────────

// generateJTI 生成 JWT 唯一 ID (16 字节 hex)
func generateJTI() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// fallback: 用时间戳作为 jti (极端情况)
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// CreateToken 生成 JWT
func CreateToken(wecomUserID, name, role string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":  wecomUserID,
		"name": name,
		"role": role,
		"exp":  now.Add(time.Duration(config.C.JWTExpireMinutes) * time.Minute).Unix(),
		"iat":  now.Unix(),
		"nbf":  now.Unix(),
		"jti":  generateJTI(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.C.JWTSecretKey))
}
