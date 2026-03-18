package handlers

import (
	"testing"
	"pdd-order-system/models"
)

// We abstract out the calculation logic to make it testable without DB
func calculateProfitItem(o *models.Order, platformRate, designerRate, operatorRate int) map[string]int {
	pf := o.Price * platformRate / 100
	dc := o.Price * designerRate / 100
	oc := o.Price * operatorRate / 100
	np := o.Price - pf - dc - oc
	return map[string]int{
		"platform_fee": pf,
		"designer":     dc,
		"operator":     oc,
		"net":          np,
		"price":        o.Price,
	}
}

func TestProfitCalculation(t *testing.T) {
	// mock normal 100 unit price
	order := &models.Order{Price: 10000} // $100

	platformRate := 5
	designerRate := 50
	operatorRate := 10

	res := calculateProfitItem(order, platformRate, designerRate, operatorRate)

	if res["platform_fee"] != 500 { // $5
		t.Errorf("Expected platform fee 500, got %d", res["platform_fee"])
	}
	if res["designer"] != 5000 { // $50
		t.Errorf("Expected designer fee 5000, got %d", res["designer"])
	}
	if res["operator"] != 1000 { // $10
		t.Errorf("Expected operator fee 1000, got %d", res["operator"])
	}
	if res["net"] != 3500 { // $35
		t.Errorf("Expected net profit 3500, got %d", res["net"])
	}
}

func TestProfitCalculationOddNumber(t *testing.T) {
	// odd number test
	order := &models.Order{Price: 9990} // $99.90

	platformRate := 5
	designerRate := 50
	operatorRate := 10

	// pf = 9990 * 5 / 100 = 499 (integer division)
	// dc = 9990 * 50 / 100 = 4995
	// oc = 9990 * 10 / 100 = 999
	// np = 9990 - 499 - 4995 - 999 = 3497

	res := calculateProfitItem(order, platformRate, designerRate, operatorRate)

	if res["platform_fee"] != 499 {
		t.Errorf("Expected platform fee 499, got %d", res["platform_fee"])
	}
	if res["designer"] != 4995 {
		t.Errorf("Expected designer fee 4995, got %d", res["designer"])
	}
	if res["operator"] != 999 {
		t.Errorf("Expected operator fee 999, got %d", res["operator"])
	}
	if res["net"] != 3497 {
		t.Errorf("Expected net profit 3497, got %d", res["net"])
	}
}
