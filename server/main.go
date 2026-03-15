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
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[PDD] ")

	// 加载 .env
	_ = godotenv.Load()

	// 初始化配置
	config.Init()

	// 初始化数据库
	models.InitDB(config.C.DBPath)

	// 初始化企微客户端
	services.InitWecom()

	// 确保目录存在
	os.MkdirAll("uploads", 0o755)
	os.MkdirAll("data", 0o755)

	// 创建 Gin 引擎
	r := gin.Default()

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     config.C.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	// 启用 Gzip 压缩 (对大小大于默认值的响应进行压缩)
	r.Use(gzip.Gzip(gzip.DefaultCompression))

	// ── 静态资源与前端 (Vue SPA) ──────────────────
	// 将 admin-web/dist 目录下的静态文件挂载到根路径
	r.Static("/assets", "../admin-web/dist/assets")
	r.StaticFile("/favicon.ico", "../admin-web/dist/favicon.ico")

	r.GET("/", func(c *gin.Context) {
		c.File("../admin-web/dist/index.html")
	})
	
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// ── API v1 路由 ──────────────────────────────
	v1 := r.Group("/api/v1")
	{
		// 认证 (公开)
		v1.POST("/auth/device_login", handlers.DeviceLogin)

		// OCR (公开, 后续可加 JWT)
		v1.POST("/orders/upload_ocr", handlers.UploadOCR)

		// 订单
		v1.POST("/orders/create", handlers.CreateOrder)
		v1.POST("/orders/grab", handlers.GrabOrder)
		v1.PUT("/orders/:id/status", handlers.UpdateOrderStatus)
		v1.GET("/orders/list", handlers.ListOrders)
		v1.GET("/orders/:id", handlers.GetOrder)

		// 管理端
		admin := v1.Group("/admin")
		{
			admin.GET("/dashboard", handlers.GetDashboard)
			admin.GET("/revenue_chart", handlers.GetRevenueChart)
			admin.GET("/employees", handlers.ListEmployees)
			admin.POST("/employees", handlers.CreateEmployee)
			admin.PUT("/employees/:id/toggle", handlers.ToggleEmployee)
			admin.GET("/team_workload", handlers.GetTeamWorkload)
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
