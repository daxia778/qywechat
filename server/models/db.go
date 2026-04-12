package models

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"pdd-order-system/config"

	"golang.org/x/crypto/bcrypt"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var (
	DB      *gorm.DB
	writeMu sync.Mutex // 全局写串行化锁，防止 SQLite 写冲突
)

// WriteTx 写事务包装（兼容混合模式）
// 对于 SQLite 强制串行写防 locked 错误；对于 Postgres 直接执行无锁并发
func WriteTx(fn func(tx *gorm.DB) error) error {
	if config.C.DBType == "sqlite" {
		writeMu.Lock()
		defer writeMu.Unlock()
	}
	return DB.Transaction(fn)
}

// InitDB 初始化数据库连接
func InitDB() {
	var err error
	var dialector gorm.Dialector

	if config.C.DBType == "postgres" {
		// PostgreSQL 初始化
		dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=Asia/Shanghai",
			config.C.PGHost, config.C.PGUser, config.C.PGPassword, config.C.PGDBName, config.C.PGPort, config.C.PGSSLMode)
		dialector = postgres.Open(dsn)
	} else {
		// SQLite 初始化
		dbPath := config.C.DBPath
		dir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dir, 0o750); err != nil { // #nosec G301
			log.Fatalf("❌ 创建数据库目录失败: %v", err)
		}
		dsn := fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=30000&_synchronous=FULL&_cache_size=-64000&_foreign_keys=ON", dbPath)
		dialector = sqlite.Open(dsn)
	}

	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("❌ 数据库连接失败 (%s): %v", config.C.DBType, err)
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Fatalf("❌ 获取 sql.DB 失败: %v", err)
	}

	if config.C.DBType == "sqlite" {
		// SQLite: 单连接防止 "database is locked"，配合 WriteTx 互斥锁
		sqlDB.SetMaxIdleConns(1)
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetConnMaxLifetime(0) // 不回收连接
	} else {
		// PostgreSQL: 允许并发连接
		sqlDB.SetMaxIdleConns(4)
		sqlDB.SetMaxOpenConns(8)
		sqlDB.SetConnMaxLifetime(30 * time.Minute)
	}

	// 自动建表与迁移
	if err := DB.AutoMigrate(&Employee{}, &Order{}, &Customer{}, &AuditLog{}, &WecomGroupChat{}, &WecomMember{}, &WecomMessageLog{}, &AppVersion{}, &Notification{}, &OrderTimeline{}, &PaymentRecord{}, &TokenBlacklist{}, &UserMinIssuedAtRecord{}, &FreelanceDesigner{}, &ContactWay{}, &CustomerTransfer{}, &TransferRule{}, &RiskAlert{}, &AuditConfig{}, &ChatArchiveMessage{}, &ChatArchiveCursor{}, &WeComExternalContact{}); err != nil {
		log.Fatalf("❌ 数据库迁移失败: %v", err)
	}

	// 手动创建复合索引（AutoMigrate 可能不覆盖所有场景）
	ensureIndexes()

	log.Printf("✅ 数据库初始化完成 (Driver: %s)", config.C.DBType)

	// 种子数据: 自动创建默认管理员账户
	seedDefaultAdmin()

	// 一次性补录: 给缺少 GROUP_CREATED 时间线的订单补记录
	backfillGroupCreatedTimeline()
}

// ensureIndexes 创建业务常用的复合索引
func ensureIndexes() {
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_orders_operator_status ON orders(operator_id, status)",
		"CREATE INDEX IF NOT EXISTS idx_orders_designer_status ON orders(designer_id, status)",
		"CREATE INDEX IF NOT EXISTS idx_orders_deadline ON orders(deadline, deadline_reminded) WHERE deadline IS NOT NULL",
		"CREATE INDEX IF NOT EXISTS idx_employees_role_active ON employees(role, is_active)",
		"CREATE INDEX IF NOT EXISTS idx_employees_machine_id ON employees(machine_id) WHERE machine_id != ''",
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_username ON employees(username) WHERE username != ''",
		"CREATE INDEX IF NOT EXISTS idx_orders_wecom_chat_id ON orders(wecom_chat_id) WHERE wecom_chat_id != ''",
		"CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)",
		"CREATE INDEX IF NOT EXISTS idx_archive_msg_sender ON chat_archive_messages(sender_id, msg_time)",
	}
	for _, sql := range indexes {
		if err := DB.Exec(sql).Error; err != nil {
			log.Printf("⚠️  索引创建跳过: %v", err)
		}
	}
}

// seedDefaultAdmin 如果没有管理员账户，自动创建默认管理员
func seedDefaultAdmin() {
	var count int64
	DB.Model(&Employee{}).Where("role = ? AND username != ''", "admin").Count(&count)
	if count > 0 {
		return // 已有管理员账户，跳过
	}

	username := config.C.AdminDefaultUsername
	password := config.C.AdminDefaultPassword

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("❌ 创建默认管理员失败: %v", err)
		return
	}

	admin := Employee{
		WecomUserID:  "admin",
		Name:         "系统管理员",
		Role:         "admin",
		Username:     username,
		PasswordHash: string(hashed),
		IsActive:     true,
	}
	if err := DB.Create(&admin).Error; err != nil {
		log.Printf("⚠️  默认管理员创建跳过 (可能已存在): %v", err)
		return
	}
	log.Printf("✅ 已创建默认管理员账户: %s (密码已设置，请通过环境变量 ADMIN_DEFAULT_PASSWORD 查看)", username)
}

// backfillGroupCreatedTimeline 补录缺少 GROUP_CREATED 时间线的历史订单
func backfillGroupCreatedTimeline() {
	var orders []Order
	DB.Where("designer_id != '' AND status != ?", StatusPending).Find(&orders)

	filled := 0
	for _, o := range orders {
		var exists int64
		DB.Model(&OrderTimeline{}).Where(
			"order_id = ? AND event_type = 'status_changed' AND to_status = ?",
			o.ID, StatusGroupCreated,
		).Count(&exists)
		if exists > 0 {
			continue
		}

		designerName := o.DesignerID
		var emp Employee
		if DB.Where("wecom_userid = ?", o.DesignerID).First(&emp).Error == nil {
			designerName = emp.Name
		}

		ts := o.CreatedAt
		if o.AssignedAt != nil {
			ts = *o.AssignedAt
		}

		DB.Create(&OrderTimeline{
			OrderID:      o.ID,
			EventType:    "status_changed",
			FromStatus:   StatusPending,
			ToStatus:     StatusGroupCreated,
			OperatorID:   o.DesignerID,
			OperatorName: designerName,
			Remark:       "系统自动指派",
			CreatedAt:    ts,
		})
		filled++
	}
	if filled > 0 {
		log.Printf("✅ 已补录 %d 条缺失的 GROUP_CREATED 时间线记录", filled)
	}
}
