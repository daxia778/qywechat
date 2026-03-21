package handlers

import (
	"strconv"

	"pdd-order-system/config"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// GetProfitBreakdown 获取分润明细报表（批量，使用落库数据）
func GetProfitBreakdown(c *gin.Context) {
	monthStr := c.DefaultQuery("month", "")
	result := services.GetProfitBreakdown(monthStr)
	respondOK(c, result)
}

// GetOrderProfit 获取单个订单的实时分润计算结果
func GetOrderProfit(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的订单ID")
		return
	}

	result, err := services.CalculateProfit(models.DB, uint(id))
	if err != nil {
		notFound(c, "订单不存在或无法计算分润")
		return
	}

	respondOK(c, gin.H{
		"profit": result,
		"config": gin.H{
			"platform_fee_rate":        config.C.PlatformFeeRate,
			"designer_commission_rate": config.C.DesignerCommissionRate,
			"sales_commission_rate":    config.C.SalesCommissionRate,
			"follow_commission_rate":   config.C.FollowCommissionRate,
		},
	})
}
