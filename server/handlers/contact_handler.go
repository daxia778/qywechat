package handlers

import (
	"log"

	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// CreateContactWay POST /api/v1/admin/contact_way
// 创建「联系我」二维码渠道
func CreateContactWay(c *gin.Context) {
	if !services.Wecom.IsContactConfigured() {
		badRequest(c, "客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
		return
	}

	var body struct {
		State   string   `json:"state"`
		UserIDs []string `json:"user_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		log.Printf("CreateContactWay 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	configID, qrCode, err := services.Wecom.CreateContactWay(body.State, body.UserIDs)
	if err != nil {
		log.Printf("创建联系我失败: %v", err)
		internalError(c, "创建联系我失败，请稍后重试")
		return
	}

	respondOK(c, gin.H{
		"config_id": configID,
		"qr_code":   qrCode,
	})
}

// ListContactWays GET /api/v1/admin/contact_ways
// 目前先返回空列表（企微 API 无批量查询接口，需本地存储，可后续完善）
func ListContactWays(c *gin.Context) {
	respondOK(c, gin.H{
		"items": []any{},
		"total": 0,
	})
}
