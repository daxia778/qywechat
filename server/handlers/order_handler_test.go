package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// setupTestDB creates a fresh in-memory SQLite database for each test.
func setupTestDB(t *testing.T) {
	t.Helper()
	config.C = &config.Config{
		DBType:               "sqlite",
		DBPath:               ":memory:",
		JWTSecretKey:         "test-secret",
		JWTExpireMinutes:     60,
		AdminDefaultUsername: "admin",
		AdminDefaultPassword: "Test123!",
	}

	var err error
	models.DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to open test DB: %v", err)
	}

	if err := models.DB.AutoMigrate(
		&models.Order{},
		&models.Employee{},
		&models.OrderTimeline{},
		&models.Notification{},
	); err != nil {
		t.Fatalf("AutoMigrate failed: %v", err)
	}

	// Initialize Wecom with empty config so async goroutines don't nil-panic.
	services.InitWecom()
}

func seedOrder(t *testing.T, order *models.Order) {
	t.Helper()
	if err := models.DB.Create(order).Error; err != nil {
		t.Fatalf("Failed to seed order: %v", err)
	}
}

func seedEmployee(t *testing.T, emp *models.Employee) {
	t.Helper()
	if err := models.DB.Create(emp).Error; err != nil {
		t.Fatalf("Failed to seed employee: %v", err)
	}
}

// ---------------------------------------------------------------
// GrabOrder: Identity validation (JWT caller vs designer_userid)
// ---------------------------------------------------------------

func TestGrabOrder_ValidGrab(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	seedOrder(t, &models.Order{
		OrderSN:    "GRAB-OK-001",
		OperatorID: "op1",
		Status:     models.StatusPending,
		Price:      1000,
	})
	seedEmployee(t, &models.Employee{
		WecomUserID: "designer1",
		Name:        "Designer One",
		Role:        "designer",
		IsActive:    true,
		Status:      "idle",
	})

	body, _ := json.Marshal(GrabOrderReq{OrderID: 1, DesignerUserID: "designer1"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "designer1") // JWT caller matches body

	GrabOrder(c)

	if w.Code != http.StatusOK {
		t.Errorf("Valid grab: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	// Let async goroutine (group creation) settle.
	time.Sleep(100 * time.Millisecond)
}

func TestGrabOrder_MismatchedCaller(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(GrabOrderReq{OrderID: 1, DesignerUserID: "designer1"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "attacker") // JWT says "attacker", body says "designer1"

	GrabOrder(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Mismatched caller: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGrabOrder_MissingJWTClaims(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(GrabOrderReq{OrderID: 1, DesignerUserID: "designer1"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	// wecom_userid intentionally NOT set

	GrabOrder(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("Missing JWT claims: expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------
// UpdateOrderStatus: Role + ownership permission logic
// ---------------------------------------------------------------

func TestUpdateOrderStatus_AdminCanUpdateAnyOrder(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	// Order belongs to op1, no designer -- admin should still be able to close it.
	seedOrder(t, &models.Order{
		OrderSN:    "ADM-001",
		OperatorID: "op1",
		Status:     models.StatusPending,
		Price:      5000,
	})

	body, _ := json.Marshal(map[string]string{"status": models.StatusClosed})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/orders/1/status", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "admin_user")
	c.Set("role", "admin")
	c.Set("name", "Admin")

	UpdateOrderStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("Admin update any order: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	time.Sleep(100 * time.Millisecond)
}

func TestUpdateOrderStatus_OperatorOwnOrder(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	seedOrder(t, &models.Order{
		OrderSN:    "OP-OWN-001",
		OperatorID: "op1",
		Status:     models.StatusPending,
		Price:      5000,
	})

	body, _ := json.Marshal(map[string]string{"status": models.StatusRefunded})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/orders/1/status", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "op1") // matches OperatorID
	c.Set("role", "operator")
	c.Set("name", "Operator 1")

	UpdateOrderStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("Operator own order: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	time.Sleep(100 * time.Millisecond)
}

func TestUpdateOrderStatus_OperatorOtherOrder(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	seedOrder(t, &models.Order{
		OrderSN:    "OP-OTHER-001",
		OperatorID: "op1",
		Status:     models.StatusPending,
		Price:      5000,
	})

	body, _ := json.Marshal(map[string]string{"status": models.StatusRefunded})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/orders/1/status", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "op2") // does NOT match OperatorID "op1"
	c.Set("role", "operator")
	c.Set("name", "Operator 2")

	UpdateOrderStatus(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Operator other order: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateOrderStatus_DesignerOwnOrder(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	seedOrder(t, &models.Order{
		OrderSN:    "DS-OWN-001",
		OperatorID: "op1",
		DesignerID: "designer1",
		Status:     models.StatusDesigning,
		Price:      5000,
	})

	body, _ := json.Marshal(map[string]string{"status": models.StatusDelivered})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/orders/1/status", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "designer1") // matches DesignerID
	c.Set("role", "designer")
	c.Set("name", "Designer 1")

	UpdateOrderStatus(c)

	if w.Code != http.StatusOK {
		t.Errorf("Designer own order: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	time.Sleep(100 * time.Millisecond)
}

func TestUpdateOrderStatus_DesignerOtherOrder(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	seedOrder(t, &models.Order{
		OrderSN:    "DS-OTHER-001",
		OperatorID: "op1",
		DesignerID: "designer1",
		Status:     models.StatusDesigning,
		Price:      5000,
	})

	body, _ := json.Marshal(map[string]string{"status": models.StatusDelivered})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/orders/1/status", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "designer2") // does NOT match DesignerID "designer1"
	c.Set("role", "designer")
	c.Set("name", "Designer 2")

	UpdateOrderStatus(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Designer other order: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateOrderStatus_WrongRole(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	seedOrder(t, &models.Order{
		OrderSN:    "ROLE-001",
		OperatorID: "op1",
		DesignerID: "designer1",
		Status:     models.StatusPending,
		Price:      5000,
	})

	// Designer tries to CLOSE (only admin is allowed for StatusClosed).
	body, _ := json.Marshal(map[string]string{"status": models.StatusClosed})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Request, _ = http.NewRequest(http.MethodPut, "/orders/1/status", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "designer1")
	c.Set("role", "designer")
	c.Set("name", "Designer 1")

	UpdateOrderStatus(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Wrong role: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------
// CreateOrder: Price validation
// ---------------------------------------------------------------

func TestCreateOrder_PriceZero(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(CreateOrderReq{Price: 0, Topic: "Test"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	CreateOrder(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Price=0: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateOrder_PriceNegative(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(CreateOrderReq{Price: -100, Topic: "Test"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	CreateOrder(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Price=-100: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateOrder_PriceTooHigh(t *testing.T) {
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(CreateOrderReq{Price: 1000000, Topic: "Test"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	CreateOrder(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Price=1000000: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateOrder_ValidPrice(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(CreateOrderReq{
		OrderSN: "VALID-PRICE-001",
		Price:   5000,
		Topic:   "Test PPT",
		Pages:   10,
	})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "op1")

	CreateOrder(c)

	if w.Code != http.StatusOK {
		t.Errorf("Valid price: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify the order was persisted in the database.
	var order models.Order
	err := models.DB.Where("order_sn = ?", "VALID-PRICE-001").First(&order).Error
	if err != nil {
		t.Errorf("Order not persisted: %v", err)
	}
	if order.Price != 5000 {
		t.Errorf("Persisted price: expected 5000, got %d", order.Price)
	}
	time.Sleep(100 * time.Millisecond)
}

func TestCreateOrder_BoundaryPrice999999(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(CreateOrderReq{
		OrderSN: "BOUNDARY-001",
		Price:   999999,
		Topic:   "Boundary Test",
	})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("wecom_userid", "op1")

	CreateOrder(c)

	if w.Code != http.StatusOK {
		t.Errorf("Boundary price 999999: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	time.Sleep(100 * time.Millisecond)
}
