package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminOnly 管理员角色校验中间件
// 配合 JWTAuth() 使用，要求 JWT claims 中 role == "admin"
func AdminOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, exists := c.Get("role")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "缺少角色信息"})
			c.Abort()
			return
		}

		if role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "仅管理员可访问"})
			c.Abort()
			return
		}

		c.Next()
	}
}
