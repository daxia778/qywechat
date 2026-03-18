package handlers

import (
	"fmt"
	"net/http"
	"strconv"

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
	for _, allowed := range config.C.CORSOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

// WebSocketHandler 处理 WebSocket 连接升级
func WebSocketHandler(c *gin.Context) {
	// 从 query param 中获取 token (WebSocket 无法设置 Header)
	tokenStr := c.Query("token")
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(config.C.JWTSecretKey), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid claims"})
		return
	}

	userID, _ := claims["sub"].(string)

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	services.Hub.Register(conn, userID)
}

// GetOrderDetail 获取订单详情（含时间线和分润）
func GetOrderDetail(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	// 获取时间线
	var timeline []models.OrderTimeline
	models.DB.Where("order_id = ?", order.ID).Order("created_at ASC").Find(&timeline)

	// 计算分润明细
	platformRate := config.C.PlatformFeeRate
	designerRate := config.C.DesignerCommissionRate
	operatorRate := config.C.OperatorCommissionRate

	pf := order.Price * platformRate / 100
	dc := order.Price * designerRate / 100
	oc := order.Price * operatorRate / 100
	np := order.Price - pf - dc - oc

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

	c.JSON(http.StatusOK, gin.H{
		"order":    order,
		"timeline": timeline,
		"profit": gin.H{
			"total_price":         order.Price,
			"platform_fee":        pf,
			"designer_commission": dc,
			"operator_commission": oc,
			"net_profit":          np,
			"platform_fee_rate":   platformRate,
			"designer_rate":       designerRate,
			"operator_rate":       operatorRate,
		},
		"people": gin.H{
			"operator_name": operatorName,
			"designer_name": designerName,
		},
	})
}

// GetOrderTimeline 仅获取订单的时间线
func GetOrderTimeline(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	var timeline []models.OrderTimeline
	models.DB.Where("order_id = ?", uint(id)).Order("created_at ASC").Find(&timeline)

	// 增加创建记录 (从 order 本身)
	var order models.Order
	if models.DB.First(&order, uint(id)).Error == nil {
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
	}

	c.JSON(http.StatusOK, gin.H{"data": timeline})
}
