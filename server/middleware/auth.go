package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"pdd-order-system/config"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

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

		c.Set("wecom_userid", claims["sub"])
		c.Set("name", claims["name"])
		c.Set("role", claims["role"])
		c.Next()
	}
}

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
