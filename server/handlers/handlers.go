package handlers

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─── 认证 ──────────────────────────────────────────

type DeviceLoginReq struct {
	ActivationCode string `json:"activation_code"`
	MacAddress     string `json:"mac_address" binding:"required"`
}

// DeviceLogin 设备登录: 激活码 + MAC 绑定
func DeviceLogin(c *gin.Context) {
	var req DeviceLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	var emp models.Employee

	if req.ActivationCode == "" {
		// ── 无激活码: 仅允许 MAC 静默登录 (已绑定设备重连) ──
		result := models.DB.Where("mac_address = ? AND is_active = ?", req.MacAddress, true).First(&emp)
		if result.Error != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "设备未注册，请输入激活码"})
			return
		}
	} else {
		// ── 有激活码: 必须校验激活码有效性 ──
		result := models.DB.Where("activation_code = ? AND is_active = ?", req.ActivationCode, true).First(&emp)
		if result.Error != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "激活码无效或已禁用"})
			return
		}

		// 检查 MAC 绑定:
		// - 首次激活: MAC 为空 → 绑定当前设备
		// - 已绑定同设备: MAC 一致 → 放行
		// - 已绑定不同设备: MAC 不一致 → 拒绝
		if emp.MacAddress == "" {
			// 首次激活，绑定 MAC 到此设备
			emp.MacAddress = req.MacAddress
			models.DB.Save(&emp)
			log.Printf("✅ 设备绑定 | 员工=%s | MAC=%s", emp.Name, req.MacAddress)
		} else if emp.MacAddress != req.MacAddress {
			c.JSON(http.StatusForbidden, gin.H{"error": "该激活码已绑定其他设备，请联系管理员解绑"})
			return
		}
	}

	token, _ := middleware.CreateToken(emp.WecomUserID, emp.Name, emp.Role)
	c.JSON(http.StatusOK, gin.H{
		"token":         token,
		"employee_name": emp.Name,
		"wecom_userid":  emp.WecomUserID,
	})
}

// ─── OCR ──────────────────────────────────────────

// UploadOCR 上传订单截图进行 OCR 解析
func UploadOCR(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请上传图片文件"})
		return
	}

	ext := filepath.Ext(file.Filename)
	filename := uuid.New().String() + ext
	savePath := filepath.Join("uploads", filename)
	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "文件保存失败"})
		return
	}

	result, err := services.ExtractOrderFromImage(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "OCR 解析失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ─── 订单 ──────────────────────────────────────────

type CreateOrderReq struct {
	OrderSN         string `json:"order_sn"`
	CustomerContact string `json:"customer_contact"`
	Price           int    `json:"price"`
	Topic           string `json:"topic"`
	Pages           int    `json:"pages"`
	Deadline        string `json:"deadline"`
	Remark          string `json:"remark"`
}

// CreateOrder 创建订单
func CreateOrder(c *gin.Context) {
	var req CreateOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	operatorID := c.Query("operator_id")
	if operatorID == "" {
		// 从 JWT 中获取
		if v, exists := c.Get("wecom_userid"); exists {
			operatorID = v.(string)
		}
	}
	if operatorID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 operator_id"})
		return
	}

	var deadline *time.Time
	if req.Deadline != "" {
		t, err := time.Parse("2006-01-02 15:04", req.Deadline)
		if err == nil {
			deadline = &t
		}
	}

	order, err := services.CreateOrder(
		operatorID, req.OrderSN, req.CustomerContact,
		req.Topic, req.Remark, "", req.Price, req.Pages, deadline,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 异步通知设计师
	go func() {
		designers := services.GetIdleDesigners()
		ids := make([]string, len(designers))
		for i, d := range designers {
			ids[i] = d.WecomUserID
		}
		deadlineStr := "待定"
		if deadline != nil {
			deadlineStr = deadline.Format("2006-01-02 15:04")
		}
		if len(ids) > 0 {
			_ = services.Wecom.NotifyNewOrder(order.OrderSN, operatorID, req.Topic, req.Pages, req.Price, deadlineStr, ids)
		}
	}()

	c.JSON(http.StatusOK, order)
}

type GrabOrderReq struct {
	OrderID        uint   `json:"order_id" binding:"required"`
	DesignerUserID string `json:"designer_userid" binding:"required"`
}

// GrabOrder 设计师抢单
func GrabOrder(c *gin.Context) {
	var req GrabOrderReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	order, err := services.GrabOrder(req.OrderID, req.DesignerUserID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	// 异步建群
	go func() {
		deadlineStr := "待定"
		if order.Deadline != nil {
			deadlineStr = order.Deadline.Format("2006-01-02 15:04")
		}
		chatID, err := services.Wecom.SetupOrderGroup(
			order.OrderSN, order.OperatorID, req.DesignerUserID,
			order.Topic, order.Pages, order.Price, deadlineStr, order.Remark,
		)
		if err == nil && chatID != "" {
			models.DB.Model(order).Update("wecom_chat_id", chatID)
		}
	}()

	c.JSON(http.StatusOK, order)
}

// UpdateOrderStatus 更新订单状态
func UpdateOrderStatus(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	order, err := services.UpdateOrderStatus(uint(id), body.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "状态更新成功", "order": order})
}

// ListOrders 订单列表
func ListOrders(c *gin.Context) {
	status := c.Query("status")
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	var orders []models.Order
	query := models.DB.Order("created_at DESC")
	if status != "" {
		query = query.Where("status = ?", status)
	}
	query.Offset(offset).Limit(limit).Find(&orders)

	c.JSON(http.StatusOK, gin.H{"data": orders})
}

// GetOrder 获取单个订单详情
func GetOrder(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的订单ID"})
		return
	}

	var order models.Order
	if err := models.DB.First(&order, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "订单不存在"})
		return
	}

	c.JSON(http.StatusOK, order)
}

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
		WecomUserID:    req.WecomUserID,
		Name:           req.Name,
		Role:           req.Role,
		ActivationCode: req.ActivationCode,
	}
	models.DB.Create(&emp)
	c.JSON(http.StatusOK, emp)
}

// ToggleEmployee 启用/禁用员工
func ToggleEmployee(c *gin.Context) {
	idStr := c.Param("id")
	id, _ := strconv.ParseUint(idStr, 10, 32)

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
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("%s成功", status), "is_active": emp.IsActive})
}

// UnbindDevice 解绑员工设备 (清空 MAC 地址)
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

	if emp.MacAddress == "" {
		c.JSON(http.StatusOK, gin.H{"message": "该员工未绑定任何设备"})
		return
	}

	oldMAC := emp.MacAddress
	models.DB.Model(&emp).Update("mac_address", "")
	log.Printf("🔓 设备解绑 | 员工=%s | 旧MAC=%s", emp.Name, oldMAC)
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("已解绑 %s 的设备", emp.Name)})
}

// GetTeamWorkload 设计师工作负载
func GetTeamWorkload(c *gin.Context) {
	var designers []models.Employee
	models.DB.Where("role = ? AND is_active = ?", "designer", true).Find(&designers)

	type WorkloadItem struct {
		Name         string `json:"name"`
		WecomUserID  string `json:"wecom_userid"`
		Status       string `json:"status"`
		ActiveOrders int64  `json:"active_orders"`
	}

	result := make([]WorkloadItem, 0, len(designers))
	for _, d := range designers {
		var count int64
		models.DB.Model(&models.Order{}).Where(
			"designer_id = ? AND status IN ?", d.WecomUserID,
			[]string{models.StatusGroupCreated, models.StatusDesigning},
		).Count(&count)

		result = append(result, WorkloadItem{
			Name:         d.Name,
			WecomUserID:  d.WecomUserID,
			Status:       d.Status,
			ActiveOrders: count,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func init() {
	os.MkdirAll("uploads", 0o755)
}
