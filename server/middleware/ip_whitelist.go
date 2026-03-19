package middleware

import (
	"log"
	"net"
	"net/http"
	"strings"

	"pdd-order-system/config"

	"github.com/gin-gonic/gin"
)

// AdminIPWhitelist 管理后台 IP 白名单中间件
// 当 ADMIN_ALLOWED_IPS 配置为空时，放行所有请求（向下兼容）
// 配置示例: ADMIN_ALLOWED_IPS=192.168.1.100,10.0.0.0/8
func AdminIPWhitelist() gin.HandlerFunc {
	return func(c *gin.Context) {
		allowed := config.C.AdminAllowedIPs
		if len(allowed) == 0 {
			c.Next()
			return
		}

		clientIP := c.ClientIP()

		for _, entry := range allowed {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}

			// 支持 CIDR 格式 (如 10.0.0.0/8)
			if strings.Contains(entry, "/") {
				_, cidr, err := net.ParseCIDR(entry)
				if err != nil {
					log.Printf("⚠️ IP 白名单 CIDR 格式错误: %s", entry)
					continue
				}
				if cidr.Contains(net.ParseIP(clientIP)) {
					c.Next()
					return
				}
			} else {
				// 精确 IP 匹配
				if clientIP == entry {
					c.Next()
					return
				}
			}
		}

		log.Printf("🚨 IP 白名单拦截: IP=%s 尝试访问管理后台 %s", clientIP, c.Request.URL.Path)
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		c.Abort()
	}
}
