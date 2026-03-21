package handlers

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// ExportExcel 导出 Excel 多 Sheet 报表
// GET /api/v1/admin/export/excel?start_date=2026-01-01&end_date=2026-03-31&employee_id=1
func ExportExcel(c *gin.Context) {
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	employeeIDStr := c.Query("employee_id")

	var employeeID uint
	if employeeIDStr != "" {
		if id, err := strconv.ParseUint(employeeIDStr, 10, 32); err == nil {
			employeeID = uint(id)
		}
	}

	// 默认日期范围: 最近 30 天
	if startDate == "" {
		startDate = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	}
	if endDate == "" {
		endDate = time.Now().Format("2006-01-02")
	}

	f, err := services.ExportOrderReport(startDate, endDate, employeeID)
	if err != nil {
		log.Printf("Excel 导出失败: %v", err)
		internalError(c, "导出失败，请稍后重试")
		return
	}
	defer f.Close()

	filename := fmt.Sprintf("PDD报表_%s_%s.xlsx", startDate, endDate)

	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")

	if err := f.Write(c.Writer); err != nil {
		log.Printf("Excel 写入响应失败: %v", err)
	}
}
