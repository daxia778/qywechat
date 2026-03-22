package services

import (
	"strings"
	"testing"
	"time"

	"pdd-order-system/models"
	"pdd-order-system/testutil"
)

// setupOrderTest wraps testutil.SetupTestDB and initialises the Wecom client
// (same package, no import needed) to prevent nil-pointer panics in async
// goroutines spawned by CreateOrder / UpdateOrderStatus.
func setupOrderTest(t *testing.T) {
	t.Helper()
	testutil.SetupTestDB(t)
	InitWecom()
}

// ---------------------------------------------------------------------------
// CreateOrder
// ---------------------------------------------------------------------------

func TestCreateOrder_Success(t *testing.T) {
	setupOrderTest(t)

	deadline := time.Now().Add(48 * time.Hour)
	order, err := CreateOrder(
		"sales01",       // operatorID
		"TEST-SN-001",   // orderSN
		"13800138000",   // customerContact
		"Annual Report", // topic
		"urgent",        // remark
		"",              // screenshotPath
		"",              // attachmentURLs
		5000,            // price (cents)
		20,              // pages
		&deadline,       // deadline
	)
	if err != nil {
		t.Fatalf("CreateOrder returned error: %v", err)
	}
	if order == nil {
		t.Fatal("CreateOrder returned nil order")
	}
	if order.ID == 0 {
		t.Error("Expected order.ID to be assigned, got 0")
	}
	if order.OrderSN != "TEST-SN-001" {
		t.Errorf("OrderSN: expected TEST-SN-001, got %s", order.OrderSN)
	}
	if order.Status != models.StatusPending {
		t.Errorf("Status: expected %s, got %s", models.StatusPending, order.Status)
	}
	if order.Price != 5000 {
		t.Errorf("Price: expected 5000, got %d", order.Price)
	}
	if order.OperatorID != "sales01" {
		t.Errorf("OperatorID: expected sales01, got %s", order.OperatorID)
	}

	// Verify the order was persisted.
	var persisted models.Order
	if err := models.DB.First(&persisted, order.ID).Error; err != nil {
		t.Fatalf("Order not found in DB: %v", err)
	}
	if persisted.Topic != "Annual Report" {
		t.Errorf("Persisted topic: expected 'Annual Report', got %q", persisted.Topic)
	}

	// Allow async goroutines (profit recalc, customer stats) to settle.
	time.Sleep(200 * time.Millisecond)
}

func TestCreateOrder_AutoGenerateSN(t *testing.T) {
	setupOrderTest(t)

	order, err := CreateOrder("sales01", "", "", "Auto SN Test", "", "", "", 1000, 5, nil)
	if err != nil {
		t.Fatalf("CreateOrder returned error: %v", err)
	}
	if order.OrderSN == "" {
		t.Error("Expected auto-generated OrderSN, got empty string")
	}
	if !strings.HasPrefix(order.OrderSN, "SYS-") {
		t.Errorf("Auto-generated SN should start with 'SYS-', got %s", order.OrderSN)
	}
	time.Sleep(200 * time.Millisecond)
}

func TestCreateOrder_DuplicateSN(t *testing.T) {
	setupOrderTest(t)

	_, err := CreateOrder("sales01", "DUP-SN-001", "", "First", "", "", "", 1000, 5, nil)
	if err != nil {
		t.Fatalf("First CreateOrder failed: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	// Second order with the same SN should fail.
	order2, err2 := CreateOrder("sales01", "DUP-SN-001", "", "Duplicate", "", "", "", 2000, 10, nil)
	if err2 == nil {
		t.Fatal("Expected error for duplicate SN, got nil")
	}
	if order2 != nil {
		t.Error("Expected nil order for duplicate SN")
	}
	if !strings.Contains(err2.Error(), "已被录入") {
		t.Errorf("Error message should mention duplicate, got: %v", err2)
	}
}

// ---------------------------------------------------------------------------
// UpdateOrderStatus
// ---------------------------------------------------------------------------

func TestUpdateOrderStatus_ValidTransition(t *testing.T) {
	setupOrderTest(t)

	// Seed: PENDING order with a designer.
	models.DB.Create(&models.Order{
		OrderSN:    "STATUS-001",
		OperatorID: "sales01",
		DesignerID: "designer01",
		Status:     models.StatusPending,
		Price:      3000,
	})

	// PENDING -> GROUP_CREATED (valid).
	updated, err := UpdateOrderStatus(1, models.StatusGroupCreated)
	if err != nil {
		t.Fatalf("UpdateOrderStatus returned error: %v", err)
	}
	if updated.Status != models.StatusGroupCreated {
		t.Errorf("Status: expected %s, got %s", models.StatusGroupCreated, updated.Status)
	}
	time.Sleep(100 * time.Millisecond)
}

func TestUpdateOrderStatus_InvalidTransition(t *testing.T) {
	setupOrderTest(t)

	models.DB.Create(&models.Order{
		OrderSN:    "STATUS-002",
		OperatorID: "sales01",
		Status:     models.StatusPending,
		Price:      3000,
	})

	// PENDING -> DESIGNING is not a valid direct transition.
	_, err := UpdateOrderStatus(1, models.StatusDesigning)
	if err == nil {
		t.Fatal("Expected error for invalid transition, got nil")
	}
	if !strings.Contains(err.Error(), "非法状态转换") {
		t.Errorf("Error should mention illegal transition, got: %v", err)
	}
}

func TestUpdateOrderStatus_OrderNotFound(t *testing.T) {
	setupOrderTest(t)

	_, err := UpdateOrderStatus(9999, models.StatusGroupCreated)
	if err == nil {
		t.Fatal("Expected error for non-existent order, got nil")
	}
	if !strings.Contains(err.Error(), "订单不存在") {
		t.Errorf("Error should mention order not found, got: %v", err)
	}
}

func TestUpdateOrderStatus_CompletedSetsTimestamp(t *testing.T) {
	setupOrderTest(t)

	// Seed an order in DELIVERED state.
	models.DB.Create(&models.Order{
		OrderSN:    "STATUS-003",
		OperatorID: "sales01",
		DesignerID: "designer01",
		Status:     models.StatusDelivered,
		Price:      3000,
	})

	updated, err := UpdateOrderStatus(1, models.StatusCompleted)
	if err != nil {
		t.Fatalf("UpdateOrderStatus returned error: %v", err)
	}
	if updated.CompletedAt == nil {
		t.Error("CompletedAt should be set when transitioning to COMPLETED")
	}
	time.Sleep(200 * time.Millisecond)
}

func TestUpdateOrderStatus_TerminalReleasesDesigner(t *testing.T) {
	setupOrderTest(t)

	// Seed designer with active orders.
	models.DB.Create(&models.Employee{
		WecomUserID:      "designer01",
		Name:             "Designer One",
		Role:             "designer",
		IsActive:         true,
		Status:           "busy",
		ActiveOrderCount: 1,
	})

	// Seed a PENDING order (so we can transition to CLOSED, a terminal state).
	models.DB.Create(&models.Order{
		OrderSN:    "STATUS-TERM-001",
		OperatorID: "sales01",
		DesignerID: "designer01",
		Status:     models.StatusPending,
		Price:      3000,
	})

	_, err := UpdateOrderStatus(1, models.StatusClosed)
	if err != nil {
		t.Fatalf("UpdateOrderStatus returned error: %v", err)
	}

	// Verify the designer's active_order_count was decremented.
	var designer models.Employee
	models.DB.Where("wecom_userid = ?", "designer01").First(&designer)
	if designer.ActiveOrderCount != 0 {
		t.Errorf("ActiveOrderCount: expected 0 after terminal status, got %d", designer.ActiveOrderCount)
	}
	time.Sleep(100 * time.Millisecond)
}

// ---------------------------------------------------------------------------
// GrabOrder
// ---------------------------------------------------------------------------

func TestGrabOrder_Success(t *testing.T) {
	setupOrderTest(t)

	// Seed a PENDING order.
	models.DB.Create(&models.Order{
		OrderSN:    "GRAB-001",
		OperatorID: "sales01",
		Status:     models.StatusPending,
		Price:      5000,
	})

	// Seed the designer.
	models.DB.Create(&models.Employee{
		WecomUserID:      "designer01",
		Name:             "Designer One",
		Role:             "designer",
		IsActive:         true,
		Status:           "idle",
		ActiveOrderCount: 0,
	})

	order, err := GrabOrder(1, "designer01")
	if err != nil {
		t.Fatalf("GrabOrder returned error: %v", err)
	}
	if order == nil {
		t.Fatal("GrabOrder returned nil order")
	}
	if order.DesignerID != "designer01" {
		t.Errorf("DesignerID: expected designer01, got %s", order.DesignerID)
	}
	if order.Status != models.StatusGroupCreated {
		t.Errorf("Status: expected %s, got %s", models.StatusGroupCreated, order.Status)
	}
	if order.AssignedAt == nil {
		t.Error("AssignedAt should be set after grab")
	}

	// Verify the designer's status was updated.
	var designer models.Employee
	models.DB.Where("wecom_userid = ?", "designer01").First(&designer)
	if designer.Status != "busy" {
		t.Errorf("Designer status: expected 'busy', got %q", designer.Status)
	}
	if designer.ActiveOrderCount != 1 {
		t.Errorf("ActiveOrderCount: expected 1, got %d", designer.ActiveOrderCount)
	}
}

func TestGrabOrder_AlreadyGrabbed(t *testing.T) {
	setupOrderTest(t)

	// Seed an order that is already GROUP_CREATED (i.e. already grabbed).
	now := time.Now()
	models.DB.Create(&models.Order{
		OrderSN:    "GRAB-002",
		OperatorID: "sales01",
		DesignerID: "designer01",
		Status:     models.StatusGroupCreated,
		Price:      5000,
		AssignedAt: &now,
	})

	// Another designer tries to grab it.
	models.DB.Create(&models.Employee{
		WecomUserID:      "designer02",
		Name:             "Designer Two",
		Role:             "designer",
		IsActive:         true,
		Status:           "idle",
		ActiveOrderCount: 0,
	})

	_, err := GrabOrder(1, "designer02")
	if err == nil {
		t.Fatal("Expected error when grabbing already-grabbed order, got nil")
	}
	if !strings.Contains(err.Error(), "已被抢走") {
		t.Errorf("Error should mention order already grabbed, got: %v", err)
	}
}

func TestGrabOrder_NonExistentOrder(t *testing.T) {
	setupOrderTest(t)

	_, err := GrabOrder(9999, "designer01")
	if err == nil {
		t.Fatal("Expected error for non-existent order, got nil")
	}
	if !strings.Contains(err.Error(), "不存在") && !strings.Contains(err.Error(), "已被抢走") {
		t.Errorf("Error should indicate problem, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// GenerateOrderSN
// ---------------------------------------------------------------------------

func TestGenerateOrderSN_Format(t *testing.T) {
	sn := GenerateOrderSN()
	if !strings.HasPrefix(sn, "SYS-") {
		t.Errorf("Generated SN should start with 'SYS-', got %s", sn)
	}
	// Format: SYS-20060102150405-abcdef (total length around 25-27 chars).
	if len(sn) < 20 {
		t.Errorf("Generated SN is too short: %s", sn)
	}
}

func TestGenerateOrderSN_Unique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		sn := GenerateOrderSN()
		if seen[sn] {
			t.Fatalf("Duplicate SN generated: %s", sn)
		}
		seen[sn] = true
	}
}
