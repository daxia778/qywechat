package services

import (
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
)

// ─── Revenue Chart ──────────────────────────────────────────

// RevenueChartDay 单日营收数据
type RevenueChartDay struct {
	Date       string `json:"date"`
	Revenue    int    `json:"revenue"`
	OrderCount int    `json:"order_count"`
}

// RevenueChartSummary 营收汇总
type RevenueChartSummary struct {
	TotalRevenue int `json:"total_revenue"`
	TotalOrders  int `json:"total_orders"`
}

// RevenueChartResult 营收折线图完整结果
type RevenueChartResult struct {
	Summary RevenueChartSummary `json:"summary"`
	Data    []RevenueChartDay   `json:"data"`
}

// GetRevenueChart 查询最近 N 天的营收折线数据
// 单次聚合查询获取有数据的日期，再填充空白日期保证连续
func GetRevenueChart(days int) *RevenueChartResult {
	startDate := time.Now().AddDate(0, 0, -(days - 1)).Truncate(24 * time.Hour)

	type aggRow struct {
		Day        string `gorm:"column:day"`
		Revenue    int    `gorm:"column:revenue"`
		OrderCount int    `gorm:"column:order_count"`
	}
	var rows []aggRow
	models.DB.Model(&models.Order{}).
		Select("strftime('%Y-%m-%d', created_at) as day, COALESCE(SUM(price), 0) as revenue, COUNT(*) as order_count").
		Where("created_at >= ?", startDate).
		Group("day").
		Order("day ASC").
		Find(&rows)

	// 构建日期到聚合结果的映射
	dayMap := make(map[string]aggRow, len(rows))
	for _, r := range rows {
		dayMap[r.Day] = r
	}

	// 填充完整日期范围（含无数据的日期）
	data := make([]RevenueChartDay, 0, days)
	totalRevenue := 0
	totalOrders := 0
	for i := days - 1; i >= 0; i-- {
		d := time.Now().AddDate(0, 0, -i).Truncate(24 * time.Hour)
		dateStr := d.Format("2006-01-02")
		dd := RevenueChartDay{Date: dateStr}
		if agg, ok := dayMap[dateStr]; ok {
			dd.Revenue = agg.Revenue
			dd.OrderCount = agg.OrderCount
		}
		data = append(data, dd)
		totalRevenue += dd.Revenue
		totalOrders += dd.OrderCount
	}

	return &RevenueChartResult{
		Summary: RevenueChartSummary{
			TotalRevenue: totalRevenue,
			TotalOrders:  totalOrders,
		},
		Data: data,
	}
}

// ─── Team Workload ──────────────────────────────────────────

// WorkloadItem 单个员工的工作负载数据
type WorkloadItem struct {
	Name            string  `json:"name"`
	WecomUserID     string  `json:"wecom_userid"`
	Role            string  `json:"role"`
	Status          string  `json:"status"`
	ActiveOrders    int64   `json:"active_orders"`
	GrabTimeoutRate float64 `json:"grab_timeout_rate"`
}

// GetTeamWorkload 查询所有活跃员工的工作负载统计
// 包含设计师/客服的活跃订单数和抢单超时率
func GetTeamWorkload() []WorkloadItem {
	var employees []models.Employee
	models.DB.Where("is_active = ?", true).Find(&employees)

	// 批量查询设计师活跃订单数
	type countRow struct {
		UserID string `gorm:"column:user_id"`
		Count  int64  `gorm:"column:cnt"`
	}
	var designerCounts []countRow
	models.DB.Model(&models.Order{}).
		Select("designer_id as user_id, COUNT(*) as cnt").
		Where("status IN ?", []string{models.StatusGroupCreated, models.StatusDesigning}).
		Group("designer_id").
		Find(&designerCounts)

	// 批量查询客服/管理员活跃订单数
	var operatorCounts []countRow
	models.DB.Model(&models.Order{}).
		Select("operator_id as user_id, COUNT(*) as cnt").
		Where("status IN ?", []string{models.StatusPending, models.StatusGroupCreated, models.StatusDesigning, models.StatusDelivered}).
		Group("operator_id").
		Find(&operatorCounts)

	// 构建映射
	designerMap := make(map[string]int64, len(designerCounts))
	for _, r := range designerCounts {
		designerMap[r.UserID] = r.Count
	}
	operatorMap := make(map[string]int64, len(operatorCounts))
	for _, r := range operatorCounts {
		operatorMap[r.UserID] = r.Count
	}

	// 批量查询设计师抢单超时率
	grabStats, _ := GetDesignerGrabStats()
	timeoutRateMap := make(map[string]float64, len(grabStats))
	for _, s := range grabStats {
		if uid, ok := s["designer_id"].(string); ok {
			if rate, ok := s["timeout_rate"].(float64); ok {
				timeoutRateMap[uid] = rate
			}
		}
	}

	result := make([]WorkloadItem, 0, len(employees))
	for _, d := range employees {
		var count int64
		switch d.Role {
		case "designer":
			count = designerMap[d.WecomUserID]
		case "sales", "admin":
			count = operatorMap[d.WecomUserID]
		}

		result = append(result, WorkloadItem{
			Name:            d.Name,
			WecomUserID:     d.WecomUserID,
			Role:            d.Role,
			Status:          d.Status,
			ActiveOrders:    count,
			GrabTimeoutRate: timeoutRateMap[d.WecomUserID],
		})
	}

	return result
}

// ─── Profit Breakdown ──────────────────────────────────────────

// ProfitBreakdownItem 单个订单的分润明细
type ProfitBreakdownItem struct {
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

// ProfitBreakdownConfig 分润配置费率
type ProfitBreakdownConfig struct {
	PlatformFeeRate        int `json:"platform_fee_rate"`
	DesignerCommissionRate int `json:"designer_commission_rate"`
	SalesCommissionRate    int `json:"sales_commission_rate"`
	FollowCommissionRate   int `json:"follow_commission_rate"`
}

// ProfitBreakdownSummary 分润汇总
type ProfitBreakdownSummary struct {
	TotalRevenue     int `json:"total_revenue"`
	TotalPlatformFee int `json:"total_platform_fee"`
	TotalDesignerPay int `json:"total_designer_pay"`
	TotalSalesPay    int `json:"total_sales_pay"`
	TotalFollowPay   int `json:"total_follow_pay"`
	TotalNetProfit   int `json:"total_net_profit"`
}

// ProfitBreakdownResult 分润明细报表完整结果
type ProfitBreakdownResult struct {
	Month      string                 `json:"month"`
	OrderCount int                    `json:"order_count"`
	Config     ProfitBreakdownConfig  `json:"config"`
	Summary    ProfitBreakdownSummary `json:"summary"`
	Items      []ProfitBreakdownItem  `json:"items"`
}

// GetProfitBreakdown 获取指定月份的分润明细报表
// monthStr 为空时默认当月，格式 "2006-01"
func GetProfitBreakdown(monthStr string) *ProfitBreakdownResult {
	if monthStr == "" {
		monthStr = time.Now().Format("2006-01")
	}
	startTime, err := time.Parse("2006-01", monthStr)
	if err != nil {
		startTime = time.Now().Truncate(24 * time.Hour).AddDate(0, 0, -time.Now().Day()+1)
		monthStr = startTime.Format("2006-01")
	}
	endTime := startTime.AddDate(0, 1, 0)

	var orders []models.Order
	// 仅计算已完成的订单，排除退款等终态
	models.DB.Where("created_at >= ? AND created_at < ? AND status = ?", startTime, endTime, models.StatusCompleted).Find(&orders)

	items := make([]ProfitBreakdownItem, 0, len(orders))
	var totalRevenue, totalPlatformFee, totalDesigner, totalSales, totalFollow, totalNet int

	for _, o := range orders {
		// 使用落库的分润数据（已由分润引擎预计算）
		totalPrice := o.Price + o.ExtraPrice

		items = append(items, ProfitBreakdownItem{
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

	return &ProfitBreakdownResult{
		Month:      monthStr,
		OrderCount: len(orders),
		Config: ProfitBreakdownConfig{
			PlatformFeeRate:        config.C.PlatformFeeRate,
			DesignerCommissionRate: config.C.DesignerCommissionRate,
			SalesCommissionRate:    config.C.SalesCommissionRate,
			FollowCommissionRate:   config.C.FollowCommissionRate,
		},
		Summary: ProfitBreakdownSummary{
			TotalRevenue:     totalRevenue,
			TotalPlatformFee: totalPlatformFee,
			TotalDesignerPay: totalDesigner,
			TotalSalesPay:    totalSales,
			TotalFollowPay:   totalFollow,
			TotalNetProfit:   totalNet,
		},
		Items: items,
	}
}
