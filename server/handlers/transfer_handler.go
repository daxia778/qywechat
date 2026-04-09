package handlers

import (
	"fmt"
	"log"
	"strconv"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GetExternalContacts GET /admin/transfer/external-contacts?userid=xxx
// 获取员工的外部联系人列表（含详情）
func GetExternalContacts(c *gin.Context) {
	if !services.Wecom.IsContactConfigured() {
		badRequest(c, "客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
		return
	}

	userid := c.Query("userid")
	if userid == "" {
		badRequest(c, "请提供 userid 参数")
		return
	}

	externalIDs, err := services.Wecom.GetExternalContactList(userid)
	if err != nil {
		log.Printf("获取外部联系人列表失败: %v", err)
		internalError(c, "获取外部联系人列表失败")
		return
	}

	type ContactItem struct {
		ExternalUserID string `json:"external_userid"`
		Name           string `json:"name"`
		Avatar         string `json:"avatar"`
		Type           int    `json:"type"`
		Gender         int    `json:"gender"`
		CorpName       string `json:"corp_name"`
	}

	contacts := make([]ContactItem, 0, len(externalIDs))
	for _, eid := range externalIDs {
		detail, err := services.Wecom.GetExternalContactDetail(eid)
		if err != nil {
			log.Printf("获取外部联系人详情失败 eid=%s: %v", eid, err)
			contacts = append(contacts, ContactItem{ExternalUserID: eid, Name: eid})
			continue
		}

		item := ContactItem{ExternalUserID: eid}
		if extInfo, ok := detail["external_contact"].(map[string]any); ok {
			if name, ok := extInfo["name"].(string); ok {
				item.Name = name
			}
			if avatar, ok := extInfo["avatar"].(string); ok {
				item.Avatar = avatar
			}
			if t, ok := extInfo["type"].(float64); ok {
				item.Type = int(t)
			}
			if g, ok := extInfo["gender"].(float64); ok {
				item.Gender = int(g)
			}
			if corp, ok := extInfo["corp_name"].(string); ok {
				item.CorpName = corp
			}
		}
		if item.Name == "" {
			item.Name = eid
		}
		contacts = append(contacts, item)
	}

	respondOK(c, gin.H{"contacts": contacts, "total": len(contacts)})
}

// ExecuteTransfer POST /admin/transfer/execute
// 执行客户转接（在职继承）
func ExecuteTransfer(c *gin.Context) {
	if !services.Wecom.IsContactConfigured() {
		badRequest(c, "客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
		return
	}

	var body struct {
		HandoverUserID  string   `json:"handover_user_id" binding:"required"`
		TakeoverUserID  string   `json:"takeover_user_id" binding:"required"`
		ExternalUserIDs []string `json:"external_user_ids" binding:"required"`
		TransferMsg     string   `json:"transfer_msg"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		log.Printf("ExecuteTransfer 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	if len(body.ExternalUserIDs) == 0 {
		badRequest(c, "请选择要转移的客户")
		return
	}

	if body.HandoverUserID == body.TakeoverUserID {
		badRequest(c, "原跟进人和接手人不能是同一人")
		return
	}

	// 调用企微 API 执行转移
	customers, err := services.Wecom.TransferCustomer(body.HandoverUserID, body.TakeoverUserID, body.ExternalUserIDs, body.TransferMsg)
	if err != nil {
		log.Printf("执行客户转移失败: %v", err)
		internalError(c, "客户转移失败，请稍后重试")
		return
	}

	// 构建 external_userid → 客户名称映射（尽量获取）
	nameMap := make(map[string]string)
	for _, eid := range body.ExternalUserIDs {
		detail, err := services.Wecom.GetExternalContactDetail(eid)
		if err == nil {
			if extInfo, ok := detail["external_contact"].(map[string]any); ok {
				if name, ok := extInfo["name"].(string); ok {
					nameMap[eid] = name
				}
			}
		}
	}

	// 创建转接记录
	if err := models.WriteTx(func(tx *gorm.DB) error {
		for _, eid := range body.ExternalUserIDs {
			status := "pending"
			failReason := ""

			// 从企微返回结果中匹配当前客户的状态
			for _, cust := range customers {
				custEid, _ := cust["external_userid"].(string)
				if custEid == eid {
					errCode, _ := cust["errcode"].(float64)
					if int(errCode) == 0 {
						status = "waiting"
					} else {
						status = "failed"
						failReason = fmt.Sprintf("errcode=%d", int(errCode))
					}
					break
				}
			}

			record := models.CustomerTransfer{
				HandoverUserID: body.HandoverUserID,
				TakeoverUserID: body.TakeoverUserID,
				ExternalUserID: eid,
				CustomerName:   nameMap[eid],
				Status:         status,
				FailReason:     failReason,
				TransferMsg:    body.TransferMsg,
			}
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		log.Printf("保存转接记录失败: %v", err)
		// 企微 API 已经成功，只是本地记录保存失败，不影响转移结果
		log.Printf("⚠️ 转接记录持久化失败，但企微 API 调用已成功")
	}

	respondOK(c, gin.H{
		"message":   fmt.Sprintf("已提交 %d 个客户的转移请求", len(body.ExternalUserIDs)),
		"customers": customers,
	})
}

// GetTransferRecords GET /admin/transfer/records?page=1&page_size=20
// 查询客户转接记录
func GetTransferRecords(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	var total int64
	models.DB.Model(&models.CustomerTransfer{}).Count(&total)

	var records []models.CustomerTransfer
	models.DB.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&records)

	// 加载员工姓名映射
	userIDs := make(map[string]bool)
	for _, r := range records {
		userIDs[r.HandoverUserID] = true
		userIDs[r.TakeoverUserID] = true
	}
	ids := make([]string, 0, len(userIDs))
	for uid := range userIDs {
		ids = append(ids, uid)
	}

	nameMap := make(map[string]string)
	if len(ids) > 0 {
		var emps []models.Employee
		models.DB.Where("wecom_userid IN ?", ids).Find(&emps)
		for _, e := range emps {
			nameMap[e.WecomUserID] = e.Name
		}
	}

	type RecordItem struct {
		models.CustomerTransfer
		HandoverName string `json:"handover_name"`
		TakeoverName string `json:"takeover_name"`
	}

	items := make([]RecordItem, 0, len(records))
	for _, r := range records {
		item := RecordItem{CustomerTransfer: r}
		if name, ok := nameMap[r.HandoverUserID]; ok {
			item.HandoverName = name
		} else {
			item.HandoverName = r.HandoverUserID
		}
		if name, ok := nameMap[r.TakeoverUserID]; ok {
			item.TakeoverName = name
		} else {
			item.TakeoverName = r.TakeoverUserID
		}
		items = append(items, item)
	}

	respondOK(c, gin.H{"data": items, "total": total})
}

// CheckTransferStatus POST /admin/transfer/check-status
// 查询客户转移状态并更新本地记录
func CheckTransferStatus(c *gin.Context) {
	if !services.Wecom.IsContactConfigured() {
		badRequest(c, "客户联系功能未开通，请在企微后台配置 WECOM_CONTACT_SECRET")
		return
	}

	var body struct {
		HandoverUserID string `json:"handover_user_id" binding:"required"`
		TakeoverUserID string `json:"takeover_user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		log.Printf("CheckTransferStatus 参数绑定失败: %v", err)
		badRequest(c, "请求参数格式错误")
		return
	}

	customers, err := services.Wecom.GetTransferResult(body.HandoverUserID, body.TakeoverUserID)
	if err != nil {
		log.Printf("查询转移结果失败: %v", err)
		internalError(c, "查询转移结果失败，请稍后重试")
		return
	}

	// 更新本地记录
	updated := 0
	if err := models.WriteTx(func(tx *gorm.DB) error {
		for _, cust := range customers {
			eid, _ := cust["external_userid"].(string)
			statusCode, _ := cust["status"].(float64)

			var newStatus string
			switch int(statusCode) {
			case 1:
				newStatus = "waiting"
			case 2:
				newStatus = "success"
			case 3:
				newStatus = "failed"
			default:
				newStatus = "pending"
			}

			result := tx.Model(&models.CustomerTransfer{}).
				Where("handover_user_id = ? AND takeover_user_id = ? AND external_user_id = ?",
					body.HandoverUserID, body.TakeoverUserID, eid).
				Updates(map[string]any{"status": newStatus})
			if result.RowsAffected > 0 {
				updated++
			}
		}
		return nil
	}); err != nil {
		log.Printf("更新转移状态失败: %v", err)
	}

	respondOK(c, gin.H{
		"message":   fmt.Sprintf("已更新 %d 条转移记录状态", updated),
		"customers": customers,
	})
}

// ─── 自动转接规则 CRUD ──────────────────────────

// CreateTransferRule POST /admin/transfer/rules
func CreateTransferRule(c *gin.Context) {
	var body struct {
		Name           string `json:"name" binding:"required"`
		HandoverUserID string `json:"handover_user_id"`
		TakeoverUserID string `json:"takeover_user_id" binding:"required"`
		TriggerDays    int    `json:"trigger_days"`
		TransferMsg    string `json:"transfer_msg"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请求参数格式错误")
		return
	}
	if body.TriggerDays <= 0 {
		body.TriggerDays = 30
	}
	if body.HandoverUserID != "" && body.HandoverUserID == body.TakeoverUserID {
		badRequest(c, "原跟进人和接手人不能是同一人")
		return
	}

	rule := models.TransferRule{
		Name:           body.Name,
		HandoverUserID: body.HandoverUserID,
		TakeoverUserID: body.TakeoverUserID,
		TriggerDays:    body.TriggerDays,
		TransferMsg:    body.TransferMsg,
		IsActive:       true,
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Create(&rule).Error
	}); err != nil {
		log.Printf("创建自动转接规则失败: %v", err)
		internalError(c, "创建规则失败")
		return
	}

	respondOK(c, rule)
}

// ListTransferRules GET /admin/transfer/rules
func ListTransferRules(c *gin.Context) {
	var rules []models.TransferRule
	models.DB.Order("created_at DESC").Find(&rules)

	// 加载员工姓名映射
	userIDs := make(map[string]bool)
	for _, r := range rules {
		if r.HandoverUserID != "" {
			userIDs[r.HandoverUserID] = true
		}
		userIDs[r.TakeoverUserID] = true
	}
	ids := make([]string, 0, len(userIDs))
	for uid := range userIDs {
		ids = append(ids, uid)
	}

	nameMap := make(map[string]string)
	if len(ids) > 0 {
		var emps []models.Employee
		models.DB.Where("wecom_userid IN ?", ids).Find(&emps)
		for _, e := range emps {
			nameMap[e.WecomUserID] = e.Name
		}
	}

	type RuleItem struct {
		models.TransferRule
		HandoverName string `json:"handover_name"`
		TakeoverName string `json:"takeover_name"`
	}

	items := make([]RuleItem, 0, len(rules))
	for _, r := range rules {
		item := RuleItem{TransferRule: r}
		if r.HandoverUserID == "" {
			item.HandoverName = "所有跟单客服"
		} else if name, ok := nameMap[r.HandoverUserID]; ok {
			item.HandoverName = name
		} else {
			item.HandoverName = r.HandoverUserID
		}
		if name, ok := nameMap[r.TakeoverUserID]; ok {
			item.TakeoverName = name
		} else {
			item.TakeoverName = r.TakeoverUserID
		}
		items = append(items, item)
	}

	respondOK(c, gin.H{"data": items, "total": len(items)})
}

// UpdateTransferRule PUT /admin/transfer/rules/:id
func UpdateTransferRule(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		badRequest(c, "无效的规则ID")
		return
	}

	var rule models.TransferRule
	if err := models.DB.First(&rule, id).Error; err != nil {
		notFound(c, "规则不存在")
		return
	}

	var body struct {
		Name           *string `json:"name"`
		HandoverUserID *string `json:"handover_user_id"`
		TakeoverUserID *string `json:"takeover_user_id"`
		TriggerDays    *int    `json:"trigger_days"`
		TransferMsg    *string `json:"transfer_msg"`
		IsActive       *bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请求参数格式错误")
		return
	}

	updates := make(map[string]any)
	if body.Name != nil {
		updates["name"] = *body.Name
	}
	if body.HandoverUserID != nil {
		updates["handover_user_id"] = *body.HandoverUserID
	}
	if body.TakeoverUserID != nil {
		updates["takeover_user_id"] = *body.TakeoverUserID
	}
	if body.TriggerDays != nil && *body.TriggerDays > 0 {
		updates["trigger_days"] = *body.TriggerDays
	}
	if body.TransferMsg != nil {
		updates["transfer_msg"] = *body.TransferMsg
	}
	if body.IsActive != nil {
		updates["is_active"] = *body.IsActive
	}

	// 校验 handover != takeover
	handover := rule.HandoverUserID
	takeover := rule.TakeoverUserID
	if body.HandoverUserID != nil {
		handover = *body.HandoverUserID
	}
	if body.TakeoverUserID != nil {
		takeover = *body.TakeoverUserID
	}
	if handover != "" && handover == takeover {
		badRequest(c, "原跟进人和接手人不能是同一人")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&rule).Updates(updates).Error
	}); err != nil {
		log.Printf("更新自动转接规则失败: %v", err)
		internalError(c, "更新规则失败")
		return
	}

	models.DB.First(&rule, id)
	respondOK(c, rule)
}

// DeleteTransferRule DELETE /admin/transfer/rules/:id
func DeleteTransferRule(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		badRequest(c, "无效的规则ID")
		return
	}

	if err := models.WriteTx(func(tx *gorm.DB) error {
		result := tx.Delete(&models.TransferRule{}, id)
		if result.RowsAffected == 0 {
			return fmt.Errorf("not found")
		}
		return result.Error
	}); err != nil {
		if err.Error() == "not found" {
			notFound(c, "规则不存在")
			return
		}
		log.Printf("删除自动转接规则失败: %v", err)
		internalError(c, "删除规则失败")
		return
	}

	respondMessage(c, "规则已删除")
}
