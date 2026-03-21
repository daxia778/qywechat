package handlers

import (
	"fmt"
	"log"
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
// 认证方式: 首帧消息 { type: "auth", token: "xxx" }
func WebSocketHandler(c *gin.Context) {
	// SEC-05: URL query token 已移除，仅支持首帧认证（避免 token 泄露到 access log / referer）
	if c.Query("token") != "" {
		log.Println("WARNING: WebSocket token via URL query is deprecated and ignored. Use first-frame auth instead.")
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
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
	case "admin", "follow":
		// admin/follow 可查看所有订单
	case "sales":
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

	// 批量查询操作人和设计师名称，避免多次查询
	operatorName := ""
	designerName := ""
	empIDs := make([]string, 0, 2)
	if order.OperatorID != "" {
		empIDs = append(empIDs, order.OperatorID)
	}
	if order.DesignerID != "" && order.DesignerID != order.OperatorID {
		empIDs = append(empIDs, order.DesignerID)
	}
	if len(empIDs) > 0 {
		var emps []models.Employee
		models.DB.Select("wecom_userid, name").Where("wecom_userid IN ?", empIDs).Find(&emps)
		for _, e := range emps {
			if e.WecomUserID == order.OperatorID {
				operatorName = e.Name
			}
			if e.WecomUserID == order.DesignerID {
				designerName = e.Name
			}
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
		salesRate := config.C.SalesCommissionRate
		followRate := config.C.FollowCommissionRate

		pf := order.Price * platformRate / 100
		dc := order.Price * designerRate / 100
		sc := order.Price * salesRate / 100
		fc := order.Price * followRate / 100
		np := order.Price - pf - dc - sc - fc

		result["profit"] = gin.H{
			"total_price":         order.Price,
			"platform_fee":        pf,
			"designer_commission": dc,
			"sales_commission":    sc,
			"follow_commission":   fc,
			"net_profit":          np,
			"platform_fee_rate":   platformRate,
			"designer_rate":       designerRate,
			"sales_rate":          salesRate,
			"follow_rate":         followRate,
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

	query := models.DB.Model(&models.Order{}).Where("id = ?", uint(id))
	query, ok := filterByRole(query, roleStr, uidStr)
	if !ok {
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
