package handlers

import (
	"fmt"
	"log"
	"math"
	"strconv"

	"pdd-order-system/config"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SearchDesigners 搜索设计师花名册（支持模糊搜索）
// GET /api/v1/orders/designers?q=关键字
func SearchDesigners(c *gin.Context) {
	q := c.Query("q")
	query := models.DB.Model(&models.FreelanceDesigner{})

	if q != "" {
		like := "%" + escapeLike(q) + "%"
		query = query.Where("name LIKE ? ESCAPE '\\' OR wechat_id LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\'", like, like, like)
	}

	var designers []models.FreelanceDesigner
	if err := query.Order("total_orders DESC").Limit(50).Find(&designers).Error; err != nil {
		log.Printf("SearchDesigners 查询失败: %v", err)
		internalError(c, "查询设计师花名册失败")
		return
	}

	respondList(c, designers, len(designers))
}

// DesignerStats 设计师花名册聚合统计结构
type DesignerStats struct {
	models.FreelanceDesigner
	DesigningOrders int     `json:"designing_orders"`
	CompletedOrders int     `json:"completed_orders"`
	RefundedOrders  int     `json:"refunded_orders"`
	TotalRevenue    int     `json:"total_revenue"`
	AvgPrice        int     `json:"avg_price"`
	CompletionRate  float64 `json:"completion_rate"`
	RefundRate      float64 `json:"refund_rate"`
	LastOrderAt     *string `json:"last_order_at"`
}


// ListDesignersWithStats 设计师花名册列表（带聚合统计，使用连表优化）
// GET /api/v1/orders/designers/list
func ListDesignersWithStats(c *gin.Context) {
	keyword := c.Query("keyword")

	// 1. 使用 LEFT JOIN 和 GROUP BY 避免 N+1 查询
	query := models.DB.Table("freelance_designers d").
		Select(`
			d.*,
			COUNT(o.id) as calc_total,
			SUM(CASE WHEN o.status = 'DESIGNING' THEN 1 ELSE 0 END) as designing_orders,
			SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
			SUM(CASE WHEN o.status = 'REFUNDED' THEN 1 ELSE 0 END) as refunded_orders,
			COALESCE(SUM(o.price), 0) as total_revenue,
			COALESCE(SUM(o.designer_commission), 0) as calc_commission,
			MAX(o.created_at) as last_order_at
		`).
		Joins("LEFT JOIN orders o ON o.freelance_designer_id = d.id")

	if keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		query = query.Where("d.name LIKE ? ESCAPE '\\'", like)
	}

	query = query.Group("d.id").Order("calc_total DESC, d.id DESC")

	type RawResult struct {
		models.FreelanceDesigner
		CalcTotal        int     `gorm:"column:calc_total"`
		DesigningOrders  int     `gorm:"column:designing_orders"`
		CompletedOrders  int     `gorm:"column:completed_orders"`
		RefundedOrders   int     `gorm:"column:refunded_orders"`
		TotalRevenue     int     `gorm:"column:total_revenue"`
		CalcCommission   int     `gorm:"column:calc_commission"`
		LastOrderAt      *string `gorm:"column:last_order_at"`
	}

	var rawResults []RawResult
	if err := query.Find(&rawResults).Error; err != nil {
		log.Printf("ListDesignersWithStats 查询失败: %v", err)
		internalError(c, "查询设计师聚合统计失败")
		return
	}

	// 2. 在 Go 中计算衍生指标，避免复杂的 SQL Math
	results := make([]DesignerStats, 0, len(rawResults))
	for _, r := range rawResults {
		var completionRate, refundRate float64
		totalDone := r.CompletedOrders + r.RefundedOrders
		
		if r.CalcTotal > 0 {
			completionRate = float64(r.CompletedOrders) / float64(r.CalcTotal) * 100
		}
		if totalDone > 0 {
			refundRate = float64(r.RefundedOrders) / float64(totalDone) * 100
		}
		
		avgPrice := 0
		if r.CalcTotal > 0 {
			avgPrice = r.TotalRevenue / r.CalcTotal
		}

		ds := DesignerStats{
			FreelanceDesigner: r.FreelanceDesigner,
			DesigningOrders:   r.DesigningOrders,
			CompletedOrders:   r.CompletedOrders,
			RefundedOrders:    r.RefundedOrders,
			TotalRevenue:      r.TotalRevenue,
			AvgPrice:          avgPrice,
			CompletionRate:    math.Round(completionRate*10) / 10,
			RefundRate:        math.Round(refundRate*10) / 10,
			LastOrderAt:       r.LastOrderAt,
		}
		
		// 统一使用实时聚合的订单数与佣金
		ds.TotalOrders = r.CalcTotal
		ds.TotalCommission = r.CalcCommission 
		
		results = append(results, ds)
	}

	// 3. 汇总当前活跃情况
	var activeThisMonth int64
	models.DB.Model(&models.Order{}).
		Where("freelance_designer_id > 0 AND created_at >= date('now', 'start of month')").
		Distinct("freelance_designer_id").Count(&activeThisMonth)

	respondOK(c, gin.H{
		"summary": gin.H{
			"total_designers":      len(results),
			"active_this_month":    activeThisMonth,
		},
		"designers": results,
	})
}

// CreateDesigner 新建设计师（跟单客服/管理员权限）
// POST /api/v1/orders/designers
func CreateDesigner(c *gin.Context) {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "当前角色无权新建设计师")
		return
	}

	var body struct {
		Name      string `json:"name" binding:"required"`
		WechatID  string `json:"wechat_id"`
		Mobile    string `json:"mobile"`
		Specialty string `json:"specialty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供设计师名字")
		return
	}

	// 名字去重
	var count int64
	models.DB.Model(&models.FreelanceDesigner{}).Where("name = ?", body.Name).Count(&count)
	if count > 0 {
		conflict(c, "该设计师名字已存在")
		return
	}

	designer := models.FreelanceDesigner{
		Name:      body.Name,
		WechatID:  body.WechatID,
		Mobile:    body.Mobile,
		Specialty: body.Specialty,
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&designer).Error
	}); err != nil {
		log.Printf("CreateDesigner 失败: %v", err)
		internalError(c, "创建设计师失败")
		return
	}

	respondOK(c, designer)
}

// AssignDesigner 关联设计师到订单（跟单客服/管理员权限）
// PUT /api/v1/orders/:id/assign-designer
func AssignDesigner(c *gin.Context) {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "当前角色无权关联设计师")
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	var body struct {
		FreelanceDesignerID uint   `json:"freelance_designer_id"`
		DesignerName        string `json:"designer_name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供设计师ID或名字")
		return
	}

	if body.FreelanceDesignerID == 0 && body.DesignerName == "" {
		badRequest(c, "请提供 freelance_designer_id 或 designer_name")
		return
	}

	// 查询订单
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// 获取操作人信息
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	var designer models.FreelanceDesigner
	isReassign := order.FreelanceDesignerID > 0
	oldDesignerName := order.FreelanceDesignerName
	oldDesignerID := order.FreelanceDesignerID

	err = models.WriteTx(func(tx *gorm.DB) error {
		if body.FreelanceDesignerID > 0 {
			// 通过 ID 查找
			if err := tx.First(&designer, body.FreelanceDesignerID).Error; err != nil {
				return fmt.Errorf("设计师不存在")
			}
		} else {
			// 按名字查找，不存在则自动创建
			result := tx.Where("name = ?", body.DesignerName).First(&designer)
			if result.Error != nil {
				designer = models.FreelanceDesigner{Name: body.DesignerName}
				if err := tx.Create(&designer).Error; err != nil {
					return fmt.Errorf("自动创建设计师失败: %w", err)
				}
				log.Printf("自动创建设计师 | name=%s | id=%d", designer.Name, designer.ID)
			}
		}

		// 更新订单关联字段
		updates := map[string]any{
			"freelance_designer_id":   designer.ID,
			"freelance_designer_name": designer.Name,
		}

		// cost_price 为 0（未手动指定）时，自动设为订单总价的 25%
		if order.CostPrice == 0 {
			updates["cost_price"] = (order.Price + order.ExtraPrice) * 25 / 100
		}

		// 如果订单是 PENDING，自动流转为 DESIGNING
		if order.Status == models.StatusPending {
			updates["status"] = models.StatusDesigning
		}

		if err := tx.Model(&order).Updates(updates).Error; err != nil {
			return err
		}

		// 换人场景：旧设计师 total_orders 减一
		if isReassign {
			tx.Model(&models.FreelanceDesigner{}).
				Where("id = ? AND total_orders > 0", oldDesignerID).
				Update("total_orders", gorm.Expr("total_orders - 1"))
		}

		// 更新新设计师接单数
		tx.Model(&designer).Update("total_orders", gorm.Expr("total_orders + 1"))

		// 记录时间线
		timeline := models.OrderTimeline{
			OrderID:      order.ID,
			OperatorID:   uidStr,
			OperatorName: operatorName,
		}
		if isReassign {
			timeline.EventType = "designer_reassigned"
			timeline.Remark = fmt.Sprintf("将设计师从 %s 更换为 %s", oldDesignerName, designer.Name)
		} else {
			timeline.EventType = "designer_assigned"
			timeline.Remark = fmt.Sprintf("关联设计师: %s", designer.Name)
		}
		if order.Status == models.StatusPending {
			timeline.FromStatus = models.StatusPending
			timeline.ToStatus = models.StatusDesigning
		}
		return tx.Create(&timeline).Error
	})

	if err != nil {
		log.Printf("AssignDesigner 失败: order_id=%d err=%v", id, err)
		badRequest(c, err.Error())
		return
	}

	// cost_price 变动时触发分润重算
	services.TriggerProfitRecalculation(order.ID)

	// 重新查询订单
	models.DB.First(&order, uint(id))
	respondOK(c, gin.H{"message": "设计师已关联", "order": order})

	// WebSocket 广播
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})

	// 异步建群: 关联设计师且状态流转为 DESIGNING 时，自动建企微群
	if order.Status == models.StatusDesigning && order.WecomChatID == "" {
		go func() {
			deadlineStr := "待定"
			if order.Deadline != nil {
				deadlineStr = order.Deadline.Format("01-02 15:04")
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
			)
			if err != nil {
				log.Printf("⚠️ 自动建群失败: sn=%s err=%v", order.OrderSN, err)
				return
			}
			if chatID != "" {
				models.WriteTx(func(tx *gorm.DB) error {
					return tx.Model(&models.Order{}).Where("id = ?", order.ID).Update("wecom_chat_id", chatID).Error
				})
				log.Printf("✅ 关联设计师后自动建群 | sn=%s | chatid=%s", order.OrderSN, chatID)
			}
		}()
	}
}

// AdjustCommission 修改设计师佣金金额（跟单客服/管理员权限）
// PUT /api/v1/orders/:id/adjust-commission
func AdjustCommission(c *gin.Context) {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "当前角色无权修改佣金")
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	var body struct {
		DesignerCommission float64 `json:"designer_commission" binding:"required"` // 金额（元）
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供 designer_commission（元）")
		return
	}

	if body.DesignerCommission < 0 {
		badRequest(c, "佣金金额不能为负数")
		return
	}

	// 查询订单
	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// 获取操作人信息
	userID, _ := c.Get("wecom_userid")
	uidStr, _ := userID.(string)
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	// 计算新的佣金金额（元转分）
	totalAmount := order.Price + order.ExtraPrice
	oldCommission := order.DesignerCommission
	newCommission := int(math.Round(body.DesignerCommission * 100)) // 元→分

	if totalAmount > 0 && newCommission > totalAmount {
		badRequest(c, "佣金金额不能超过订单总额")
		return
	}

	// 反算佣金比例用于记录
	var commissionRate float64
	if totalAmount > 0 {
		commissionRate = float64(newCommission) / float64(totalAmount) * 100
	}

	// 重算其他分润字段
	platformRate := config.C.PlatformFeeRate
	salesRate := config.C.SalesCommissionRate
	followRate := config.C.FollowCommissionRate

	platformFee := int(math.Round(float64(totalAmount) * float64(platformRate) / 100.0))
	salesCommission := int(math.Round(float64(totalAmount) * float64(salesRate) / 100.0))
	followCommission := int(math.Round(float64(totalAmount) * float64(followRate) / 100.0))
	netProfit := totalAmount - platformFee - newCommission - salesCommission - followCommission

	err = models.WriteTx(func(tx *gorm.DB) error {
		updates := map[string]any{
			"designer_commission": newCommission,
			"platform_fee":       platformFee,
			"sales_commission":   salesCommission,
			"follow_commission":  followCommission,
			"net_profit":         netProfit,
			"commission_adjusted": true,
		}
		if err := tx.Model(&order).Updates(updates).Error; err != nil {
			return err
		}

		// 记录时间线
		return tx.Create(&models.OrderTimeline{
			OrderID:      order.ID,
			EventType:    "commission_adjusted",
			OldValue:     strconv.Itoa(oldCommission),
			NewValue:     strconv.Itoa(newCommission),
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       fmt.Sprintf("设计师佣金调整为 ¥%.2f（%.1f%%，%d分 -> %d分）", body.DesignerCommission, commissionRate, oldCommission, newCommission),
		}).Error
	})

	if err != nil {
		log.Printf("AdjustCommission 失败: order_id=%d err=%v", id, err)
		internalError(c, "修改佣金失败")
		return
	}

	// 重新查询订单
	models.DB.First(&order, uint(id))
	respondOK(c, gin.H{"message": "佣金已调整", "order": order})

	// WebSocket 广播
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})
}

// UpdateDesigner 编辑设计师花名册信息（跟单客服/管理员权限）
// PUT /api/v1/orders/designers/:id
func UpdateDesigner(c *gin.Context) {
	role, _ := c.Get("role")
	roleStr, _ := role.(string)
	if roleStr != "admin" && roleStr != "follow" {
		forbidden(c, "当前角色无权编辑设计师")
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的设计师ID")
		return
	}

	var body struct {
		Name      *string `json:"name"`
		WechatID  *string `json:"wechat_id"`
		Mobile    *string `json:"mobile"`
		Specialty *string `json:"specialty"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请求参数格式错误")
		return
	}

	var designer models.FreelanceDesigner
	if err := models.DB.First(&designer, uint(id)).Error; err != nil {
		notFound(c, "设计师不存在")
		return
	}

	updates := map[string]any{}
	if body.Name != nil && *body.Name != "" {
		// 名字去重（排除自身）
		var count int64
		models.DB.Model(&models.FreelanceDesigner{}).Where("name = ? AND id != ?", *body.Name, id).Count(&count)
		if count > 0 {
			conflict(c, "该设计师名字已存在")
			return
		}
		updates["name"] = *body.Name
	}
	if body.WechatID != nil {
		updates["wechat_id"] = *body.WechatID
	}
	if body.Mobile != nil {
		updates["mobile"] = *body.Mobile
	}
	if body.Specialty != nil {
		updates["specialty"] = *body.Specialty
	}

	if len(updates) == 0 {
		badRequest(c, "请至少提供一个要修改的字段")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		if err := tx.Model(&designer).Updates(updates).Error; err != nil {
			return err
		}
		// 如果修改了名字，同步更新所有关联订单的冗余字段
		if newName, ok := updates["name"]; ok {
			return tx.Model(&models.Order{}).
				Where("freelance_designer_id = ?", designer.ID).
				Update("freelance_designer_name", newName).Error
		}
		return nil
	}); err != nil {
		log.Printf("UpdateDesigner 失败: id=%d err=%v", id, err)
		internalError(c, "更新设计师信息失败")
		return
	}

	models.DB.First(&designer, uint(id))
	respondOK(c, gin.H{"message": "设计师信息已更新", "designer": designer})
}
