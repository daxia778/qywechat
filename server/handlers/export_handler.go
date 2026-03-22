package handlers

import (
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// ExportExcel 导出 Excel 多 Sheet 报表
// GET /api/v1/admin/export/excel?start_date=2026-01-01&end_date=2026-03-31&employee_ids=1,2,3&role=designer&status=COMPLETED
func ExportExcel(c *gin.Context) {
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	employeeIDStr := c.Query("employee_id")
	employeeIDsStr := c.Query("employee_ids")
	role := c.Query("role")
	status := c.Query("status")

	// 解析多员工 ID（逗号分隔）
	var employeeIDs []uint
	if employeeIDsStr != "" {
		for _, idStr := range strings.Split(employeeIDsStr, ",") {
			idStr = strings.TrimSpace(idStr)
			if id, err := strconv.ParseUint(idStr, 10, 32); err == nil {
				employeeIDs = append(employeeIDs, uint(id))
			}
		}
	}

	// 向后兼容：单个 employee_id 参数
	if employeeIDStr != "" && len(employeeIDs) == 0 {
		if id, err := strconv.ParseUint(employeeIDStr, 10, 32); err == nil {
			employeeIDs = append(employeeIDs, uint(id))
		}
	}

	// 默认日期范围: 最近 30 天
	if startDate == "" {
		startDate = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	}
	if endDate == "" {
		endDate = time.Now().Format("2006-01-02")
	}

	filter := services.ExportFilter{
		StartDate:   startDate,
		EndDate:     endDate,
		EmployeeIDs: employeeIDs,
		Role:        role,
		Status:      status,
	}

	f, err := services.ExportOrderReport(filter)
	if err != nil {
		log.Printf("Excel 导出失败: %v", err)
		internalError(c, "导出失败，请稍后重试")
		return
	}
	defer f.Close()

	// 文件名包含筛选条件
	filename := fmt.Sprintf("PDD报表_%s_%s", startDate, endDate)
	if role != "" {
		roleName := map[string]string{"sales": "谈单", "designer": "设计师", "follow": "跟单"}[role]
		if roleName != "" {
			filename += "_" + roleName
		}
	}
	if status != "" {
		filename += "_" + status
	}
	filename += ".xlsx"

	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")

	if err := f.Write(c.Writer); err != nil {
		log.Printf("Excel 写入响应失败: %v", err)
	}
}
