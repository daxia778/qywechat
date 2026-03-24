package handlers

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"slices"
	"strconv"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/middleware"
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
// 与 HTTP 中间件 JWTAuth 保持一致的安全校验：签名 + jti 黑名单 + iat 最小有效期
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

	// jti 黑名单检查（已登出的 token 不允许连接 WebSocket）
	jti, _ := claims["jti"].(string)
	if jti != "" && middleware.IsTokenRevoked(jti) {
		return "", fmt.Errorf("token revoked")
	}

	// iat 最小有效签发时间检查（密码重置/账号禁用后的旧 token 全部失效）
	userID, _ := claims["sub"].(string)
	if iatFloat, ok := claims["iat"].(float64); ok && userID != "" {
		iat := time.Unix(int64(iatFloat), 0)
		if middleware.IsIssuedBeforeMinValid(userID, iat) {
			return "", fmt.Errorf("token invalidated")
		}
	}

	return userID, nil
}

// GetOrderDetail 获取订单详情（含时间线和分润）
func GetOrderDetail(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	// 所有已认证用户均可查看任意订单详情
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
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
	role, _ := c.Get("role")
	if role == "admin" {
		// 优先使用已落库的分润数据（订单完成时已计算并保存）
		// 若尚未落库（分润字段全为 0 且订单未退款），则用当前 config 费率实时计算
		pf := order.PlatformFee
		dc := order.DesignerCommission
		sc := order.SalesCommission
		fc := order.FollowCommission
		np := order.NetProfit

		if pf == 0 && dc == 0 && sc == 0 && order.Status != models.StatusRefunded && order.Price > 0 {
			platformRate := config.C.PlatformFeeRate
			designerRate := config.C.DesignerCommissionRate
			salesRate := config.C.SalesCommissionRate
			followRate := config.C.FollowCommissionRate
			totalAmount := order.Price + order.ExtraPrice
			pf = int(math.Round(float64(totalAmount) * float64(platformRate) / 100.0))
			dc = int(math.Round(float64(totalAmount) * float64(designerRate) / 100.0))
			sc = int(math.Round(float64(totalAmount) * float64(salesRate) / 100.0))
			fc = int(math.Round(float64(totalAmount) * float64(followRate) / 100.0))
			np = totalAmount - pf - dc - sc - fc
		}

		result["profit"] = gin.H{
			"total_price":         order.Price + order.ExtraPrice,
			"platform_fee":        pf,
			"designer_commission": dc,
			"sales_commission":    sc,
			"follow_commission":   fc,
			"net_profit":          np,
			"platform_fee_rate":   config.C.PlatformFeeRate,
			"designer_rate":       config.C.DesignerCommissionRate,
			"sales_rate":          config.C.SalesCommissionRate,
			"follow_rate":         config.C.FollowCommissionRate,
		}
	}

	respondOK(c, result)
}

// GetOrderTimeline 仅获取订单的时间线
func GetOrderTimeline(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	// 所有已认证用户均可查看任意订单时间线
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
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

	respondOK(c, gin.H{"data": timeline})
}
