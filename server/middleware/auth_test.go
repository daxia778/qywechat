package middleware

import (
	"testing"
	"time"

	"pdd-order-system/config"

	"github.com/golang-jwt/jwt/v5"
)

func TestCreateAndParseToken(t *testing.T) {
	// Mock config
	config.C = &config.Config{
		JWTSecretKey:     "test-secret",
		JWTExpireMinutes: 60,
	}

	uid := "user123"
	name := "Test User"
	role := "admin"

	tokenStr, err := CreateToken(uid, name, role)
	if err != nil {
		t.Fatalf("CreateToken error: %v", err)
	}

	// Parse it back
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		return []byte(config.C.JWTSecretKey), nil
	})

	if err != nil || !token.Valid {
		t.Fatalf("Parsed token is invalid: %v", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		t.Fatalf("Failed to extract claims")
	}

	if claims["sub"] != uid {
		t.Errorf("Expected sub %s, got %s", uid, claims["sub"])
	}
	if claims["name"] != name {
		t.Errorf("Expected name %s, got %s", name, claims["name"])
	}
	if claims["role"] != role {
		t.Errorf("Expected role %s, got %s", role, claims["role"])
	}
}

func TestExpiredToken(t *testing.T) {
	// Create a token that expires instantly
	config.C = &config.Config{
		JWTSecretKey:     "test-secret",
		JWTExpireMinutes: -1, // Expired
	}

	tokenStr, _ := CreateToken("uid", "name", "role")

	// Wait a moment
	time.Sleep(1 * time.Millisecond)

	_, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		return []byte(config.C.JWTSecretKey), nil
	})

	if err == nil {
		t.Errorf("Expected error parsing expired token, got nil")
	}
}
