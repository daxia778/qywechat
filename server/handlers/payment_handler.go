package handlers

import (
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ListPayments GET /api/v1/payments — 收款流水列表
func ListPayments(c *gin.Context) {
	orderIDStr := c.Query("order_id")
	customerIDStr := c.Query("customer_id")
	source := c.Query("source")
	startTime := c.Query("start_time")
	endTime := c.Query("end_time")
	pageStr := c.DefaultQuery("page", "1")
	pageSizeStr := c.DefaultQuery("page_size", "20")

	page, _ := strconv.Atoi(pageStr)
	pageSize, _ := strconv.Atoi(pageSizeStr)
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := models.DB.Model(&models.PaymentRecord{})

	// 角色权限过滤: admin/follow 查所有, follow 只查自己相关订单的流水
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	switch roleStr {
	case "admin":
		// 管理员查看全部
	case "follow":
		// 跟单客服: 只查自己关联订单的流水
		query = query.Where("order_id IN (?)",
			models.DB.Model(&models.Order{}).Select("id").Where("follow_operator_id = ? OR operator_id = ?", uidStr, uidStr),
		)
	case "sales":
		query = query.Where("order_id IN (?)",
			models.DB.Model(&models.Order{}).Select("id").Where("operator_id = ?", uidStr),
		)
	case "designer":
		query = query.Where("order_id IN (?)",
			models.DB.Model(&models.Order{}).Select("id").Where("designer_id = ?", uidStr),
		)
	default:
		c.JSON(http.StatusForbidden, gin.H{"error": "未知角色，无权访问"})
		return
	}

	if orderIDStr != "" {
		if oid, err := strconv.ParseUint(orderIDStr, 10, 32); err == nil {
			query = query.Where("order_id = ?", uint(oid))
		}
	}
	if customerIDStr != "" {
		if cid, err := strconv.ParseUint(customerIDStr, 10, 32); err == nil {
			query = query.Where("customer_id = ?", uint(cid))
		}
	}
	if source != "" {
		query = query.Where("source = ?", source)
	}
	if startTime != "" {
		if t, err := time.Parse("2006-01-02", startTime); err == nil {
			query = query.Where("paid_at >= ?", t)
		}
	}
	if endTime != "" {
		if t, err := time.Parse("2006-01-02", endTime); err == nil {
			query = query.Where("paid_at < ?", t.Add(24*time.Hour))
		}
	}

	var total int64
	query.Count(&total)

	var payments []models.PaymentRecord
	query.Order("paid_at DESC").Offset(offset).Limit(pageSize).Find(&payments)

	c.JSON(http.StatusOK, gin.H{
		"data":      payments,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// CreatePaymentReq 手动录入收款请求体
type CreatePaymentReq struct {
	OrderID uint   `json:"order_id" binding:"required"`
	Amount  int    `json:"amount" binding:"required"`
	Source  string `json:"source" binding:"required"`
	Remark  string `json:"remark"`
	PaidAt  string `json:"paid_at"`
}

// CreatePayment POST /api/v1/payments — 手动录入收款记录
func CreatePayment(c *gin.Context) {
	var req CreatePaymentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("CreatePayment 参数绑定失败: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数格式错误"})
		return
	}

	// 参数校验
	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "金额必须大于0"})
		return
	}
	if req.Amount > 99999999 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "金额超出合理范围"})
		return
	}
	if !models.IsValidPaymentSource(req.Source) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的收款来源，可选: pdd / wecom / manual"})
		return
	}

	// 校验关联订单是否存在
	var order models.Order
	if err := models.DB.First(&order, req.OrderID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "关联订单不存在"})
		return
	}

	// 角色权限校验: admin 和 follow 可以录入
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	if roleStr != "admin" && roleStr != "follow" {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权录入收款记录"})
		return
	}

	// follow 角色只能为自己关联的订单录入
	if roleStr == "follow" && order.FollowOperatorID != uidStr && order.OperatorID != uidStr {
		c.JSON(http.StatusForbidden, gin.H{"error": "只能为自己关联的订单录入收款"})
		return
	}

	// 支付时间
	paidAt := time.Now()
	if req.PaidAt != "" {
		if t, err := time.Parse("2006-01-02 15:04", req.PaidAt); err == nil {
			paidAt = t
		}
	}

	now := time.Now()
	transactionID := fmt.Sprintf("MANUAL-%d-%04d", now.UnixMilli(), rand.Intn(10000))

	payment := models.PaymentRecord{
		TransactionID: transactionID,
		OrderID:       req.OrderID,
		CustomerID:    order.CustomerID,
		Amount:        req.Amount,
		Source:        req.Source,
		PayeeUserID:   uidStr,
		Remark:        req.Remark,
		TradeState:    "SUCCESS",
		PaidAt:        paidAt,
		MatchedAt:     &now,
		MatchMethod:   "manual",
	}

	err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&payment).Error
	})
	if err != nil {
		log.Printf("❌ 创建收款记录失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建收款记录失败"})
		return
	}

	log.Printf("✅ 手动录入收款 | txn=%s | order=%d | amount=%d | source=%s", transactionID, req.OrderID, req.Amount, req.Source)
	c.JSON(http.StatusOK, gin.H{"message": "收款记录创建成功", "payment": payment})
}

// MatchPaymentReq 手动关联订单请求体
type MatchPaymentReq struct {
	OrderID uint `json:"order_id" binding:"required"`
}

// MatchPayment PUT /api/v1/payments/:id/match — 手动关联订单
func MatchPayment(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的流水ID"})
		return
	}

	var req MatchPaymentReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("MatchPayment 参数绑定失败: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数格式错误"})
		return
	}

	// 角色权限校验
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		c.JSON(http.StatusForbidden, gin.H{"error": "无权操作"})
		return
	}

	// 校验目标订单是否存在
	var order models.Order
	if err := models.DB.First(&order, req.OrderID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "目标订单不存在"})
		return
	}

	var payment models.PaymentRecord
	err = models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.First(&payment, uint(id)).Error; err != nil {
			return fmt.Errorf("流水记录不存在")
		}

		// 已关联订单的流水不允许重复关联
		if payment.OrderID != 0 {
			return fmt.Errorf("该流水已关联订单 (order_id=%d)，不可重复关联", payment.OrderID)
		}

		now := time.Now()
		payment.OrderID = req.OrderID
		payment.CustomerID = order.CustomerID
		payment.MatchedAt = &now
		payment.MatchMethod = "manual"

		return tx.Save(&payment).Error
	})

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Printf("✅ 手动关联流水 | txn=%s → order=%d", payment.TransactionID, req.OrderID)
	c.JSON(http.StatusOK, gin.H{"message": "关联成功", "payment": payment})
}

// GetPaymentSummary GET /api/v1/payments/summary — 收款汇总统计
func GetPaymentSummary(c *gin.Context) {
	// 权限: 仅 admin
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "仅管理员可查看汇总统计"})
		return
	}

	startTime := c.Query("start_time")
	endTime := c.Query("end_time")

	query := models.DB.Model(&models.PaymentRecord{}).Where("trade_state = ?", "SUCCESS")

	if startTime != "" {
		if t, err := time.Parse("2006-01-02", startTime); err == nil {
			query = query.Where("paid_at >= ?", t)
		}
	}
	if endTime != "" {
		if t, err := time.Parse("2006-01-02", endTime); err == nil {
			query = query.Where("paid_at < ?", t.Add(24*time.Hour))
		}
	}

	// 总收款金额
	var totalAmount int64
	query.Select("COALESCE(SUM(amount), 0)").Row().Scan(&totalAmount)

	// 按来源分组
	type SourceSummary struct {
		Source string `json:"source"`
		Total  int64  `json:"total"`
		Count  int64  `json:"count"`
	}

	var sourceSummaries []SourceSummary
	query.Select("source, COALESCE(SUM(amount), 0) as total, COUNT(*) as count").
		Group("source").
		Find(&sourceSummaries)

	// 构造按来源的 map
	sourceMap := make(map[string]gin.H)
	for _, s := range sourceSummaries {
		sourceMap[s.Source] = gin.H{
			"total": s.Total,
			"count": s.Count,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_amount":  totalAmount,
		"by_source":     sourceMap,
		"source_detail": sourceSummaries,
	})
}

// SyncWecomPayments POST /api/v1/payments/sync-wecom — 手动触发企微收款同步
func SyncWecomPayments(c *gin.Context) {
	// 权限: 仅 admin
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "仅管理员可触发企微收款同步"})
		return
	}

	result, err := services.SyncWecomPayments()
	if err != nil {
		log.Printf("手动触发企微收款同步失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  fmt.Sprintf("同步失败: %v", err),
			"result": result,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "企微收款同步完成",
		"result":  result,
	})
}
