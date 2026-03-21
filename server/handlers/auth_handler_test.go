package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ---------------------------------------------------------------------------
// helpers (reuses setupTestDB from order_handler_test.go in the same package)
// ---------------------------------------------------------------------------

// createTestEmployee inserts an employee with a bcrypt-hashed password into the test DB.
// NOTE: GORM ignores zero-value bool fields when the column has default:true,
// so we first create with IsActive=true, then explicitly UPDATE if isActive=false.
func createTestEmployee(t *testing.T, username, password, role, wecomUID, name string, isActive bool) {
	t.Helper()
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost) // MinCost for speed
	if err != nil {
		t.Fatalf("bcrypt hash failed: %v", err)
	}
	emp := models.Employee{
		WecomUserID:  wecomUID,
		Name:         name,
		Role:         role,
		Username:     username,
		PasswordHash: string(hashed),
		IsActive:     true, // always create as active first
		Status:       "idle",
	}
	if err := models.DB.Create(&emp).Error; err != nil {
		t.Fatalf("Failed to create test employee: %v", err)
	}
	// If the caller wants an inactive user, do an explicit UPDATE to bypass
	// GORM's zero-value field skipping behaviour.
	if !isActive {
		if err := models.DB.Model(&emp).Update("is_active", false).Error; err != nil {
			t.Fatalf("Failed to deactivate test employee: %v", err)
		}
	}
}

// doLogin sends a POST request to the Login handler with the given credentials
// and returns the recorder for status/body inspection.
func doLogin(t *testing.T, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)

	body, _ := json.Marshal(LoginReq{
		Username: username,
		Password: password,
	})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.RemoteAddr = "127.0.0.1:12345" // needed for ClientIP()

	Login(c)
	return w
}

// ---------------------------------------------------------------------------
// Login tests
// ---------------------------------------------------------------------------

func TestLogin_Success(t *testing.T) {
	setupTestDB(t) // from order_handler_test.go
	createTestEmployee(t, "testuser", "correct-password", "admin", "wu_test01", "Test Admin", true)

	w := doLogin(t, "testuser", "correct-password")

	if w.Code != http.StatusOK {
		t.Fatalf("Login success: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response JSON: %v", err)
	}

	token, ok := resp["token"].(string)
	if !ok || token == "" {
		t.Error("Response should contain a non-empty 'token' field")
	}

	user, ok := resp["user"].(map[string]interface{})
	if !ok {
		t.Fatal("Response should contain a 'user' object")
	}
	if user["name"] != "Test Admin" {
		t.Errorf("user.name: expected 'Test Admin', got %v", user["name"])
	}
	if user["role"] != "admin" {
		t.Errorf("user.role: expected 'admin', got %v", user["role"])
	}
	if user["username"] != "testuser" {
		t.Errorf("user.username: expected 'testuser', got %v", user["username"])
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	setupTestDB(t)
	createTestEmployee(t, "testuser", "correct-password", "sales", "wu_test02", "Test Sales", true)

	w := doLogin(t, "testuser", "wrong-password")

	if w.Code != http.StatusForbidden {
		t.Errorf("Wrong password: expected 403, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response body: %v (raw: %q)", err, w.Body.String())
	}
	// The error response may use "error" (handler) or "message" (brute-force
	// protection middleware). Accept either format.
	errMsg, _ := resp["error"].(string)
	msgVal, _ := resp["message"].(string)
	if errMsg == "" && msgVal == "" {
		t.Errorf("Response should contain a non-empty 'error' or 'message' field, got body: %q", w.Body.String())
	}
}

func TestLogin_UserNotFound(t *testing.T) {
	setupTestDB(t)
	// No employees seeded -- the user simply does not exist.

	w := doLogin(t, "nonexistent", "any-password")

	if w.Code != http.StatusForbidden {
		t.Errorf("User not found: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLogin_InactiveUser(t *testing.T) {
	setupTestDB(t)
	// Create a user that is explicitly disabled (is_active = false).
	createTestEmployee(t, "inactive_user", "correct-password", "designer", "wu_test03", "Inactive Designer", false)

	w := doLogin(t, "inactive_user", "correct-password")

	// The query filters by is_active=true, so an inactive user is treated
	// the same as a non-existent user.
	if w.Code != http.StatusForbidden {
		t.Errorf("Inactive user: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLogin_MissingFields(t *testing.T) {
	setupTestDB(t)
	gin.SetMode(gin.TestMode)

	// Empty JSON body -- both username and password are required.
	body, _ := json.Marshal(map[string]string{})

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.RemoteAddr = "127.0.0.1:12345"

	Login(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Missing fields: expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLogin_MultipleRoles(t *testing.T) {
	setupTestDB(t)

	// Verify that different roles can all log in through the unified endpoint.
	roles := []struct {
		username string
		role     string
		wecomID  string
		name     string
	}{
		{"admin_user", "admin", "wu_admin", "Admin User"},
		{"sales_user", "sales", "wu_sales", "Sales User"},
		{"designer_user", "designer", "wu_designer", "Designer User"},
		{"follow_user", "follow", "wu_follow", "Follow User"},
	}

	for _, r := range roles {
		createTestEmployee(t, r.username, "password123", r.role, r.wecomID, r.name, true)
	}

	for _, r := range roles {
		w := doLogin(t, r.username, "password123")
		if w.Code != http.StatusOK {
			t.Errorf("Login for role %s: expected 200, got %d: %s", r.role, w.Code, w.Body.String())
		}

		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		user := resp["user"].(map[string]interface{})
		if user["role"] != r.role {
			t.Errorf("Role mismatch for %s: expected %s, got %v", r.username, r.role, user["role"])
		}
	}
}
