package handlers

import (
	"log"
	"net/http"

	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CheckAppVersion 检查客户端版本 (OTA更新) — 从数据库查询最新版本
func CheckAppVersion(c *gin.Context) {
	var latest models.AppVersion
	result := models.DB.Where("is_active = ?", true).Order("created_at DESC").First(&latest)
	if result.Error != nil {
		// 还没有发布过任何版本 — 返回空版本，客户端不会触发更新
		c.JSON(http.StatusOK, gin.H{
			"version":       "",
			"force_update":  false,
			"download_url":  "",
			"release_notes": "",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"version":       latest.VersionCode,
		"force_update":  latest.ForceUpdate,
		"download_url":  latest.DownloadURL,
		"release_notes": latest.ReleaseNotes,
	})
}

// CreateAppVersion 发布新版本 (仅管理员)
func CreateAppVersion(c *gin.Context) {
	var req models.AppVersion
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("CreateAppVersion 参数绑定失败: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数格式错误"})
		return
	}
	if req.VersionCode == "" || req.DownloadURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "版本号和下载链接不能为空"})
		return
	}
	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&req).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "版本发布失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": req, "message": "版本发布成功"})
}
