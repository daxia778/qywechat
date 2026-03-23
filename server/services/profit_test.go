package services

import (
	"testing"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
	"pdd-order-system/testutil"
)

// setupProfitTest wraps testutil.SetupTestDB and initialises the Wecom client
// to prevent nil-pointer panics from async goroutines.
func setupProfitTest(t *testing.T) {
	t.Helper()
	testutil.SetupTestDB(t)
	InitWecom()
}

// ---------------------------------------------------------------------------
// CalculateProfit
// ---------------------------------------------------------------------------

func TestCalculateProfit_Normal(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	// Seed a normal order: Price=10000 (100 yuan), ExtraPrice=2000 (20 yuan).
	models.DB.Create(&models.Order{
		OrderSN:    "PROFIT-001",
		OperatorID: "sales01",
		DesignerID: "designer01",
		Status:     models.StatusCompleted,
		Price:      10000,
		ExtraPrice: 2000,
	})

	// Default rates from testutil: platform=30%, designer=25%, sales=10%, follow=5%.
	result, err := CalculateProfit(db, 1)
	if err != nil {
		t.Fatalf("CalculateProfit returned error: %v", err)
	}
	if result == nil {
		t.Fatal("CalculateProfit returned nil result")
	}

	// TotalAmount = 10000 + 2000 = 12000
	if result.TotalAmount != 12000 {
		t.Errorf("TotalAmount: expected 12000, got %d", result.TotalAmount)
	}

	// PlatformFee = round(12000 * 30 / 100) = 3600
	if result.PlatformFee != 3600 {
		t.Errorf("PlatformFee: expected 3600, got %d", result.PlatformFee)
	}

	// DesignerCommission = round(12000 * 25 / 100) = 3000
	if result.DesignerCommission != 3000 {
		t.Errorf("DesignerCommission: expected 3000, got %d", result.DesignerCommission)
	}

	// SalesCommission = round(12000 * 10 / 100) = 1200
	if result.SalesCommission != 1200 {
		t.Errorf("SalesCommission: expected 1200, got %d", result.SalesCommission)
	}

	// FollowCommission = round(12000 * 5 / 100) = 600
	if result.FollowCommission != 600 {
		t.Errorf("FollowCommission: expected 600, got %d", result.FollowCommission)
	}

	// NetProfit = 12000 - 3600 - 3000 - 1200 - 600 = 3600
	if result.NetProfit != 3600 {
		t.Errorf("NetProfit: expected 3600, got %d", result.NetProfit)
	}
}

func TestCalculateProfit_NoDesigner(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	// Order without a designer (DesignerID is empty).
	// The profit engine still calculates designer commission based on rate;
	// the business decides allocation separately.
	models.DB.Create(&models.Order{
		OrderSN:    "PROFIT-002",
		OperatorID: "sales01",
		Status:     models.StatusPending,
		Price:      5000,
	})

	result, err := CalculateProfit(db, 1)
	if err != nil {
		t.Fatalf("CalculateProfit returned error: %v", err)
	}

	// TotalAmount = 5000 (no ExtraPrice).
	if result.TotalAmount != 5000 {
		t.Errorf("TotalAmount: expected 5000, got %d", result.TotalAmount)
	}

	// PlatformFee = round(5000 * 30 / 100) = 1500
	if result.PlatformFee != 1500 {
		t.Errorf("PlatformFee: expected 1500, got %d", result.PlatformFee)
	}

	// DesignerCommission = round(5000 * 25 / 100) = 1250
	if result.DesignerCommission != 1250 {
		t.Errorf("DesignerCommission: expected 1250, got %d", result.DesignerCommission)
	}

	// NetProfit = 5000 - 1500 - 1250 - 500 - 250 = 1500
	if result.NetProfit != 1500 {
		t.Errorf("NetProfit: expected 1500, got %d", result.NetProfit)
	}
}

func TestCalculateProfit_ZeroPrice(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	// Zero-price order (e.g. free sample, charity).
	models.DB.Create(&models.Order{
		OrderSN:    "PROFIT-003",
		OperatorID: "sales01",
		Status:     models.StatusCompleted,
		Price:      0,
	})

	result, err := CalculateProfit(db, 1)
	if err != nil {
		t.Fatalf("CalculateProfit returned error: %v", err)
	}

	if result.TotalAmount != 0 {
		t.Errorf("TotalAmount: expected 0, got %d", result.TotalAmount)
	}
	if result.PlatformFee != 0 {
		t.Errorf("PlatformFee: expected 0, got %d", result.PlatformFee)
	}
	if result.DesignerCommission != 0 {
		t.Errorf("DesignerCommission: expected 0, got %d", result.DesignerCommission)
	}
	if result.SalesCommission != 0 {
		t.Errorf("SalesCommission: expected 0, got %d", result.SalesCommission)
	}
	if result.NetProfit != 0 {
		t.Errorf("NetProfit: expected 0, got %d", result.NetProfit)
	}
}

func TestCalculateProfit_RefundedOrder(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	// Refunded orders should return all-zero profit.
	now := time.Now()
	models.DB.Create(&models.Order{
		OrderSN:    "PROFIT-004",
		OperatorID: "sales01",
		Status:     models.StatusRefunded,
		Price:      8000,
		ClosedAt:   &now,
	})

	result, err := CalculateProfit(db, 1)
	if err != nil {
		t.Fatalf("CalculateProfit returned error: %v", err)
	}
	if result.TotalAmount != 0 {
		t.Errorf("Refunded order TotalAmount: expected 0, got %d", result.TotalAmount)
	}
	if result.NetProfit != 0 {
		t.Errorf("Refunded order NetProfit: expected 0, got %d", result.NetProfit)
	}
}

func TestCalculateProfit_OrderNotFound(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	_, err := CalculateProfit(db, 9999)
	if err == nil {
		t.Fatal("Expected error for non-existent order, got nil")
	}
}

func TestCalculateProfit_CustomRates(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	// Override default rates to test custom calculation.
	config.C.PlatformFeeRate = 10
	config.C.DesignerCommissionRate = 30
	config.C.SalesCommissionRate = 15
	config.C.FollowCommissionRate = 10

	models.DB.Create(&models.Order{
		OrderSN:    "PROFIT-005",
		OperatorID: "sales01",
		Status:     models.StatusCompleted,
		Price:      10000,
	})

	result, err := CalculateProfit(db, 1)
	if err != nil {
		t.Fatalf("CalculateProfit returned error: %v", err)
	}

	// PlatformFee = 10000 * 10% = 1000
	if result.PlatformFee != 1000 {
		t.Errorf("PlatformFee: expected 1000, got %d", result.PlatformFee)
	}
	// DesignerCommission = 10000 * 30% = 3000
	if result.DesignerCommission != 3000 {
		t.Errorf("DesignerCommission: expected 3000, got %d", result.DesignerCommission)
	}
	// SalesCommission = 10000 * 15% = 1500
	if result.SalesCommission != 1500 {
		t.Errorf("SalesCommission: expected 1500, got %d", result.SalesCommission)
	}
	// FollowCommission = 10000 * 10% = 1000
	if result.FollowCommission != 1000 {
		t.Errorf("FollowCommission: expected 1000, got %d", result.FollowCommission)
	}
	// NetProfit = 10000 - 1000 - 3000 - 1500 - 1000 = 3500
	if result.NetProfit != 3500 {
		t.Errorf("NetProfit: expected 3500, got %d", result.NetProfit)
	}
}

// ---------------------------------------------------------------------------
// RecalculateAndSave
// ---------------------------------------------------------------------------

func TestRecalculateAndSave(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	models.DB.Create(&models.Order{
		OrderSN:    "RECALC-001",
		OperatorID: "sales01",
		Status:     models.StatusCompleted,
		Price:      10000,
	})

	if err := RecalculateAndSave(db, 1); err != nil {
		t.Fatalf("RecalculateAndSave returned error: %v", err)
	}

	// Verify fields were persisted.
	var order models.Order
	models.DB.First(&order, 1)

	if order.PlatformFee == 0 && order.Price > 0 {
		t.Error("PlatformFee should be non-zero after recalculation")
	}
	if order.DesignerCommission == 0 && order.Price > 0 {
		t.Error("DesignerCommission should be non-zero after recalculation")
	}
	if order.NetProfit == 0 && order.Price > 0 {
		t.Error("NetProfit should be non-zero after recalculation")
	}
}

// ---------------------------------------------------------------------------
// ClearProfitFields
// ---------------------------------------------------------------------------

func TestClearProfitFields(t *testing.T) {
	setupProfitTest(t)
	db := models.DB

	models.DB.Create(&models.Order{
		OrderSN:            "CLEAR-001",
		OperatorID:         "sales01",
		Status:             models.StatusRefunded,
		Price:              10000,
		PlatformFee:        500,
		DesignerCommission: 4000,
		SalesCommission:    1000,
		FollowCommission:   500,
		NetProfit:          4000,
	})

	if err := ClearProfitFields(db, 1); err != nil {
		t.Fatalf("ClearProfitFields returned error: %v", err)
	}

	var order models.Order
	models.DB.First(&order, 1)

	if order.PlatformFee != 0 {
		t.Errorf("PlatformFee: expected 0 after clear, got %d", order.PlatformFee)
	}
	if order.DesignerCommission != 0 {
		t.Errorf("DesignerCommission: expected 0 after clear, got %d", order.DesignerCommission)
	}
	if order.SalesCommission != 0 {
		t.Errorf("SalesCommission: expected 0 after clear, got %d", order.SalesCommission)
	}
	if order.FollowCommission != 0 {
		t.Errorf("FollowCommission: expected 0 after clear, got %d", order.FollowCommission)
	}
	if order.NetProfit != 0 {
		t.Errorf("NetProfit: expected 0 after clear, got %d", order.NetProfit)
	}
}
