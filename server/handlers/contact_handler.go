package handlers

import (
	"net/http"

	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// CreateContactWay POST /api/v1/admin/contact_way
// 创建「联系我」二维码渠道
func CreateContactWay(c *gin.Context) {
	if !services.Wecom.IsContactConfigured() {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET",
		})
		return
	}

	var body struct {
		State   string   `json:"state"`
		UserIDs []string `json:"user_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}

	configID, qrCode, err := services.Wecom.CreateContactWay(body.State, body.UserIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建联系我失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"config_id": configID,
		"qr_code":   qrCode,
	})
}

// ListContactWays GET /api/v1/admin/contact_ways
// 目前先返回空列表（企微 API 无批量查询接口，需本地存储，可后续完善）
func ListContactWays(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"items": []any{},
		"total": 0,
	})
}
