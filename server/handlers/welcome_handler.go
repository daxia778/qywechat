package handlers

import (
	"log"

	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ListWelcomeTemplates 获取欢迎语模板列表
func ListWelcomeTemplates(c *gin.Context) {
	var templates []models.WelcomeTemplate
	query := models.DB.Order("is_default DESC, created_at DESC")

	if active := c.Query("active"); active == "true" {
		query = query.Where("is_active = ?", true)
	}

	if err := query.Find(&templates).Error; err != nil {
		internalError(c, "查询欢迎语模板失败")
		return
	}
	respondOK(c, templates)
}

// CreateWelcomeTemplate 创建欢迎语模板
func CreateWelcomeTemplate(c *gin.Context) {
	var req struct {
		Name            string `json:"name" binding:"required"`
		Content         string `json:"content" binding:"required"`
		AttachmentType  string `json:"attachment_type"`
		AttachmentURL   string `json:"attachment_url"`
		LinkTitle       string `json:"link_title"`
		LinkDesc        string `json:"link_desc"`
		LinkPicURL      string `json:"link_pic_url"`
		ContactWayState string `json:"contact_way_state"`
		IsDefault       bool   `json:"is_default"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误: "+err.Error())
		return
	}

	tmpl := models.WelcomeTemplate{
		Name:            req.Name,
		Content:         req.Content,
		AttachmentType:  req.AttachmentType,
		AttachmentURL:   req.AttachmentURL,
		LinkTitle:       req.LinkTitle,
		LinkDesc:        req.LinkDesc,
		LinkPicURL:      req.LinkPicURL,
		ContactWayState: req.ContactWayState,
		IsDefault:       req.IsDefault,
		IsActive:        true,
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		if req.IsDefault {
			tx.Model(&models.WelcomeTemplate{}).Where("is_default = ?", true).Update("is_default", false)
		}
		return tx.Create(&tmpl).Error
	}); err != nil {
		internalError(c, "创建欢迎语模板失败")
		return
	}

	log.Printf("✅ 创建欢迎语模板 | id=%d | name=%s", tmpl.ID, tmpl.Name)
	respondOK(c, tmpl)
}

// UpdateWelcomeTemplate 更新欢迎语模板
func UpdateWelcomeTemplate(c *gin.Context) {
	id := c.Param("id")
	var tmpl models.WelcomeTemplate
	if err := models.DB.First(&tmpl, id).Error; err != nil {
		notFound(c, "模板不存在")
		return
	}

	var req struct {
		Name            *string `json:"name"`
		Content         *string `json:"content"`
		AttachmentType  *string `json:"attachment_type"`
		AttachmentURL   *string `json:"attachment_url"`
		LinkTitle       *string `json:"link_title"`
		LinkDesc        *string `json:"link_desc"`
		LinkPicURL      *string `json:"link_pic_url"`
		ContactWayState *string `json:"contact_way_state"`
		IsDefault       *bool   `json:"is_default"`
		IsActive        *bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, "参数错误: "+err.Error())
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		updates := map[string]any{}
		if req.Name != nil {
			updates["name"] = *req.Name
		}
		if req.Content != nil {
			updates["content"] = *req.Content
		}
		if req.AttachmentType != nil {
			updates["attachment_type"] = *req.AttachmentType
		}
		if req.AttachmentURL != nil {
			updates["attachment_url"] = *req.AttachmentURL
		}
		if req.LinkTitle != nil {
			updates["link_title"] = *req.LinkTitle
		}
		if req.LinkDesc != nil {
			updates["link_desc"] = *req.LinkDesc
		}
		if req.LinkPicURL != nil {
			updates["link_pic_url"] = *req.LinkPicURL
		}
		if req.ContactWayState != nil {
			updates["contact_way_state"] = *req.ContactWayState
		}
		if req.IsDefault != nil {
			if *req.IsDefault {
				tx.Model(&models.WelcomeTemplate{}).Where("is_default = ? AND id != ?", true, tmpl.ID).Update("is_default", false)
			}
			updates["is_default"] = *req.IsDefault
		}
		if req.IsActive != nil {
			updates["is_active"] = *req.IsActive
		}
		if len(updates) == 0 {
			return nil
		}
		return tx.Model(&tmpl).Updates(updates).Error
	}); err != nil {
		internalError(c, "更新模板失败")
		return
	}

	models.DB.First(&tmpl, id)
	respondOK(c, tmpl)
}

// DeleteWelcomeTemplate 删除欢迎语模板
func DeleteWelcomeTemplate(c *gin.Context) {
	id := c.Param("id")
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Delete(&models.WelcomeTemplate{}, id).Error
	}); err != nil {
		internalError(c, "删除模板失败")
		return
	}
	respondMessage(c, "模板已删除")
}
