package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"pdd-order-system/models"
)

// ══════════════════════════════════════════════════════════════
// Test 5: Payment CRUD
// ══════════════════════════════════════════════════════════════

func TestE2E_PaymentCRUD(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_pay", "Admin@123", "admin", "admin_pay", "AdminPay")
	token := loginAndGetToken(t, client, server.URL, "admin_pay", "Admin@123")
	csrf := getCSRFToken(t, client, server.URL)

	// Admin creates order
	orderResp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", token, csrf, map[string]interface{}{
		"price": 1000,
		"topic": "Payment Test PPT",
	})
	defer orderResp.Body.Close()
	orderData := readJSON(t, orderResp)
	orderID := uint(orderData["id"].(float64))

	// Create a payment
	paymentReq := map[string]interface{}{
		"order_id": orderID,
		"amount":   500,
		"source":   "pdd",
		"remark":   "half payment",
	}
	csrf = getCSRFToken(t, client, server.URL)
	payResp := doRequest(t, client, "POST", server.URL+"/api/v1/payments", token, csrf, paymentReq)
	if payResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(payResp.Body)
		t.Fatalf("create payment failed: %v: %s", payResp.StatusCode, raw)
	}
	payResp.Body.Close()

	// List payments
	listResp := doRequest(t, client, "GET", server.URL+"/api/v1/payments", token, "", nil)
	defer listResp.Body.Close()
	listData := readJSON(t, listResp)
	total := listData["total"].(float64)
	if total < 1 {
		t.Errorf("expected at least 1 payment, got %v", total)
	}

	// Summary
	summResp := doRequest(t, client, "GET", server.URL+"/api/v1/payments/summary", token, "", nil)
	defer summResp.Body.Close()
	summData := readJSON(t, summResp)
	if summData["total_amount"] == nil {
		t.Errorf("expected total_amount in summary")
	}

	// Test non-admin access to summary
	seedTestEmployee(t, "sales_pay", "Sales@123", "sales", "sales_pay", "SalesPay")
	salesToken := loginAndGetToken(t, client, server.URL, "sales_pay", "Sales@123")
	summRespSales := doRequest(t, client, "GET", server.URL+"/api/v1/payments/summary", salesToken, "", nil)
	defer summRespSales.Body.Close()
	if summRespSales.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 for sales accessing summary, got %d", summRespSales.StatusCode)
	}
}

// ══════════════════════════════════════════════════════════════
// Test 6: Employee Management
// ══════════════════════════════════════════════════════════════

func TestE2E_EmployeeManagement(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_emp", "Admin@123", "admin", "admin_emp", "AdminEmp")
	token := loginAndGetToken(t, client, server.URL, "admin_emp", "Admin@123")
	csrf := getCSRFToken(t, client, server.URL)

	// Create designer
	createReq := map[string]string{
		"name": "New Designer",
		"role": "designer",
	}
	createResp := doRequest(t, client, "POST", server.URL+"/api/v1/admin/employees", token, csrf, createReq)
	if createResp.StatusCode != http.StatusOK {
		t.Fatalf("create employee failed")
	}
	createData := readJSON(t, createResp)
	newUsername := createData["username"].(string)
	newPassword := createData["password"].(string)
	empData := createData["employee"].(map[string]interface{})
	empID := uint(empData["id"].(float64))

	// Verify login with new creds
	designerToken := loginAndGetToken(t, client, server.URL, newUsername, newPassword)
	if designerToken == "" {
		t.Fatalf("failed to login with new credentials")
	}

	// Toggle employee disable
	csrf = getCSRFToken(t, client, server.URL)
	toggleResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/admin/employees/%d/toggle", server.URL, empID), token, csrf, nil)
	if toggleResp.StatusCode != http.StatusOK {
		t.Fatalf("toggle failed")
	}
	toggleResp.Body.Close()

	// Try login, should fail
	body, _ := json.Marshal(map[string]string{"username": newUsername, "password": newPassword})
	failResp, err := client.Post(server.URL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login request failed: %v", err)
	}
	defer failResp.Body.Close()
	if failResp.StatusCode != http.StatusForbidden {
		t.Errorf("expected login to fail for disabled employee")
	}

	// Toggle back active
	csrf = getCSRFToken(t, client, server.URL)
	doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/admin/employees/%d/toggle", server.URL, empID), token, csrf, nil).Body.Close()

	// Reset password
	csrf = getCSRFToken(t, client, server.URL)
	resetResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/admin/employees/%d/reset_password", server.URL, empID), token, csrf, nil)
	if resetResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resetResp.Body)
		t.Fatalf("reset password failed: %s", raw)
	}
	resetData := readJSON(t, resetResp)
	resetPassword := resetData["password"].(string)

	// Try login with reset password
	resetToken := loginAndGetToken(t, client, server.URL, newUsername, resetPassword)
	if resetToken == "" {
		t.Fatalf("failed to login with reset credentials")
	}

	// Delete employee
	csrf = getCSRFToken(t, client, server.URL)
	delResp := doRequest(t, client, "DELETE", fmt.Sprintf("%s/api/v1/admin/employees/%d", server.URL, empID), token, csrf, nil)
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("delete employee failed")
	}
	delResp.Body.Close()
}

// ══════════════════════════════════════════════════════════════
// Test 7: Token Lifecycle
// ══════════════════════════════════════════════════════════════

func TestE2E_TokenLifecycle(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "user_token", "Test@123", "sales", "user_token", "TokenUser")
	token := loginAndGetToken(t, client, server.URL, "user_token", "Test@123")
	csrf := getCSRFToken(t, client, server.URL)

	// Refresh Token
	refreshResp := doRequest(t, client, "POST", server.URL+"/api/v1/auth/refresh", token, csrf, nil)
	if refreshResp.StatusCode != http.StatusOK {
		t.Fatalf("refresh token failed")
	}
	refreshData := readJSON(t, refreshResp)
	newToken := refreshData["token"].(string)
	if newToken == "" {
		t.Fatalf("new token is empty")
	}

	// Validate new token
	valResp := doRequest(t, client, "GET", server.URL+"/api/v1/auth/validate_token", newToken, "", nil)
	if valResp.StatusCode != http.StatusOK {
		t.Fatalf("validation of new token failed")
	}
	valResp.Body.Close()

	// Logout new token
	csrf = getCSRFToken(t, client, server.URL)
	logoutResp := doRequest(t, client, "POST", server.URL+"/api/v1/auth/logout", newToken, csrf, nil)
	if logoutResp.StatusCode != http.StatusOK {
		t.Fatalf("logout failed")
	}
	logoutResp.Body.Close()

	time.Sleep(10 * time.Millisecond) // Ensure token is blocked properly in cache/DB

	// Try validate blacklisted token
	valFailResp := doRequest(t, client, "GET", server.URL+"/api/v1/auth/validate_token", newToken, "", nil)
	if valFailResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for logged out token, got %d", valFailResp.StatusCode)
	}
	valFailResp.Body.Close()
}

// ══════════════════════════════════════════════════════════════
// Test 8: Order Amount & Reassign
// ══════════════════════════════════════════════════════════════

func TestE2E_OrderAmountAndReassign(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_order", "Admin@123", "admin", "admin_order", "AdminOrder")
	seedTestEmployee(t, "designer_a", "Design@123", "designer", "designer_a", "DesignerA")
	seedTestEmployee(t, "designer_b", "Design@123", "designer", "designer_b", "DesignerB")

	adminToken := loginAndGetToken(t, client, server.URL, "admin_order", "Admin@123")
	csrf := getCSRFToken(t, client, server.URL)

	// Admin creates order
	orderResp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{
		"price": 3000,
		"topic": "Reassign PPT",
	})
	defer orderResp.Body.Close()
	orderData := readJSON(t, orderResp)
	orderID := uint(orderData["id"].(float64))

	// Designer A grabs order
	designerAToken := loginAndGetToken(t, client, server.URL, "designer_a", "Design@123")
	csrfA := getCSRFToken(t, client, server.URL)
	
	grabResp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/grab", designerAToken, csrfA, map[string]interface{}{
		"order_id": orderID,
		"designer_userid": "designer_a",
	})
	if grabResp.StatusCode != http.StatusOK {
		t.Fatalf("Designer A grab failed: %v", grabResp.StatusCode)
	}
	grabResp.Body.Close()

	// Admin updates amount
	updateBody := map[string]interface{}{
		"price": 4500,
		"pages": 20,
		"remark": "Added pages",
	}
	csrf = getCSRFToken(t, client, server.URL)
	amountResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/orders/%d/amount", server.URL, orderID), adminToken, csrf, updateBody)
	if amountResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(amountResp.Body)
		t.Fatalf("update amount failed: %s", raw)
	}
	amountData := readJSON(t, amountResp)
	orderNode := amountData["order"].(map[string]interface{})
	if int(orderNode["price"].(float64)) != 4500 {
		t.Errorf("expected price 4500")
	}

	// Admin reassigns
	csrf = getCSRFToken(t, client, server.URL)
	reassignResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/orders/%d/reassign", server.URL, orderID), adminToken, csrf, map[string]interface{}{
		"designer_userid": "designer_b",
	})
	if reassignResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(reassignResp.Body)
		t.Fatalf("reassign failed: %s", raw)
	}
	reassignData := readJSON(t, reassignResp)
	orderNodeR := reassignData["order"].(map[string]interface{})
	if orderNodeR["designer_id"].(string) != "designer_b" {
		t.Errorf("expected reassigned to designer_b")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 9: Notifications
// ══════════════════════════════════════════════════════════════

func TestE2E_Notifications(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_notif", "Admin@123", "admin", "admin_notif", "AdminNotif")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_notif", "Admin@123")

	// Create test notification directly via GORM
	models.DB.Create(&models.Notification{
		UserID:   "admin_notif",
		Title:    "Test Notif",
		Content:  "Test Notif Content",
		Category: "system",
		IsRead:   false,
	})

	// List notifications
	listResp := doRequest(t, client, "GET", server.URL+"/api/v1/admin/notifications?unread=true", adminToken, "", nil)
	defer listResp.Body.Close()
	listData := readJSON(t, listResp)
	
	if listData["unread_count"] == nil {
		t.Fatalf("expected unread_count in response, got %v", listData)
	}
	
	unreadCount := int(listData["unread_count"].(float64))
	if unreadCount < 1 {
		t.Errorf("expected at least 1 unread notification")
	}

	dataList := listData["data"].([]interface{})
	firstNotif := dataList[0].(map[string]interface{})
	notifID := uint(firstNotif["id"].(float64))

	// Mark read
	csrf := getCSRFToken(t, client, server.URL)
	readResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/admin/notifications/%d/read", server.URL, notifID), adminToken, csrf, nil)
	if readResp.StatusCode != http.StatusOK {
		t.Fatalf("mark read failed")
	}
	readResp.Body.Close()

	// Verify unread count decreased
	listResp2 := doRequest(t, client, "GET", server.URL+"/api/v1/admin/notifications?unread=true", adminToken, "", nil)
	listData2 := readJSON(t, listResp2)
	unreadCount2 := int(listData2["unread_count"].(float64))
	if unreadCount2 >= unreadCount {
		t.Errorf("expected unread count to decrease")
	}

	// Mark all read
	csrf = getCSRFToken(t, client, server.URL)
	allReadResp := doRequest(t, client, "PUT", server.URL+"/api/v1/admin/notifications/all/read", adminToken, csrf, nil)
	if allReadResp.StatusCode != http.StatusOK {
		t.Fatalf("mark all read failed")
	}
	allReadResp.Body.Close()
}

// ══════════════════════════════════════════════════════════════
// Test 10: Audit Logs
// ══════════════════════════════════════════════════════════════

func TestE2E_AuditLogs(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_audit", "Admin@123", "admin", "admin_audit", "AdminAudit")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_audit", "Admin@123")
	csrf := getCSRFToken(t, client, server.URL)

	// Trigger audit log: create employee
	createResp := doRequest(t, client, "POST", server.URL+"/api/v1/admin/employees", adminToken, csrf, map[string]string{
		"name": "Audit Target",
		"role": "sales",
	})
	createResp.Body.Close()

	time.Sleep(10 * time.Millisecond) // slight delay for log insertion

	// Get audit logs
	logResp := doRequest(t, client, "GET", server.URL+"/api/v1/admin/audit_logs?action="+models.AuditEmployeeAdd, adminToken, "", nil)
	logData := readJSON(t, logResp)
	
	total := int(logData["total"].(float64))
	if total < 1 {
		t.Errorf("expected at least 1 audit log for employee creation")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 11: Batch Order Status
// ══════════════════════════════════════════════════════════════

func TestE2E_BatchOrderStatus(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_batch", "Admin@123", "admin", "admin_batch", "AdminBatch")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_batch", "Admin@123")
	
	// Create order 1
	csrf := getCSRFToken(t, client, server.URL)
	o1Resp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{"price": 100})
	o1ID := uint(readJSON(t, o1Resp)["id"].(float64))

	// Create order 2
	csrf = getCSRFToken(t, client, server.URL)
	o2Resp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{"price": 200})
	o2ID := uint(readJSON(t, o2Resp)["id"].(float64))

	// Batch update status to GROUP_CREATED
	csrf = getCSRFToken(t, client, server.URL)
	batchResp := doRequest(t, client, "PUT", server.URL+"/api/v1/orders/batch-status", adminToken, csrf, map[string]interface{}{
		"order_ids": []uint{o1ID, o2ID},
		"status":    "GROUP_CREATED",
	})
	if batchResp.StatusCode != http.StatusOK {
		t.Fatalf("batch update failed")
	}
	batchResp.Body.Close()

	// Verify status
	listResp := doRequest(t, client, "GET", server.URL+"/api/v1/orders/list?status=GROUP_CREATED", adminToken, "", nil)
	listData := readJSON(t, listResp)
	if int(listData["total"].(float64)) < 2 {
		t.Errorf("expected at least 2 GROUP_CREATED orders")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 12: Order List And Detail
// ══════════════════════════════════════════════════════════════

func TestE2E_OrderListAndDetail(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_list", "Admin@123", "admin", "admin_list", "AdminList")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_list", "Admin@123")
	
	csrf := getCSRFToken(t, client, server.URL)
	oResp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{
		"price": 500, "topic": "List Test",
	})
	oID := uint(readJSON(t, oResp)["id"].(float64))

	// Get List
	listResp := doRequest(t, client, "GET", server.URL+"/api/v1/orders/list?limit=10&offset=0", adminToken, "", nil)
	listData := readJSON(t, listResp)
	if listData["total"] == nil {
		t.Fatalf("expected total in list response")
	}

	// Get Detail
	detailResp := doRequest(t, client, "GET", fmt.Sprintf("%s/api/v1/orders/%d", server.URL, oID), adminToken, "", nil)
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("get order detail failed: %d", detailResp.StatusCode)
	}
	detailData := readJSON(t, detailResp)
	if detailData["id"] == nil || uint(detailData["id"].(float64)) != oID {
		t.Errorf("detail mismatch")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 13: Payment Match
// ══════════════════════════════════════════════════════════════

func TestE2E_PaymentMatch(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_match", "Admin@123", "admin", "admin_match", "AdminMatch")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_match", "Admin@123")
	
	csrf := getCSRFToken(t, client, server.URL)
	oResp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{
		"price": 100, "topic": "Match Order",
	})
	oID := uint(readJSON(t, oResp)["id"].(float64))

	// Insert unassociated payment via DB
	payment := models.PaymentRecord{
		TransactionID: "TEST-UNMATCHED-123",
		Amount:        100,
		Source:        "wecom",
	}
	models.DB.Create(&payment)

	// Match payment
	csrf = getCSRFToken(t, client, server.URL)
	matchResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/payments/%d/match", server.URL, payment.ID), adminToken, csrf, map[string]interface{}{
		"order_id": oID,
	})
	if matchResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(matchResp.Body)
		t.Fatalf("match payment failed: %s", raw)
	}
	matchResp.Body.Close()

	// Verify payment order ID
	var p models.PaymentRecord
	models.DB.First(&p, payment.ID)
	if p.OrderID != oID {
		t.Errorf("payment not matched to order")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 14: Customer CRUD
// ══════════════════════════════════════════════════════════════

func TestE2E_CustomerCRUD(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_cust", "Admin@123", "admin", "admin_cust", "AdminCust")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_cust", "Admin@123")
	
	// Create two orders with two contacts -> triggers customer creation
	csrf := getCSRFToken(t, client, server.URL)
	doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{
		"price": 100, "customer_contact": "ContactA",
	}).Body.Close()
	csrf = getCSRFToken(t, client, server.URL)
	doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{
		"price": 100, "customer_contact": "ContactB",
	}).Body.Close()

	// List customers
	listResp := doRequest(t, client, "GET", server.URL+"/api/v1/admin/customers?limit=10", adminToken, "", nil)
	listData := readJSON(t, listResp)
	total := int(listData["total"].(float64))
	if total < 2 {
		t.Fatalf("expected at least 2 customers, got %d", total)
	}
	customers := listData["data"].([]interface{})
	c1ID := uint(customers[0].(map[string]interface{})["id"].(float64))
	c2ID := uint(customers[1].(map[string]interface{})["id"].(float64))

	// Get single customer
	getResp := doRequest(t, client, "GET", fmt.Sprintf("%s/api/v1/admin/customers/%d", server.URL, c1ID), adminToken, "", nil)
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get customer failed")
	}
	getResp.Body.Close()

	// Update customer
	csrf = getCSRFToken(t, client, server.URL)
	updateResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/admin/customers/%d", server.URL, c1ID), adminToken, csrf, map[string]interface{}{
		"nickname": "Updated Nickname",
	})
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("update customer failed")
	}
	updateResp.Body.Close()

	// Merge customers
	csrf = getCSRFToken(t, client, server.URL)
	mergeResp := doRequest(t, client, "POST", server.URL+"/api/v1/admin/customers/merge", adminToken, csrf, map[string]interface{}{
		"primary_id":   c1ID,
		"duplicate_id": c2ID,
	})
	if mergeResp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(mergeResp.Body)
		t.Fatalf("merge customer failed: %s", raw)
	}
	mergeResp.Body.Close()
}

// ══════════════════════════════════════════════════════════════
// Test 15: Profit Reports
// ══════════════════════════════════════════════════════════════

func TestE2E_ProfitReports(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_prof", "Admin@123", "admin", "admin_prof", "AdminProf")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_prof", "Admin@123")
	
	csrf := getCSRFToken(t, client, server.URL)
	oResp := doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{
		"price": 1000,
	})
	oID := uint(readJSON(t, oResp)["id"].(float64))

	// Get breakdown
	logResp := doRequest(t, client, "GET", server.URL+"/api/v1/admin/profit_breakdown", adminToken, "", nil)
	if logResp.StatusCode != http.StatusOK {
		t.Fatalf("get profit breakdown failed")
	}
	logResp.Body.Close()

	// Get single order profit
	profResp := doRequest(t, client, "GET", fmt.Sprintf("%s/api/v1/orders/%d/profit", server.URL, oID), adminToken, "", nil)
	if profResp.StatusCode != http.StatusOK {
		t.Fatalf("get order profit failed")
	}
	profData := readJSON(t, profResp)
	if profData["profit"] == nil {
		t.Errorf("missing profit info")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 16: Batch Employee Ops
// ══════════════════════════════════════════════════════════════

func TestE2E_BatchEmployeeOps(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_bemp", "Admin@123", "admin", "admin_bemp", "AdminBemp")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_bemp", "Admin@123")

	seedTestEmployee(t, "designer_b1", "D@123", "designer", "designer_b1", "D1")
	seedTestEmployee(t, "designer_b2", "D@123", "designer", "designer_b2", "D2")
	
	var d1, d2 models.Employee
	models.DB.Where("wecom_userid = ?", "designer_b1").First(&d1)
	models.DB.Where("wecom_userid = ?", "designer_b2").First(&d2)

	// Batch Toggle (disable)
	csrf := getCSRFToken(t, client, server.URL)
	tResp := doRequest(t, client, "PUT", server.URL+"/api/v1/admin/employees/batch_toggle", adminToken, csrf, map[string]interface{}{
		"ids":    []uint{d1.ID, d2.ID},
		"active": false,
	})
	if tResp.StatusCode != http.StatusOK {
		t.Fatalf("batch toggle failed")
	}
	tResp.Body.Close()

	// Batch Delete
	csrf = getCSRFToken(t, client, server.URL)
	dResp := doRequest(t, client, "POST", server.URL+"/api/v1/admin/employees/batch_delete", adminToken, csrf, map[string]interface{}{
		"ids": []uint{d1.ID, d2.ID},
	})
	if dResp.StatusCode != http.StatusOK {
		t.Fatalf("batch delete failed")
	}
	dResp.Body.Close()
}

// ══════════════════════════════════════════════════════════════
// Test 17: Device Unbind
// ══════════════════════════════════════════════════════════════

func TestE2E_DeviceUnbind(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_unbind", "Admin@123", "admin", "admin_unbind", "AdminUnbind")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_unbind", "Admin@123")

	seedTestEmployee(t, "emp_unbind", "E@123", "designer", "emp_unbind", "E_Unbind")
	var emp models.Employee
	models.DB.Where("wecom_userid = ?", "emp_unbind").First(&emp)
	models.DB.Model(&emp).Update("machine_id", "TEST-MACHINE-123")

	csrf := getCSRFToken(t, client, server.URL)
	uResp := doRequest(t, client, "PUT", fmt.Sprintf("%s/api/v1/admin/employees/%d/unbind", server.URL, emp.ID), adminToken, csrf, nil)
	if uResp.StatusCode != http.StatusOK {
		t.Fatalf("device unbind failed")
	}
	uResp.Body.Close()

	// Verify
	models.DB.First(&emp, emp.ID)
	if emp.MachineID != "" {
		t.Errorf("machine ID not cleared")
	}
}

// ══════════════════════════════════════════════════════════════
// Test 18: Export CSV/Excel
// ══════════════════════════════════════════════════════════════

func TestE2E_ExportCSV(t *testing.T) {
	server, cleanup := setupE2ERouter(t)
	defer cleanup()
	client := server.Client()

	seedTestEmployee(t, "admin_exp", "Admin@123", "admin", "admin_exp", "AdminExp")
	adminToken := loginAndGetToken(t, client, server.URL, "admin_exp", "Admin@123")

	// Create an order so we have data
	csrf := getCSRFToken(t, client, server.URL)
	doRequest(t, client, "POST", server.URL+"/api/v1/orders/create", adminToken, csrf, map[string]interface{}{"price": 100}).Body.Close()

	// Export orders CSV
	req1, _ := http.NewRequest("GET", server.URL+"/api/v1/admin/orders/export", nil)
	req1.Header.Set("Authorization", "Bearer "+adminToken)
	resp1, err := client.Do(req1)
	if err != nil || resp1.StatusCode != http.StatusOK {
		t.Fatalf("export orders csv failed")
	}
	contentType1 := resp1.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType1, "text/csv") {
		t.Errorf("expected text/csv, got %s", contentType1)
	}
	resp1.Body.Close()

	// Export profit CSV
	req2, _ := http.NewRequest("GET", server.URL+"/api/v1/admin/profit/export", nil)
	req2.Header.Set("Authorization", "Bearer "+adminToken)
	resp2, _ := client.Do(req2)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("export profit csv failed")
	}
	resp2.Body.Close()

	// Export Excel
	req3, _ := http.NewRequest("GET", server.URL+"/api/v1/admin/export/excel", nil)
	req3.Header.Set("Authorization", "Bearer "+adminToken)
	resp3, _ := client.Do(req3)
	if resp3.StatusCode != http.StatusOK {
		t.Fatalf("export excel failed")
	}
	contentType3 := resp3.Header.Get("Content-Type")
	if contentType3 != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Errorf("expected excel content type, got %s", contentType3)
	}
	resp3.Body.Close()
}

