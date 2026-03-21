package handlers

import (
	"net/http"
	"strconv"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// GetProfitBreakdown 获取分润明细报表（批量，使用落库数据）
func GetProfitBreakdown(c *gin.Context) {
	// 时间范围参数，默认当月
	monthStr := c.DefaultQuery("month", time.Now().Format("2006-01"))
	startTime, err := time.Parse("2006-01", monthStr)
	if err != nil {
		startTime = time.Now().Truncate(24 * time.Hour).AddDate(0, 0, -time.Now().Day()+1)
	}
	endTime := startTime.AddDate(0, 1, 0)

	var orders []models.Order
	// 仅计算已完成的订单，排除退款等终态
	models.DB.Where("created_at >= ? AND created_at < ? AND status = ?", startTime, endTime, models.StatusCompleted).Find(&orders)

	type ProfitItem struct {
		OrderSN            string `json:"order_sn"`
		TotalPrice         int    `json:"total_price"`
		PlatformFee        int    `json:"platform_fee"`
		DesignerCommission int    `json:"designer_commission"`
		SalesCommission    int    `json:"sales_commission"`
		FollowCommission   int    `json:"follow_commission"`
		NetProfit          int    `json:"net_profit"`
		DesignerID         string `json:"designer_id"`
		OperatorID         string `json:"operator_id"`
	}

	platformRate := config.C.PlatformFeeRate
	designerRate := config.C.DesignerCommissionRate
	salesRate := config.C.SalesCommissionRate
	followRate := config.C.FollowCommissionRate

	items := make([]ProfitItem, 0, len(orders))
	var totalRevenue, totalPlatformFee, totalDesigner, totalSales, totalFollow, totalNet int

	for _, o := range orders {
		// 使用落库的分润数据（已由分润引擎预计算）
		totalPrice := o.Price + o.ExtraPrice

		items = append(items, ProfitItem{
			OrderSN:            o.OrderSN,
			TotalPrice:         totalPrice,
			PlatformFee:        o.PlatformFee,
			DesignerCommission: o.DesignerCommission,
			SalesCommission:    o.SalesCommission,
			FollowCommission:   o.FollowCommission,
			NetProfit:          o.NetProfit,
			DesignerID:         o.DesignerID,
			OperatorID:         o.OperatorID,
		})

		totalRevenue += totalPrice
		totalPlatformFee += o.PlatformFee
		totalDesigner += o.DesignerCommission
		totalSales += o.SalesCommission
		totalFollow += o.FollowCommission
		totalNet += o.NetProfit
	}

	c.JSON(http.StatusOK, gin.H{
		"month":       monthStr,
		"order_count": len(orders),
		"config": gin.H{
			"platform_fee_rate":        platformRate,
			"designer_commission_rate": designerRate,
			"sales_commission_rate":    salesRate,
			"follow_commission_rate":   followRate,
		},
		"summary": gin.H{
			"total_revenue":      totalRevenue,
			"total_platform_fee": totalPlatformFee,
			"total_designer_pay": totalDesigner,
			"total_sales_pay":    totalSales,
			"total_follow_pay":   totalFollow,
			"total_net_profit":   totalNet,
		},
		"items": items,
	})
}

// GetOrderProfit 获取单个订单的实时分润计算结果
func GetOrderProfit(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	result, err := services.CalculateProfit(models.DB, uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"profit": result,
		"config": gin.H{
			"platform_fee_rate":        config.C.PlatformFeeRate,
			"designer_commission_rate": config.C.DesignerCommissionRate,
			"sales_commission_rate":    config.C.SalesCommissionRate,
			"follow_commission_rate":   config.C.FollowCommissionRate,
		},
	})
}
