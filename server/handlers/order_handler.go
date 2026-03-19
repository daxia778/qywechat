package handlers

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ─── OCR ──────────────────────────────────────────

// UploadOCR 上传订单截图进行 OCR 解析
func UploadOCR(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请上传图片文件"})
		return
	}

	// 上传到 OSS 或本地磁盘 (取决于 OSS_PROVIDER 配置)
	uploadResult, err := services.UploadFile(file, "ocr")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件上传失败: " + err.Error()})
		return
	}

	// OCR 解析: 本地模式始终用 FilePath (相对磁盘路径)，云 OSS 模式用公网 URL
	ocrInput := uploadResult.FilePath
	if strings.HasPrefix(uploadResult.URL, "http") {
		ocrInput = uploadResult.URL // 云 OSS 模式: OCR 服务通过 URL 访问文件
	}

	result, err := services.ExtractOrderFromImage(ocrInput)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "OCR 解析失败: " + err.Error()})
		return
	}

	// 将 OCR 结果和截图 URL 一起返回
	c.JSON(http.StatusOK, gin.H{
		"order_sn":       result.OrderSN,
		"price":          result.Price,
		"raw_price":      result.RawPrice,
		"order_time":     result.OrderTime,
		"confidence":     result.Confidence,
		"screenshot_url": uploadResult.URL,
	})
}

// ─── 订单 ──────────────────────────────────────────

type CreateOrderReq struct {
	OrderSN         string `json:"order_sn"`
	CustomerContact string `json:"customer_contact"`
	Price           int    `json:"price"`
	Topic           string `json:"topic"`
	Pages           int    `json:"pages"`
	Deadline        string `json:"deadline"`
	Remark          string `json:"remark"`
}

// CreateOrder 创建订单
func CreateOrder(c *gin.Context) {
	var req CreateOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	// 服务端价格校验
	if req.Price <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "价格必须大于0"})
		return
	}
	if req.Price > 999999 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "价格超出合理范围（最大999999分）"})
		return
	}

	// 始终从 JWT 中获取 operator_id，防止伪造
	var operatorID string
	if v, exists := c.Get("wecom_userid"); exists {
		if strV, ok := v.(string); ok {
			operatorID = strV
		}
	}
	if operatorID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 operator_id"})
		return
	}

	var deadline *time.Time
	if req.Deadline != "" {
		t, err := time.Parse("2006-01-02 15:04", req.Deadline)
		if err == nil {
			deadline = &t
		}
	}

	order, err := services.CreateOrder(
		operatorID, req.OrderSN, req.CustomerContact,
		req.Topic, req.Remark, "", req.Price, req.Pages, deadline,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 异步通知设计师
	go func() {
		designers := services.GetIdleDesigners()
		ids := make([]string, len(designers))
		for i, d := range designers {
			ids[i] = d.WecomUserID
		}
		deadlineStr := "待定"
		if deadline != nil {
			deadlineStr = deadline.Format("2006-01-02 15:04")
		}
		if len(ids) > 0 {
			_ = services.Wecom.NotifyNewOrder(order.OrderSN, operatorID, req.Topic, req.Pages, req.Price, deadlineStr, ids)
		}
	}()

	c.JSON(http.StatusOK, order)
}

type GrabOrderReq struct {
	OrderID        uint   `json:"order_id" binding:"required"`
	DesignerUserID string `json:"designer_userid" binding:"required"`
}

// GrabOrder 设计师抢单
func GrabOrder(c *gin.Context) {
	var req GrabOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	// 安全校验: 从 JWT 中获取真实用户身份，防止伪造 designer_userid
	callerID, _ := c.Get("wecom_userid")
	callerStr, _ := callerID.(string)
	if callerStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未授权"})
		return
	}
	if req.DesignerUserID != callerStr {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能为自己抢单"})
		return
	}

	order, err := services.GrabOrder(req.OrderID, req.DesignerUserID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	// 异步建群
	go func() {
		deadlineStr := "待定"
		if order.Deadline != nil {
			deadlineStr = order.Deadline.Format("2006-01-02 15:04")
		}
		chatID, err := services.Wecom.SetupOrderGroup(
			order.OrderSN, order.OperatorID, req.DesignerUserID,
			order.Topic, order.Pages, order.Price, deadlineStr, order.Remark,
		)
		if err == nil && chatID != "" {
			models.DB.Model(order).Update("wecom_chat_id", chatID)
		}
	}()

	c.JSON(http.StatusOK, order)
}

// UpdateOrderStatus 更新订单状态 (包含鉴权逻辑)
func UpdateOrderStatus(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	var body struct {
		Status       string `json:"status" binding:"required"`
		RefundReason string `json:"refund_reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. 获取当前操作人信息
	userID, _ := c.Get("wecom_userid")
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	uidStr, _ := userID.(string)

	// 2. 角色基本权限校验
	allowedRoles, ok := models.StatusChangePermission[body.Status]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未知的目标状态"})
		return
	}

	if !slices.Contains(allowedRoles, roleStr) {
		c.JSON(http.StatusForbidden, gin.H{"error": "当前角色无权流转到该状态"})
		return
	}

	// 3. 属主权限校验 (对于设计师，只能操作自己的单子；客服也只能操作自己录的单子，除非是admin)
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	if roleStr == "designer" && order.DesignerID != uidStr {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能操作指派给自己的订单"})
		return
	}
	if roleStr == "operator" && order.OperatorID != uidStr {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能操作自己录入的订单"})
		return
	}

	// 4. 执行状态流转
	updatedOrder, err := services.UpdateOrderStatus(uint(id), body.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 5. 如果是退款，记录原因
	if body.Status == models.StatusRefunded && body.RefundReason != "" {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(updatedOrder).Update("refund_reason", body.RefundReason).Error
		})
		updatedOrder.RefundReason = body.RefundReason
	}

	c.JSON(http.StatusOK, gin.H{"message": "状态更新成功", "order": updatedOrder})

	// 6. 记录状态流转时间线
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}
	models.DB.Create(&models.OrderTimeline{
		OrderID:      updatedOrder.ID,
		FromStatus:   order.Status,
		ToStatus:     body.Status,
		OperatorID:   uidStr,
		OperatorName: operatorName,
		Remark:       body.RefundReason,
	})

	// 7. WebSocket 广播订单状态变更
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: updatedOrder,
	})

	// 8. 异步发送状态变更通知 (企微 + 站内)
	SendOrderStatusNotification(updatedOrder, body.Status)
}

// ListOrders 订单列表 (支持多条件筛选)
func ListOrders(c *gin.Context) {
	status := c.Query("status")
	keyword := c.Query("keyword")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	operatorID := c.Query("operator_id")
	designerID := c.Query("designer_id")
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	query := models.DB.Model(&models.Order{})

	// 角色权限过滤: 非 admin 用户只能查看自己相关的订单
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	switch roleStr {
	case "admin":
		// admin 可查看所有订单
	case "operator":
		query = query.Where("operator_id = ?", uidStr)
	case "designer":
		query = query.Where("designer_id = ?", uidStr)
	default:
		c.JSON(http.StatusForbidden, gin.H{"error": "未知角色，无权访问"})
		return
	}

	if status != "" {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("order_sn LIKE ? OR customer_contact LIKE ? OR topic LIKE ?", like, like, like)
	}
	if startDate != "" {
		if t, err := time.Parse("2006-01-02", startDate); err == nil {
			query = query.Where("created_at >= ?", t)
		}
	}
	if endDate != "" {
		if t, err := time.Parse("2006-01-02", endDate); err == nil {
			query = query.Where("created_at < ?", t.Add(24*time.Hour))
		}
	}
	if operatorID != "" {
		query = query.Where("operator_id = ?", operatorID)
	}
	if designerID != "" {
		query = query.Where("designer_id = ?", designerID)
	}

	var total int64
	query.Count(&total)

	var orders []models.Order
	query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&orders)

	c.JSON(http.StatusOK, gin.H{"data": orders, "total": total})
}

// GetOrder 获取单个订单详情 (含角色权限校验)
func GetOrder(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	// 先鉴权再查库，统一返回 404 避免信息泄露
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	query := models.DB.Model(&models.Order{}).Where("id = ?", uint(id))
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

	c.JSON(http.StatusOK, order)
}
