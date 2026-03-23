package handlers

import (
	"encoding/json"
	"fmt"
	"log"
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
		badRequest(c, "请上传图片文件")
		return
	}

	// 上传到 OSS 或本地磁盘 (取决于 OSS_PROVIDER 配置)
	uploadResult, err := services.UploadFile(file, "ocr")
	if err != nil {
		log.Printf("文件上传失败: %v", err)
		internalError(c, "文件上传失败，请稍后重试")
		return
	}

	// OCR 解析: 本地模式始终用 FilePath (相对磁盘路径)，云 OSS 模式用公网 URL
	ocrInput := uploadResult.FilePath
	if strings.HasPrefix(uploadResult.URL, "http") {
		ocrInput = uploadResult.URL // 云 OSS 模式: OCR 服务通过 URL 访问文件
	}

	result, err := services.ExtractOrderFromImage(ocrInput)
	if err != nil {
		log.Printf("OCR 解析失败: %v", err)
		internalError(c, "OCR 解析失败，请稍后重试")
		return
	}

	// 将 OCR 结果和截图 URL 一起返回
	respondOK(c, gin.H{
		"order_sn":       result.OrderSN,
		"price":          result.Price,
		"raw_price":      result.RawPrice,
		"order_time":     result.OrderTime,
		"confidence":     result.Confidence,
		"screenshot_url": uploadResult.URL,
	})
}

// ─── 通用图片上传 ──────────────────────────────────

// UploadAttachment 上传备注图片（不做 OCR，仅上传返回 URL）
func UploadAttachment(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		badRequest(c, "请上传图片文件")
		return
	}

	uploadResult, err := services.UploadFile(file, "attachments")
	if err != nil {
		log.Printf("附件上传失败: %v", err)
		internalError(c, "文件上传失败，请稍后重试")
		return
	}

	respondOK(c, gin.H{
		"url": uploadResult.URL,
	})
}

// ─── 订单 ──────────────────────────────────────────

type CreateOrderReq struct {
	OrderSN         string   `json:"order_sn"`
	CustomerContact string   `json:"customer_contact"`
	Price           int      `json:"price"`
	Topic           string   `json:"topic"`
	Pages           int      `json:"pages"`
	Deadline        string   `json:"deadline"`
	Remark          string   `json:"remark"`
	ScreenshotURL   string   `json:"screenshot_url"`
	AttachmentURLs  []string `json:"attachment_urls"` // 备注图片URL列表
}

// CreateOrder 创建订单
func CreateOrder(c *gin.Context) {
	var req CreateOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("CreateOrder 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	// 服务端价格校验
	if req.Price <= 0 {
		badRequest(c, "价格必须大于0")
		return
	}
	if req.Price > models.MaxOrderPrice {
		badRequest(c, "价格超出合理范围（最大999999分）")
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
		badRequest(c, "缺少 operator_id")
		return
	}

	var deadline *time.Time
	if req.Deadline != "" {
		t, err := time.Parse("2006-01-02 15:04", req.Deadline)
		if err == nil {
			deadline = &t
		}
	}

	// 检查订单号是否已存在，避免 UNIQUE constraint 错误返回 500
	if req.OrderSN != "" {
		var count int64
		models.DB.Model(&models.Order{}).Where("order_sn = ?", req.OrderSN).Count(&count)
		if count > 0 {
			conflict(c, "订单号已存在")
			return
		}
	}

	// 序列化备注图片URL列表
	attachmentURLsJSON := ""
	if len(req.AttachmentURLs) > 0 {
		if b, err := json.Marshal(req.AttachmentURLs); err == nil {
			attachmentURLsJSON = string(b)
		}
	}

	order, err := services.CreateOrder(
		operatorID, req.OrderSN, req.CustomerContact,
		req.Topic, req.Remark, req.ScreenshotURL, attachmentURLsJSON, req.Price, req.Pages, deadline,
	)
	if err != nil {
		log.Printf("创建订单失败: %v", err)
		internalError(c, "创建订单失败，请稍后重试")
		return
	}

	// 异步通知设计师
	safeGo("CreateOrder.notify", func() {
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
			if err := services.Wecom.NotifyNewOrder(order.OrderSN, operatorID, req.Topic, req.Pages, req.Price, deadlineStr, ids); err != nil {
				log.Printf("发送新订单企微通知失败: sn=%s err=%v", order.OrderSN, err)
			}
		}
	})

	respondOK(c, order)
}

type GrabOrderReq struct {
	OrderID        uint   `json:"order_id" binding:"required"`
	DesignerUserID string `json:"designer_userid" binding:"required"`
}

// GrabOrder 设计师抢单
func GrabOrder(c *gin.Context) {
	var req GrabOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("GrabOrder 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	// 安全校验: 从 JWT 中获取真实用户身份，防止伪造 designer_userid
	callerID, _ := c.Get("wecom_userid")
	callerStr, _ := callerID.(string)
	if callerStr == "" {
		unauthorized(c, "未授权")
		return
	}
	if req.DesignerUserID != callerStr {
		forbidden(c, "只能为自己抢单")
		return
	}

	order, err := services.GrabOrder(req.OrderID, req.DesignerUserID)
	if err != nil {
		conflict(c, err.Error())
		return
	}

	// 异步建群
	safeGo("GrabOrder.setupGroup", func() {
		deadlineStr := "待定"
		if order.Deadline != nil {
			deadlineStr = order.Deadline.Format("2006-01-02 15:04")
		}
		chatID, err := services.Wecom.SetupOrderGroup(
			order.OrderSN, order.OperatorID, req.DesignerUserID,
			order.Topic, order.Pages, order.Price, deadlineStr, order.Remark,
		)
		if err == nil && chatID != "" {
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Model(order).Update("wecom_chat_id", chatID).Error
			})
		}
	})

	respondOK(c, order)
}

// UpdateOrderStatus 更新订单状态 (包含鉴权逻辑)
func UpdateOrderStatus(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	var body struct {
		Status       string `json:"status" binding:"required"`
		RefundReason string `json:"refund_reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		log.Printf("UpdateOrderStatus 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
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
		badRequest(c, "未知的目标状态")
		return
	}

	if !slices.Contains(allowedRoles, roleStr) {
		forbidden(c, "当前角色无权流转到该状态")
		return
	}

	// 3. 属主权限校验 (对于设计师，只能操作自己的单子；客服也只能操作自己录的单子，除非是admin)
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	if roleStr == "designer" && order.DesignerID != uidStr {
		forbidden(c, "只能操作指派给自己的订单")
		return
	}
	if roleStr == "sales" && order.OperatorID != uidStr {
		forbidden(c, "只能操作自己录入的订单")
		return
	}

	// 4. 执行状态流转
	updatedOrder, err := services.UpdateOrderStatus(uint(id), body.Status)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	// 5. 如果是退款，记录原因
	if body.Status == models.StatusRefunded && body.RefundReason != "" {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(updatedOrder).Update("refund_reason", body.RefundReason).Error
		})
		updatedOrder.RefundReason = body.RefundReason
	}

	// 6. 记录状态流转时间线（响应前写入，确保数据一致性）
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}
	models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&models.OrderTimeline{
			OrderID:      updatedOrder.ID,
			EventType:    "status_changed",
			FromStatus:   order.Status,
			ToStatus:     body.Status,
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       body.RefundReason,
		}).Error
	})

	respondOK(c, gin.H{"message": "状态更新成功", "order": updatedOrder})

	// 7. WebSocket 广播订单状态变更
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: updatedOrder,
	})

	// 8. 异步发送状态变更通知 (企微 + 站内)
	SendOrderStatusNotification(updatedOrder, body.Status)
}

// ─── 批量状态更新 ──────────────────────────────────

type BatchUpdateStatusReq struct {
	OrderIDs []uint `json:"order_ids" binding:"required,min=1"`
	Status   string `json:"status" binding:"required"`
}

type BatchUpdateResult struct {
	OrderID uint   `json:"order_id"`
	OrderSN string `json:"order_sn"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// BatchUpdateOrderStatus 批量更新订单状态
func BatchUpdateOrderStatus(c *gin.Context) {
	var req BatchUpdateStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("BatchUpdateOrderStatus 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	// 限制单次批量操作数量，防止滥用
	if len(req.OrderIDs) > models.BatchOperationMax {
		badRequest(c, fmt.Sprintf("单次批量操作最多%d条订单", models.BatchOperationMax))
		return
	}

	// 1. 获取当前操作人信息
	userID, _ := c.Get("wecom_userid")
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	uidStr, _ := userID.(string)

	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	// 2. 角色基本权限校验
	allowedRoles, ok := models.StatusChangePermission[req.Status]
	if !ok {
		badRequest(c, "未知的目标状态")
		return
	}

	if !slices.Contains(allowedRoles, roleStr) {
		forbidden(c, "当前角色无权流转到该状态")
		return
	}

	// 3. 逐个处理订单，收集结果
	// 每个订单的状态更新 + 时间线记录在同一个事务内完成，保证原子性。
	results := make([]BatchUpdateResult, 0, len(req.OrderIDs))
	successCount := 0

	for _, orderID := range req.OrderIDs {
		result := BatchUpdateResult{OrderID: orderID}

		// 查询订单 (事务外预检，减少不必要的事务开销)
		var order models.Order
		if err := models.DB.First(&order, orderID).Error; err != nil {
			result.Error = "订单不存在"
			results = append(results, result)
			continue
		}
		result.OrderSN = order.OrderSN

		// 属主权限校验
		if roleStr == "designer" && order.DesignerID != uidStr {
			result.Error = "只能操作指派给自己的订单"
			results = append(results, result)
			continue
		}
		if roleStr == "sales" && order.OperatorID != uidStr {
			result.Error = "只能操作自己录入的订单"
			results = append(results, result)
			continue
		}

		// 在单个事务中执行: 状态更新 + 时间线记录
		oldStatus := order.Status
		var updatedOrder *models.Order
		txErr := models.WriteTx(func(tx *gorm.DB) error {
			var err error
			updatedOrder, err = services.UpdateOrderStatusInTx(tx, orderID, req.Status)
			if err != nil {
				return err
			}

			// 时间线记录与状态更新在同一事务中
			return tx.Create(&models.OrderTimeline{
				OrderID:      updatedOrder.ID,
				EventType:    "status_changed",
				FromStatus:   oldStatus,
				ToStatus:     req.Status,
				OperatorID:   uidStr,
				OperatorName: operatorName,
				Remark:       "批量操作",
			}).Error
		})

		if txErr != nil {
			result.Error = txErr.Error()
			results = append(results, result)
			continue
		}

		// 事务提交后触发副作用 (分润等)
		services.PostStatusChangeEffects(updatedOrder, req.Status)

		result.Success = true
		results = append(results, result)
		successCount++

		// WebSocket 广播
		services.Hub.Broadcast(services.WSEvent{
			Type:    "order_updated",
			Payload: updatedOrder,
		})

		// 异步发送状态变更通知
		SendOrderStatusNotification(updatedOrder, req.Status)
	}

	respondOK(c, gin.H{
		"message":       fmt.Sprintf("批量操作完成: %d/%d 成功", successCount, len(req.OrderIDs)),
		"success_count": successCount,
		"fail_count":    len(req.OrderIDs) - successCount,
		"results":       results,
	})
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
	if limit <= 0 || limit > models.PaginationMax {
		limit = models.PaginationDefault
	}

	query := models.DB.Model(&models.Order{})

	// 所有已认证用户均可查看全部订单（操作权限仍按角色控制）
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr == "" {
		forbidden(c, "未知角色，无权访问")
		return
	}

	if status != "" {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		query = query.Where("order_sn LIKE ? ESCAPE '\\' OR customer_contact LIKE ? ESCAPE '\\' OR topic LIKE ? ESCAPE '\\'", like, like, like)
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
	if err := query.Count(&total).Error; err != nil {
		log.Printf("ListOrders 统计总数失败: %v", err)
		internalError(c, "查询订单失败，请稍后重试")
		return
	}

	var orders []models.Order
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&orders).Error; err != nil {
		log.Printf("ListOrders 查询订单列表失败: %v", err)
		internalError(c, "查询订单失败，请稍后重试")
		return
	}

	respondOK(c, gin.H{"data": orders, "total": total})
}

// GetOrder 获取单个订单详情 (含角色权限校验)
func GetOrder(c *gin.Context) {
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

	respondOK(c, order)
}

// ─── 金额/页数修改 ──────────────────────────────────

type UpdateOrderAmountReq struct {
	Price  *int   `json:"price"`  // 新金额(分), 可选
	Pages  *int   `json:"pages"`  // 新页数, 可选
	Remark string `json:"remark"` // 修改原因
}

// UpdateOrderAmount 修改订单金额和/或页数（designer 只能改自己的订单，admin 可改任意）
func UpdateOrderAmount(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	var req UpdateOrderAmountReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("UpdateOrderAmount 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	// 至少修改一项
	if req.Price == nil && req.Pages == nil {
		badRequest(c, "请至少提供新金额或新页数")
		return
	}

	// 校验金额范围
	if req.Price != nil {
		if *req.Price <= 0 {
			badRequest(c, "价格必须大于0")
			return
		}
		if *req.Price > models.MaxOrderPrice {
			badRequest(c, "价格超出合理范围（最大999999分）")
			return
		}
	}

	// 校验页数范围
	if req.Pages != nil && *req.Pages < 0 {
		badRequest(c, "页数不能为负数")
		return
	}

	// 获取当前操作人信息
	userID, _ := c.Get("wecom_userid")
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	uidStr, _ := userID.(string)

	// 权限校验: 仅 designer 和 admin 可修改
	if roleStr != "admin" && roleStr != "designer" {
		forbidden(c, "当前角色无权修改订单金额")
		return
	}

	// 查询订单
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// designer 只能修改自己的订单
	if roleStr == "designer" && order.DesignerID != uidStr {
		forbidden(c, "只能修改指派给自己的订单")
		return
	}

	// 终态订单不允许修改
	if order.Status == models.StatusRefunded || order.Status == models.StatusClosed || order.Status == models.StatusCompleted {
		badRequest(c, "终态订单不允许修改金额/页数")
		return
	}

	// 记录修改前的值
	oldPrice := order.Price
	oldPages := order.Pages

	// 获取操作人姓名
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	// 在事务中执行更新 + 写入审计日志
	err = models.WriteTx(func(tx *gorm.DB) error {
		updates := map[string]interface{}{}

		if req.Price != nil && *req.Price != oldPrice {
			updates["price"] = *req.Price
		}
		if req.Pages != nil && *req.Pages != oldPages {
			updates["pages"] = *req.Pages
		}

		if len(updates) == 0 {
			return nil // 值未变化，无需更新
		}

		// 更新订单字段
		if err := tx.Model(&order).Updates(updates).Error; err != nil {
			return err
		}

		// 写入金额变更审计日志
		if req.Price != nil && *req.Price != oldPrice {
			if err := tx.Create(&models.OrderTimeline{
				OrderID:      order.ID,
				EventType:    "amount_changed",
				OldValue:     strconv.Itoa(oldPrice),
				NewValue:     strconv.Itoa(*req.Price),
				OperatorID:   uidStr,
				OperatorName: operatorName,
				Remark:       req.Remark,
			}).Error; err != nil {
				return err
			}
		}

		// 写入页数变更审计日志
		if req.Pages != nil && *req.Pages != oldPages {
			if err := tx.Create(&models.OrderTimeline{
				OrderID:      order.ID,
				EventType:    "pages_changed",
				OldValue:     strconv.Itoa(oldPages),
				NewValue:     strconv.Itoa(*req.Pages),
				OperatorID:   uidStr,
				OperatorName: operatorName,
				Remark:       req.Remark,
			}).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		log.Printf("UpdateOrderAmount 事务失败: order_id=%d err=%v", id, err)
		internalError(c, "更新失败，请稍后重试")
		return
	}

	// 重新查询最新订单数据
	models.DB.First(&order, uint(id))

	// 金额变更后触发分润重算（异步）
	if req.Price != nil && *req.Price != oldPrice {
		services.TriggerProfitRecalculation(order.ID)
	}

	respondOK(c, gin.H{"message": "订单金额/页数已更新", "order": order})

	// WebSocket 广播订单变更
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})
}

// ─── 转派 ──────────────────────────────────────

type ReassignOrderReq struct {
	DesignerUserID string `json:"designer_userid" binding:"required"`
}

// ReassignOrder 管理员转派订单给另一个设计师
// PUT /api/v1/orders/:id/reassign
func ReassignOrder(c *gin.Context) {
	// 1. 权限校验: 仅 admin
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" {
		forbidden(c, "仅管理员可执行转派操作")
		return
	}

	// 2. 解析订单 ID
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	// 3. 解析请求体
	var req ReassignOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("ReassignOrder 参数绑定失败: %v", err)
		badRequest(c, "请提供目标设计师ID (designer_userid)")
		return
	}

	// 4. 获取操作人
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	// 5. 调用 service
	updatedOrder, err := services.ReassignOrder(uint(id), req.DesignerUserID, uidStr)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	respondOK(c, gin.H{"message": "订单已成功转派", "order": updatedOrder})

	// 6. WebSocket 广播
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: updatedOrder,
	})
}

// ─── 匹配好友 ──────────────────────────────────

// ListPendingMatchOrders 查询待匹配好友的 PENDING 订单（客户尚未关联 ExternalUserID）
func ListPendingMatchOrders(c *gin.Context) {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "无权访问")
		return
	}

	operatorID := c.Query("operator_id")

	subquery := models.DB.Model(&models.Customer{}).Select("id").
		Where("external_user_id = '' OR external_user_id IS NULL")

	query := models.DB.Where("status = ?", models.StatusPending).
		Where("customer_id IS NULL OR customer_id = 0 OR customer_id IN (?)", subquery)

	if operatorID != "" {
		query = query.Where("operator_id = ?", operatorID)
	}

	var orders []models.Order
	if err := query.Order("created_at DESC").Limit(100).Find(&orders).Error; err != nil {
		log.Printf("ListPendingMatchOrders 查询失败: %v", err)
		internalError(c, "查询待匹配订单失败，请稍后重试")
		return
	}

	// 补充客户联系方式信息 (批量查询替代 N+1)
	type enrichedOrder struct {
		models.Order
		CustomerNickname string `json:"customer_nickname"`
		CustomerMobile   string `json:"customer_mobile"`
		CustomerWechatID string `json:"customer_wechat_id"`
	}

	// 收集所有需要查询的 customer ID
	customerIDs := make([]uint, 0, len(orders))
	for _, o := range orders {
		if o.CustomerID > 0 {
			customerIDs = append(customerIDs, o.CustomerID)
		}
	}

	// 批量查询客户信息
	customerMap := make(map[uint]models.Customer, len(customerIDs))
	if len(customerIDs) > 0 {
		var customers []models.Customer
		if err := models.DB.Where("id IN ?", customerIDs).Find(&customers).Error; err != nil {
			log.Printf("ListPendingMatchOrders 批量查询客户失败: %v", err)
		} else {
			for _, cust := range customers {
				customerMap[cust.ID] = cust
			}
		}
	}

	result := make([]enrichedOrder, 0, len(orders))
	for _, o := range orders {
		item := enrichedOrder{Order: o}
		if cust, ok := customerMap[o.CustomerID]; ok {
			item.CustomerNickname = cust.Nickname
			item.CustomerMobile = cust.Mobile
			item.CustomerWechatID = cust.WechatID
		}
		result = append(result, item)
	}

	respondList(c, result, len(result))
}

// MatchOrderContact 将待匹配订单关联到外部联系人
func MatchOrderContact(c *gin.Context) {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "无权操作")
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	var body struct {
		ExternalUserID string `json:"external_user_id" binding:"required"`
		Nickname       string `json:"nickname"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供 external_user_id")
		return
	}

	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}
	if order.Status != models.StatusPending {
		badRequest(c, "只能匹配 PENDING 状态的订单")
		return
	}

	operatorID, _ := c.Get("wecom_userid")
	uidStr, _ := operatorID.(string)
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	var customerIDToKeep uint

	err = models.WriteTx(func(tx *gorm.DB) error {
		if order.CustomerID > 0 {
			customerIDToKeep = order.CustomerID
			// 更新已有客户的 ExternalUserID
			if err := tx.Model(&models.Customer{}).Where("id = ?", order.CustomerID).
				Update("external_user_id", body.ExternalUserID).Error; err != nil {
				return err
			}
			// 补充昵称（如果原来为空）
			if body.Nickname != "" {
				tx.Model(&models.Customer{}).
					Where("id = ? AND (nickname = '' OR nickname IS NULL)", order.CustomerID).
					Update("nickname", body.Nickname)
			}
		} else {
			// 订单没有关联客户，创建新客户记录
			cust := models.Customer{
				ExternalUserID: body.ExternalUserID,
				Nickname:       body.Nickname,
			}
			if err := tx.Create(&cust).Error; err != nil {
				return err
			}
			customerIDToKeep = cust.ID
			if err := tx.Model(&order).Update("customer_id", cust.ID).Error; err != nil {
				return err
			}
		}

		// 合并回调创建的重复客户记录（仅有 external_user_id 无关联订单的幽灵记录）
		var duplicates []models.Customer
		tx.Where("external_user_id = ? AND id != ?", body.ExternalUserID, customerIDToKeep).Find(&duplicates)
		for _, dup := range duplicates {
			var orderCount int64
			tx.Model(&models.Order{}).Where("customer_id = ?", dup.ID).Count(&orderCount)
			if orderCount == 0 {
				tx.Delete(&dup)
				log.Printf("合并重复客户记录 | deleted_id=%d | kept_id=%d | external_user_id=%s", dup.ID, customerIDToKeep, body.ExternalUserID)
			}
		}

		// 写入时间线事件
		return tx.Create(&models.OrderTimeline{
			OrderID:      order.ID,
			EventType:    "customer_matched",
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       "关联外部联系人: " + body.ExternalUserID,
		}).Error
	})

	if err != nil {
		log.Printf("MatchOrderContact 事务失败: order_id=%d err=%v", id, err)
		internalError(c, "匹配失败，请稍后重试")
		return
	}

	// 重新查询最新订单数据并广播
	models.DB.First(&order, uint(id))
	respondOK(c, gin.H{"message": "订单已成功关联外部联系人", "order": order})

	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})
}

// ─── 个人统计 (所有角色可用) ──────────────────────────────────

// GetMyStats 返回当前用户角色相关的订单统计数据（非管理员仪表盘）
func GetMyStats(c *gin.Context) {
	roleVal, _ := c.Get("role")
	uidVal, _ := c.Get("wecom_userid")
	role, _ := roleVal.(string)
	uid, _ := uidVal.(string)

	log.Printf("[GetMyStats] role=%q uid=%q roleVal=%v(%T) uidVal=%v(%T)", role, uid, roleVal, roleVal, uidVal, uidVal)

	if uid == "" {
		log.Printf("[GetMyStats] WARNING: uid is empty! JWT context keys dump:")
		if claims, ok := c.Get("jwt_claims"); ok {
			log.Printf("[GetMyStats] jwt_claims=%v", claims)
		}
	}

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// 基础查询：按角色过滤
	baseQ := func() *gorm.DB {
		q := models.DB.Model(&models.Order{})
		q, _ = filterByRole(q, role, uid)
		return q
	}

	var totalOrders, pendingOrders, designingOrders, deliveredOrders, completedOrders, todayOrders int64
	var totalRevenue, todayRevenue int64

	baseQ().Count(&totalOrders)
	baseQ().Where("status IN ?", []string{"PENDING", "GROUP_CREATED", "CONFIRMED"}).Count(&pendingOrders)
	baseQ().Where("status = ?", "DESIGNING").Count(&designingOrders)
	baseQ().Where("status = ?", "DELIVERED").Count(&deliveredOrders)
	baseQ().Where("status = ?", "COMPLETED").Count(&completedOrders)
	baseQ().Where("created_at >= ?", todayStart).Count(&todayOrders)

	// 营收统计（已完成订单的 price 总和）
	baseQ().Where("status IN ?", []string{"COMPLETED", "DELIVERED", "DESIGNING"}).
		Select("COALESCE(SUM(price), 0)").Scan(&totalRevenue)
	baseQ().Where("created_at >= ?", todayStart).
		Select("COALESCE(SUM(price), 0)").Scan(&todayRevenue)

	log.Printf("[GetMyStats] results: total=%d pending=%d designing=%d delivered=%d completed=%d today=%d revenue=%d",
		totalOrders, pendingOrders, designingOrders, deliveredOrders, completedOrders, todayOrders, totalRevenue)

	// 最近订单（最新5条）
	var recentOrders []models.Order
	q := models.DB.Model(&models.Order{}).Order("created_at DESC").Limit(5)
	q, _ = filterByRole(q, role, uid)
	q.Find(&recentOrders)

	respondOK(c, gin.H{
		"role":             role,
		"total_orders":     totalOrders,
		"pending_orders":   pendingOrders,
		"designing_orders": designingOrders,
		"delivered_orders": deliveredOrders,
		"completed_orders": completedOrders,
		"today_orders":     todayOrders,
		"total_revenue":    totalRevenue,
		"today_revenue":    todayRevenue,
		"recent_orders":    recentOrders,
	})
}
