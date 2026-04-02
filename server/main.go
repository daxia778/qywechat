package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/handlers"
	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

var startupTime = time.Now()

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[PDD] ")

	// 加载 .env（优先工作目录，其次可执行文件所在目录）
	if err := godotenv.Load(); err != nil {
		// 工作目录没找到，尝试可执行文件所在目录
		exe, _ := os.Executable()
		exeDir := filepath.Dir(exe)
		if err2 := godotenv.Load(filepath.Join(exeDir, ".env")); err2 != nil {
			log.Printf("⚠️ .env 未加载 (cwd 和 exe 目录均无): %v", err2)
		} else {
			log.Printf("✅ .env 从可执行文件目录加载: %s", exeDir)
		}
	}

	// 初始化配置
	config.Init()

	// 初始化数据库
	models.InitDB()

	// 初始化企微客户端
	services.InitWecom()

	// 顾客数据迁移（从已有订单回填，幂等）
	services.MigrateCustomersFromOrders()

	// 种子数据填充（空库时自动执行，已有数据则跳过）
	SeedData()

	// 创建可取消的 context，用于优雅关闭所有后台 goroutine
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 设置限速器的 context（必须在创建限速中间件之前调用）
	middleware.SetRateLimiterContext(ctx)

	// 启动安全模块后台清理（替代原 init() goroutine）
	middleware.StartFailMapCleaner(ctx)

	// 启动 CSRF token 定期清理协程
	middleware.StartCSRFCleanup(ctx)

	// 从数据库恢复 Token 黑名单（重启后不丢失）
	middleware.LoadTokenBlacklistFromDB()

	// 启动 Token 黑名单定期清理协程
	middleware.StartTokenCleanup(ctx)

	// 启动 SQLite 定时备份调度器
	services.StartBackupScheduler(ctx)

	// 启动交付截止倒计时提醒调度器
	services.StartDeadlineReminderWatcher(ctx)

	// 启动上传文件定时清理 (7天过期)
	services.StartUploadCleanupScheduler(ctx)

	// 启动企微通讯录定时同步 (每小时)
	services.StartWecomSyncScheduler(ctx)

	// 启动企微数据 90 天过期清理
	services.StartWecomDataCleanupScheduler(ctx)

	// 启动企微对外收款定时同步 (每2小时)
	services.StartWecomPaymentSyncScheduler(ctx)

	// 确保目录存在
	os.MkdirAll("uploads", 0o750) // #nosec G301 — 服务进程专用目录
	os.MkdirAll("data", 0o750)    // #nosec G301 — 服务进程专用目录

	// 创建 Gin 引擎
	r := gin.Default()

	// 只信任本地反向代理，防止 ClientIP 伪造
	r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

	// 上传文件大小限制 (10MB，防止 DoS)
	r.MaxMultipartMemory = 10 << 20

	// 安全响应头 (X-Content-Type-Options, X-Frame-Options, HSTS, CSP 等)
	r.Use(middleware.SecurityHeaders())

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     config.C.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-CSRF-Token"},
		ExposeHeaders:    []string{"X-CSRF-Token"},
		AllowCredentials: true,
	}))

	// 启用 Gzip 压缩 (对大小大于默认值的响应进行压缩)
	r.Use(gzip.Gzip(gzip.DefaultCompression))

	// 可疑请求拦截 (阻断扫描器探测 .php/.env/wp-admin 等)
	r.Use(middleware.SuspiciousRequestFilter())

	// 请求体大小限制 (10MB，与 MaxMultipartMemory 一致，兼容文件上传)
	r.Use(middleware.MaxBodySize(10 << 20))

	// CSRF 防护 (状态变更请求需携带 X-CSRF-Token)
	r.Use(middleware.CSRFMiddleware())

	// ── 静态资源与前端 (SPA) ──────────────────
	// 开发环境: ../admin-web/dist, 生产环境: dist (WorkingDirectory=/opt/pdd-server)
	distDir := "../admin-web/dist"
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		distDir = "dist"
	}
	r.Static("/assets", distDir+"/assets")
	r.StaticFile("/favicon.svg", distDir+"/favicon.svg")
	r.StaticFile("/icons.svg", distDir+"/icons.svg")
	// Vue SPA: 所有非 API/静态的请求由 NoRoute 兜底 (见下方)

	// P2-18: health 端点只返回 status，不暴露 uptime 等信息
	r.GET("/health", func(c *gin.Context) {
		sqlDB, err := models.DB.DB()
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error"})
			return
		}
		if err := sqlDB.Ping(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "error"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// ── API v1 路由 ──────────────────────────────
	v1 := r.Group("/api/v1")
	// API 通用限速 (60 请求/分钟/IP)
	v1.Use(middleware.APIRateLimit())
	{
		// 认证 (公开, 但有更严格的频率限制防爆破 + 暴力破解IP封锁)
		// 登录限速: 5 请求/分钟/IP (叠加在 API 通用限速之上)
		v1.POST("/auth/login", middleware.BruteForceGuard(), middleware.LoginRateLimit(), handlers.Login)
		v1.POST("/auth/device_login", middleware.BruteForceGuard(), middleware.LoginRateLimit(), handlers.DeviceLogin)   // 兼容桌面端过渡
		v1.POST("/auth/admin_login", middleware.BruteForceGuard(), middleware.LoginRateLimit(), handlers.AdminLogin)     // 兼容旧前端过渡

		// 企微回调 (公开, 企微服务器验证必须公开)
		v1.Any("/wecom/callback", handlers.WecomCallback)

		// WebSocket (公开, token 通过 query param 传递)
		v1.GET("/ws", handlers.WebSocketHandler)

		// 客户端 OTA (公开)
		v1.GET("/app/version", handlers.CheckAppVersion)

		// Token 校验/注销/刷新 (需要 JWT)
		authGroup := v1.Group("/auth")
		authGroup.Use(middleware.JWTAuth())
		{
			authGroup.GET("/validate_token", handlers.ValidateToken)
			authGroup.POST("/logout", handlers.Logout)
			authGroup.POST("/refresh", handlers.RefreshToken)
		}

		// 订单操作 (全部需要 JWT 登录)
		orderAuth := v1.Group("/orders")
		orderAuth.Use(middleware.JWTAuth())
		{
			orderAuth.POST("/upload_ocr", handlers.UploadOCR)
			orderAuth.POST("/upload_attachment", handlers.UploadAttachment)
			orderAuth.GET("/list", handlers.ListOrders)
			orderAuth.GET("/:id", handlers.GetOrder)
			orderAuth.POST("/create", handlers.CreateOrder)
			// 跟单客服列表（桌面端建群选择）
			orderAuth.GET("/follow-staff", handlers.ListFollowStaff)
			// 花名册
			orderAuth.GET("/designers", handlers.SearchDesigners)
			orderAuth.POST("/designers", handlers.CreateDesigner)
			// 跟单操作
			orderAuth.PUT("/:id/assign-designer", handlers.AssignDesigner)
			orderAuth.PUT("/:id/adjust-commission", handlers.AdjustCommission)
			orderAuth.PUT("/batch-status", handlers.BatchUpdateOrderStatus)
			orderAuth.PUT("/:id/status", handlers.UpdateOrderStatus)
			orderAuth.PUT("/:id/amount", handlers.UpdateOrderAmount)
			orderAuth.GET("/:id/detail", handlers.GetOrderDetail)
			orderAuth.GET("/:id/timeline", handlers.GetOrderTimeline)
			orderAuth.GET("/:id/profit", handlers.GetOrderProfit)
			orderAuth.GET("/pending-match", handlers.ListPendingMatchOrders)
			orderAuth.POST("/:id/match", handlers.MatchOrderContact)
			orderAuth.PUT("/:id/reassign", handlers.ReassignOrder)
		orderAuth.GET("/my-stats", handlers.GetMyStats)

			// 上传文件访问（需 JWT 鉴权，防止未授权访问 OCR 截图等敏感文件）
			orderAuth.GET("/uploads/*filepath", func(c *gin.Context) {
				fp := c.Param("filepath")
				// 清洗路径防止路径穿越攻击 (e.g. ../../etc/passwd)
				cleaned := filepath.Clean(fp)
				// filepath.Clean 后可能以 "/" 开头，Join 会正确处理
				absUploads, err := filepath.Abs("uploads")
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "INTERNAL_ERROR", "message": "内部错误"})
				return
			}
				target := filepath.Join(absUploads, cleaned)
				// 确保最终路径仍在 uploads/ 目录下
				if !strings.HasPrefix(target, absUploads+string(filepath.Separator)) && target != absUploads {
					c.JSON(http.StatusForbidden, gin.H{"error": "非法路径"})
					return
				}
				c.File(target)
			})
		}

		// 收款流水 (需要 JWT 登录)
		payments := v1.Group("/payments")
		payments.Use(middleware.JWTAuth())
		{
			payments.GET("", handlers.ListPayments)
			payments.POST("", handlers.CreatePayment)
			payments.PUT("/:id/match", handlers.MatchPayment)
			payments.GET("/summary", handlers.GetPaymentSummary)
			payments.POST("/sync-wecom", handlers.SyncWecomPayments)
		}

		// 管理端 (需要 JWT + Admin 角色 + IP 白名单)
		admin := v1.Group("/admin")
		admin.Use(middleware.JWTAuth(), middleware.AdminOnly(), middleware.AdminIPWhitelist())
		{
			admin.GET("/dashboard", handlers.GetDashboard)
			admin.GET("/revenue_chart", handlers.GetRevenueChart)
			admin.GET("/employees", handlers.ListEmployees)
			admin.POST("/employees", handlers.CreateEmployee)
			admin.PUT("/employees/:id/toggle", handlers.ToggleEmployee)
			admin.PUT("/employees/:id/reset_password", handlers.ResetPassword)
			admin.PUT("/employees/:id/unbind", handlers.UnbindDevice)
			admin.DELETE("/employees/:id", handlers.DeleteEmployee)
			admin.PUT("/employees/batch_toggle", handlers.BatchToggleEmployees)
			admin.POST("/employees/batch_delete", handlers.BatchDeleteEmployees)
			admin.GET("/team_workload", handlers.GetTeamWorkload)
			admin.GET("/profit_breakdown", handlers.GetProfitBreakdown)
			admin.GET("/audit_logs", handlers.ListAuditLogs)
			admin.POST("/versions", handlers.CreateAppVersion)
			admin.GET("/activation_codes", handlers.ListActivationCodes)
			admin.PUT("/activation_codes/:id/pause", handlers.PauseActivationCode)
			admin.PUT("/activation_codes/:id/regenerate", handlers.RegenerateActivationCode)

			// 抢单监控
			admin.GET("/grab_alerts", handlers.GetGrabAlerts)

			// 顾客管理
			admin.GET("/customers", handlers.ListCustomers)
			admin.GET("/customers/:id", handlers.GetCustomer)
			admin.PUT("/customers/:id", handlers.UpdateCustomer)
			admin.POST("/customers/merge", handlers.MergeCustomers)

			// 客户联系（联系我）
			admin.POST("/contact_way", handlers.CreateContactWay)
			admin.GET("/contact_ways", handlers.ListContactWays)

			// 企微数据查看
			admin.GET("/wecom/members", handlers.ListWecomMembers)
			admin.GET("/wecom/groups", handlers.ListWecomGroups)
			admin.GET("/wecom/groups/:chat_id/messages", handlers.GetWecomGroupMessages)
			admin.GET("/wecom/diagnostic", handlers.WecomDiagnostic)
			admin.POST("/wecom/sync", func(c *gin.Context) {
				go services.SyncWecomMembers()
				c.JSON(http.StatusOK, gin.H{"message": "通讯录同步已触发，请查看日志"})
			})

			// Phase 2: 通知
			admin.GET("/notifications", handlers.ListNotifications)
			admin.PUT("/notifications/all/read", handlers.MarkAllNotificationsRead)
			admin.PUT("/notifications/:id/read", handlers.MarkNotificationRead)

			// Phase 2: 数据导出
			admin.GET("/orders/export", handlers.ExportOrdersCSV)
			admin.GET("/profit/export", handlers.ExportProfitCSV)

			// Phase 3: Excel 多 Sheet 导出
			admin.GET("/export/excel", handlers.ExportExcel)

			// 简易运行指标 (预留，后续可替换为 Prometheus)
			admin.GET("/metrics", func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{
					"uptime_seconds": time.Since(startupTime).Seconds(),
					"goroutines":     runtime.NumGoroutine(),
				})
			})
		}
	}

	// P2-17: NoRoute — API 路径返回 404 JSON，非 API 路径返回前端 SPA
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "接口不存在"})
			return
		}
		c.File(distDir + "/index.html")
	})

	// 启动
	port := config.C.ServerPort
	log.Println("=" + fmt.Sprintf("%49s", "="))
	log.Println("PDD 派单管理系统启动")
	log.Printf("   地址: http://0.0.0.0:%s", port)
	log.Printf("   API:  http://0.0.0.0:%s/api/v1", port)
	log.Println("=" + fmt.Sprintf("%49s", "="))

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: r,
	}

	// 在 goroutine 中启动服务器
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务启动失败: %v", err)
		}
	}()

	// 优雅关闭 (Graceful Shutdown)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务器...")

	// 取消所有后台 goroutine
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatal("服务器强制关闭:", err)
	}

	log.Println("服务器已优雅退出")
}
