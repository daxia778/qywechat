package handlers

import (
	"net/http"

	"pdd-order-system/models"

	"github.com/gin-gonic/gin"
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误: " + err.Error()})
		return
	}
	if req.VersionCode == "" || req.DownloadURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "版本号和下载链接不能为空"})
		return
	}
	models.DB.Create(&req)
	c.JSON(http.StatusOK, gin.H{"data": req, "message": "版本发布成功"})
}
