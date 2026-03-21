package handlers

import (
	"fmt"
	"log"
	"time"

	"pdd-order-system/middleware"
	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ─── 统一登录 ──────────────────────────────────────────

type LoginReq struct {
	Username  string `json:"username" binding:"required"`
	Password  string `json:"password" binding:"required"`
	MachineID string `json:"machine_id"` // 桌面端可选传入，用于设备绑定
}

// Login 统一登录接口: 所有角色使用 username + password
// POST /api/v1/auth/login
func Login(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请输入用户名和密码")
		return
	}

	var emp models.Employee
	result := models.DB.Where("username = ? AND is_active = ?", req.Username, true).First(&emp)

	if result.Error != nil {
		middleware.RecordLoginFail(c.ClientIP())
		models.WriteAuditLog("", "", models.AuditLoginFail, "", "登录失败: 用户不存在或已禁用 ("+req.Username+")", c.ClientIP())
		forbidden(c, "用户名或密码错误")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(req.Password)); err != nil {
		middleware.RecordLoginFail(c.ClientIP())
		models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLoginFail, "", "登录密码错误", c.ClientIP())
		forbidden(c, "用户名或密码错误")
		return
	}

	// 桌面端设备绑定（可选）
	if req.MachineID != "" && emp.MachineID == "" {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&emp).Update("machine_id", req.MachineID).Error
		})
		emp.MachineID = req.MachineID
		log.Printf("桌面端设备绑定 | 员工=%s | MachineID=%s", emp.Name, req.MachineID)
	}

	token, err := middleware.CreateToken(emp.WecomUserID, emp.Name, emp.Role)
	if err != nil {
		log.Printf("生成认证令牌失败: %v", err)
		internalError(c, "生成认证令牌失败")
		return
	}
	models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "登录成功", c.ClientIP())

	// 更新最后登录时间和IP
	now := time.Now()
	models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Updates(map[string]any{
			"last_login_at": &now,
			"last_login_ip": c.ClientIP(),
		}).Error
	})

	respondOK(c, gin.H{
		"token": token,
		"user": gin.H{
			"id":       emp.ID,
			"name":     emp.Name,
			"role":     emp.Role,
			"username": emp.Username,
		},
	})
}

// ─── 兼容旧接口: 设备登录 (桌面端过渡期) ──────────────

type DeviceLoginReq struct {
	ActivationCode string `json:"activation_code"`
	MachineID      string `json:"machine_id" binding:"required"`
	MacAddress     string `json:"mac_address"`
	WecomUserID    string `json:"wecom_userid"`
}

// DeviceLogin 设备登录: 激活码 + MAC 绑定 (向后兼容，桌面端过渡期保留)
func DeviceLogin(c *gin.Context) {
	var req DeviceLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("DeviceLogin 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	var emp models.Employee

	if req.ActivationCode == "" {
		// ── 无激活码: 仅允许已绑定的非管理员设备静默重连 ──
		result := models.DB.Where("machine_id = ? AND is_active = ? AND role != 'admin'", req.MachineID, true).First(&emp)
		if result.Error != nil {
			middleware.RecordLoginFail(c.ClientIP())
			forbidden(c, "设备未注册，请使用账号密码登录")
			return
		}
	} else {
		// ── 有激活码: 校验激活码有效性 (兼容旧数据) ──
		var matchedEmp *models.Employee

		if req.WecomUserID != "" {
			var candidate models.Employee
			result := models.DB.Where("wecom_userid = ? AND is_active = ?", req.WecomUserID, true).First(&candidate)
			if result.Error == nil {
				if err := bcrypt.CompareHashAndPassword([]byte(candidate.ActivationCode), []byte(req.ActivationCode)); err == nil {
					matchedEmp = &candidate
				}
			}
		} else {
			var employees []models.Employee
			prefix := req.ActivationCode
			if len(prefix) > 4 {
				prefix = prefix[:4]
			}
			query := models.DB.Where("activation_code != '' AND is_active = ?", true)
			if prefix != "" {
				query = query.Where("activation_code_prefix = ?", prefix)
			}
			query.Find(&employees)
			for i := range employees {
				if err := bcrypt.CompareHashAndPassword([]byte(employees[i].ActivationCode), []byte(req.ActivationCode)); err == nil {
					matchedEmp = &employees[i]
					break
				}
			}
		}

		if matchedEmp == nil {
			middleware.RecordLoginFail(c.ClientIP())
			forbidden(c, "激活码无效，请使用账号密码登录")
			return
		}
		emp = *matchedEmp

		// 检查设备指纹绑定
		if emp.MachineID == "" {
			updates := map[string]any{
				"machine_id":             req.MachineID,
				"mac_address":            req.MacAddress,
				"activation_code":        "",
				"activation_code_prefix": "",
			}
			models.WriteTx(func(tx *gorm.DB) error {
				return tx.Model(&emp).Updates(updates).Error
			})
			emp.MachineID = req.MachineID
			log.Printf("设备永久绑定 | 员工=%s | MachineID=%s | MAC=%s | 激活码已销毁", emp.Name, req.MachineID, req.MacAddress)
			models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "首次设备激活绑定，激活码已销毁", c.ClientIP())
		} else if emp.MachineID != req.MachineID {
			forbidden(c, "该激活码已绑定其他设备，请联系管理员解绑")
			return
		}
	}

	token, err := middleware.CreateToken(emp.WecomUserID, emp.Name, emp.Role)
	if err != nil {
		log.Printf("生成认证令牌失败: %v", err)
		internalError(c, "生成认证令牌失败")
		return
	}
	models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "设备登录成功", c.ClientIP())

	// 更新最后登录时间和IP
	now := time.Now()
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Updates(map[string]any{
			"last_login_at": &now,
			"last_login_ip": c.ClientIP(),
		}).Error
	}); err != nil {
		log.Printf("更新设备登录时间失败: %v", err)
	}

	respondOK(c, gin.H{
		"token":         token,
		"employee_name": emp.Name,
		"wecom_userid":  emp.WecomUserID,
	})
}

// ─── 管理后台登录 (兼容旧前端，过渡期保留) ──────────────

type AdminLoginReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// AdminLogin 管理后台登录 (兼容旧前端，新前端请使用 /auth/login)
func AdminLogin(c *gin.Context) {
	var req AdminLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "请输入用户名和密码")
		return
	}

	var emp models.Employee
	result := models.DB.Where("username = ? AND is_active = ?", req.Username, true).First(&emp)

	if result.Error != nil {
		middleware.RecordLoginFail(c.ClientIP())
		models.WriteAuditLog("", "", models.AuditLoginFail, "", "管理员登录失败: 用户不存在或已禁用", c.ClientIP())
		forbidden(c, "用户名或密码错误")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(req.Password)); err != nil {
		middleware.RecordLoginFail(c.ClientIP())
		models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLoginFail, "", "管理员登录密码错误", c.ClientIP())
		forbidden(c, "用户名或密码错误")
		return
	}

	// 校验必须是 admin 角色
	if emp.Role != "admin" {
		models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLoginFail, "", "非管理员账号尝试登录管理端", c.ClientIP())
		forbidden(c, "非管理员账号，禁止登录管理端")
		return
	}

	token, err := middleware.CreateToken(emp.WecomUserID, emp.Name, emp.Role)
	if err != nil {
		log.Printf("生成认证令牌失败: %v", err)
		internalError(c, "生成认证令牌失败")
		return
	}
	models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "管理员登录成功", c.ClientIP())

	now := time.Now()
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&emp).Updates(map[string]any{
			"last_login_at": &now,
			"last_login_ip": c.ClientIP(),
		}).Error
	}); err != nil {
		log.Printf("更新管理员登录时间失败: %v", err)
	}

	respondOK(c, gin.H{
		"token":         token,
		"employee_name": emp.Name,
		"wecom_userid":  emp.WecomUserID,
	})
}

// ValidateToken 校验当前 Token 是否有效 (用于前端会话保持)
func ValidateToken(c *gin.Context) {
	name, _ := c.Get("name")
	role, _ := c.Get("role")
	sub, _ := c.Get("wecom_userid")
	respondOK(c, gin.H{
		"valid":         true,
		"employee_name": name,
		"wecom_userid":  sub,
		"role":          role,
	})
}

// ─── Token 注销与刷新 ──────────────────────────────────────

// Logout 注销当前 Token，加入黑名单
// POST /api/v1/auth/logout
func Logout(c *gin.Context) {
	claimsVal, exists := c.Get("jwt_claims")
	if !exists {
		unauthorized(c, "无法获取 Token 信息")
		return
	}
	claims, ok := claimsVal.(jwt.MapClaims)
	if !ok {
		unauthorized(c, "Token 解析异常")
		return
	}

	jti, _ := claims["jti"].(string)
	if jti == "" {
		badRequest(c, "Token 缺少 jti 字段")
		return
	}

	// 计算 token 原始过期时间
	expAt := time.Now().Add(24 * time.Hour) // 默认兜底
	if expFloat, ok := claims["exp"].(float64); ok {
		expAt = time.Unix(int64(expFloat), 0)
	}

	middleware.RevokeToken(jti, expAt)

	sub, _ := c.Get("wecom_userid")
	name, _ := c.Get("name")
	models.WriteAuditLog(fmt.Sprintf("%v", sub), fmt.Sprintf("%v", name), models.AuditLogin, "", "用户主动登出", c.ClientIP())

	log.Printf("Token 已注销 | 用户=%v | jti=%s", name, jti)
	respondMessage(c, "已成功登出")
}

// RefreshToken 刷新 Token: 验证当前 token 有效，签发新 token，旧 token 加入黑名单
// POST /api/v1/auth/refresh
func RefreshToken(c *gin.Context) {
	claimsVal, exists := c.Get("jwt_claims")
	if !exists {
		unauthorized(c, "无法获取 Token 信息")
		return
	}
	claims, ok := claimsVal.(jwt.MapClaims)
	if !ok {
		unauthorized(c, "Token 解析异常")
		return
	}

	sub, _ := claims["sub"].(string)
	name, _ := claims["name"].(string)
	role, _ := claims["role"].(string)
	oldJTI, _ := claims["jti"].(string)

	if sub == "" || name == "" || role == "" {
		unauthorized(c, "Token 信息不完整")
		return
	}

	// 签发新 token
	newToken, err := middleware.CreateToken(sub, name, role)
	if err != nil {
		log.Printf("生成新令牌失败: %v", err)
		internalError(c, "生成新令牌失败")
		return
	}

	// 将旧 token 加入黑名单
	if oldJTI != "" {
		expAt := time.Now().Add(24 * time.Hour) // 默认兜底
		if expFloat, ok := claims["exp"].(float64); ok {
			expAt = time.Unix(int64(expFloat), 0)
		}
		middleware.RevokeToken(oldJTI, expAt)
	}

	log.Printf("Token 已刷新 | 用户=%s | 旧jti=%s", name, oldJTI)
	respondOK(c, gin.H{
		"token": newToken,
		"user": gin.H{
			"name":         name,
			"role":         role,
			"wecom_userid": sub,
		},
	})
}
