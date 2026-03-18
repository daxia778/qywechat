package handlers

import (
	"net/http"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
)

// GetProfitBreakdown 获取分润明细报表
func GetProfitBreakdown(c *gin.Context) {
	// 时间范围参数，默认当月
	monthStr := c.DefaultQuery("month", time.Now().Format("2006-01"))
	startTime, err := time.Parse("2006-01", monthStr)
	if err != nil {
		startTime = time.Now().Truncate(24 * time.Hour).AddDate(0, 0, -time.Now().Day()+1)
	}
	endTime := startTime.AddDate(0, 1, 0)

	var orders []models.Order
	// 仅计算已完成的订单，排除发生退款等终态
	models.DB.Where("created_at >= ? AND created_at < ? AND status = ?", startTime, endTime, models.StatusCompleted).Find(&orders)

	type ProfitItem struct {
		OrderSN            string `json:"order_sn"`
		TotalPrice         int    `json:"total_price"`
		PlatformFee        int    `json:"platform_fee"`
		DesignerCommission int    `json:"designer_commission"`
		OperatorCommission int    `json:"operator_commission"`
		NetProfit          int    `json:"net_profit"`
		DesignerID         string `json:"designer_id"`
		OperatorID         string `json:"operator_id"`
	}

	platformRate := config.C.PlatformFeeRate
	designerRate := config.C.DesignerCommissionRate
	operatorRate := config.C.OperatorCommissionRate

	items := make([]ProfitItem, 0, len(orders))
	var totalRevenue, totalPlatformFee, totalDesigner, totalOperator, totalNet int

	for _, o := range orders {
		pf := o.Price * platformRate / 100
		dc := o.Price * designerRate / 100
		oc := o.Price * operatorRate / 100
		np := o.Price - pf - dc - oc

		items = append(items, ProfitItem{
			OrderSN:            o.OrderSN,
			TotalPrice:         o.Price,
			PlatformFee:        pf,
			DesignerCommission: dc,
			OperatorCommission: oc,
			NetProfit:          np,
			DesignerID:         o.DesignerID,
			OperatorID:         o.OperatorID,
		})

		totalRevenue += o.Price
		totalPlatformFee += pf
		totalDesigner += dc
		totalOperator += oc
		totalNet += np
	}

	c.JSON(http.StatusOK, gin.H{
		"month":       monthStr,
		"order_count": len(orders),
		"config": gin.H{
			"platform_fee_rate":        platformRate,
			"designer_commission_rate": designerRate,
			"operator_commission_rate": operatorRate,
		},
		"summary": gin.H{
			"total_revenue":      totalRevenue,
			"total_platform_fee": totalPlatformFee,
			"total_designer_pay": totalDesigner,
			"total_operator_pay": totalOperator,
			"total_net_profit":   totalNet,
		},
		"items": items,
	})
}
