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

// escapeLike 转义 LIKE 查询中的特殊通配符
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

// isMobile 判断联系方式是否为手机号（纯数字且长度11位）
func isMobile(contact string) bool {
	return mobileRegex.MatchString(strings.TrimSpace(contact))
}

// FindOrCreateCustomer 根据联系方式查找或创建顾客
// 查找顺序: external_user_id -> mobile -> wechat_id -> 创建新记录
// 支持传入 contact (手机号或微信号) 和可选的 opts 参数
func FindOrCreateCustomer(contact string, opts ...CustomerLookupOpts) (*models.Customer, error) {
	contact = strings.TrimSpace(contact)

	var opt CustomerLookupOpts
	if len(opts) > 0 {
		opt = opts[0]
	}

	// 至少需要一个查找条件
	if contact == "" && opt.ExternalUserID == "" {
		return nil, nil
	}

	var customer models.Customer

	// 1. 优先按 external_user_id 查找
	if opt.ExternalUserID != "" {
		err := models.DB.Where("external_user_id = ?", opt.ExternalUserID).First(&customer).Error
		if err == nil {
			// 找到了，补充缺失字段
			updated := fillMissingFields(&customer, contact, opt)
			if updated {
				if saveErr := models.WriteTx(func(tx *gorm.DB) error {
					return tx.Save(&customer).Error
				}); saveErr != nil {
					log.Printf("补充顾客字段失败: id=%d err=%v", customer.ID, saveErr)
				}
			}
			return &customer, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("查询顾客失败: %w", err)
		}
	}

	// 2. 按 mobile 查找
	if contact != "" && isMobile(contact) {
		err := models.DB.Where("mobile = ?", contact).First(&customer).Error
		if err == nil {
			updated := fillMissingFields(&customer, "", opt)
			if updated {
				if saveErr := models.WriteTx(func(tx *gorm.DB) error {
					return tx.Save(&customer).Error
				}); saveErr != nil {
					log.Printf("补充顾客字段失败: id=%d err=%v", customer.ID, saveErr)
				}
			}
			return &customer, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("查询顾客失败: %w", err)
		}
	}

	// 3. 按 wechat_id 查找
	if contact != "" && !isMobile(contact) {
		err := models.DB.Where("wechat_id = ?", contact).First(&customer).Error
		if err == nil {
			updated := fillMissingFields(&customer, "", opt)
			if updated {
				if saveErr := models.WriteTx(func(tx *gorm.DB) error {
					return tx.Save(&customer).Error
				}); saveErr != nil {
					log.Printf("补充顾客字段失败: id=%d err=%v", customer.ID, saveErr)
				}
			}
			return &customer, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("查询顾客失败: %w", err)
		}
	}

	// 4. 不存在则创建
	customer = models.Customer{}
	if contact != "" {
		if isMobile(contact) {
			customer.Mobile = contact
		} else {
			customer.WechatID = contact
		}
	}
	if opt.ExternalUserID != "" {
		customer.ExternalUserID = opt.ExternalUserID
	}
	if opt.Nickname != "" {
		customer.Nickname = opt.Nickname
	}
	if opt.Source != "" {
		customer.Source = opt.Source
	}

	if createErr := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&customer).Error
	}); createErr != nil {
		return nil, fmt.Errorf("创建顾客失败: %w", createErr)
	}

	log.Printf("新顾客创建 | id=%d | contact=%s | external_user_id=%s", customer.ID, contact, opt.ExternalUserID)
	return &customer, nil
}

// CustomerLookupOpts FindOrCreateCustomer 的可选参数
type CustomerLookupOpts struct {
	ExternalUserID string
	Nickname       string
	Source         string // pdd / referral / other
}

// fillMissingFields 将可选参数中的非空字段补充到已有记录上，返回是否有更新
func fillMissingFields(c *models.Customer, contact string, opt CustomerLookupOpts) bool {
	updated := false
	if contact != "" {
		if isMobile(contact) && c.Mobile == "" {
			c.Mobile = contact
			updated = true
		} else if !isMobile(contact) && c.WechatID == "" {
			c.WechatID = contact
			updated = true
		}
	}
	if opt.ExternalUserID != "" && c.ExternalUserID == "" {
		c.ExternalUserID = opt.ExternalUserID
		updated = true
	}
	if opt.Nickname != "" && c.Nickname == "" {
		c.Nickname = opt.Nickname
		updated = true
	}
	if opt.Source != "" && c.Source == "" {
		c.Source = opt.Source
		updated = true
	}
	return updated
}

// MergeCustomerRecords 合并两条客户记录
// primary: 保留的主记录（通常是录单时创建的，有更多信息）
// duplicate: 要合并的重复记录（然后软删除）
func MergeCustomerRecords(db *gorm.DB, primaryID, duplicateID uint) (*models.Customer, error) {
	if primaryID == duplicateID {
		return nil, fmt.Errorf("主记录和重复记录不能相同")
	}

	var primary, duplicate models.Customer
	var mergedCustomer models.Customer

	err := models.WriteTx(func(tx *gorm.DB) error {
		// 1. 获取两条记录
		if err := tx.First(&primary, primaryID).Error; err != nil {
			return fmt.Errorf("主记录不存在: %w", err)
		}
		if err := tx.First(&duplicate, duplicateID).Error; err != nil {
			return fmt.Errorf("重复记录不存在: %w", err)
		}

		// 2. 将 duplicate 的非空字段补充到 primary 上
		if primary.ExternalUserID == "" && duplicate.ExternalUserID != "" {
			primary.ExternalUserID = duplicate.ExternalUserID
		}
		if primary.Nickname == "" && duplicate.Nickname != "" {
			primary.Nickname = duplicate.Nickname
		}
		if primary.Mobile == "" && duplicate.Mobile != "" {
			primary.Mobile = duplicate.Mobile
		}
		if primary.WechatID == "" && duplicate.WechatID != "" {
			primary.WechatID = duplicate.WechatID
		}
		if primary.Remark == "" && duplicate.Remark != "" {
			primary.Remark = duplicate.Remark
		}
		if primary.Source == "" && duplicate.Source != "" {
			primary.Source = duplicate.Source
		}
		// 合并标签（去重）
		if duplicate.Tags != "" {
			primary.Tags = mergeTags(primary.Tags, duplicate.Tags)
		}

		// 合并统计字段
		primary.TotalOrders += duplicate.TotalOrders
		primary.TotalAmount += duplicate.TotalAmount
		primary.TotalPayments += duplicate.TotalPayments
		primary.IsRepurchase = primary.TotalOrders > 1

		// 合并时间字段：取最早的 FirstOrderAt 和最晚的 LastOrderAt
		if duplicate.FirstOrderAt != nil {
			if primary.FirstOrderAt == nil || duplicate.FirstOrderAt.Before(*primary.FirstOrderAt) {
				primary.FirstOrderAt = duplicate.FirstOrderAt
			}
		}
		if duplicate.LastOrderAt != nil {
			if primary.LastOrderAt == nil || duplicate.LastOrderAt.After(*primary.LastOrderAt) {
				primary.LastOrderAt = duplicate.LastOrderAt
			}
		}

		if err := tx.Save(&primary).Error; err != nil {
			return fmt.Errorf("更新主记录失败: %w", err)
		}

		// 3. 更新所有引用 duplicate 的订单
		if err := tx.Model(&models.Order{}).
			Where("customer_id = ?", duplicateID).
			Update("customer_id", primaryID).Error; err != nil {
			return fmt.Errorf("迁移订单失败: %w", err)
		}

		// 4. 更新所有引用 duplicate 的收款流水
		if err := tx.Model(&models.PaymentRecord{}).
			Where("customer_id = ?", duplicateID).
			Update("customer_id", primaryID).Error; err != nil {
			return fmt.Errorf("迁移收款流水失败: %w", err)
		}

		// 5. 软删除 duplicate 记录
		if err := tx.Delete(&duplicate).Error; err != nil {
			return fmt.Errorf("删除重复记录失败: %w", err)
		}

		mergedCustomer = primary
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("合并顾客记录失败: %w", err)
	}

	log.Printf("顾客合并完成 | primary=%d | duplicate=%d(已删除)", primaryID, duplicateID)
	return &mergedCustomer, nil
}

// mergeTags 合并两组逗号分隔的标签，去重
func mergeTags(a, b string) string {
	seen := make(map[string]bool)
	var result []string

	for _, tag := range strings.Split(a, ",") {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[tag] {
			seen[tag] = true
			result = append(result, tag)
		}
	}
	for _, tag := range strings.Split(b, ",") {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[tag] {
			seen[tag] = true
			result = append(result, tag)
		}
	}
	return strings.Join(result, ",")
}

// UpdateCustomerStats 更新顾客统计（订单数、消费额、收款笔数、复购标记等）
func UpdateCustomerStats(customerID uint) error {
	var orderStats struct {
		Count       int64
		TotalAmount int
	}

	err := models.DB.Model(&models.Order{}).
		Select("COUNT(*) as count, COALESCE(SUM(price), 0) as total_amount").
		Where("customer_id = ?", customerID).
		Scan(&orderStats).Error
	if err != nil {
		return fmt.Errorf("统计顾客订单数据失败: %w", err)
	}

	// 统计收款笔数
	var paymentCount int64
	models.DB.Model(&models.PaymentRecord{}).
		Where("customer_id = ?", customerID).
		Count(&paymentCount)

	updates := map[string]any{
		"total_orders":   orderStats.Count,
		"total_amount":   orderStats.TotalAmount,
		"total_payments": paymentCount,
		"is_repurchase":  orderStats.Count > 1,
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		if updateErr := tx.Model(&models.Customer{}).Where("id = ?", customerID).Updates(updates).Error; updateErr != nil {
			return updateErr
		}
		// 单独更新时间字段（子查询）
		return tx.Exec(
			"UPDATE customers SET first_order_at = (SELECT MIN(created_at) FROM orders WHERE customer_id = ?), last_order_at = (SELECT MAX(created_at) FROM orders WHERE customer_id = ?) WHERE id = ?",
			customerID, customerID, customerID,
		).Error
	}); err != nil {
		return fmt.Errorf("更新顾客统计失败: %w", err)
	}

	return nil
}

// ListCustomers 分页查询顾客列表
func ListCustomers(keyword string, limit, offset int) ([]models.Customer, int64, error) {
	var customers []models.Customer
	var total int64

	query := models.DB.Model(&models.Customer{})

	if keyword != "" {
		like := "%" + escapeLike(keyword) + "%"
		query = query.Where("wechat_id LIKE ? ESCAPE '\\' OR mobile LIKE ? ESCAPE '\\' OR nickname LIKE ? ESCAPE '\\' OR remark LIKE ? ESCAPE '\\'", like, like, like, like)
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
		if err := models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&models.Order{}).
				Where("customer_contact = ? AND (customer_id = 0 OR customer_id IS NULL)", contact).
				Update("customer_id", customer.ID).Error
		}); err != nil {
			log.Printf("❌ 回填订单customer_id失败: contact=%s err=%v", contact, err)
		}

		// 更新统计
		_ = UpdateCustomerStats(customer.ID)
		migrated++
	}

	log.Printf("✅ 顾客数据迁移完成: 共迁移 %d 个顾客", migrated)
}
