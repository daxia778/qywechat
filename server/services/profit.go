package services

import (
	"fmt"
	"log"
	"math"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"gorm.io/gorm"
)

// ProfitResult 分润计算结果
type ProfitResult struct {
	OrderID            uint `json:"order_id"`
	TotalAmount        int  `json:"total_amount"`        // 订单总金额（分）= Price + ExtraPrice
	PlatformFee        int  `json:"platform_fee"`        // 平台手续费 = TotalAmount * PLATFORM_FEE_RATE / 100
	DesignerCommission int  `json:"designer_commission"` // 设计师佣金 = TotalAmount * DESIGNER_COMMISSION_RATE / 100
	SalesCommission    int  `json:"sales_commission"`    // 谈单客服佣金 = TotalAmount * SALES_COMMISSION_RATE / 100
	FollowCommission   int  `json:"follow_commission"`   // 跟单客服佣金 = TotalAmount * FOLLOW_COMMISSION_RATE / 100
	NetProfit          int  `json:"net_profit"`          // 净利润 = TotalAmount - 以上四项
}

// CalculateProfit 计算指定订单的分润（纯计算，不写库）
// 1. 查询订单获取基础金额 (Price) 和加页费用 (ExtraPrice)
// 2. 计算总金额 = Price + ExtraPrice
// 3. 按费率计算各方分润（四舍五入）
// 4. 返回结果
//
// 注意: PaymentRecord 模型尚未实现，待后续追加收款功能上线后在此处补充汇总逻辑
func CalculateProfit(db *gorm.DB, orderID uint) (*ProfitResult, error) {
	var order models.Order
	if err := db.First(&order, orderID).Error; err != nil {
		return nil, fmt.Errorf("订单不存在: %w", err)
	}

	// 退款订单不计入分润，全部清零
	if order.Status == models.StatusRefunded {
		return &ProfitResult{
			OrderID:     orderID,
			TotalAmount: 0,
		}, nil
	}

	// 总金额 = 基础价格 + 加页费用
	// TODO: 待 PaymentRecord 模型上线后，在此处汇总关联的追加收款金额
	totalAmount := order.Price + order.ExtraPrice

	// 从配置读取费率（百分比整数，0-100）
	platformRate := config.C.PlatformFeeRate
	designerRate := config.C.DesignerCommissionRate
	salesRate := config.C.SalesCommissionRate
	followRate := config.C.FollowCommissionRate

	// 使用 math.Round 四舍五入，避免整数截断偏差
	platformFee := int(math.Round(float64(totalAmount) * float64(platformRate) / 100.0))
	designerCommission := int(math.Round(float64(totalAmount) * float64(designerRate) / 100.0))
	salesCommission := int(math.Round(float64(totalAmount) * float64(salesRate) / 100.0))
	followCommission := int(math.Round(float64(totalAmount) * float64(followRate) / 100.0))

	// 净利润 = 总金额 - 四项支出
	netProfit := totalAmount - platformFee - designerCommission - salesCommission - followCommission

	return &ProfitResult{
		OrderID:            orderID,
		TotalAmount:        totalAmount,
		PlatformFee:        platformFee,
		DesignerCommission: designerCommission,
		SalesCommission:    salesCommission,
		FollowCommission:   followCommission,
		NetProfit:          netProfit,
	}, nil
}

// RecalculateAndSave 重算分润并保存到订单记录
// 在事务内完成计算+更新，保证数据一致性
func RecalculateAndSave(db *gorm.DB, orderID uint) error {
	result, err := CalculateProfit(db, orderID)
	if err != nil {
		return fmt.Errorf("分润计算失败: %w", err)
	}

	updateFields := map[string]any{
		"platform_fee":        result.PlatformFee,
		"designer_commission": result.DesignerCommission,
		"sales_commission":    result.SalesCommission,
		"follow_commission":   result.FollowCommission,
		"net_profit":          result.NetProfit,
	}

	if err := db.Model(&models.Order{}).Where("id = ?", orderID).Updates(updateFields).Error; err != nil {
		return fmt.Errorf("分润落库失败: %w", err)
	}

	log.Printf("✅ 分润计算完成 | orderID=%d | total=%d | platform=%d | designer=%d | sales=%d | follow=%d | net=%d",
		orderID, result.TotalAmount,
		result.PlatformFee, result.DesignerCommission,
		result.SalesCommission, result.FollowCommission,
		result.NetProfit)

	return nil
}

// ClearProfitFields 清空订单的分润字段（用于退款等场景）
func ClearProfitFields(db *gorm.DB, orderID uint) error {
	updateFields := map[string]any{
		"platform_fee":        0,
		"designer_commission": 0,
		"sales_commission":    0,
		"follow_commission":   0,
		"net_profit":          0,
	}
	if err := db.Model(&models.Order{}).Where("id = ?", orderID).Updates(updateFields).Error; err != nil {
		return fmt.Errorf("清空分润字段失败: %w", err)
	}
	log.Printf("✅ 分润字段已清零 | orderID=%d (退款)", orderID)
	return nil
}

// TriggerProfitRecalculation 异步触发分润重算（用于非事务场景）
// 在 goroutine 中执行，错误仅记录日志不阻塞主流程
func TriggerProfitRecalculation(orderID uint) {
	go func() {
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return RecalculateAndSave(tx, orderID)
		}); err != nil {
			log.Printf("❌ 异步分润重算失败 | orderID=%d err=%v", orderID, err)
		}
	}()
}
