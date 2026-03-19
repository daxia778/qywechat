package handlers

import (
	"net/http"
	"strconv"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": customers, "total": total})
}

// GetCustomer GET /api/v1/admin/customers/:id
func GetCustomer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的顾客ID"})
		return
	}

	customer, orders, err := services.GetCustomerWithOrders(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"customer": customer, "orders": orders})
}

// UpdateCustomer PUT /api/v1/admin/customers/:id
func UpdateCustomer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的顾客ID"})
		return
	}

	var body struct {
		Nickname string `json:"nickname"`
		Remark   string `json:"remark"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	var customer models.Customer
	if err := models.DB.First(&customer, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "顾客不存在"})
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
		models.DB.Model(&customer).Updates(updates)
	}

	models.DB.First(&customer, uint(id))
	c.JSON(http.StatusOK, gin.H{"message": "更新成功", "customer": customer})
}
