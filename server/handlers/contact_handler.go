package handlers

import (
	"encoding/json"
	"log"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

	// 获取创建者 ID
	creatorID := ""
	if v, exists := c.Get("wecom_userid"); exists {
		creatorID, _ = v.(string)
	}

	// 序列化 user_ids
	userIDsJSON, _ := json.Marshal(body.UserIDs)

	// 持久化到本地数据库
	record := models.ContactWay{
		ConfigID:  configID,
		QRCode:    qrCode,
		State:     body.State,
		UserIDs:   string(userIDsJSON),
		CreatorID: creatorID,
	}
	if dbErr := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&record).Error
	}); dbErr != nil {
		log.Printf("⚠️ 联系我记录持久化失败 (企微已创建): %v", dbErr)
	}

	respondOK(c, gin.H{
		"config_id": configID,
		"qr_code":   qrCode,
	})
}

// ListContactWays GET /api/v1/admin/contact_ways
// 返回本地存储的联系我记录列表
func ListContactWays(c *gin.Context) {
	var records []models.ContactWay
	if err := models.DB.Order("created_at DESC").Find(&records).Error; err != nil {
		log.Printf("查询联系我列表失败: %v", err)
		internalError(c, "查询失败")
		return
	}

	// 解析 user_ids JSON，补充员工姓名
	type ContactWayItem struct {
		models.ContactWay
		UserNames []string `json:"user_names"`
	}

	// 批量查询所有相关员工
	empMap := make(map[string]string)
	var allUserIDs []string
	for _, r := range records {
		var ids []string
		if json.Unmarshal([]byte(r.UserIDs), &ids) == nil {
			allUserIDs = append(allUserIDs, ids...)
		}
	}
	if len(allUserIDs) > 0 {
		var emps []models.Employee
		models.DB.Where("wecom_userid IN ?", allUserIDs).Find(&emps)
		for _, e := range emps {
			empMap[e.WecomUserID] = e.Name
		}
	}

	items := make([]ContactWayItem, 0, len(records))
	for _, r := range records {
		item := ContactWayItem{ContactWay: r}
		var ids []string
		if json.Unmarshal([]byte(r.UserIDs), &ids) == nil {
			for _, uid := range ids {
				if name, ok := empMap[uid]; ok {
					item.UserNames = append(item.UserNames, name)
				} else {
					item.UserNames = append(item.UserNames, uid)
				}
			}
		}
		items = append(items, item)
	}

	respondOK(c, gin.H{
		"items": items,
		"total": len(items),
	})
}
