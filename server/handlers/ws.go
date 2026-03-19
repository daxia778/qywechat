package handlers

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin:     checkHandlerWSOrigin,
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// checkHandlerWSOrigin 校验 WebSocket 连接的 Origin
func checkHandlerWSOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return slices.Contains(config.C.CORSOrigins, origin)
}

// WebSocketHandler 处理 WebSocket 连接升级
// 支持两种认证方式: 1) URL query param ?token=xxx (兼容旧版) 2) 首帧消息 { type: "auth", token: "xxx" }
func WebSocketHandler(c *gin.Context) {
	// 尝试从 query param 获取 token (兼容旧版客户端)
	tokenStr := c.Query("token")

	// 如果 query 中有 token，先验证
	var userID string
	if tokenStr != "" {
		uid, err := validateJWT(tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		userID = uid
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	// 如果已通过 query param 认证，直接注册
	if userID != "" {
		services.Hub.Register(conn, userID)
		return
	}

	// 首帧认证: 读取第一条消息获取 token
	go func() {
		authenticated := false
		defer func() {
			if !authenticated {
				conn.Close()
			}
		}()

		// 设置首帧读取超时，防止客户端连接后不发送 auth 消息导致 goroutine 泄漏
		conn.SetReadDeadline(time.Now().Add(10 * time.Second))

		var authMsg struct {
			Type  string `json:"type"`
			Token string `json:"token"`
		}
		if err := conn.ReadJSON(&authMsg); err != nil {
			// 超时或读取失败，conn 会在 defer 中关闭，无需发送错误消息
			return
		}
		if authMsg.Type != "auth" || authMsg.Token == "" {
			_ = conn.WriteJSON(gin.H{"type": "error", "message": "invalid auth message"})
			return
		}

		uid, err := validateJWT(authMsg.Token)
		if err != nil {
			_ = conn.WriteJSON(gin.H{"type": "error", "message": "invalid token"})
			return
		}
		authenticated = true

		// 认证成功，清除读取超时
		conn.SetReadDeadline(time.Time{})
		conn.WriteJSON(gin.H{"type": "auth_ok"})
		services.Hub.Register(conn, uid)
	}()
}

// validateJWT 解析并验证 JWT token，返回用户 ID
func validateJWT(tokenStr string) (string, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(config.C.JWTSecretKey), nil
	})
	if err != nil || !token.Valid {
		return "", fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fmt.Errorf("invalid claims")
	}

	userID, _ := claims["sub"].(string)
	return userID, nil
}

// GetOrderDetail 获取订单详情（含时间线和分润）
func GetOrderDetail(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	// 先鉴权再查库，角色条件合并到 WHERE，统一返回 404 避免信息泄露
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	query := models.DB.Where("id = ?", uint(id))
	switch roleStr {
	case "admin":
		// admin 可查看所有订单
	case "operator":
		query = query.Where("operator_id = ?", uidStr)
	case "designer":
		query = query.Where("designer_id = ?", uidStr)
	default:
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	var order models.Order
	if err := query.First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	// 获取时间线
	var timeline []models.OrderTimeline
	models.DB.Where("order_id = ?", order.ID).Order("created_at ASC").Find(&timeline)

	// 获取操作人和设计师名称
	operatorName := ""
	designerName := ""
	if order.OperatorID != "" {
		var emp models.Employee
		if models.DB.Where("wecom_userid = ?", order.OperatorID).First(&emp).Error == nil {
			operatorName = emp.Name
		}
	}
	if order.DesignerID != "" {
		var emp models.Employee
		if models.DB.Where("wecom_userid = ?", order.DesignerID).First(&emp).Error == nil {
			designerName = emp.Name
		}
	}

	result := gin.H{
		"order":    order,
		"timeline": timeline,
		"people": gin.H{
			"operator_name": operatorName,
			"designer_name": designerName,
		},
	}

	// 仅 admin 可查看分润明细，防止敏感数据泄露
	if roleStr == "admin" {
		platformRate := config.C.PlatformFeeRate
		designerRate := config.C.DesignerCommissionRate
		operatorRate := config.C.OperatorCommissionRate

		pf := order.Price * platformRate / 100
		dc := order.Price * designerRate / 100
		oc := order.Price * operatorRate / 100
		np := order.Price - pf - dc - oc

		result["profit"] = gin.H{
			"total_price":         order.Price,
			"platform_fee":        pf,
			"designer_commission": dc,
			"operator_commission": oc,
			"net_profit":          np,
			"platform_fee_rate":   platformRate,
			"designer_rate":       designerRate,
			"operator_rate":       operatorRate,
		}
	}

	c.JSON(http.StatusOK, result)
}

// GetOrderTimeline 仅获取订单的时间线
func GetOrderTimeline(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	// 先鉴权再查库，角色条件合并到 WHERE，统一返回 404
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	query := models.DB.Where("id = ?", uint(id))
	switch roleStr {
	case "admin":
		// admin 可查看所有订单
	case "operator":
		query = query.Where("operator_id = ?", uidStr)
	case "designer":
		query = query.Where("designer_id = ?", uidStr)
	default:
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	var order models.Order
	if err := query.First(&order).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	var timeline []models.OrderTimeline
	models.DB.Where("order_id = ?", uint(id)).Order("created_at ASC").Find(&timeline)

	// 在前面插入"订单创建"事件
	createEvent := models.OrderTimeline{
		OrderID:      order.ID,
		FromStatus:   "",
		ToStatus:     models.StatusPending,
		OperatorID:   order.OperatorID,
		OperatorName: "",
		Remark:       fmt.Sprintf("订单创建, 金额 ¥%.2f", float64(order.Price)/100),
		CreatedAt:    order.CreatedAt,
	}
	// 查操作人姓名
	var emp models.Employee
	if models.DB.Where("wecom_userid = ?", order.OperatorID).First(&emp).Error == nil {
		createEvent.OperatorName = emp.Name
	}
	timeline = append([]models.OrderTimeline{createEvent}, timeline...)

	c.JSON(http.StatusOK, gin.H{"data": timeline})
}
