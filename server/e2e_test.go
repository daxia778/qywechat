package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"pdd-order-system/config"
	"pdd-order-system/handlers"
	"pdd-order-system/middleware"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// ══════════════════════════════════════════════════════════════
// Setup
// ══════════════════════════════════════════════════════════════

func setupE2ERouter(t *testing.T) (*httptest.Server, func()) {
	t.Helper()

	// 1. 初始化 config.C（内存 SQLite，固定 JWT 密钥，分润费率，AdminAllowedIPs 留空放行）
	config.C = &config.Config{
		DBType:                  "sqlite",
		DBPath:                  ":memory:",
		JWTSecretKey:            "e2e-test-secret-key-32bytes!!!!!",
		JWTExpireMinutes:        60,
		AdminDefaultUsername:    "admin",
		AdminDefaultPassword:    "Test123!",
		CORSOrigins:             []string{"*"},
		GrabOrderTimeoutSeconds: 300,
		PlatformFeeRate:         30,
		DesignerCommissionRate:  25,
		SalesCommissionRate:     10,
		FollowCommissionRate:    5,
		ServerPort:              "0",
		DeployMode:              "debug",
		AdminAllowedIPs:         nil, // 空 = 放行所有 IP
		OSSProvider:             "local",
		BaseURL:                 "http://localhost:8200",
	}

	// 2. 打开内存 SQLite，替换 models.DB（每个测试独立数据库）
	dbName := fmt.Sprintf("file:e2e_%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dbName), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	models.DB = db

	// 3. AutoMigrate 所有模型
	if err := db.AutoMigrate(
		&models.Employee{},
		&models.Order{},
		&models.Customer{},
		&models.AuditLog{},
		&models.WecomGroupChat{},
		&models.WecomMember{},
		&models.WecomMessageLog{},
		&models.AppVersion{},
		&models.Notification{},
		&models.OrderTimeline{},
		&models.PaymentRecord{},
		&models.TokenBlacklist{},
		&models.UserMinIssuedAtRecord{},
	); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}

	// 4. 创建 context + 启动中间件后台任务
	ctx, cancel := context.WithCancel(context.Background())
	middleware.SetRateLimiterContext(ctx)
	middleware.StartFailMapCleaner(ctx)
	middleware.StartCSRFCleanup(ctx)

	// 5. 初始化企微客户端（空配置不会 panic）
	services.InitWecom()

	// 6. 构建 Gin 引擎（照搬 main.go 路由注册，跳过静态资源和 NoRoute）
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	r.MaxMultipartMemory = 10 << 20

	// 安全响应头
	r.Use(middleware.SecurityHeaders())

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     config.C.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-CSRF-Token"},
		ExposeHeaders:    []string{"X-CSRF-Token"},
		AllowCredentials: true,
	}))

	// Gzip 压缩
	r.Use(gzip.Gzip(gzip.DefaultCompression))

	// 可疑请求拦截
	r.Use(middleware.SuspiciousRequestFilter())

	// 请求体大小限制
	r.Use(middleware.MaxBodySize(2 << 20))

	// CSRF 防护
	r.Use(middleware.CSRFMiddleware())

	// Health 端点（公开，用于获取 CSRF token）
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

	// API v1 路由
	v1 := r.Group("/api/v1")
	// v1.Use(middleware.APIRateLimit()) // skip APIRateLimit for E2E test robustness
	{
		// 认证（公开）
		v1.POST("/auth/login", handlers.Login)
		v1.POST("/auth/device_login", handlers.DeviceLogin)
		v1.POST("/auth/admin_login", handlers.AdminLogin)

		// 企微回调（公开）
		v1.Any("/wecom/callback", handlers.WecomCallback)

		// WebSocket
		v1.GET("/ws", handlers.WebSocketHandler)

		// 客户端 OTA
		v1.GET("/app/version", handlers.CheckAppVersion)

		// Token 校验/注销/刷新（需要 JWT）
		authGroup := v1.Group("/auth")
		authGroup.Use(middleware.JWTAuth())
		{
			authGroup.GET("/validate_token", handlers.ValidateToken)
			authGroup.POST("/logout", handlers.Logout)
			authGroup.POST("/refresh", handlers.RefreshToken)
		}

		// 订单操作（需要 JWT）
		orderAuth := v1.Group("/orders")
		orderAuth.Use(middleware.JWTAuth())
		{
			orderAuth.POST("/upload_ocr", handlers.UploadOCR)
			orderAuth.POST("/upload_attachment", handlers.UploadAttachment)
			orderAuth.GET("/list", handlers.ListOrders)
			orderAuth.GET("/:id", handlers.GetOrder)
			orderAuth.POST("/create", handlers.CreateOrder)
			orderAuth.POST("/grab", handlers.GrabOrder)
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
		}

		// 收款流水（需要 JWT）
		payments := v1.Group("/payments")
		payments.Use(middleware.JWTAuth())
		{
			payments.GET("", handlers.ListPayments)
			payments.POST("", handlers.CreatePayment)
			payments.PUT("/:id/match", handlers.MatchPayment)
			payments.GET("/summary", handlers.GetPaymentSummary)
			payments.POST("/sync-wecom", handlers.SyncWecomPayments)
		}

		// 管理端（需要 JWT + Admin 角色 + IP 白名单）
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
			admin.GET("/grab_alerts", handlers.GetGrabAlerts)
			admin.GET("/customers", handlers.ListCustomers)
			admin.GET("/customers/:id", handlers.GetCustomer)
			admin.PUT("/customers/:id", handlers.UpdateCustomer)
			admin.POST("/customers/merge", handlers.MergeCustomers)
			admin.POST("/contact_way", handlers.CreateContactWay)
			admin.GET("/contact_ways", handlers.ListContactWays)
			admin.GET("/wecom/members", handlers.ListWecomMembers)
			admin.GET("/wecom/groups", handlers.ListWecomGroups)
			admin.GET("/wecom/groups/:chat_id/messages", handlers.GetWecomGroupMessages)
			admin.GET("/wecom/diagnostic", handlers.WecomDiagnostic)
			admin.POST("/wecom/sync", func(c *gin.Context) {
				go services.SyncWecomMembers()
				c.JSON(http.StatusOK, gin.H{"message": "同步已触发"})
			})
			admin.GET("/notifications", handlers.ListNotifications)
			admin.PUT("/notifications/all/read", handlers.MarkAllNotificationsRead)
			admin.PUT("/notifications/:id/read", handlers.MarkNotificationRead)
			admin.GET("/orders/export", handlers.ExportOrdersCSV)
			admin.GET("/profit/export", handlers.ExportProfitCSV)
			admin.GET("/export/excel", handlers.ExportExcel)
		}
	}

	// 7. httptest.NewServer 启动
	ts := httptest.NewServer(r)

	// 8. 返回 server 和 cleanup
	cleanup := func() {
		ts.Close()
		cancel()
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			sqlDB.Close()
		}
	}

	return ts, cleanup
}

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

// getCSRFToken 发 GET /api/v1/orders/list 拿 CSRF token
func getCSRFToken(t *testing.T, client *http.Client, baseURL string) string {
	t.Helper()
	resp, err := client.Get(baseURL + "/api/v1/orders/list")
	if err != nil {
		t.Fatalf("getCSRFToken: request failed: %v", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	token := resp.Header.Get("X-CSRF-Token")
	if token == "" {
		t.Fatal("getCSRFToken: X-CSRF-Token header is empty")
	}
	return token
}

// loginAndGetToken 登录并返回 JWT token
func loginAndGetToken(t *testing.T, client *http.Client, baseURL, username, password string) string {
	t.Helper()
	body := map[string]string{"username": username, "password": password}
	b, _ := json.Marshal(body)
	resp, err := client.Post(baseURL+"/api/v1/auth/login", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("loginAndGetToken: request failed: %v", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("loginAndGetToken: expected 200 for %s, got %d: %s", username, resp.StatusCode, string(raw))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("loginAndGetToken: failed to parse response: %s", string(raw))
	}
	token, ok := result["token"].(string)
	if !ok || token == "" {
		t.Fatalf("loginAndGetToken: missing token in response: %s", string(raw))
	}
	return token
}

// doRequest 带 JWT + CSRF 发请求的通用函数
func doRequest(t *testing.T, client *http.Client, method, url, token, csrfToken string, body interface{}) *http.Response {
	t.Helper()
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("doRequest: marshal body: %v", err)
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		t.Fatalf("doRequest: create request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if csrfToken != "" {
		req.Header.Set("X-CSRF-Token", csrfToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("doRequest: %s %s failed: %v", method, url, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// seedTestEmployee 创建测试员工（bcrypt.MinCost 加速测试）
func seedTestEmployee(t *testing.T, username, password, role, wecomUID, name string) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("seedTestEmployee: bcrypt hash: %v", err)
	}
	emp := models.Employee{
		Username:     username,
		PasswordHash: string(hash),
		Role:         role,
		WecomUserID:  wecomUID,
		Name:         name,
		IsActive:     true,
		Status:       "idle",
	}
	if err := models.DB.Create(&emp).Error; err != nil {
		t.Fatalf("seedTestEmployee: create %s: %v", username, err)
	}
}

// readJSON 读取 HTTP 响应体并解析为 map
func readJSON(t *testing.T, resp *http.Response) map[string]interface{} {
	t.Helper()
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("readJSON: read body: %v", err)
	}
	var result map[string]interface{}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("readJSON: parse JSON (status=%d): %s", resp.StatusCode, string(raw))
	}
	return result
}

// ══════════════════════════════════════════════════════════════
// Test 1: Login Flow
// ══════════════════════════════════════════════════════════════

func TestE2E_LoginFlow(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_e2e", "Admin@123", "admin", "admin_e2e", "E2E管理员")

	// -- 1. 登录成功，验证 token 非空 --
	token := loginAndGetToken(t, client, server.URL, "admin_e2e", "Admin@123")
	if token == "" {
		t.Fatal("expected non-empty JWT token after login")
	}

	// -- 2. 错误密码登录，验证返回 403 --
	body, _ := json.Marshal(map[string]string{
		"username": "admin_e2e",
		"password": "WrongPassword",
	})
	resp, err := client.Post(server.URL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("wrong password request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 for wrong password, got %d", resp.StatusCode)
	}

	// -- 3. 用 token 访问 validate_token，验证 200 --
	resp = doRequest(t, client, "GET", server.URL+"/api/v1/auth/validate_token", token, "", nil)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("expected 200 for validate_token, got %d", resp.StatusCode)
	}
	data := readJSON(t, resp)
	valid, _ := data["valid"].(bool)
	if !valid {
		t.Error("expected valid=true in validate_token response")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 2: Order Lifecycle
// ══════════════════════════════════════════════════════════════

func TestE2E_OrderLifecycle(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	// -- 1. 创建管理员 + 客服账号 (v2.0 不需要设计师单独登录操作) --
	seedTestEmployee(t, "admin_ol", "Admin@123", "admin", "admin_ol", "管理员老张")
	seedTestEmployee(t, "sales_ol", "Sales@123", "sales", "sales_ol", "客服小李")

	// -- 2. 客服登录，创建订单 (price=5800, topic="毕业设计PPT") --
	salesToken := loginAndGetToken(t, client, server.URL, "sales_ol", "Sales@123")

	csrf := getCSRFToken(t, client, server.URL)
	createBody := map[string]interface{}{
		"price": 5800,
		"topic": "毕业设计PPT",
	}
	resp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", salesToken, csrf, createBody)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("create order failed with %d: %s", resp.StatusCode, string(raw))
	}
	orderData := readJSON(t, resp)

	orderIDFloat, ok := orderData["id"].(float64)
	if !ok {
		t.Fatalf("create order response missing id: %v", orderData)
	}
	orderID := uint(orderIDFloat)

	// -- 3. 验证订单状态为 PENDING --
	status, _ := orderData["status"].(string)
	if status != models.StatusPending {
		t.Errorf("expected status %s after create, got %s", models.StatusPending, status)
	}

	// -- 4. 管理员登录，v2.0 流程: PENDING -> DESIGNING --
	adminToken := loginAndGetToken(t, client, server.URL, "admin_ol", "Admin@123")

	csrf = getCSRFToken(t, client, server.URL)
	statusBody := map[string]string{"status": models.StatusDesigning}
	resp = doRequest(t, client, "PUT",
		fmt.Sprintf("%s/api/v1/orders/%d/status", server.URL, orderID),
		adminToken, csrf, statusBody)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("DESIGNING transition failed with %d: %s", resp.StatusCode, string(raw))
	}
	resp.Body.Close()

	// -- 5. 管理员: DESIGNING -> COMPLETED --
	csrf = getCSRFToken(t, client, server.URL)
	statusBody = map[string]string{"status": models.StatusCompleted}
	resp = doRequest(t, client, "PUT",
		fmt.Sprintf("%s/api/v1/orders/%d/status", server.URL, orderID),
		adminToken, csrf, statusBody)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("COMPLETED transition failed with %d: %s", resp.StatusCode, string(raw))
	}
	resp.Body.Close()

	// -- 6. 查询订单详情，验证最终状态和金额 --
	resp = doRequest(t, client, "GET",
		fmt.Sprintf("%s/api/v1/orders/%d/detail", server.URL, orderID),
		adminToken, "", nil)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("get order detail failed with %d: %s", resp.StatusCode, string(raw))
	}
	detailData := readJSON(t, resp)

	// detail 响应可能在 "order" 字段内，也可能在顶层
	orderInfo := detailData
	if nested, ok := detailData["order"].(map[string]interface{}); ok {
		orderInfo = nested
	}

	finalStatus, _ := orderInfo["status"].(string)
	if finalStatus != models.StatusCompleted {
		t.Errorf("expected final status %s, got %s", models.StatusCompleted, finalStatus)
	}
	finalPrice, _ := orderInfo["price"].(float64)
	if int(finalPrice) != 5800 {
		t.Errorf("expected price 5800, got %d", int(finalPrice))
	}

	// -- 7. 查询订单时间线，验证有操作记录 --
	resp = doRequest(t, client, "GET",
		fmt.Sprintf("%s/api/v1/orders/%d/timeline", server.URL, orderID),
		adminToken, "", nil)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("get timeline failed with %d: %s", resp.StatusCode, string(raw))
	}
	timelineRaw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	// 时间线可能是数组或包裹在 data 字段中
	var timelineItems []interface{}
	if err := json.Unmarshal(timelineRaw, &timelineItems); err != nil {
		var wrapped map[string]interface{}
		if err2 := json.Unmarshal(timelineRaw, &wrapped); err2 != nil {
			t.Fatalf("failed to parse timeline response: %s", string(timelineRaw))
		}
		if arr, ok := wrapped["data"].([]interface{}); ok {
			timelineItems = arr
		}
	}
	if len(timelineItems) == 0 {
		t.Error("expected at least one timeline entry, got none")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 3: Admin Dashboard
// ══════════════════════════════════════════════════════════════

func TestE2E_AdminDashboard(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_dash", "Admin@123", "admin", "admin_dash", "管理员")
	seedTestEmployee(t, "sales_dash", "Sales@123", "sales", "sales_dash", "客服")

	// -- 1. 管理员登录 --
	adminToken := loginAndGetToken(t, client, server.URL, "admin_dash", "Admin@123")

	// -- 2. GET /admin/dashboard，验证 200 + 返回数据结构 --
	resp := doRequest(t, client, "GET", server.URL+"/api/v1/admin/dashboard", adminToken, "", nil)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("admin dashboard expected 200, got %d: %s", resp.StatusCode, string(raw))
	}
	dashData := readJSON(t, resp)
	if dashData == nil {
		t.Error("dashboard returned nil data")
	}

	// -- 3. GET /admin/employees，验证能看到员工列表 --
	resp = doRequest(t, client, "GET", server.URL+"/api/v1/admin/employees", adminToken, "", nil)
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("admin employees expected 200, got %d: %s", resp.StatusCode, string(raw))
	}
	empData := readJSON(t, resp)
	if empData == nil {
		t.Error("employees returned nil data")
	}

	// -- 4. 非管理员（客服）访问 admin 接口，验证返回 403 --
	salesToken := loginAndGetToken(t, client, server.URL, "sales_dash", "Sales@123")

	resp = doRequest(t, client, "GET", server.URL+"/api/v1/admin/dashboard", salesToken, "", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("sales accessing admin dashboard: expected 403, got %d", resp.StatusCode)
	}

	resp = doRequest(t, client, "GET", server.URL+"/api/v1/admin/employees", salesToken, "", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("sales accessing admin employees: expected 403, got %d", resp.StatusCode)
	}
}

// ══════════════════════════════════════════════════════════════
// Test 4: Unauthorized Access
// ══════════════════════════════════════════════════════════════

func TestE2E_UnauthorizedAccess(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	// -- 1. 不带 token 访问 orders/list，验证 401 --
	resp := doRequest(t, client, "GET", server.URL+"/api/v1/orders/list", "", "", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: expected 401, got %d", resp.StatusCode)
	}

	// -- 2. 带无效 token 访问 orders/list，验证 401 --
	resp = doRequest(t, client, "GET", server.URL+"/api/v1/orders/list",
		"invalid.jwt.token.here", "", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("invalid token: expected 401, got %d", resp.StatusCode)
	}

	// -- 3. health 端点无需认证，验证 200 --
	resp, err := client.Get(server.URL + "/health")
	if err != nil {
		t.Fatalf("health request failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("health endpoint: expected 200, got %d", resp.StatusCode)
	}
}
