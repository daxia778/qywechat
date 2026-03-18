package handlers

import (
	"log"
	"net/http"
	"time"

	"pdd-order-system/middleware"
	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ─── 认证 ──────────────────────────────────────────

type DeviceLoginReq struct {
	ActivationCode string `json:"activation_code"`
	MachineID      string `json:"machine_id" binding:"required"`
	MacAddress     string `json:"mac_address"`
	WecomUserID    string `json:"wecom_userid"`
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
		// ── 无激活码: 仅允许已绑定设备静默重连 ──
		result := models.DB.Where("machine_id = ? AND is_active = ?", req.MachineID, true).First(&emp)
		if result.Error != nil {
			middleware.RecordLoginFail(c.ClientIP())
			c.JSON(http.StatusForbidden, gin.H{"error": "设备未注册，请输入激活码"})
			return
		}
	} else {
		// ── 有激活码: 校验激活码有效性 ──
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
			c.JSON(http.StatusForbidden, gin.H{"error": "激活码无效或已被使用"})
			return
		}
		emp = *matchedEmp

		// 检查设备指纹绑定
		if emp.MachineID == "" {
			// 首次激活: 绑定设备指纹 + MAC + 清空激活码（一次性使用）
			updates := map[string]interface{}{
				"machine_id":             req.MachineID,
				"mac_address":            req.MacAddress,
				"activation_code":        "",
				"activation_code_prefix": "",
			}
			models.DB.Model(&emp).Updates(updates)
			emp.MachineID = req.MachineID
			log.Printf("✅ 设备永久绑定 | 员工=%s | MachineID=%s | MAC=%s | 激活码已销毁", emp.Name, req.MachineID, req.MacAddress)
			models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "首次设备激活绑定，激活码已销毁", c.ClientIP())
		} else if emp.MachineID != req.MachineID {
			c.JSON(http.StatusForbidden, gin.H{"error": "该激活码已绑定其他设备，请联系管理员解绑"})
			return
		}
	}

	token, err := middleware.CreateToken(emp.WecomUserID, emp.Name, emp.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成认证令牌失败"})
		return
	}
	models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "设备登录成功", c.ClientIP())

	// 更新最后登录时间和IP
	now := time.Now()
	models.DB.Model(&emp).Updates(map[string]interface{}{
		"last_login_at": &now,
		"last_login_ip": c.ClientIP(),
	})

	c.JSON(http.StatusOK, gin.H{
		"token":         token,
		"employee_name": emp.Name,
		"wecom_userid":  emp.WecomUserID,
	})
}

// ─── 管理后台登录 (无需 MAC 绑定) ──────────────────

type AdminLoginReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// AdminLogin 管理后台登录: 用户名 + 密码 (仅限 admin 角色)
func AdminLogin(c *gin.Context) {
	var req AdminLoginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入用户名和密码"})
		return
	}

	var emp models.Employee
	result := models.DB.Where("username = ? AND is_active = ? AND role = ?", req.Username, true, "admin").First(&emp)

	if result.Error != nil {
		middleware.RecordLoginFail(c.ClientIP())
		models.WriteAuditLog("", "", models.AuditLoginFail, "", "管理员登录失败: 用户不存在或已禁用", c.ClientIP())
		c.JSON(http.StatusForbidden, gin.H{"error": "用户名或密码错误"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(req.Password)); err != nil {
		middleware.RecordLoginFail(c.ClientIP())
		models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLoginFail, "", "管理员登录密码错误", c.ClientIP())
		c.JSON(http.StatusForbidden, gin.H{"error": "用户名或密码错误"})
		return
	}

	token, err := middleware.CreateToken(emp.WecomUserID, emp.Name, emp.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成认证令牌失败"})
		return
	}
	models.WriteAuditLog(emp.WecomUserID, emp.Name, models.AuditLogin, "", "管理员登录成功", c.ClientIP())

	// 更新最后登录时间
	now := time.Now()
	models.DB.Model(&emp).Updates(map[string]interface{}{
		"last_login_at": &now,
		"last_login_ip": c.ClientIP(),
	})

	c.JSON(http.StatusOK, gin.H{
		"token":         token,
		"employee_name": emp.Name,
		"wecom_userid":  emp.WecomUserID,
	})
}

// ValidateToken 校验当前 Token 是否有效 (用于前端会话保持)
func ValidateToken(c *gin.Context) {
	// 能走到这里说明 JWT 中间件已校验通过
	name, _ := c.Get("name")
	role, _ := c.Get("role")
	sub, _ := c.Get("wecom_userid")
	c.JSON(http.StatusOK, gin.H{
		"valid":         true,
		"employee_name": name,
		"wecom_userid":  sub,
		"role":          role,
	})
}
