package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ─── 管理端 ──────────────────────────────────────────

// GetDashboard 仪表盘综合数据
func GetDashboard(c *gin.Context) {
	stats := services.GetDashboardStats()
	c.JSON(http.StatusOK, stats)
}

// GetRevenueChart 最近 N 天营收折线
func GetRevenueChart(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "7")
	days, _ := strconv.Atoi(daysStr)
	if days <= 0 || days > 90 {
		days = 7
	}

	type DayData struct {
		Date       string `json:"date"`
		Revenue    int    `json:"revenue"`
		OrderCount int    `json:"order_count"`
	}

	result := make([]DayData, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := time.Now().AddDate(0, 0, -i).Truncate(24 * time.Hour)
		end := d.Add(24 * time.Hour)

		var orders []models.Order
		models.DB.Where("created_at >= ? AND created_at < ?", d, end).Find(&orders)

		revenue := 0
		for _, o := range orders {
			revenue += o.Price
		}
		result = append(result, DayData{
			Date:       d.Format("2006-01-02"),
			Revenue:    revenue,
			OrderCount: len(orders),
		})
	}

	totalRevenue := 0
	totalOrders := 0
	for _, d := range result {
		totalRevenue += d.Revenue
		totalOrders += d.OrderCount
	}

	c.JSON(http.StatusOK, gin.H{
		"summary": gin.H{
			"total_revenue": totalRevenue,
			"total_orders":  totalOrders,
		},
		"data": result,
	})
}

// ─── 员工管理 ──────────────────────────────────────────

type CreateEmployeeReq struct {
	WecomUserID    string `json:"wecom_userid" binding:"required"`
	Name           string `json:"name" binding:"required"`
	Role           string `json:"role" binding:"required"`
	ActivationCode string `json:"activation_code"`
	Username       string `json:"username"`
	Password       string `json:"password"`
}

// ListEmployees 员工列表
func ListEmployees(c *gin.Context) {
	role := c.Query("role")
	var employees []models.Employee
	query := models.DB
	if role != "" {
		query = query.Where("role = ?", role)
	}
	query.Find(&employees)
	c.JSON(http.StatusOK, gin.H{"data": employees})
}

// CreateEmployee 添加员工
func CreateEmployee(c *gin.Context) {
	var req CreateEmployeeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 校验角色
	if req.Role != "operator" && req.Role != "designer" && req.Role != "admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "角色必须是 operator/designer/admin"})
		return
	}

	var existing models.Employee
	if err := models.DB.Where("wecom_userid = ?", req.WecomUserID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "该企微UserID已存在"})
		return
	}

	emp := models.Employee{
		WecomUserID: req.WecomUserID,
		Name:        req.Name,
		Role:        req.Role,
	}

	if req.Role == "admin" {
		if req.Username == "" || req.Password == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "管理员角色必须提供用户名和密码"})
			return
		}
		if err := middleware.ValidatePasswordStrength(req.Password); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		var userExist int64
		models.DB.Model(&models.Employee{}).Where("username = ?", req.Username).Count(&userExist)
		if userExist > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
			return
		}

		hashedPwd, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
			return
		}
		emp.Username = req.Username
		emp.PasswordHash = string(hashedPwd)
	} else {
		// 校验激活码不能为空，防止空字符串通过 bcrypt 哈希后可被空密码匹配
		if req.ActivationCode == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "非管理员角色必须提供激活码"})
			return
		}
		// Bcrypt 加密 ActivationCode
		hashedCode, err := bcrypt.GenerateFromPassword([]byte(req.ActivationCode), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "加密激活码失败"})
			return
		}
		emp.ActivationCode = string(hashedCode)
		// 保存明文前缀用于缩小登录时 bcrypt 扫描范围
		prefix := req.ActivationCode
		if len(prefix) > 4 {
			prefix = prefix[:4]
		}
		emp.ActivationCodePrefix = prefix
	}

	models.DB.Create(&emp)

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeAdd, req.WecomUserID, "添加员工: "+req.Name+" 角色: "+req.Role, c.ClientIP())

	// 返回时显示原始激活码（仅此一次可见，之后无法找回）
	emp.ActivationCode = ""
	c.JSON(http.StatusOK, gin.H{
		"employee":              emp,
		"activation_code_plain": req.ActivationCode,
		"notice":                "⚠️ 激活码仅显示一次，请立即记录并告知员工！",
	})
}

// toggleEmployeeActive 通用的员工启用/禁用切换逻辑 (ToggleEmployee 和 PauseActivationCode 共用)
func toggleEmployeeActive(c *gin.Context, auditOnDisable bool) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的员工ID"})
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "员工不存在"})
		return
	}

	emp.IsActive = !emp.IsActive
	models.DB.Save(&emp)

	status := "启用"
	if !emp.IsActive {
		status = "禁用"
		if auditOnDisable {
			models.WriteAuditLog("", "", models.AuditSecurityAlert, emp.WecomUserID, "管理员远程暂停设备激活码登录: "+emp.Name, c.ClientIP())
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("%s成功", status), "is_active": emp.IsActive})
}

// ToggleEmployee 启用/禁用员工
func ToggleEmployee(c *gin.Context) {
	toggleEmployeeActive(c, false)
}

// UnbindDevice 解绑员工设备 (清空设备指纹)
func UnbindDevice(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的员工ID"})
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "员工不存在"})
		return
	}

	if emp.MachineID == "" {
		c.JSON(http.StatusOK, gin.H{"message": "该员工未绑定任何设备"})
		return
	}

	oldMID := emp.MachineID
	models.DB.Model(&emp).Update("machine_id", "")
	log.Printf("🔓 设备解绑 | 员工=%s | 旧MachineID=%s", emp.Name, oldMID)
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("已解绑 %s 的设备", emp.Name)})
}

// GetTeamWorkload 设计师工作负载
func GetTeamWorkload(c *gin.Context) {
	var employees []models.Employee
	models.DB.Where("is_active = ?", true).Find(&employees)

	type WorkloadItem struct {
		Name         string `json:"name"`
		WecomUserID  string `json:"wecom_userid"`
		Role         string `json:"role"`
		Status       string `json:"status"`
		ActiveOrders int64  `json:"active_orders"`
	}

	result := make([]WorkloadItem, 0, len(employees))
	for _, d := range employees {
		var count int64
		switch d.Role {
		case "designer":
			models.DB.Model(&models.Order{}).Where(
				"designer_id = ? AND status IN ?", d.WecomUserID,
				[]string{models.StatusGroupCreated, models.StatusDesigning},
			).Count(&count)
		case "operator", "admin":
			models.DB.Model(&models.Order{}).Where(
				"operator_id = ? AND status IN ?", d.WecomUserID,
				[]string{models.StatusPending, models.StatusGroupCreated, models.StatusDesigning, models.StatusDelivered},
			).Count(&count)
		}

		result = append(result, WorkloadItem{
			Name:         d.Name,
			WecomUserID:  d.WecomUserID,
			Role:         d.Role,
			Status:       d.Status,
			ActiveOrders: count,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// ─── 激活码管理 ──────────────────────────────────────────

// ListActivationCodes 列出所有具有激活码的员工设备状态
func ListActivationCodes(c *gin.Context) {
	var employees []models.Employee
	models.DB.Where("activation_code != '' AND role != 'admin'").Find(&employees)
	c.JSON(http.StatusOK, gin.H{"data": employees})
}

// PauseActivationCode 远程暂停或恢复激活码 (复用 toggleEmployeeActive)
func PauseActivationCode(c *gin.Context) {
	toggleEmployeeActive(c, true)
}

// ─── 审计日志 ──────────────────────────────────────────

// ListAuditLogs 查询审计日志 (管理员专用)
func ListAuditLogs(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "100")
	offsetStr := c.DefaultQuery("offset", "0")
	action := c.Query("action")
	userID := c.Query("user_id")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	var logs []models.AuditLog
	query := models.DB.Order("created_at DESC")
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	query.Offset(offset).Limit(limit).Find(&logs)

	var total int64
	countQuery := models.DB.Model(&models.AuditLog{})
	if action != "" {
		countQuery = countQuery.Where("action = ?", action)
	}
	if userID != "" {
		countQuery = countQuery.Where("user_id = ?", userID)
	}
	countQuery.Count(&total)

	c.JSON(http.StatusOK, gin.H{
		"data":  logs,
		"total": total,
	})
}
