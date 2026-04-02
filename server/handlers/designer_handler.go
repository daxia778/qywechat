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

		// 如果订单是 PENDING，自动流转为 DESIGNING
		if order.Status == models.StatusPending {
			updates["status"] = models.StatusDesigning
		}

		if err := tx.Model(&order).Updates(updates).Error; err != nil {
			return err
		}

		// 更新花名册接单数
		tx.Model(&designer).Update("total_orders", gorm.Expr("total_orders + 1"))

		// 记录时间线
		timeline := models.OrderTimeline{
			OrderID:      order.ID,
			EventType:    "designer_assigned",
			OperatorID:   uidStr,
			OperatorName: operatorName,
			Remark:       fmt.Sprintf("关联设计师: %s", designer.Name),
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

	// 重新查询订单
	models.DB.First(&order, uint(id))
	respondOK(c, gin.H{"message": "设计师已关联", "order": order})

	// WebSocket 广播
	services.Hub.Broadcast(services.WSEvent{
		Type:    "order_updated",
		Payload: order,
	})
}

// AdjustCommission 修改设计师佣金比例（跟单客服/管理员权限）
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
		DesignerCommissionRate int `json:"designer_commission_rate" binding:"required"` // 百分比, 如 30 表示 30%
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供 designer_commission_rate")
		return
	}

	if body.DesignerCommissionRate < 0 || body.DesignerCommissionRate > 100 {
		badRequest(c, "佣金比例必须在 0-100 之间")
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

	// 计算新的佣金金额
	totalAmount := order.Price + order.ExtraPrice
	oldCommission := order.DesignerCommission
	newCommission := int(math.Round(float64(totalAmount) * float64(body.DesignerCommissionRate) / 100.0))

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
			Remark:       fmt.Sprintf("设计师佣金比例调整为 %d%%（%d分 -> %d分）", body.DesignerCommissionRate, oldCommission, newCommission),
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
