package handlers

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
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

	// 单次聚合查询替代 N+1 循环
	startDate := time.Now().AddDate(0, 0, -(days - 1)).Truncate(24 * time.Hour)

	type AggRow struct {
		Day        string `gorm:"column:day"`
		Revenue    int    `gorm:"column:revenue"`
		OrderCount int    `gorm:"column:order_count"`
	}
	var rows []AggRow
	models.DB.Model(&models.Order{}).
		Select("strftime('%Y-%m-%d', created_at) as day, COALESCE(SUM(price), 0) as revenue, COUNT(*) as order_count").
		Where("created_at >= ?", startDate).
		Group("day").
		Order("day ASC").
		Find(&rows)

	// 构建日期到聚合结果的映射
	dayMap := make(map[string]AggRow, len(rows))
	for _, r := range rows {
		dayMap[r.Day] = r
	}

	// 填充完整日期范围（含无数据的日期）
	result := make([]DayData, 0, days)
	totalRevenue := 0
	totalOrders := 0
	for i := days - 1; i >= 0; i-- {
		d := time.Now().AddDate(0, 0, -i).Truncate(24 * time.Hour)
		dateStr := d.Format("2006-01-02")
		dd := DayData{Date: dateStr}
		if agg, ok := dayMap[dateStr]; ok {
			dd.Revenue = agg.Revenue
			dd.OrderCount = agg.OrderCount
		}
		result = append(result, dd)
		totalRevenue += dd.Revenue
		totalOrders += dd.OrderCount
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
	Name string `json:"name" binding:"required"`
	Role string `json:"role" binding:"required"`
}

// generateUsername 根据角色自动生成用户名: designer_001, sales_001, follow_001
func generateUsername(role string) string {
	var count int64
	models.DB.Model(&models.Employee{}).Where("role = ?", role).Count(&count)
	return fmt.Sprintf("%s_%03d", role, count+1)
}

// generateRandomPassword 生成 8 位随机密码 (大小写字母+数字)
func generateRandomPassword() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		b[i] = chars[n.Int64()]
	}
	return string(b)
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

// CreateEmployee 添加员工 (V2: 自动生成账号密码)
func CreateEmployee(c *gin.Context) {
	var req CreateEmployeeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("CreateEmployee 参数绑定失败: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数格式错误"})
		return
	}

	// 校验角色
	if !models.IsValidRole(req.Role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "角色必须是 sales/designer/follow/admin"})
		return
	}

	// 自动生成用户名
	username := generateUsername(req.Role)
	if req.Role == "admin" {
		username = "admin" // admin 用户名保持自定义
	}

	// 检查用户名唯一性
	var userExist int64
	models.DB.Model(&models.Employee{}).Where("username = ?", username).Count(&userExist)
	if userExist > 0 {
		// 用户名已存在，递增序号
		for i := 0; i < 100; i++ {
			var cnt int64
			models.DB.Model(&models.Employee{}).Where("role = ?", req.Role).Count(&cnt)
			username = fmt.Sprintf("%s_%03d", req.Role, cnt+1+int64(i))
			models.DB.Model(&models.Employee{}).Where("username = ?", username).Count(&userExist)
			if userExist == 0 {
				break
			}
		}
	}

	// 生成随机密码
	plainPassword := generateRandomPassword()
	hashedPwd, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	emp := models.Employee{
		WecomUserID:  username, // 默认用 username 作为 wecom_userid，后续可通过通讯录同步覆盖
		Name:         req.Name,
		Role:         req.Role,
		Username:     username,
		PasswordHash: string(hashedPwd),
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&emp).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建员工失败: " + err.Error()})
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeAdd, emp.WecomUserID, "添加员工: "+req.Name+" 角色: "+req.Role, c.ClientIP())

	log.Printf("✅ 创建员工 | %s | 用户名=%s | 角色=%s", req.Name, username, req.Role)

	c.JSON(http.StatusOK, gin.H{
		"employee": emp,
		"username": username,
		"password": plainPassword,
		"notice":   "⚠️ 账号密码仅显示一次，请立即记录并告知员工！",
	})
}

// ResetPassword 重置员工密码 (管理员操作)
// PUT /api/v1/admin/employees/:id/reset_password
func ResetPassword(c *gin.Context) {
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

	plainPassword := generateRandomPassword()
	hashedPwd, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Update("password_hash", string(hashedPwd)).Error
	})

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeAdd, emp.WecomUserID, "重置密码: "+emp.Name, c.ClientIP())

	log.Printf("🔑 密码已重置 | 员工=%s", emp.Name)

	c.JSON(http.StatusOK, gin.H{
		"password": plainPassword,
		"notice":   "⚠️ 新密码仅显示一次，请立即告知员工！",
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
	models.WriteTx(func(tx *gorm.DB) error {
		return tx.Save(&emp).Error
	})

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
	models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Update("machine_id", "").Error
	})
	log.Printf("🔓 设备解绑 | 员工=%s | 旧MachineID=%s", emp.Name, oldMID)
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("已解绑 %s 的设备", emp.Name)})
}

// GetTeamWorkload 设计师工作负载
func GetTeamWorkload(c *gin.Context) {
	var employees []models.Employee
	models.DB.Where("is_active = ?", true).Find(&employees)

	type WorkloadItem struct {
		Name             string  `json:"name"`
		WecomUserID      string  `json:"wecom_userid"`
		Role             string  `json:"role"`
		Status           string  `json:"status"`
		ActiveOrders     int64   `json:"active_orders"`
		GrabTimeoutRate  float64 `json:"grab_timeout_rate"`
	}

	// 批量查询设计师活跃订单数
	type CountRow struct {
		UserID string `gorm:"column:user_id"`
		Count  int64  `gorm:"column:cnt"`
	}
	var designerCounts []CountRow
	models.DB.Model(&models.Order{}).
		Select("designer_id as user_id, COUNT(*) as cnt").
		Where("status IN ?", []string{models.StatusGroupCreated, models.StatusDesigning}).
		Group("designer_id").
		Find(&designerCounts)

	// 批量查询客服/管理员活跃订单数
	var operatorCounts []CountRow
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
	grabStats, _ := services.GetDesignerGrabStats()
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

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// ─── 抢单监控 ──────────────────────────────────────────

// GetGrabAlerts 获取当前超时抢单列表
func GetGrabAlerts(c *gin.Context) {
	alerts, err := services.GetGrabAlerts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": alerts, "total": len(alerts)})
}

// ─── 激活码管理 ──────────────────────────────────────────

// ListActivationCodes 列出所有非 admin 员工的设备绑定状态
// 查询参数: ?status=bound (已绑定) | unbound (未绑定) | 空=全部
func ListActivationCodes(c *gin.Context) {
	status := c.Query("status")
	var employees []models.Employee
	query := models.DB.Where("role != 'admin'")
	switch status {
	case "bound":
		query = query.Where("machine_id != ''")
	case "unbound":
		query = query.Where("machine_id = ''")
	}
	query.Order("created_at DESC").Find(&employees)
	c.JSON(http.StatusOK, gin.H{"data": employees, "total": len(employees)})
}

// PauseActivationCode 远程暂停或恢复激活码 (复用 toggleEmployeeActive)
func PauseActivationCode(c *gin.Context) {
	toggleEmployeeActive(c, true)
}

// RegenerateActivationCode 重新生成激活码（管理员操作，会同时解绑旧设备）
func RegenerateActivationCode(c *gin.Context) {
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

	if emp.Role == "admin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "管理员角色不使用激活码"})
		return
	}

	// 生成新激活码（8位大写字母+数字）
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	codeBytes := make([]byte, 8)
	for i := range codeBytes {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "生成激活码失败"})
			return
		}
		codeBytes[i] = chars[n.Int64()]
	}
	plainCode := string(codeBytes)

	hashedCode, err := bcrypt.GenerateFromPassword([]byte(plainCode), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加密激活码失败"})
		return
	}

	prefix := plainCode[:4]

	// 更新激活码 + 同时清空设备绑定（旧设备失效）
	updates := map[string]interface{}{
		"activation_code":        string(hashedCode),
		"activation_code_prefix": prefix,
		"machine_id":             "",
		"mac_address":            "",
	}
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Updates(updates).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新激活码失败: " + err.Error()})
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeAdd, emp.WecomUserID, "重新生成激活码并解绑旧设备: "+emp.Name, c.ClientIP())

	log.Printf("🔑 激活码已重新生成 | 员工=%s | 旧设备已解绑", emp.Name)

	c.JSON(http.StatusOK, gin.H{
		"activation_code_plain": plainCode,
		"notice":                "⚠️ 新激活码仅显示一次，旧设备绑定已同时解除！",
	})
}

// ─── 企微数据查看 ──────────────────────────────────────────

// ListWecomMembers GET /api/v1/admin/wecom/members
// 查看企微通讯录成员
func ListWecomMembers(c *gin.Context) {
	keyword := c.Query("keyword")
	query := models.DB.Model(&models.WecomMember{})
	if keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		query = query.Where("name LIKE ? ESCAPE '\\' OR userid LIKE ? ESCAPE '\\'", like, like)
	}
	var members []models.WecomMember
	query.Order("name ASC").Find(&members)
	c.JSON(http.StatusOK, gin.H{"data": members, "total": len(members)})
}

// ListWecomGroups GET /api/v1/admin/wecom/groups
// 查看企微群聊列表
func ListWecomGroups(c *gin.Context) {
	var groups []models.WecomGroupChat
	models.DB.Order("synced_at DESC").Find(&groups)
	c.JSON(http.StatusOK, gin.H{"data": groups, "total": len(groups)})
}

// GetWecomGroupMessages GET /api/v1/admin/wecom/groups/:chat_id/messages
// 查看群消息记录
func GetWecomGroupMessages(c *gin.Context) {
	chatID := c.Param("chat_id")
	var messages []models.WecomMessageLog
	models.DB.Where("chat_id = ?", chatID).Order("created_at ASC").Find(&messages)
	c.JSON(http.StatusOK, gin.H{"data": messages, "total": len(messages)})
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

// DeleteEmployee DELETE /admin/employees/:id
func DeleteEmployee(c *gin.Context) {
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
	if emp.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "不能删除管理员账号"})
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Delete(&emp).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败: " + err.Error()})
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeAdd, emp.WecomUserID, "删除员工: "+emp.Name, c.ClientIP())
	log.Printf("🗑️ 员工已删除 | 员工=%s", emp.Name)
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// BatchToggleEmployees PUT /admin/employees/batch_toggle
func BatchToggleEmployees(c *gin.Context) {
	var body struct {
		IDs    []uint `json:"ids"`
		Active bool   `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&models.Employee{}).Where("id IN ? AND role != ?", body.IDs, "admin").Update("is_active", body.Active).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量操作失败: " + err.Error()})
		return
	}

	status := "启用"
	if !body.Active {
		status = "禁用"
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("已批量%s %d 名员工", status, len(body.IDs))})
}

// BatchDeleteEmployees POST /admin/employees/batch_delete
func BatchDeleteEmployees(c *gin.Context) {
	var body struct {
		IDs []uint `json:"ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Where("id IN ? AND role != ?", body.IDs, "admin").Delete(&models.Employee{}).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "批量删除失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("已批量删除 %d 名员工", len(body.IDs))})
}
