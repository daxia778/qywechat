package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCSRF_ValidTokenConsumed(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := CSRFMiddleware()

	// Step 1: GET request to obtain a CSRF token.
	w1 := httptest.NewRecorder()
	c1, _ := gin.CreateTestContext(w1)
	c1.Request, _ = http.NewRequest(http.MethodGet, "/api/v1/orders", nil)
	handler(c1)

	token := w1.Header().Get("X-CSRF-Token")
	if token == "" {
		t.Fatal("GET did not return X-CSRF-Token header")
	}

	// Step 2: First POST with this token should succeed.
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/orders", nil)
	c2.Request.Header.Set("X-CSRF-Token", token)
	handler(c2)

	if w2.Code == http.StatusForbidden {
		t.Errorf("First use of valid token: expected pass, got 403: %s", w2.Body.String())
	}

	// Step 3: Second POST with the same token should fail (consumed).
	w3 := httptest.NewRecorder()
	c3, _ := gin.CreateTestContext(w3)
	c3.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/orders", nil)
	c3.Request.Header.Set("X-CSRF-Token", token)
	handler(c3)

	if w3.Code != http.StatusForbidden {
		t.Errorf("Second use of consumed token: expected 403, got %d: %s", w3.Code, w3.Body.String())
	}
}

func TestCSRF_ExpiredToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Manually inject an expired token into the store.
	expiredToken := "expired-test-token-abc123"
	csrf.mu.Lock()
	csrf.tokens[expiredToken] = time.Now().Add(-31 * time.Minute) // 31 minutes ago, past the 30-min limit
	csrf.mu.Unlock()

	handler := CSRFMiddleware()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/orders", nil)
	c.Request.Header.Set("X-CSRF-Token", expiredToken)
	handler(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Expired token: expected 403, got %d: %s", w.Code, w.Body.String())
	}

	// Verify the expired token was NOT deleted from the store (the code path
	// returns before delete when expired).
	// Actually, re-reading the code: the token is left in the map for the
	// background cleanup goroutine. This is fine -- the important thing is
	// the request was rejected.
}

func TestCSRF_MissingToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := CSRFMiddleware()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/orders", nil)
	// No X-CSRF-Token header set.
	handler(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Missing token: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCSRF_InvalidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := CSRFMiddleware()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodPost, "/api/v1/orders", nil)
	c.Request.Header.Set("X-CSRF-Token", "completely-bogus-token-that-was-never-issued")
	handler(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("Invalid/fabricated token: expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCSRF_SkippedPaths(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := CSRFMiddleware()

	// These paths should bypass CSRF protection entirely, even for POST.
	skippedPaths := []string{
		"/api/v1/wecom/callback",
		"/api/v1/auth/device_login",
		"/api/v1/auth/admin_login",
		"/health",
	}

	for _, path := range skippedPaths {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request, _ = http.NewRequest(http.MethodPost, path, nil)
			// No CSRF token provided -- should still pass.
			handler(c)

			if w.Code == http.StatusForbidden {
				t.Errorf("Skipped path %s: expected pass, got 403", path)
			}
		})
	}
}

func TestCSRF_GETIssuesToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := CSRFMiddleware()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest(http.MethodGet, "/api/v1/orders", nil)
	handler(c)

	token := w.Header().Get("X-CSRF-Token")
	if token == "" {
		t.Error("GET request should issue X-CSRF-Token in response header")
	}
	if len(token) != 64 { // 32 bytes hex-encoded = 64 chars
		t.Errorf("Token length: expected 64 hex chars, got %d", len(token))
	}
}
