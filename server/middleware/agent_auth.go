package middleware

import (
	"net/http"
	"strings"

	"pdd-order-system/config"

	"github.com/gin-gonic/gin"
)

// AgentAuth Agent Token 认证中间件
// Agent 通过 Header "Authorization: Bearer <token>" 传递 AUTO_ADD_AGENT_TOKEN
func AgentAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := config.C.AutoAddAgentToken
		if token == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": "AGENT_NOT_CONFIGURED", "message": "Agent 认证未配置"})
			c.Abort()
			return
		}

		auth := c.GetHeader("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "缺少 Agent Token"})
			c.Abort()
			return
		}

		provided := strings.TrimPrefix(auth, "Bearer ")
		if provided != token {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Agent Token 无效"})
			c.Abort()
			return
		}

		c.Next()
	}
}
