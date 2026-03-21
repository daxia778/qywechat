package testutil

import (
	"fmt"
	"testing"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// SetupTestDB creates a fresh in-memory SQLite database, replaces models.DB,
// initialises config.C with safe defaults, and registers a cleanup that closes
// the underlying sql.DB when the test finishes.
//
// NOTE: This package intentionally does NOT import services (to avoid import
// cycles). Callers in the services package should call InitWecom() themselves;
// callers in other packages should call services.InitWecom().
func SetupTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	// Minimal config so WriteTx / JWT / profit code does not nil-panic.
	config.C = &config.Config{
		DBType:                 "sqlite",
		DBPath:                 ":memory:",
		JWTSecretKey:           "test-secret-key-for-unit-tests",
		JWTExpireMinutes:       60,
		AdminDefaultUsername:   "admin",
		AdminDefaultPassword:   "Test123!",
		PlatformFeeRate:        5,
		DesignerCommissionRate: 40,
		SalesCommissionRate:    10,
		FollowCommissionRate:   5,
	}

	// Use a unique in-memory DB per test to avoid cross-test state leakage.
	dbName := fmt.Sprintf("file:testdb_%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dbName), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatalf("Failed to open test DB: %v", err)
	}

	sqlDB, _ := db.DB()
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetMaxOpenConns(1)

	t.Cleanup(func() {
		sqlDB.Close()
	})

	// AutoMigrate all models used by the application.
	if err := db.AutoMigrate(
		&models.Order{},
		&models.Employee{},
		&models.Customer{},
		&models.PaymentRecord{},
		&models.OrderTimeline{},
		&models.Notification{},
		&models.AuditLog{},
	); err != nil {
		t.Fatalf("AutoMigrate failed: %v", err)
	}

	// Replace the global DB so that WriteTx / services use our test database.
	models.DB = db

	return db
}
