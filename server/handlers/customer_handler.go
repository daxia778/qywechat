package handlers

import (
	"log"
	"strconv"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ListCustomers GET /api/v1/admin/customers
func ListCustomers(c *gin.Context) {
	keyword := c.Query("keyword")
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	customers, total, err := services.ListCustomers(keyword, limit, offset)
	if err != nil {
		log.Printf("查询顾客列表失败: %v", err)
		internalError(c, "查询顾客列表失败，请稍后重试")
		return
	}

	respondOK(c, gin.H{"data": customers, "total": total})
}

// GetCustomer GET /api/v1/admin/customers/:id
func GetCustomer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的顾客ID")
		return
	}

	customer, orders, err := services.GetCustomerWithOrders(uint(id))
	if err != nil {
		notFound(c, "顾客不存在")
		return
	}

	respondOK(c, gin.H{"customer": customer, "orders": orders})
}

// UpdateCustomer PUT /api/v1/admin/customers/:id
func UpdateCustomer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		badRequest(c, "无效的顾客ID")
		return
	}

	var body struct {
		Nickname string `json:"nickname"`
		Remark   string `json:"remark"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		log.Printf("UpdateCustomer 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	var customer models.Customer
	if err := models.DB.First(&customer, uint(id)).Error; err != nil {
		notFound(c, "顾客不存在")
		return
	}

	updates := map[string]any{}
	if body.Nickname != "" {
		updates["nickname"] = body.Nickname
	}
	if body.Remark != "" {
		updates["remark"] = body.Remark
	}

	if len(updates) > 0 {
		models.WriteTx(func(tx *gorm.DB) error {
			return tx.Model(&customer).Updates(updates).Error
		})
	}

	models.DB.First(&customer, uint(id))
	respondOK(c, gin.H{"message": "更新成功", "customer": customer})
}

// MergeCustomers POST /api/v1/admin/customers/merge
// 手动合并两条顾客记录，将 duplicate 合并到 primary 并软删除 duplicate
func MergeCustomers(c *gin.Context) {
	var body struct {
		PrimaryID   uint `json:"primary_id" binding:"required"`
		DuplicateID uint `json:"duplicate_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		log.Printf("MergeCustomers 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误，需要 primary_id 和 duplicate_id")
		return
	}

	if body.PrimaryID == 0 || body.DuplicateID == 0 {
		badRequest(c, "primary_id 和 duplicate_id 不能为 0")
		return
	}

	merged, err := services.MergeCustomerRecords(models.DB, body.PrimaryID, body.DuplicateID)
	if err != nil {
		log.Printf("MergeCustomers 合并失败: primary=%d duplicate=%d err=%v", body.PrimaryID, body.DuplicateID, err)
		internalError(c, "顾客合并失败，请稍后重试")
		return
	}

	// 合并后重新计算统计数据，确保准确
	_ = services.UpdateCustomerStats(merged.ID)

	// 重新读取最新数据返回
	models.DB.First(merged, merged.ID)
	respondOK(c, gin.H{"message": "顾客合并成功", "customer": merged})
}
