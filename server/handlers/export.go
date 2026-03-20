package handlers

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
)

// sanitizeCSVCell 防止 CSV 注入 (Formula Injection)
// 如果单元格以 =, +, -, @, \t, \r 开头，Excel 会将其当作公式执行
func sanitizeCSVCell(s string) string {
	if len(s) > 0 {
		switch s[0] {
		case '=', '+', '-', '@', '\t', '\r':
			return "'" + s
		}
	}
	// 同时检查是否包含潜在的公式分隔符
	if strings.ContainsAny(s, "\n\r") {
		s = strings.ReplaceAll(s, "\r\n", " ")
		s = strings.ReplaceAll(s, "\r", " ")
		s = strings.ReplaceAll(s, "\n", " ")
	}
	return s
}

// ExportOrdersCSV 导出订单列表 CSV
func ExportOrdersCSV(c *gin.Context) {
	status := c.Query("status")
	keyword := c.Query("keyword")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	operatorID := c.Query("operator_id")
	designerID := c.Query("designer_id")

	query := models.DB.Model(&models.Order{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("order_sn LIKE ? OR customer_contact LIKE ? OR topic LIKE ?", like, like, like)
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

	var orders []models.Order
	query.Order("created_at DESC").Find(&orders)

	filename := fmt.Sprintf("orders_%s.csv", time.Now().Format("20060102_150405"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Header("Content-Type", "text/csv; charset=utf-8")

	// BOM for Excel UTF-8
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	w.Write([]string{"订单号", "状态", "客户联系方式", "主题", "页数", "金额(元)", "客服ID", "设计师ID", "创建时间", "交付时间", "完成时间", "备注"})

	for _, o := range orders {
		deliveredAt := ""
		if o.DeliveredAt != nil {
			deliveredAt = o.DeliveredAt.Format("2006-01-02 15:04")
		}
		completedAt := ""
		if o.CompletedAt != nil {
			completedAt = o.CompletedAt.Format("2006-01-02 15:04")
		}

		w.Write([]string{
			sanitizeCSVCell(o.OrderSN),
			o.Status,
			sanitizeCSVCell(o.CustomerContact),
			sanitizeCSVCell(o.Topic),
			strconv.Itoa(o.Pages),
			fmt.Sprintf("%.2f", float64(o.Price)/100),
			sanitizeCSVCell(o.OperatorID),
			sanitizeCSVCell(o.DesignerID),
			o.CreatedAt.Format("2006-01-02 15:04"),
			deliveredAt,
			completedAt,
			sanitizeCSVCell(o.Remark),
		})
	}
}

// ExportProfitCSV 导出分润报表 CSV
func ExportProfitCSV(c *gin.Context) {
	monthStr := c.DefaultQuery("month", time.Now().Format("2006-01"))
	startTime, err := time.Parse("2006-01", monthStr)
	if err != nil {
		startTime = time.Now().Truncate(24 * time.Hour).AddDate(0, 0, -time.Now().Day()+1)
	}
	endTime := startTime.AddDate(0, 1, 0)

	var orders []models.Order
	models.DB.Where("created_at >= ? AND created_at < ? AND status = ?", startTime, endTime, models.StatusCompleted).Find(&orders)

	platformRate := config.C.PlatformFeeRate
	designerRate := config.C.DesignerCommissionRate
	salesRate := config.C.SalesCommissionRate
	followRate := config.C.FollowCommissionRate

	filename := fmt.Sprintf("profit_%s.csv", monthStr)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	w.Write([]string{"订单号", "总金额(元)", "平台扣点(元)", "设计师分成(元)", "谈单客服分成(元)", "跟单客服分成(元)", "净利润(元)", "设计师ID", "客服ID"})

	for _, o := range orders {
		pf := o.Price * platformRate / 100
		dc := o.Price * designerRate / 100
		sc := o.Price * salesRate / 100
		fc := o.Price * followRate / 100
		np := o.Price - pf - dc - sc - fc

		w.Write([]string{
			sanitizeCSVCell(o.OrderSN),
			fmt.Sprintf("%.2f", float64(o.Price)/100),
			fmt.Sprintf("%.2f", float64(pf)/100),
			fmt.Sprintf("%.2f", float64(dc)/100),
			fmt.Sprintf("%.2f", float64(sc)/100),
			fmt.Sprintf("%.2f", float64(fc)/100),
			fmt.Sprintf("%.2f", float64(np)/100),
			sanitizeCSVCell(o.DesignerID),
			sanitizeCSVCell(o.OperatorID),
		})
	}
}
