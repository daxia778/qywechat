package services

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"
)

// ─── 审计播报服务 ──────────────────────────────────────
// 将跟单客服的关键操作自动推送到「跟单运营监控群」，
// 实现操作留痕和透明化监控。

// AuditEventType 审计事件类型
type AuditEventType string

const (
	AuditOrderAssigned      AuditEventType = "order_assigned"      // 新单分配
	AuditStatusChanged      AuditEventType = "status_changed"      // 状态变更
	AuditAmountChanged      AuditEventType = "amount_changed"      // 金额修改
	AuditRefundProcessed    AuditEventType = "refund_processed"    // 退款操作
	AuditDesignerAssigned   AuditEventType = "designer_assigned"   // 关联设计师
	AuditDesignerReassigned AuditEventType = "designer_reassigned" // 换设计师
	AuditCommissionAdjusted AuditEventType = "commission_adjusted" // 佣金调整
	AuditGroupCreated       AuditEventType = "group_created"       // 建群
)

// AuditEvent 审计事件
type AuditEvent struct {
	Type         AuditEventType
	OrderSN      string
	OrderID      uint
	OperatorID   string // 操作人企微 UserID
	OperatorName string // 操作人姓名
	OperatorRole string // 操作人角色
	OldValue     string // 修改前的值
	NewValue     string // 修改后的值
	Extra        map[string]string // 附加信息
}

var (
	auditChatID   string
	auditInitOnce sync.Once
	auditReady    bool
)

// InitAuditGroup 启动时初始化审计监控群
// 如果配置了 WECOM_AUDIT_CHAT_ID 则直接使用，否则尝试自动创建群
func InitAuditGroup() {
	auditInitOnce.Do(func() {
		if !Wecom.IsConfigured() {
			log.Println("⚠️ 企微未配置，审计播报服务跳过初始化")
			return
		}

		if config.C.WecomAuditChatID != "" {
			auditChatID = config.C.WecomAuditChatID
			auditReady = true
			log.Printf("✅ 审计监控群已就绪 | ChatID=%s", auditChatID)
			return
		}

		// 尝试自动创建监控群
		log.Println("⚠️ WECOM_AUDIT_CHAT_ID 未配置，尝试自动创建监控群...")
		chatID, err := createAuditGroup()
		if err != nil {
			log.Printf("❌ 自动创建审计监控群失败: %v", err)
			log.Println("💡 请手动在企微创建群聊，将 ChatID 填入 .env 的 WECOM_AUDIT_CHAT_ID")
			return
		}
		auditChatID = chatID
		auditReady = true
		log.Printf("✅ 审计监控群已自动创建 | ChatID=%s", auditChatID)
		log.Printf("📋 请将以下内容添加到 .env 文件: WECOM_AUDIT_CHAT_ID=%s", auditChatID)
	})
}

// createAuditGroup 自动创建审计监控群
func createAuditGroup() (string, error) {
	// 获取所有 admin + follow 角色员工的企微 UserID
	var employees []models.Employee
	models.DB.Where("role IN ? AND is_active = ? AND wecom_userid != ''",
		[]string{"admin", "follow"}, true).Find(&employees)

	if len(employees) < 2 {
		return "", fmt.Errorf("至少需要 2 名员工才能建群 (当前 admin+follow 人数: %d)", len(employees))
	}

	memberIDs := make([]string, 0, len(employees))
	for _, e := range employees {
		memberIDs = append(memberIDs, e.WecomUserID)
	}

	// 通过企微 API 创建群聊
	chatID, err := Wecom.CreateGroupChat(
		"跟单运营监控群",
		memberIDs[0], // 群主为第一个 admin
		memberIDs,
	)
	if err != nil {
		return "", err
	}

	// 保存群聊快照
	SaveGroupChatSnapshot(chatID, "跟单运营监控群", memberIDs[0], memberIDs, "")

	// 发送欢迎消息
	welcomeMsg := "🛡️ 跟单运营监控群已创建\n━━━━━━━━━━━━━━━━━\n本群由系统自动管理，跟单客服的所有关键操作将在此群自动播报。\n\n📋 播报范围:\n• 订单状态变更\n• 金额修改\n• 退款操作\n• 设计师关联/更换\n• 佣金调整\n━━━━━━━━━━━━━━━━━\n⚠️ 请勿退出此群"
	if err := Wecom.SendGroupMessage(chatID, welcomeMsg); err != nil {
		log.Printf("⚠️ 发送审计群欢迎消息失败: %v", err)
	}

	return chatID, nil
}

// BroadcastAuditEvent 向审计监控群推送操作事件
// 异步调用，不阻塞业务逻辑
// 会检查 AuditConfig 中的开关、事件类型和监控对象配置
func BroadcastAuditEvent(event AuditEvent) {
	if !auditReady || auditChatID == "" {
		return
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[AuditBroadcast] panic recovered: %v", r)
			}
		}()

		// 检查 AuditConfig 配置
		cfg := models.GetAuditConfig()
		if !cfg.BroadcastEnabled {
			return // 总开关关闭
		}
		if !cfg.IsEventEnabled(string(event.Type)) {
			return // 该事件类型关闭
		}
		if event.OperatorID != "" && !cfg.IsStaffMonitored(event.OperatorID) {
			return // 该操作人不在监控名单
		}

		msg := formatAuditMessage(event)
		if msg == "" {
			return
		}

		if err := Wecom.SendGroupMessage(auditChatID, msg); err != nil {
			log.Printf("⚠️ 审计播报失败: type=%s sn=%s err=%v", event.Type, event.OrderSN, err)
			return
		}

		// 记录消息日志
		SaveMessageLog(auditChatID, "system", "text", msg, event.OrderSN, "out")
	}()
}

// ─── 消息格式化 ──────────────────────────────────────

func formatAuditMessage(e AuditEvent) string {
	ts := time.Now().Format("15:04:05")
	sep := "━━━━━━━━━━━━━━━━━"

	switch e.Type {
	case AuditOrderAssigned:
		price := e.Extra["price"]
		customer := e.Extra["customer"]
		return fmt.Sprintf("📦 新单分配\n%s\n⏰ %s\n📋 订单: %s\n💰 金额: %s\n👤 客户: %s\n👨‍💼 跟单: %s\n%s",
			sep, ts, e.OrderSN, price, customer, e.OperatorName, sep)

	case AuditStatusChanged:
		statusNames := map[string]string{
			"PENDING":    "待处理",
			"DESIGNING":  "设计中",
			"COMPLETED":  "已完成",
			"REFUNDED":   "已退款",
			"REVISION":   "修改中",
			"AFTER_SALE": "售后中",
		}
		oldName := statusNames[e.OldValue]
		if oldName == "" {
			oldName = e.OldValue
		}
		newName := statusNames[e.NewValue]
		if newName == "" {
			newName = e.NewValue
		}
		return fmt.Sprintf("🔄 状态变更\n%s\n⏰ %s\n📋 订单: %s\n📊 %s → %s\n👨‍💼 操作人: %s\n%s",
			sep, ts, e.OrderSN, oldName, newName, e.OperatorName, sep)

	case AuditAmountChanged:
		reason := e.Extra["reason"]
		dropPct := e.Extra["drop_pct"]
		warning := ""
		if dropPct != "" && dropPct != "0" {
			warning = fmt.Sprintf("\n⚠️ 降幅: %s%%", dropPct)
		}
		return fmt.Sprintf("⚠️ 金额修改\n%s\n⏰ %s\n📋 订单: %s\n💰 ¥%s → ¥%s%s\n📝 原因: %s\n👨‍💼 操作人: %s\n%s",
			sep, ts, e.OrderSN, e.OldValue, e.NewValue, warning, reason, e.OperatorName, sep)

	case AuditRefundProcessed:
		reason := e.Extra["reason"]
		amount := e.Extra["amount"]
		return fmt.Sprintf("🔴 退款操作\n%s\n⏰ %s\n📋 订单: %s\n💰 退款金额: ¥%s\n📝 原因: %s\n👨‍💼 操作人: %s\n%s",
			sep, ts, e.OrderSN, amount, reason, e.OperatorName, sep)

	case AuditDesignerAssigned:
		designerName := e.Extra["designer_name"]
		return fmt.Sprintf("👨‍🎨 关联设计师\n%s\n⏰ %s\n📋 订单: %s\n🎨 设计师: %s\n👨‍💼 操作人: %s\n%s",
			sep, ts, e.OrderSN, designerName, e.OperatorName, sep)

	case AuditDesignerReassigned:
		return fmt.Sprintf("🔄 更换设计师\n%s\n⏰ %s\n📋 订单: %s\n🎨 %s → %s\n👨‍💼 操作人: %s\n%s",
			sep, ts, e.OrderSN, e.OldValue, e.NewValue, e.OperatorName, sep)

	case AuditCommissionAdjusted:
		return fmt.Sprintf("💰 佣金调整\n%s\n⏰ %s\n📋 订单: %s\n💵 ¥%s → ¥%s\n👨‍💼 操作人: %s\n%s",
			sep, ts, e.OrderSN, e.OldValue, e.NewValue, e.OperatorName, sep)

	case AuditGroupCreated:
		groupName := e.Extra["group_name"]
		members := e.Extra["members"]
		return fmt.Sprintf("💬 订单建群\n%s\n⏰ %s\n📋 订单: %s\n🏠 群名: %s\n👥 成员: %s\n%s",
			sep, ts, e.OrderSN, groupName, members, sep)

	default:
		return ""
	}
}

// ─── 辅助函数 ──────────────────────────────────────

// GetAuditChatID 返回审计群 ChatID（供外部查询）
func GetAuditChatID() string {
	return auditChatID
}

// IsAuditReady 返回审计服务是否就绪
func IsAuditReady() bool {
	return auditReady
}

// FormatPrice 格式化金额（分→元）
func FormatPrice(priceFen int) string {
	return fmt.Sprintf("%.2f", float64(priceFen)/100)
}

// BuildOperatorInfo 从员工信息构建操作人名字
func BuildOperatorInfo(uid string) string {
	if uid == "" {
		return "系统"
	}
	var emp models.Employee
	if models.DB.Where("wecom_userid = ?", uid).First(&emp).Error == nil {
		parts := []string{emp.Name}
		if emp.Role != "" {
			roleNames := map[string]string{
				"admin":  "管理员",
				"follow": "跟单",
				"sales":  "谈单",
			}
			if rn, ok := roleNames[emp.Role]; ok {
				parts = append(parts, "("+rn+")")
			}
		}
		return strings.Join(parts, "")
	}
	return uid
}
