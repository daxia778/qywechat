package services

import (
	"fmt"
	"log"
	"regexp"
	"strings"

	"pdd-order-system/models"

	"gorm.io/gorm"
)

var mobileRegex = regexp.MustCompile(`^\d{11}$`)

// isMobile 判断联系方式是否为手机号（纯数字且长度11位）
func isMobile(contact string) bool {
	return mobileRegex.MatchString(strings.TrimSpace(contact))
}

// FindOrCreateCustomer 根据联系方式查找或创建顾客
func FindOrCreateCustomer(contact string) (*models.Customer, error) {
	contact = strings.TrimSpace(contact)
	if contact == "" {
		return nil, nil
	}

	var customer models.Customer
	var err error

	if isMobile(contact) {
		err = models.DB.Where("mobile = ?", contact).First(&customer).Error
	} else {
		err = models.DB.Where("wechat_id = ?", contact).First(&customer).Error
	}

	if err == nil {
		return &customer, nil
	}

	if err != gorm.ErrRecordNotFound {
		return nil, fmt.Errorf("查询顾客失败: %w", err)
	}

	// 不存在则创建
	customer = models.Customer{}
	if isMobile(contact) {
		customer.Mobile = contact
	} else {
		customer.WechatID = contact
	}

	if createErr := models.DB.Create(&customer).Error; createErr != nil {
		return nil, fmt.Errorf("创建顾客失败: %w", createErr)
	}

	log.Printf("✅ 新顾客创建 | id=%d | contact=%s", customer.ID, contact)
	return &customer, nil
}

// UpdateCustomerStats 更新顾客统计（订单数、消费额等）
func UpdateCustomerStats(customerID uint) error {
	var result struct {
		Count        int64
		TotalAmount  int
		FirstOrderAt *string
		LastOrderAt  *string
	}

	err := models.DB.Model(&models.Order{}).
		Select("COUNT(*) as count, COALESCE(SUM(price), 0) as total_amount, MIN(created_at) as first_order_at, MAX(created_at) as last_order_at").
		Where("customer_id = ?", customerID).
		Scan(&result).Error
	if err != nil {
		return fmt.Errorf("统计顾客数据失败: %w", err)
	}

	updates := map[string]any{
		"total_orders": result.Count,
		"total_amount": result.TotalAmount,
	}

	// 使用子查询获取时间字段
	models.DB.Model(&models.Customer{}).Where("id = ?", customerID).Updates(updates)

	// 单独更新时间字段
	models.DB.Exec(
		"UPDATE customers SET first_order_at = (SELECT MIN(created_at) FROM orders WHERE customer_id = ?), last_order_at = (SELECT MAX(created_at) FROM orders WHERE customer_id = ?) WHERE id = ?",
		customerID, customerID, customerID,
	)

	return nil
}

// ListCustomers 分页查询顾客列表
func ListCustomers(keyword string, limit, offset int) ([]models.Customer, int64, error) {
	var customers []models.Customer
	var total int64

	query := models.DB.Model(&models.Customer{})

	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("wechat_id LIKE ? OR mobile LIKE ? OR nickname LIKE ? OR remark LIKE ?", like, like, like, like)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("查询顾客数量失败: %w", err)
	}

	if err := query.Order("last_order_at DESC, created_at DESC").Offset(offset).Limit(limit).Find(&customers).Error; err != nil {
		return nil, 0, fmt.Errorf("查询顾客列表失败: %w", err)
	}

	return customers, total, nil
}

// GetCustomerWithOrders 获取顾客详情含历史订单
func GetCustomerWithOrders(id uint) (*models.Customer, []models.Order, error) {
	var customer models.Customer
	if err := models.DB.First(&customer, id).Error; err != nil {
		return nil, nil, fmt.Errorf("顾客不存在")
	}

	var orders []models.Order
	models.DB.Where("customer_id = ?", id).Order("created_at DESC").Find(&orders)

	return &customer, orders, nil
}

// MigrateCustomersFromOrders 从已有订单数据迁移顾客信息（幂等）
func MigrateCustomersFromOrders() {
	// 检查是否已迁移（如果 customers 表已有数据且 orders 表有 customer_id 不为 0 的记录，跳过）
	var customerCount int64
	models.DB.Model(&models.Customer{}).Count(&customerCount)

	var linkedOrderCount int64
	models.DB.Model(&models.Order{}).Where("customer_id > 0").Count(&linkedOrderCount)

	if customerCount > 0 && linkedOrderCount > 0 {
		log.Println("✅ 顾客数据迁移: 已完成，跳过")
		return
	}

	// 获取所有唯一的 customer_contact
	type ContactRow struct {
		CustomerContact string
	}
	var contacts []ContactRow
	models.DB.Model(&models.Order{}).
		Select("DISTINCT customer_contact").
		Where("customer_contact != '' AND (customer_id = 0 OR customer_id IS NULL)").
		Find(&contacts)

	if len(contacts) == 0 {
		log.Println("✅ 顾客数据迁移: 无需迁移的数据")
		return
	}

	migrated := 0
	for _, row := range contacts {
		contact := strings.TrimSpace(row.CustomerContact)
		if contact == "" {
			continue
		}

		customer, err := FindOrCreateCustomer(contact)
		if err != nil || customer == nil {
			log.Printf("⚠️  迁移顾客失败: contact=%s err=%v", contact, err)
			continue
		}

		// 回填 orders.customer_id
		models.DB.Model(&models.Order{}).
			Where("customer_contact = ? AND (customer_id = 0 OR customer_id IS NULL)", contact).
			Update("customer_id", customer.ID)

		// 更新统计
		_ = UpdateCustomerStats(customer.ID)
		migrated++
	}

	log.Printf("✅ 顾客数据迁移完成: 共迁移 %d 个顾客", migrated)
}
