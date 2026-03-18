package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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

	// 加载 .env
	_ = godotenv.Load()

	// 初始化配置
	config.Init()

	// 初始化数据库
	models.InitDB()

	// 初始化企微客户端
	services.InitWecom()

	// 启动 SQLite 定时备份调度器
	services.StartBackupScheduler()

	// 启动订单超时自动触发派单调度器
	services.StartOrderTimeoutWatcher()

	// 启动交付截止倒计时提醒调度器
	services.StartDeadlineReminderWatcher()

	// 启动上传文件定时清理 (7天过期)
	services.StartUploadCleanupScheduler()

	// 启动企微通讯录定时同步 (每小时)
	services.StartWecomSyncScheduler()

	// 启动企微数据 90 天过期清理
	services.StartWecomDataCleanupScheduler()

	// 确保目录存在
	os.MkdirAll("uploads", 0o755)
	os.MkdirAll("data", 0o755)

	// 创建 Gin 引擎
	r := gin.Default()

	// 🔒 上传文件大小限制 (10MB，防止 DoS)
	r.MaxMultipartMemory = 10 << 20

	// 🛡️ 安全响应头 (X-Content-Type-Options, X-Frame-Options, HSTS, CSP 等)
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

	// 🛡️ 可疑请求拦截 (阻断扫描器探测 .php/.env/wp-admin 等)
	r.Use(middleware.SuspiciousRequestFilter())

	// 🛡️ 请求体大小限制 (2MB，防 DoS 大包攻击，文件上传另设)
	r.Use(middleware.MaxBodySize(2 << 20))

	// 🛡️ CSRF 防护 (状态变更请求需携带 X-CSRF-Token)
	r.Use(middleware.CSRFMiddleware())

	// ── 静态资源与前端 (Vue SPA) ──────────────────
	// 将 admin-web/dist 目录下的静态文件挂载到根路径
	r.Static("/assets", "../admin-web/dist/assets")
	r.StaticFile("/favicon.svg", "../admin-web/dist/favicon.svg")
	r.StaticFile("/icons.svg", "../admin-web/dist/icons.svg")

	// Vue SPA: 所有非 API/静态的请求由 NoRoute 兜底 (见下方)

	
	r.GET("/health", func(c *gin.Context) {
		sqlDB, err := models.DB.DB()
		if err != nil {
			c.JSON(503, gin.H{"status": "error", "db": "unreachable"})
			return
		}
		if err := sqlDB.Ping(); err != nil {
			c.JSON(503, gin.H{"status": "error", "db": "ping_failed"})
			return
		}
		c.JSON(200, gin.H{
			"status": "ok",
			"db":     "connected",
			"uptime": time.Since(startupTime).String(),
		})
	})

	// ── API v1 路由 ──────────────────────────────
	v1 := r.Group("/api/v1")
	// 🛡️ API 通用限速 (60 请求/分钟/IP)
	v1.Use(middleware.APIRateLimit())
	{
		// 认证 (公开, 但有更严格的频率限制防爆破 + 暴力破解IP封锁)
		// 登录限速: 5 请求/分钟/IP (叠加在 API 通用限速之上)
		v1.POST("/auth/device_login", middleware.BruteForceGuard(), middleware.LoginRateLimit(), handlers.DeviceLogin)
		v1.POST("/auth/admin_login", middleware.BruteForceGuard(), middleware.LoginRateLimit(), handlers.AdminLogin)

		// 企微回调 (公开, 企微服务器验证必须公开)
		v1.Any("/wecom/callback", handlers.WecomCallback)

		// WebSocket (公开, token 通过 query param 传递)
		v1.GET("/ws", handlers.WebSocketHandler)

		// 客户端 OTA (公开)
		v1.GET("/app/version", handlers.CheckAppVersion)

		// Token 校验 (需要 JWT)
		authGroup := v1.Group("/auth")
		authGroup.Use(middleware.JWTAuth())
		{
			authGroup.GET("/validate_token", handlers.ValidateToken)
		}

		// 订单操作 (全部需要 JWT 登录)
		orderAuth := v1.Group("/orders")
		orderAuth.Use(middleware.JWTAuth())
		{
			orderAuth.POST("/upload_ocr", handlers.UploadOCR)
			orderAuth.GET("/list", handlers.ListOrders)
			orderAuth.GET("/:id", handlers.GetOrder)
			orderAuth.POST("/create", handlers.CreateOrder)
			orderAuth.POST("/grab", handlers.GrabOrder)
			orderAuth.PUT("/:id/status", handlers.UpdateOrderStatus)
			orderAuth.GET("/:id/detail", handlers.GetOrderDetail)
			orderAuth.GET("/:id/timeline", handlers.GetOrderTimeline)
		}

		// 管理端 (需要 JWT + Admin 角色)
		admin := v1.Group("/admin")
		admin.Use(middleware.JWTAuth(), middleware.AdminOnly())
		{
			admin.GET("/dashboard", handlers.GetDashboard)
			admin.GET("/revenue_chart", handlers.GetRevenueChart)
			admin.GET("/employees", handlers.ListEmployees)
			admin.POST("/employees", handlers.CreateEmployee)
			admin.PUT("/employees/:id/toggle", handlers.ToggleEmployee)
			admin.PUT("/employees/:id/unbind", handlers.UnbindDevice)
			admin.GET("/team_workload", handlers.GetTeamWorkload)
			admin.GET("/profit_breakdown", handlers.GetProfitBreakdown)
			admin.GET("/audit_logs", handlers.ListAuditLogs)
			admin.POST("/versions", handlers.CreateAppVersion)
			admin.GET("/activation_codes", handlers.ListActivationCodes)
			admin.PUT("/activation_codes/:id/pause", handlers.PauseActivationCode)

			// Phase 2: 通知
			admin.GET("/notifications", handlers.ListNotifications)
			admin.PUT("/notifications/:id/read", handlers.MarkNotificationRead)

			// Phase 2: 数据导出
			admin.GET("/orders/export", handlers.ExportOrdersCSV)
			admin.GET("/profit/export", handlers.ExportProfitCSV)
		}
	}

	// 设置 NoRoute 处理前端 Vue Router 的 history 模式
	r.NoRoute(func(c *gin.Context) {
		c.File("../admin-web/dist/index.html")
	})

	// 启动
	port := config.C.ServerPort
	log.Println("=" + fmt.Sprintf("%49s", "="))
	log.Println("🚀 PDD 派单管理系统启动")
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
			log.Fatalf("❌ 服务启动失败: %v", err)
		}
	}()

	// 优雅关闭 (Graceful Shutdown)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务器...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("服务器强制关闭:", err)
	}

	log.Println("服务器已优雅退出")
}
