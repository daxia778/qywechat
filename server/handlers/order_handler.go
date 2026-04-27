package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
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

	// 读取文件头判断真实类型
	src, err := file.Open()
	if err != nil {
		badRequest(c, "无法读取文件")
		return
	}
	defer src.Close()

	// 读取全部文件内容用于类型检测 + SHA256 哈希计算
	fileBytes, err := io.ReadAll(src)
	if err != nil {
		badRequest(c, "无法读取文件内容")
		return
	}

	contentType := http.DetectContentType(fileBytes[:min(512, len(fileBytes))])

	allowedTypes := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/webp": true,
		"image/gif":  true,
	}
	if !allowedTypes[contentType] {
		badRequest(c, "仅支持 JPG/PNG/WebP/GIF 图片格式")
		return
	}

	// 计算截图 SHA256 哈希（防篡改校验）
	hashBytes := sha256.Sum256(fileBytes)
	screenshotHash := hex.EncodeToString(hashBytes[:])

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

	// 将 OCR 结果、截图 URL 和哈希一起返回
	respondOK(c, gin.H{
		"order_sn":        result.OrderSN,
		"price":           result.Price,
		"raw_price":       result.RawPrice,
		"order_time":      result.OrderTime,
		"confidence":      result.Confidence,
		"screenshot_url":  uploadResult.URL,
		"screenshot_hash": screenshotHash,
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

	// 读取文件头判断真实类型
	src, err := file.Open()
	if err != nil {
		badRequest(c, "无法读取文件")
		return
	}
	defer src.Close()

	buf := make([]byte, 512)
	n, _ := src.Read(buf)
	contentType := http.DetectContentType(buf[:n])

	allowedTypes := map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/webp": true,
		"image/gif":  true,
	}
	if !allowedTypes[contentType] {
		badRequest(c, "仅支持 JPG/PNG/WebP/GIF 图片格式")
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
	ScreenshotHash  string   `json:"screenshot_hash"`
	AttachmentURLs  []string `json:"attachment_urls"`
	FollowUID       string   `json:"follow_uid"`
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
		deadline = parseFlexibleDeadline(req.Deadline)
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

	// 截图哈希校验: 如果提交了 screenshot_hash，验证格式合法（64位hex SHA256）
	if req.ScreenshotHash != "" && len(req.ScreenshotHash) != 64 {
		badRequest(c, "screenshot_hash 格式无效")
		return
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
		req.Topic, req.Remark, req.ScreenshotURL, req.ScreenshotHash, attachmentURLsJSON, req.FollowUID, req.Price, req.Pages, deadline,
	)
	if err != nil {
		log.Printf("创建订单失败: %v", err)
		internalError(c, "创建订单失败，请稍后重试")
		return
	}

	respondOK(c, order)

	// 异步通知跟单客服有新订单（WebSocket + 企微消息）
	go func() {
		// WebSocket 广播给所有在线用户
		services.Hub.Broadcast(services.WSEvent{
			Type:    "order_created",
			Payload: order,
		})

		// 企微消息通知跟单客服
		if order.FollowOperatorID != "" && services.Wecom.IsConfigured() {
			operName := ""
			if name, exists := c.Get("name"); exists {
				operName, _ = name.(string)
			}

			// 构建通知消息（包含备注信息）
			remarkLine := ""
			if order.Remark != "" {
				remarkLine = fmt.Sprintf("\n**备注**: %s", order.Remark)
			}
			msg := fmt.Sprintf("# 📋 新订单分配\n**订单号**: `%s`\n**主题**: %s\n**价格**: <font color=\"warning\">%.2f 元</font>\n**页数**: %d\n**谈单**: %s\n>**客户联系方式**: <font color=\"info\">%s</font>%s\n\n请尽快联系客户！",
				order.OrderSN,
				order.Topic,
				float64(order.Price)/100,
				order.Pages,
				operName,
				order.CustomerContact,
				remarkLine,
			)
			if err := services.Wecom.SendMarkdownMessage([]string{order.FollowOperatorID}, msg); err != nil {
				log.Printf("⚠️ 新订单通知跟单客服失败: sn=%s follow=%s err=%v", order.OrderSN, order.FollowOperatorID, err)
			}

			// 发送订单截图给跟单客服（如果有）
			if order.ScreenshotPath != "" {
				if mediaID, err := services.Wecom.UploadMediaFromURL(order.ScreenshotPath); err != nil {
					log.Printf("⚠️ 订单截图上传企微失败: sn=%s err=%v", order.OrderSN, err)
				} else {
					if err := services.Wecom.SendImageMessage([]string{order.FollowOperatorID}, mediaID); err != nil {
						log.Printf("⚠️ 订单截图发送跟单客服失败: sn=%s err=%v", order.OrderSN, err)
					} else {
						log.Printf("✅ 订单截图已发送跟单客服 | sn=%s follow=%s", order.OrderSN, order.FollowOperatorID)
					}
				}
			}

			// 发送备注附件图片给跟单客服（如客户微信二维码、参考图等）
			if order.AttachmentURLs != "" {
				var imgURLs []string
				if err := json.Unmarshal([]byte(order.AttachmentURLs), &imgURLs); err == nil {
					for i, imgURL := range imgURLs {
						if imgURL == "" {
							continue
						}
						mediaID, err := services.Wecom.UploadMediaFromURL(imgURL)
						if err != nil {
							log.Printf("⚠️ 备注图片上传企微失败 [%d/%d]: sn=%s url=%s err=%v", i+1, len(imgURLs), order.OrderSN, imgURL, err)
							continue
						}
						if err := services.Wecom.SendImageMessage([]string{order.FollowOperatorID}, mediaID); err != nil {
							log.Printf("⚠️ 备注图片发送跟单客服失败 [%d/%d]: sn=%s err=%v", i+1, len(imgURLs), order.OrderSN, err)
						} else {
							log.Printf("✅ 备注图片已发送跟单客服 [%d/%d] | sn=%s follow=%s", i+1, len(imgURLs), order.OrderSN, order.FollowOperatorID)
						}
					}
				}
			}

			// 写入站内通知
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&models.Notification{
					UserID:   order.FollowOperatorID,
					Title:    "新订单分配",
					Content:  fmt.Sprintf("订单 %s (%s) 已分配给您，请尽快联系客户", order.OrderSN, order.Topic),
					Category: "order",
					RefID:    fmt.Sprintf("%d", order.ID),
				}).Error
			})
		}
	}()
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

	// 3. 属主权限校验 (客服只能操作自己的单子，除非是admin)
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	if roleStr == "sales" && order.OperatorID != uidStr {
		forbidden(c, "只能操作自己录入的订单")
		return
	}
	if roleStr == "follow" && order.FollowOperatorID != uidStr && order.OperatorID != uidStr {
		forbidden(c, "只能操作自己负责的订单")
		return
	}

	// 3.5 退款必须填写原因
	if body.Status == models.StatusRefunded && strings.TrimSpace(body.RefundReason) == "" {
		badRequest(c, "退款必须填写原因")
		return
	}

	// 4. 获取操作人姓名
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	// 5. 在单事务中执行: 状态流转 + 退款原因 + 时间线记录
	oldStatus := order.Status
	var updatedOrder *models.Order
	txErr := models.WriteTx(func(tx *gorm.DB) error {
		var err error
		updatedOrder, err = services.UpdateOrderStatusInTx(tx, uint(id), body.Status)
		if err != nil {
			return err
		}

		// 退款原因
		if body.Status == models.StatusRefunded && body.RefundReason != "" {
			if err := tx.Model(updatedOrder).Update("refund_reason", body.RefundReason).Error; err != nil {
				return err
			}
			updatedOrder.RefundReason = body.RefundReason
		}

		// 时间线记录
		return tx.Create(&models.OrderTimeline{
			OrderID:      updatedOrder.ID,
			EventType:    "status_changed",
			FromStatus:   oldStatus,
			ToStatus:     body.Status,
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       body.RefundReason,
		}).Error
	})

	if txErr != nil {
		badRequest(c, txErr.Error())
		return
	}

	// 6. 事务提交后触发副作用（分润等）
	services.PostStatusChangeEffects(updatedOrder, body.Status)

	respondOK(c, gin.H{"message": "状态更新成功", "order": updatedOrder})

	// 7. WebSocket 广播订单状态变更
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: updatedOrder,
	})

	// 8. 异步发送状态变更通知 (企微 + 站内)
	SendOrderStatusNotification(updatedOrder, body.Status)

	// 9. 审计播报: 跟单操作留痕
	if roleStr == "follow" || roleStr == "admin" {
		eventType := services.AuditStatusChanged
		extra := map[string]string{}

		if body.Status == models.StatusRefunded {
			eventType = services.AuditRefundProcessed
			extra["reason"] = body.RefundReason
			extra["amount"] = services.FormatPrice(updatedOrder.Price)
			// 风控检测: 异常时间操作
			services.CheckAbnormalTime(updatedOrder.ID, updatedOrder.OrderSN, "refund", uidStr, operatorName)
		}

		services.BroadcastAuditEvent(services.AuditEvent{
			Type:         eventType,
			OrderSN:      updatedOrder.OrderSN,
			OrderID:      updatedOrder.ID,
			OperatorID:   uidStr,
			OperatorName: operatorName,
			OperatorRole: roleStr,
			OldValue:     oldStatus,
			NewValue:     body.Status,
			Extra:        extra,
		})
	}
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
		if roleStr == "sales" && order.OperatorID != uidStr {
			result.Error = "只能操作自己录入的订单"
			results = append(results, result)
			continue
		}
		if roleStr == "follow" && order.FollowOperatorID != uidStr && order.OperatorID != uidStr {
			result.Error = "只能操作自己负责的订单"
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

	// 所有已认证用户均可查看全部订单列表（订单大厅）
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr == "" {
		forbidden(c, "未知角色，无权访问")
		return
	}

	if status != "" {
		statuses := strings.Split(status, ",")
		if len(statuses) == 1 {
			query = query.Where("status = ?", statuses[0])
		} else {
			query = query.Where("status IN ?", statuses)
		}
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

	// 权限校验: 仅 admin 和 follow 可修改
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "当前角色无权修改订单金额")
		return
	}

	// 查询订单
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// follow 只能修改自己负责的订单
	if roleStr == "follow" && order.FollowOperatorID != uidStr && order.OperatorID != uidStr {
		forbidden(c, "只能修改自己负责的订单")
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

		// 审计播报: 金额修改
		dropPct := 0
		if oldPrice > 0 && *req.Price < oldPrice {
			dropPct = (oldPrice - *req.Price) * 100 / oldPrice
		}
		services.BroadcastAuditEvent(services.AuditEvent{
			Type:         services.AuditAmountChanged,
			OrderSN:      order.OrderSN,
			OrderID:      order.ID,
			OperatorID:   uidStr,
			OperatorName: operatorName,
			OperatorRole: roleStr,
			OldValue:     services.FormatPrice(oldPrice),
			NewValue:     services.FormatPrice(*req.Price),
			Extra: map[string]string{
				"reason":   req.Remark,
				"drop_pct": strconv.Itoa(dropPct),
			},
		})

		// 风控检测: 金额异常下调 + 异常时间
		services.CheckPriceDrop(order.ID, order.OrderSN, oldPrice, *req.Price, uidStr, operatorName)
		services.CheckAbnormalTime(order.ID, order.OrderSN, "amount_changed", uidStr, operatorName)
	}

	respondOK(c, gin.H{"message": "订单金额/页数已更新", "order": order})

	// WebSocket 广播订单变更
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})
}

// ─── 备注 ──────────────────────────────────────

// AddOrderNote 追加订单备注
// POST /api/v1/orders/:id/note
func AddOrderNote(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	var body struct {
		Note string `json:"note" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供备注内容 (note)")
		return
	}

	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// 追加备注: 在已有备注后换行，带时间戳和操作人
	timestamp := time.Now().Format("2006-01-02 15:04")
	appendLine := fmt.Sprintf("[%s %s] %s", timestamp, operatorName, body.Note)
	newRemark := order.Remark
	if newRemark != "" {
		newRemark += "\n"
	}
	newRemark += appendLine

	err = models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.Model(&order).Update("remark", newRemark).Error; err != nil {
			return err
		}
		return tx.Create(&models.OrderTimeline{
			OrderID:      order.ID,
			EventType:    "note_added",
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       body.Note,
		}).Error
	})

	if err != nil {
		log.Printf("AddOrderNote 失败: order_id=%d err=%v", id, err)
		internalError(c, "添加备注失败，请稍后重试")
		return
	}

	models.DB.First(&order, uint(id))
	respondOK(c, gin.H{"message": "备注已添加", "order": order})
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

// ─── 跟单客服列表 (桌面端建群选择) ──────────────────────────────────

// ListFollowStaff 返回角色为 follow 且在职的跟单客服列表（含在线状态）
func ListFollowStaff(c *gin.Context) {
	var employees []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "follow", true).Find(&employees)

	result := make([]gin.H, 0, len(employees))
	for _, emp := range employees {
		result = append(result, gin.H{
			"id":            emp.ID,
			"name":          emp.Name,
			"wecom_userid":  emp.WecomUserID,
			"status":        emp.Status,
			"is_online":     services.Hub.UserClientCount(emp.WecomUserID) > 0,
			"active_orders": emp.ActiveOrderCount,
		})
	}
	respondOK(c, gin.H{"data": result})
}

// GetMyStats 返回当前用户角色相关的订单统计数据（v2.0 简化版）
func GetMyStats(c *gin.Context) {
	roleVal, _ := c.Get("role")
	uidVal, _ := c.Get("wecom_userid")
	role, _ := roleVal.(string)
	uid, _ := uidVal.(string)

	if uid == "" {
		log.Printf("[GetMyStats] WARNING: uid is empty!")
	}

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	// 基础查询：按角色过滤
	baseQ := func() *gorm.DB {
		q := models.DB.Model(&models.Order{})
		q, _ = filterByRole(q, role, uid)
		return q
	}

	var totalOrders, pendingOrders, designingOrders, completedOrders, todayOrders int64
	var totalRevenue, todayRevenue int64

	baseQ().Count(&totalOrders)
	baseQ().Where("status = ?", "PENDING").Count(&pendingOrders)
	baseQ().Where("status = ?", "DESIGNING").Count(&designingOrders)
	baseQ().Where("status = ?", "COMPLETED").Count(&completedOrders)
	baseQ().Where("created_at >= ?", todayStart).Count(&todayOrders)

	// 营收统计
	baseQ().Where("status IN ?", []string{"COMPLETED", "DESIGNING"}).
		Select("COALESCE(SUM(price), 0)").Scan(&totalRevenue)
	baseQ().Where("created_at >= ?", todayStart).
		Select("COALESCE(SUM(price), 0)").Scan(&todayRevenue)

	// ── 佣金统计 ──────────────────────────────────
	var commissionField string
	switch role {
	case "sales":
		commissionField = "sales_commission"
	case "follow":
		commissionField = "follow_commission"
	}

	var totalCommission, monthCommission int64
	if commissionField != "" {
		baseQ().Where("status = ?", "COMPLETED").
			Select("COALESCE(SUM(" + commissionField + "), 0)").Scan(&totalCommission)
		baseQ().Where("status = ? AND updated_at >= ?", "COMPLETED", monthStart).
			Select("COALESCE(SUM(" + commissionField + "), 0)").Scan(&monthCommission)
	}

	// 最近订单（最新5条）
	var recentOrders []models.Order
	q := models.DB.Model(&models.Order{}).Order("created_at DESC").Limit(5)
	q, _ = filterByRole(q, role, uid)
	q.Find(&recentOrders)

	result := gin.H{
		"role":             role,
		"total_orders":     totalOrders,
		"pending_orders":   pendingOrders,
		"designing_orders": designingOrders,
		"completed_orders": completedOrders,
		"today_orders":     todayOrders,
		"total_revenue":    totalRevenue,
		"today_revenue":    todayRevenue,
		"total_commission": totalCommission,
		"month_commission": monthCommission,
		"recent_orders":    recentOrders,
	}

	respondOK(c, result)
}

// CreateOrderGroup POST /api/v1/orders/:id/create-group — 创建企微群聊
func CreateOrderGroup(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	// 权限: admin / follow
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)

	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "当前角色无权创建群聊")
		return
	}

	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// follow 只能操作自己负责的订单
	if roleStr == "follow" && order.FollowOperatorID != uidStr && order.OperatorID != uidStr {
		forbidden(c, "只能为自己负责的订单建群")
		return
	}

	// 检查是否已有群聊
	if order.WecomChatID != "" {
		badRequest(c, "该订单已有企微群聊")
		return
	}

	// 检查订单状态: 仅 DESIGNING 状态可建群
	if order.Status != models.StatusDesigning {
		badRequest(c, "仅进行中(DESIGNING)状态的订单可创建群聊")
		return
	}

	// 检查企微是否已配置
	if !services.Wecom.IsConfigured() {
		badRequest(c, "企微未配置，无法创建群聊")
		return
	}

	// 拼装截止时间字符串
	deadlineStr := "未设置"
	if order.Deadline != nil {
		deadlineStr = order.Deadline.Format("2006-01-02 15:04")
	}

	// 解析附件图片 URL 列表
	var attachmentURLs []string
	if order.AttachmentURLs != "" {
		if err := json.Unmarshal([]byte(order.AttachmentURLs), &attachmentURLs); err != nil {
			log.Printf("⚠️ 解析订单附件URL失败: order_id=%d err=%v", id, err)
		}
	}

	chatID, err := services.Wecom.SetupOrderGroup(
		order.OrderSN,
		order.OperatorID,
		order.FollowOperatorID,
		order.Topic,
		order.Pages,
		order.Price,
		deadlineStr,
		order.Remark,
		order.CustomerContact,
		attachmentURLs,
	)
	if err != nil {
		log.Printf("CreateOrderGroup 建群失败: order_id=%d err=%v", id, err)
		internalError(c, "创建企微群聊失败: "+err.Error())
		return
	}

	if chatID == "" {
		badRequest(c, "企微未配置或建群返回为空")
		return
	}

	// 更新订单的 wecom_chat_id
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	err = models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.Model(&order).Update("wecom_chat_id", chatID).Error; err != nil {
			return err
		}
		return tx.Create(&models.OrderTimeline{
			OrderID:      order.ID,
			EventType:    "group_created",
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       "创建企微群聊: " + chatID,
		}).Error
	})

	if err != nil {
		log.Printf("CreateOrderGroup 保存chatID失败: order_id=%d err=%v", id, err)
		internalError(c, "群聊已创建但保存失败，请联系管理员")
		return
	}

	models.DB.First(&order, uint(id))
	respondOK(c, gin.H{"message": "企微群聊创建成功", "chat_id": chatID, "order": order})

	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})
}

// ─── AI 文本智能解析 ──────────────────────────────────

// ParseOrderText 从自由文本中提取结构化订单信息
// POST /api/v1/orders/parse_text
func ParseOrderText(c *gin.Context) {
	var body struct {
		Text string `json:"text" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供待解析文本 (text)")
		return
	}

	if len(body.Text) > 2000 {
		badRequest(c, "文本长度不能超过 2000 字符")
		return
	}

	result, err := services.ParseOrderText(body.Text)
	if err != nil {
		log.Printf("ParseOrderText 解析失败: %v", err)
		badRequest(c, "文本解析失败: "+err.Error())
		return
	}

	respondOK(c, result)
}

// ─── 转派订单 ──────────────────────────────────────────

// ReassignOrder 管理员转派订单给另一个设计师
// PUT /api/v1/orders/:id/reassign
func ReassignOrder(c *gin.Context) {
	idStr := c.Param("id")
	orderID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		badRequest(c, "无效的订单 ID")
		return
	}

	var body struct {
		DesignerUserID string `json:"designer_userid" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供目标设计师 designer_userid")
		return
	}

	operatorID, _ := c.Get("user_id")
	uidStr := fmt.Sprintf("%v", operatorID)

	order, err := services.ReassignOrder(uint(orderID), body.DesignerUserID, uidStr)
	if err != nil {
		badRequest(c, err.Error())
		return
	}

	respondOK(c, order)
}

// ─── 自然语言 Deadline 解析 ──────────────────────────

// parseFlexibleDeadline 解析多种格式的交付时间
// 支持: "2026-04-15 18:00" / "明天" / "后天" / "大后天" / "周五" / "4月15日" / "4/15" / "4-15"
func parseFlexibleDeadline(raw string) *time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	now := time.Now()
	loc := now.Location()
	defaultHour := 18 // 默认交付时间 18:00

	// 1. 尝试标准格式
	standardFormats := []string{
		"2006-01-02 15:04",
		"2006-01-02 15:04:05",
		"2006/01/02 15:04",
		"2006-01-02",
		"2006/01/02",
	}
	for _, layout := range standardFormats {
		if t, err := time.ParseInLocation(layout, raw, loc); err == nil {
			// 如果只有日期没有时间，补上默认交付时间
			if !strings.Contains(raw, ":") {
				t = time.Date(t.Year(), t.Month(), t.Day(), defaultHour, 0, 0, 0, loc)
			}
			return &t
		}
	}

	// 2. 相对日期: 今天/明天/后天/大后天
	relativeMap := map[string]int{
		"今天": 0, "今日": 0,
		"明天": 1, "明日": 1,
		"后天": 2,
		"大后天": 3,
	}
	if days, ok := relativeMap[raw]; ok {
		t := time.Date(now.Year(), now.Month(), now.Day()+days, defaultHour, 0, 0, 0, loc)
		return &t
	}

	// 3. 周X: "周一"~"周日" / "下周一"~"下周日"
	weekdayMap := map[string]time.Weekday{
		"周一": time.Monday, "周二": time.Tuesday, "周三": time.Wednesday,
		"周四": time.Thursday, "周五": time.Friday, "周六": time.Saturday,
		"周日": time.Sunday, "周天": time.Sunday,
	}
	nextWeek := false
	weekStr := raw
	if strings.HasPrefix(raw, "下") {
		nextWeek = true
		weekStr = strings.TrimPrefix(raw, "下")
	}
	if targetDay, ok := weekdayMap[weekStr]; ok {
		currentDay := now.Weekday()
		daysUntil := int(targetDay) - int(currentDay)
		if daysUntil <= 0 {
			daysUntil += 7 // 本周已过，跳到下周
		}
		if nextWeek {
			daysUntil += 7
		}
		t := time.Date(now.Year(), now.Month(), now.Day()+daysUntil, defaultHour, 0, 0, 0, loc)
		return &t
	}

	// 4. M月D日 / M月D号 格式
	cnDateRe := regexp.MustCompile(`(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*[日号]?(?:\s*(\d{1,2})[点:时](\d{0,2}))?`)
	if m := cnDateRe.FindStringSubmatch(raw); len(m) > 2 {
		month, _ := strconv.Atoi(m[1])
		day, _ := strconv.Atoi(m[2])
		hour := defaultHour
		minute := 0
		if len(m) > 3 && m[3] != "" {
			hour, _ = strconv.Atoi(m[3])
			if len(m) > 4 && m[4] != "" {
				minute, _ = strconv.Atoi(m[4])
			}
		}
		if month >= 1 && month <= 12 && day >= 1 && day <= 31 {
			year := now.Year()
			candidate := time.Date(year, time.Month(month), day, hour, minute, 0, 0, loc)
			// 如果日期已过，默认取明年
			if candidate.Before(now) {
				candidate = candidate.AddDate(1, 0, 0)
			}
			return &candidate
		}
	}

	log.Printf("⚠️ 无法解析 deadline: %q，将不设置截止时间", raw)
	return nil
}
