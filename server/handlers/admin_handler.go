package handlers

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"strconv"
	"time"

	"pdd-order-system/middleware"
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
	respondOK(c, stats)
}

// GetRevenueChart 最近 N 天营收折线
func GetRevenueChart(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "7")
	days, _ := strconv.Atoi(daysStr)
	if days <= 0 || days > 90 {
		days = 7
	}

	result := services.GetRevenueChart(days)
	respondOK(c, result)
}

// ─── 员工管理 ──────────────────────────────────────────

type CreateEmployeeReq struct {
	Name        string `json:"name" binding:"required"`
	Role        string `json:"role" binding:"required"`
	WecomUserID string `json:"wecom_userid"` // 可选: 企微通讯录 UserID，关联企微身份
}

type UpdateEmployeeReq struct {
	Name       *string `json:"name"`
	BaseSalary *int    `json:"base_salary"` // 分
}

// UpdateEmployee 更新员工信息（含底薪设置）
// PUT /api/v1/admin/employees/:id
func UpdateEmployee(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的员工ID")
		return
	}

	var req UpdateEmployeeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请求参数格式错误")
		return
	}

	if req.Name == nil && req.BaseSalary == nil {
		badRequest(c, "至少提供一个要更新的字段")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		if *req.Name == "" {
			badRequest(c, "姓名不能为空")
			return
		}
		updates["name"] = *req.Name
	}
	if req.BaseSalary != nil {
		if *req.BaseSalary < 0 {
			badRequest(c, "底薪不能为负数")
			return
		}
		updates["base_salary"] = *req.BaseSalary
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Updates(updates).Error
	}); err != nil {
		log.Printf("更新员工失败: %v", err)
		internalError(c, "更新失败，请稍后重试")
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeUpdate, emp.WecomUserID, "更新员工信息: "+emp.Name, c.ClientIP())

	// 重新加载返回最新数据
	models.DB.First(&emp, uint(id))
	respondOK(c, gin.H{"employee": emp})
}

// generateUsernameTx 在事务内根据角色生成唯一用户名，防止并发竞态。
// 通过 SELECT ... FOR UPDATE (PostgreSQL) 或 WriteTx 互斥锁 (SQLite) 保证序列号唯一。
func generateUsernameTx(tx *gorm.DB, role string) string {
	var count int64
	tx.Model(&models.Employee{}).Where("role = ?", role).Count(&count)
	candidate := fmt.Sprintf("%s_%03d", role, count+1)

	// 冲突重试: 如果用户名已存在 (如删除员工后序号不连续)，递增直到找到空位
	for i := 0; i < 100; i++ {
		var exists int64
		tx.Model(&models.Employee{}).Where("username = ?", candidate).Count(&exists)
		if exists == 0 {
			return candidate
		}
		candidate = fmt.Sprintf("%s_%03d", role, count+1+int64(i+1))
	}
	return candidate
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

// ListEmployees 员工列表 (设计师走花名册 FreelanceDesigner，不在此列表展示)
func ListEmployees(c *gin.Context) {
	role := c.Query("role")
	var employees []models.Employee
	query := models.DB.Where("role != ?", "designer")
	if role != "" {
		query = query.Where("role = ?", role)
	}
	query.Find(&employees)
	respondOK(c, gin.H{"data": employees})
}

// CreateEmployee 添加员工 (V2: 自动生成账号密码)
func CreateEmployee(c *gin.Context) {
	var req CreateEmployeeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("CreateEmployee 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	// 校验角色 (设计师走花名册 FreelanceDesigner，不走 Employee 表)
	if !models.IsValidRole(req.Role) || req.Role == "designer" {
		badRequest(c, "角色必须是 sales/follow/admin")
		return
	}

	// 生成随机密码 (在事务外完成，bcrypt 较慢不应持锁)
	plainPassword := generateRandomPassword()
	hashedPwd, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("密码加密失败: %v", err)
		internalError(c, "密码加密失败")
		return
	}

	// 如果指定了企微 UserID，检查是否已被关联
	if req.WecomUserID != "" {
		var exists int64
		models.DB.Model(&models.Employee{}).Where("wecom_userid = ?", req.WecomUserID).Count(&exists)
		if exists > 0 {
			badRequest(c, "该企微成员已关联为系统员工")
			return
		}
	}

	// 在同一个写事务内生成用户名并创建员工，防止并发竞态产生重复用户名
	var emp models.Employee
	var username string
	if err := models.WriteTx(func(tx *gorm.DB) error {
		if req.Role == "admin" {
			username = "admin"
		} else if req.WecomUserID != "" {
			// 使用企微 UserID 作为用户名
			username = req.WecomUserID
		} else {
			username = generateUsernameTx(tx, req.Role)
		}

		wecomUID := username
		if req.WecomUserID != "" {
			wecomUID = req.WecomUserID
		}

		emp = models.Employee{
			WecomUserID:  wecomUID,
			Name:         req.Name,
			Role:         req.Role,
			Username:     username,
			PasswordHash: string(hashedPwd),
		}
		return tx.Create(&emp).Error
	}); err != nil {
		log.Printf("创建员工失败: %v", err)
		internalError(c, "创建员工失败，请稍后重试")
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeAdd, emp.WecomUserID, "添加员工: "+req.Name+" 角色: "+req.Role, c.ClientIP())

	log.Printf("创建员工 | %s | 用户名=%s | 角色=%s", req.Name, username, req.Role)

	respondOK(c, gin.H{
		"employee": emp,
		"username": username,
		"password": plainPassword,
		"notice":   "账号密码仅显示一次，请立即记录并告知员工！",
	})
}

// ResetPassword 重置员工密码 (管理员操作)
// PUT /api/v1/admin/employees/:id/reset_password
func ResetPassword(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的员工ID")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}

	plainPassword := generateRandomPassword()
	hashedPwd, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("密码加密失败: %v", err)
		internalError(c, "密码加密失败")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Update("password_hash", string(hashedPwd)).Error
	}); err != nil {
		log.Printf("重置密码失败: %v", err)
		internalError(c, "重置密码失败，请稍后重试")
		return
	}

	// 密码重置后，使该用户所有已签发的 token 失效
	middleware.RevokeAllUserTokens(emp.WecomUserID)

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditPasswordReset, emp.WecomUserID, "重置密码: "+emp.Name, c.ClientIP())

	log.Printf("密码已重置 | 员工=%s | 旧Token已全部失效", emp.Name)

	respondOK(c, gin.H{
		"password": plainPassword,
		"notice":   "新密码仅显示一次，请立即告知员工！",
	})
}

// toggleEmployeeActive 通用的员工启用/禁用切换逻辑 (ToggleEmployee 和 PauseActivationCode 共用)
func toggleEmployeeActive(c *gin.Context, auditOnDisable bool) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的员工ID")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}

	emp.IsActive = !emp.IsActive
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Save(&emp).Error
	}); err != nil {
		log.Printf("切换员工状态失败: %v", err)
		internalError(c, "操作失败，请稍后重试")
		return
	}

	status := "启用"
	if !emp.IsActive {
		status = "禁用"
		// 禁用时，使该用户所有已签发的 token 失效
		middleware.RevokeAllUserTokens(emp.WecomUserID)
		if auditOnDisable {
			models.WriteAuditLog("", "", models.AuditSecurityAlert, emp.WecomUserID, "管理员远程暂停设备激活码登录: "+emp.Name, c.ClientIP())
		}
	}

	respondOK(c, gin.H{"message": fmt.Sprintf("%s成功", status), "is_active": emp.IsActive})
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
		badRequest(c, "无效的员工ID")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}

	if emp.MachineID == "" {
		respondMessage(c, "该员工未绑定任何设备")
		return
	}

	oldMID := emp.MachineID
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Update("machine_id", "").Error
	}); err != nil {
		log.Printf("设备解绑失败: %v", err)
		internalError(c, "设备解绑失败，请稍后重试")
		return
	}
	log.Printf("设备解绑 | 员工=%s | 旧MachineID=%s", emp.Name, oldMID)
	respondMessage(c, fmt.Sprintf("已解绑 %s 的设备", emp.Name))
}

// GetTeamWorkload 设计师工作负载
func GetTeamWorkload(c *gin.Context) {
	result := services.GetTeamWorkload()
	respondOK(c, gin.H{"data": result})
}

// GetTeamRoster 客服绩效花名册 (admin only)
// GET /api/v1/admin/team_roster
func GetTeamRoster(c *gin.Context) {
	var employees []models.Employee
	models.DB.Where("is_active = ? AND role IN ?", true, []string{"sales", "follow"}).
		Order("role ASC, name ASC").Find(&employees)

	type StaffStats struct {
		ID               uint    `json:"id"`
		Name             string  `json:"name"`
		Role             string  `json:"role"`
		Username         string  `json:"username"`
		TotalOrders      int     `json:"total_orders"`
		DesigningOrders  int     `json:"designing_orders"`
		CompletedOrders  int     `json:"completed_orders"`
		RefundedOrders   int     `json:"refunded_orders"`
		TotalRevenue     int     `json:"total_revenue"`
		TotalCommission  int     `json:"total_commission"`
		MonthOrders      int     `json:"month_orders"`
		MonthRevenue     int     `json:"month_revenue"`
		RefundRate       float64 `json:"refund_rate"`
		IsOnline         bool    `json:"is_online"`
	}

	results := make([]StaffStats, 0, len(employees))
	for _, emp := range employees {
		var stats struct {
			Total     int `gorm:"column:total"`
			Designing int `gorm:"column:designing"`
			Completed int `gorm:"column:completed"`
			Refunded  int `gorm:"column:refunded"`
			Revenue   int `gorm:"column:revenue"`
			Comm      int `gorm:"column:comm"`
		}

		// 根据角色用不同字段关联查订单
		orderField := "operator_id"
		commField := "sales_commission"
		if emp.Role == "follow" {
			orderField = "follow_operator_id"
			commField = "follow_commission"
		}

		models.DB.Model(&models.Order{}).
			Where(orderField+" = ?", emp.WecomUserID).
			Select(`
				COUNT(*) as total,
				SUM(CASE WHEN status = 'DESIGNING' THEN 1 ELSE 0 END) as designing,
				SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
				SUM(CASE WHEN status = 'REFUNDED' THEN 1 ELSE 0 END) as refunded,
				COALESCE(SUM(price), 0) as revenue,
				COALESCE(SUM(`+commField+`), 0) as comm
			`).Scan(&stats)

		// 当月统计
		var monthStats struct {
			Orders  int `gorm:"column:orders"`
			Revenue int `gorm:"column:revenue"`
		}
		models.DB.Model(&models.Order{}).
			Where(orderField+" = ? AND created_at >= date('now', 'start of month')", emp.WecomUserID).
			Select("COUNT(*) as orders, COALESCE(SUM(price), 0) as revenue").
			Scan(&monthStats)

		var refundRate float64
		totalDone := stats.Completed + stats.Refunded
		if totalDone > 0 {
			refundRate = float64(stats.Refunded) / float64(totalDone) * 100
		}

		results = append(results, StaffStats{
			ID:              emp.ID,
			Name:            emp.Name,
			Role:            emp.Role,
			Username:        emp.Username,
			TotalOrders:     stats.Total,
			DesigningOrders: stats.Designing,
			CompletedOrders: stats.Completed,
			RefundedOrders:  stats.Refunded,
			TotalRevenue:    stats.Revenue,
			TotalCommission: stats.Comm,
			MonthOrders:     monthStats.Orders,
			MonthRevenue:    monthStats.Revenue,
			RefundRate:      refundRate,
			IsOnline:        services.Hub.UserClientCount(emp.WecomUserID) > 0,
		})
	}

	respondOK(c, gin.H{"data": results})
}

// ─── 激活码管理 ──────────────────────────────────────────

// ListActivationCodes 列出所有非 admin 员工的设备绑定状态
// 查询参数: ?status=bound|unbound|active|paused  &keyword=xxx
func ListActivationCodes(c *gin.Context) {
	status := c.Query("status")
	keyword := c.Query("keyword")
	var employees []models.Employee
	query := models.DB.Where("role NOT IN ?", []string{"admin", "designer"})
	switch status {
	case "bound":
		query = query.Where("machine_id != ''")
	case "unbound":
		query = query.Where("machine_id = ''")
	case "active":
		query = query.Where("is_active = ?", true)
	case "paused":
		query = query.Where("is_active = ?", false)
	}
	if keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		query = query.Where("(name LIKE ? ESCAPE '\\' OR wecom_userid LIKE ? ESCAPE '\\')", like, like)
	}
	query.Order("created_at DESC").Find(&employees)

	// 查询每个员工最后一次提交订单的时间
	operatorIDs := make([]string, 0, len(employees))
	for _, emp := range employees {
		if emp.WecomUserID != "" {
			operatorIDs = append(operatorIDs, emp.WecomUserID)
		}
	}

	type lastOrderInfo struct {
		OperatorID  string
		LastOrderAt time.Time
	}
	lastOrderMap := make(map[string]time.Time)
	if len(operatorIDs) > 0 {
		var lastOrders []lastOrderInfo
		models.DB.Model(&models.Order{}).
			Select("operator_id, MAX(created_at) as last_order_at").
			Where("operator_id IN ?", operatorIDs).
			Group("operator_id").
			Find(&lastOrders)
		for _, lo := range lastOrders {
			lastOrderMap[lo.OperatorID] = lo.LastOrderAt
		}
	}

	// 组装响应，附加 last_order_at 和实时在线状态
	result := make([]gin.H, 0, len(employees))
	for _, emp := range employees {
		item := gin.H{
			"id":                 emp.ID,
			"wecom_userid":      emp.WecomUserID,
			"name":              emp.Name,
			"role":              emp.Role,
			"username":          emp.Username,
			"machine_id":        emp.MachineID,
			"mac_address":       emp.MacAddress,
			"status":            emp.Status,
			"active_order_count": emp.ActiveOrderCount,
			"is_active":         emp.IsActive,
			"last_login_at":     emp.LastLoginAt,
			"last_login_ip":     emp.LastLoginIP,
			"created_at":        emp.CreatedAt,
			"updated_at":        emp.UpdatedAt,
			"is_online":         services.Hub.UserClientCount(emp.WecomUserID) > 0,
		}
		if t, ok := lastOrderMap[emp.WecomUserID]; ok {
			item["last_order_at"] = t
		}
		result = append(result, item)
	}
	respondList(c, result, len(result))
}

// CreateActivationCode 为指定员工创建/重置激活码
// POST /api/v1/admin/activation_codes
func CreateActivationCode(c *gin.Context) {
	var req struct {
		EmployeeID uint `json:"employee_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请提供 employee_id")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, req.EmployeeID).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}
	if emp.Role == "admin" {
		badRequest(c, "管理员角色不使用激活码")
		return
	}

	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	codeBytes := make([]byte, 8)
	for i := range codeBytes {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			internalError(c, "生成激活码失败")
			return
		}
		codeBytes[i] = chars[n.Int64()]
	}
	plainCode := string(codeBytes)

	hashedCode, err := bcrypt.GenerateFromPassword([]byte(plainCode), bcrypt.DefaultCost)
	if err != nil {
		internalError(c, "加密激活码失败")
		return
	}

	prefix := plainCode[:4]
	updates := map[string]interface{}{
		"activation_code":        string(hashedCode),
		"activation_code_prefix": prefix,
	}
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Updates(updates).Error
	}); err != nil {
		internalError(c, "创建激活码失败，请稍后重试")
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditActivationCodeRegen, emp.WecomUserID, "创建激活码: "+emp.Name, c.ClientIP())

	log.Printf("激活码已创建 | 员工=%s", emp.Name)

	respondOK(c, gin.H{
		"activation_code_plain": plainCode,
		"employee_name":         emp.Name,
		"notice":                "激活码仅显示一次，请立即记录并告知员工！",
	})
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
		badRequest(c, "无效的员工ID")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}

	if emp.Role == "admin" {
		badRequest(c, "管理员角色不使用激活码")
		return
	}

	// 生成新激活码（8位大写字母+数字）
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	codeBytes := make([]byte, 8)
	for i := range codeBytes {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			log.Printf("生成激活码随机数失败: %v", err)
			internalError(c, "生成激活码失败")
			return
		}
		codeBytes[i] = chars[n.Int64()]
	}
	plainCode := string(codeBytes)

	hashedCode, err := bcrypt.GenerateFromPassword([]byte(plainCode), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("加密激活码失败: %v", err)
		internalError(c, "加密激活码失败")
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
		log.Printf("更新激活码失败: %v", err)
		internalError(c, "更新激活码失败，请稍后重试")
		return
	}

	// 踢掉该用户所有已签发的旧 token，迫使旧设备重新登录
	middleware.RevokeAllUserTokens(emp.WecomUserID)

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditActivationCodeRegen, emp.WecomUserID, "重新生成激活码并解绑旧设备: "+emp.Name, c.ClientIP())

	log.Printf("激活码已重新生成 | 员工=%s | 旧设备已解绑 | 旧Token已全部失效", emp.Name)

	respondOK(c, gin.H{
		"activation_code_plain": plainCode,
		"notice":                "新激活码仅显示一次，旧设备绑定已同时解除！",
	})
}

// ─── 企微数据查看 ──────────────────────────────────────────

// ListWecomMembers GET /api/v1/admin/wecom/members
// 查看企微通讯录成员（附带是否已关联为系统员工的标记）
func ListWecomMembers(c *gin.Context) {
	keyword := c.Query("keyword")
	query := models.DB.Model(&models.WecomMember{})
	if keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		query = query.Where("name LIKE ? ESCAPE '\\' OR userid LIKE ? ESCAPE '\\'", like, like)
	}
	var members []models.WecomMember
	query.Order("name ASC").Find(&members)

	// 查询已关联为员工的企微 UserID 集合
	var linkedIDs []string
	models.DB.Model(&models.Employee{}).Where("wecom_userid != ''").Pluck("wecom_userid", &linkedIDs)
	linkedSet := make(map[string]bool, len(linkedIDs))
	for _, id := range linkedIDs {
		linkedSet[id] = true
	}

	// 组装响应，附加 is_employee 标记
	result := make([]gin.H, 0, len(members))
	for _, m := range members {
		result = append(result, gin.H{
			"id":          m.ID,
			"userid":      m.UserID,
			"name":        m.Name,
			"department":  m.Department,
			"position":    m.Position,
			"mobile":      m.Mobile,
			"avatar":      m.Avatar,
			"status":      m.Status,
			"is_employee": linkedSet[m.UserID],
		})
	}
	respondList(c, result, len(result))
}

// ListWecomGroups GET /api/v1/admin/wecom/groups
// 查看企微群聊列表
func ListWecomGroups(c *gin.Context) {
	var groups []models.WecomGroupChat
	models.DB.Order("synced_at DESC").Find(&groups)
	respondList(c, groups, len(groups))
}

// GetWecomGroupMessages GET /api/v1/admin/wecom/groups/:chat_id/messages
// 查看群消息记录
func GetWecomGroupMessages(c *gin.Context) {
	chatID := c.Param("chat_id")
	var messages []models.WecomMessageLog
	models.DB.Where("chat_id = ?", chatID).Order("created_at ASC").Find(&messages)
	respondList(c, messages, len(messages))
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

	respondOK(c, gin.H{
		"data":  logs,
		"total": total,
	})
}

// DeleteEmployee DELETE /admin/employees/:id
func DeleteEmployee(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的员工ID")
		return
	}

	var emp models.Employee
	if err := models.DB.First(&emp, uint(id)).Error; err != nil {
		notFound(c, "员工不存在")
		return
	}
	if emp.Role == "admin" {
		forbidden(c, "不能删除管理员账号")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Delete(&emp).Error
	}); err != nil {
		log.Printf("删除员工失败: %v", err)
		internalError(c, "删除失败，请稍后重试")
		return
	}

	userID, _ := c.Get("wecom_userid")
	userName, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", userID), fmt.Sprintf("%v", userName), models.AuditEmployeeDelete, emp.WecomUserID, "删除员工: "+emp.Name, c.ClientIP())
	log.Printf("员工已删除 | 员工=%s", emp.Name)
	respondMessage(c, "删除成功")
}

// BatchToggleEmployees PUT /admin/employees/batch_toggle
func BatchToggleEmployees(c *gin.Context) {
	var body struct {
		IDs    []uint `json:"ids"`
		Active bool   `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.IDs) == 0 {
		badRequest(c, "参数错误")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&models.Employee{}).Where("id IN ? AND role != ?", body.IDs, "admin").Update("is_active", body.Active).Error
	}); err != nil {
		log.Printf("批量操作员工状态失败: %v", err)
		internalError(c, "批量操作失败，请稍后重试")
		return
	}

	// 禁用时，使被禁用员工的所有已签发 token 失效，防止继续操作
	if !body.Active {
		var disabledEmps []models.Employee
		models.DB.Select("wecom_userid").Where("id IN ? AND role != ?", body.IDs, "admin").Find(&disabledEmps)
		for _, emp := range disabledEmps {
			middleware.RevokeAllUserTokens(emp.WecomUserID)
		}
		log.Printf("批量禁用员工 | count=%d | 已撤销所有相关Token", len(disabledEmps))
	}

	status := "启用"
	if !body.Active {
		status = "禁用"
	}
	respondMessage(c, fmt.Sprintf("已批量%s %d 名员工", status, len(body.IDs)))
}

// BatchDeleteEmployees POST /admin/employees/batch_delete
func BatchDeleteEmployees(c *gin.Context) {
	var body struct {
		IDs []uint `json:"ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.IDs) == 0 {
		badRequest(c, "参数错误")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Where("id IN ? AND role != ?", body.IDs, "admin").Delete(&models.Employee{}).Error
	}); err != nil {
		log.Printf("批量删除员工失败: %v", err)
		internalError(c, "批量删除失败，请稍后重试")
		return
	}

	respondMessage(c, fmt.Sprintf("已批量删除 %d 名员工", len(body.IDs)))
}
