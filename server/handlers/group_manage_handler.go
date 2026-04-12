package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"pdd-order-system/models"
	"pdd-order-system/services"

	"github.com/gin-gonic/gin"
)

// ─── 群聊管理 ──────────────────────────────────

// GetGroupChatDetail 获取群聊详情（从企微 API 实时获取）
// 如果成员是外部联系人且在设计师花名册中，会附加 is_designer 标识
func GetGroupChatDetail(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "缺少 chat_id")
		return
	}

	if !services.Wecom.IsConfigured() {
		badRequest(c, "企微未配置")
		return
	}

	// 从企微 API 获取群详情
	detail, err := services.Wecom.GetGroupChatInfo(chatID)
	if err != nil {
		log.Printf("获取群聊详情失败: chat_id=%s err=%v", chatID, err)
		internalError(c, "获取群聊详情失败: "+err.Error())
		return
	}

	// 获取兼职设计师名单用于匹配
	var designers []models.FreelanceDesigner
	models.DB.Find(&designers)

	// 尝试增强 detail 中的成员列表，标记设计师
	if chatInfo, ok := detail["chat_info"].(map[string]any); ok {
		if memberList, ok := chatInfo["member_list"].([]any); ok {
			for i, member := range memberList {
				mMap, isMap := member.(map[string]any)
				if !isMap {
					continue
				}
				
				// 获取可能的名字或 external_user_id
				// 注意：/appchat/get 的 member_list 里只有 userid
				// 如果是正常群聊 API 可能会有 name / external_userid
				userid, _ := mMap["userid"].(string)
				
				isDesigner := false
				for _, d := range designers {
					if d.ExternalUserID != "" && d.ExternalUserID == userid {
						isDesigner = true
						break
					}
					if d.WechatID != "" && d.WechatID == userid {
						isDesigner = true
						break
					}
				}
				if isDesigner {
					mMap["is_designer"] = true
					memberList[i] = mMap
				}
			}
			chatInfo["member_list"] = memberList
		}
	}

	// 同时返回本地数据库中的关联信息
	var localGroup models.WecomGroupChat
	models.DB.Where("chat_id = ?", chatID).First(&localGroup)

	respondOK(c, gin.H{
		"wecom_detail": detail,
		"local_data":   localGroup,
	})
}

// UpdateGroupMembers 添加/移除群成员
// POST /api/v1/admin/wecom/groups/:chat_id/members
// Body: { "add_users": ["user1", "user2"], "del_users": ["user3"] }
func UpdateGroupMembers(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "缺少 chat_id")
		return
	}

	var body struct {
		AddUsers []string `json:"add_users"`
		DelUsers []string `json:"del_users"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请求参数格式错误")
		return
	}

	if len(body.AddUsers) == 0 && len(body.DelUsers) == 0 {
		badRequest(c, "请至少指定要添加或移除的成员")
		return
	}

	if !services.Wecom.IsConfigured() {
		badRequest(c, "企微未配置")
		return
	}

	// 调用企微 API
	if err := services.Wecom.UpdateGroupChat(chatID, "", body.AddUsers, body.DelUsers); err != nil {
		log.Printf("更新群成员失败: chat_id=%s err=%v", chatID, err)
		internalError(c, "更新群成员失败: "+err.Error())
		return
	}

	// 更新本地快照
	var localGroup models.WecomGroupChat
	if models.DB.Where("chat_id = ?", chatID).First(&localGroup).Error == nil {
		// 更新成员列表
		currentMembers := strings.Split(localGroup.MemberIDs, ",")
		memberSet := make(map[string]bool)
		for _, m := range currentMembers {
			if m != "" {
				memberSet[m] = true
			}
		}
		for _, u := range body.AddUsers {
			memberSet[u] = true
		}
		for _, u := range body.DelUsers {
			delete(memberSet, u)
		}
		newMembers := make([]string, 0, len(memberSet))
		for m := range memberSet {
			newMembers = append(newMembers, m)
		}
		models.DB.Model(&localGroup).Update("member_ids", strings.Join(newMembers, ","))
	}

	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	respondOK(c, gin.H{
		"message":    "群成员更新成功",
		"chat_id":    chatID,
		"added":      body.AddUsers,
		"removed":    body.DelUsers,
		"operator":   operatorName,
	})
}

// RenameGroupChat 重命名群聊
// PUT /api/v1/admin/wecom/groups/:chat_id/rename
// Body: { "name": "新群名" }
func RenameGroupChat(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "缺少 chat_id")
		return
	}

	var body struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供新的群名称")
		return
	}

	if !services.Wecom.IsConfigured() {
		badRequest(c, "企微未配置")
		return
	}

	if err := services.Wecom.UpdateGroupChat(chatID, body.Name, nil, nil); err != nil {
		log.Printf("重命名群聊失败: chat_id=%s err=%v", chatID, err)
		internalError(c, "重命名失败: "+err.Error())
		return
	}

	// 更新本地快照
	models.DB.Model(&models.WecomGroupChat{}).Where("chat_id = ?", chatID).Update("name", body.Name)

	respondOK(c, gin.H{"message": "群名已更新", "chat_id": chatID, "name": body.Name})
}

// ─── 会话存档查看 ──────────────────────────────────

// GetArchiveMessages 获取指定群聊的存档消息（分页）
// GET /api/v1/admin/wecom/groups/:chat_id/archive?limit=50&offset=0&order=asc
func GetArchiveMessages(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "缺少 chat_id")
		return
	}

	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	order := c.DefaultQuery("order", "asc") // asc=正序(旧→新), desc=倒序

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	orderClause := "msg_time ASC"
	if order == "desc" {
		orderClause = "msg_time DESC"
	}

	// 查询消息
	var messages []models.ChatArchiveMessage
	var total int64

	query := models.DB.Model(&models.ChatArchiveMessage{}).Where("chat_id = ?", chatID)
	query.Count(&total)
	query.Order(orderClause).Offset(offset).Limit(limit).Find(&messages)

	// 获取兼职设计师名单用于匹配
	var designers []models.FreelanceDesigner
	models.DB.Find(&designers)

	// 后处理：标记每条消息发送方是否兼职设计师
	for i := range messages {
		isDesigner := false
		for _, d := range designers {
			if d.ExternalUserID != "" && d.ExternalUserID == messages[i].SenderID {
				isDesigner = true
				break
			}
			if d.Name != "" && strings.Contains(messages[i].SenderName, d.Name) {
				isDesigner = true
				break
			}
		}
		messages[i].IsDesigner = isDesigner
	}

	// 查找群聊基本信息
	var group models.WecomGroupChat
	models.DB.Where("chat_id = ?", chatID).First(&group)

	respondOK(c, gin.H{
		"chat_id":    chatID,
		"group_name": group.Name,
		"order_sn":   group.OrderSN,
		"total":      total,
		"messages":   messages,
	})
}

// ListArchivedGroups 列出有存档消息的群聊列表
// GET /api/v1/admin/wecom/archive/groups?keyword=xxx
func ListArchivedGroups(c *gin.Context) {
	keyword := c.Query("keyword")

	// 从 WecomGroupChat 表获取所有群聊
	query := models.DB.Model(&models.WecomGroupChat{}).Where("status = ?", "active")
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR order_sn LIKE ? OR chat_id LIKE ?", like, like, like)
	}

	var groups []models.WecomGroupChat
	query.Order("created_at DESC").Find(&groups)

	// 为每个群聊统计存档消息数量和最近消息时间
	type GroupWithStats struct {
		models.WecomGroupChat
		ArchiveCount     int64  `json:"archive_count"`
		LastMessageTime  string `json:"last_message_time,omitempty"`
		LastMessagePreview string `json:"last_message_preview,omitempty"`
	}

	result := make([]GroupWithStats, 0, len(groups))
	for _, g := range groups {
		item := GroupWithStats{WecomGroupChat: g}

		models.DB.Model(&models.ChatArchiveMessage{}).Where("chat_id = ?", g.ChatID).Count(&item.ArchiveCount)

		// 最近一条消息
		var lastMsg models.ChatArchiveMessage
		if models.DB.Where("chat_id = ?", g.ChatID).Order("msg_time DESC").First(&lastMsg).Error == nil {
			item.LastMessageTime = lastMsg.MsgTime.Format("2006-01-02 15:04:05")
			preview := lastMsg.Content
			if len([]rune(preview)) > 30 {
				preview = string([]rune(preview)[:30]) + "..."
			}
			item.LastMessagePreview = lastMsg.SenderName + ": " + preview
		}

		result = append(result, item)
	}

	respondOK(c, gin.H{"data": result, "total": len(result)})
}

// ─── 群聊关联订单 ──────────────────────────────────

// AssociateGroupToOrder 将群聊关联到订单
// POST /api/v1/admin/wecom/groups/:chat_id/associate
// Body: { "order_id": 123 }
func AssociateGroupToOrder(c *gin.Context) {
	chatID := c.Param("chat_id")
	if chatID == "" {
		badRequest(c, "缺少 chat_id")
		return
	}

	var body struct {
		OrderID uint `json:"order_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供要关联的订单 ID")
		return
	}

	// 查找订单
	var order models.Order
	if err := models.DB.First(&order, body.OrderID).Error; err != nil {
		notFound(c, "订单不存在")
		return
	}

	// 检查订单是否已有群聊
	if order.WecomChatID != "" && order.WecomChatID != chatID {
		badRequest(c, "该订单已关联其他群聊: "+order.WecomChatID)
		return
	}

	// 更新订单的群聊 ID
	if err := models.DB.Model(&order).Update("wecom_chat_id", chatID).Error; err != nil {
		internalError(c, "关联失败")
		return
	}

	// 更新群聊快照的订单号
	models.DB.Model(&models.WecomGroupChat{}).Where("chat_id = ?", chatID).Update("order_sn", order.OrderSN)

	// 获取操作人信息
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}
	uidStr := ""
	if uid, exists := c.Get("wecom_userid"); exists {
		uidStr, _ = uid.(string)
	}

	// 写入时间线
	models.DB.Create(&models.OrderTimeline{
		OrderID:      order.ID,
		EventType:    "group_associated",
		OperatorID:   uidStr,
		OperatorName: operatorName,
		Remark:       "手动关联群聊: " + chatID,
	})

	respondOK(c, gin.H{
		"message":  "群聊已关联到订单",
		"chat_id":  chatID,
		"order_id": body.OrderID,
		"order_sn": order.OrderSN,
	})
}

// GetArchiveMediaFile 获取存档媒体文件（图片等）
// GET /api/v1/admin/wecom/archive/media/*filepath
func GetArchiveMediaFile(c *gin.Context) {
	fp := c.Param("filepath")
	if fp == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少文件路径"})
		return
	}

	// 安全校验：确保路径在 uploads/archive/ 下
	cleaned := strings.TrimPrefix(fp, "/")
	if strings.Contains(cleaned, "..") {
		c.JSON(http.StatusForbidden, gin.H{"error": "非法路径"})
		return
	}

	target := "uploads/archive/" + cleaned
	c.File(target)
}

// ─── 自定义建群 ──────────────────────────────────

// CreateCustomGroup 管理员自定义建群
// POST /api/v1/admin/wecom/groups/create
// Body: { "member_ids": ["userid1", "userid2"], "order_id": 123 (可选) }
func CreateCustomGroup(c *gin.Context) {
	var body struct {
		MemberIDs []string `json:"member_ids" binding:"required"`
		OrderID   uint     `json:"order_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "请提供群成员列表 member_ids")
		return
	}

	if len(body.MemberIDs) < 2 {
		badRequest(c, "至少选择 2 名群成员")
		return
	}

	if !services.Wecom.IsConfigured() {
		badRequest(c, "企微未配置")
		return
	}

	// 获取操作人信息
	operatorUID := ""
	if uid, exists := c.Get("wecom_userid"); exists {
		operatorUID, _ = uid.(string)
	}
	operatorName := ""
	if name, exists := c.Get("name"); exists {
		operatorName, _ = name.(string)
	}

	// 确保操作人在群成员列表中（仅当操作人是真实企微成员时）
	if operatorUID != "" {
		var memberExists int64
		models.DB.Model(&models.WecomMember{}).Where("userid = ?", operatorUID).Count(&memberExists)
		if memberExists > 0 {
			found := false
			for _, id := range body.MemberIDs {
				if id == operatorUID {
					found = true
					break
				}
			}
			if !found {
				body.MemberIDs = append(body.MemberIDs, operatorUID)
			}
		}
	}

	// 自动编号群名：订单信息跟进群-1, -2, ...
	var existingCount int64
	models.DB.Model(&models.WecomGroupChat{}).Where("name LIKE ?", "订单信息跟进群-%").Count(&existingCount)
	groupName := fmt.Sprintf("订单信息跟进群-%d", existingCount+1)

	// 选定群主：第一个成员（确保是真实企微用户）
	ownerID := body.MemberIDs[0]

	log.Printf("自定义建群请求 | owner=%s | members=%v | operator=%s", ownerID, body.MemberIDs, operatorUID)

	// 创建群聊
	chatID, err := services.Wecom.CreateGroupChat(groupName, ownerID, body.MemberIDs)
	if err != nil {
		log.Printf("自定义建群失败: err=%v", err)
		internalError(c, "建群失败: "+err.Error())
		return
	}
	if chatID == "" {
		internalError(c, "建群返回空 chatID")
		return
	}

	// 关联订单（可选）
	orderSN := ""
	if body.OrderID > 0 {
		var order models.Order
		if err := models.DB.First(&order, body.OrderID).Error; err == nil {
			orderSN = order.OrderSN
			models.DB.Model(&order).Update("wecom_chat_id", chatID)
			// 写时间线
			models.DB.Create(&models.OrderTimeline{
				OrderID:      order.ID,
				EventType:    "group_created",
				OperatorID:   operatorUID,
				OperatorName: operatorName,
				Remark:       fmt.Sprintf("管理员手动建群: %s", groupName),
			})
		}
	}

	// 保存群聊快照
	services.SaveGroupChatSnapshot(chatID, groupName, ownerID, body.MemberIDs, orderSN)

	// 发一条欢迎播报
	welcome := fmt.Sprintf("# 📋 %s\n\n由 **%s** 创建", groupName, operatorName)
	if orderSN != "" {
		welcome += fmt.Sprintf("\n关联订单: `%s`", orderSN)
	}
	welcome += "\n\n> 请在群内沟通订单跟进事宜"
	_ = services.Wecom.SendGroupMarkdownMessage(chatID, welcome)
	services.SaveMessageLog(chatID, "system", "markdown", welcome, orderSN, "out")

	log.Printf("✅ 管理员手动建群成功 | name=%s | chatid=%s | members=%d | operator=%s",
		groupName, chatID, len(body.MemberIDs), operatorName)

	respondOK(c, gin.H{
		"message":  "建群成功",
		"chat_id":  chatID,
		"name":     groupName,
		"members":  len(body.MemberIDs),
		"order_sn": orderSN,
	})
}
