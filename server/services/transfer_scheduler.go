package services

import (
	"context"
	"fmt"
	"log"
	"time"

	"pdd-order-system/models"

	"gorm.io/gorm"
)

const transferCheckInterval = 6 * time.Hour

// StartTransferScheduler 启动自动转接调度器
func StartTransferScheduler(ctx context.Context) {
	log.Printf("✅ 自动转接调度器已启动 (间隔 %v)", transferCheckInterval)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[TransferScheduler] panic recovered: %v", r)
			}
		}()

		// 启动 60 秒后首次检查（等企微客户端初始化完成）
		select {
		case <-ctx.Done():
			return
		case <-time.After(60 * time.Second):
		}
		runTransferRules()

		ticker := time.NewTicker(transferCheckInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("自动转接调度器已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("[TransferScheduler] tick panic recovered: %v", r)
						}
					}()
					runTransferRules()
				}()
			}
		}
	}()
}

// runTransferRules 执行所有活跃的自动转接规则
func runTransferRules() {
	if !Wecom.IsContactConfigured() {
		return
	}

	var rules []models.TransferRule
	models.DB.Where("is_active = ?", true).Find(&rules)
	if len(rules) == 0 {
		return
	}

	log.Printf("[TransferScheduler] 开始检查 %d 条活跃规则", len(rules))

	for _, rule := range rules {
		executeTransferRule(rule)
	}
}

// executeTransferRule 执行单条自动转接规则
func executeTransferRule(rule models.TransferRule) {
	// 确定要检查的跟进人列表
	var handoverUserIDs []string
	if rule.HandoverUserID != "" {
		handoverUserIDs = []string{rule.HandoverUserID}
	} else {
		// 空=所有跟单客服
		var employees []models.Employee
		models.DB.Where("role IN ? AND is_active = ? AND wecom_userid != ''", []string{"sales", "follow"}, true).Find(&employees)
		for _, e := range employees {
			handoverUserIDs = append(handoverUserIDs, e.WecomUserID)
		}
	}

	if len(handoverUserIDs) == 0 {
		return
	}

	threshold := time.Duration(rule.TriggerDays) * 24 * time.Hour
	now := time.Now()
	transferred := 0

	for _, handoverUID := range handoverUserIDs {
		if handoverUID == rule.TakeoverUserID {
			continue
		}

		externalIDs, err := Wecom.GetExternalContactList(handoverUID)
		if err != nil {
			log.Printf("[TransferScheduler] 获取外部联系人列表失败 userid=%s: %v", handoverUID, err)
			continue
		}

		var toTransfer []string
		nameMap := make(map[string]string)

		for _, eid := range externalIDs {
			detail, err := Wecom.GetExternalContactDetail(eid)
			if err != nil {
				log.Printf("[TransferScheduler] 获取联系人详情失败 eid=%s: %v", eid, err)
				continue
			}

			// 从 follow_user 列表中找到当前跟进人的 add_time
			followUsers, _ := detail["follow_user"].([]any)
			for _, fu := range followUsers {
				fuMap, ok := fu.(map[string]any)
				if !ok {
					continue
				}
				uid, _ := fuMap["userid"].(string)
				if uid != handoverUID {
					continue
				}
				addTime, _ := fuMap["createtime"].(float64)
				if addTime == 0 {
					// 兼容 add_time 字段名
					addTime, _ = fuMap["add_time"].(float64)
				}
				if addTime > 0 {
					addedAt := time.Unix(int64(addTime), 0)
					if now.Sub(addedAt) > threshold {
						toTransfer = append(toTransfer, eid)
						// 提取客户名称
						if extInfo, ok := detail["external_contact"].(map[string]any); ok {
							if name, ok := extInfo["name"].(string); ok {
								nameMap[eid] = name
							}
						}
					}
				}
				break
			}
		}

		if len(toTransfer) == 0 {
			continue
		}

		// 批量转移（企微限制每次最多100个）
		batchSize := 100
		for i := 0; i < len(toTransfer); i += batchSize {
			end := i + batchSize
			if end > len(toTransfer) {
				end = len(toTransfer)
			}
			batch := toTransfer[i:end]

			customers, err := Wecom.TransferCustomer(handoverUID, rule.TakeoverUserID, batch, rule.TransferMsg)
			if err != nil {
				log.Printf("[TransferScheduler] 转移客户失败 rule=%s handover=%s: %v", rule.Name, handoverUID, err)
				continue
			}

			// 创建转接记录
			if saveErr := models.WriteTx(func(tx *gorm.DB) error {
				for _, eid := range batch {
					status := "pending"
					failReason := ""

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
						HandoverUserID: handoverUID,
						TakeoverUserID: rule.TakeoverUserID,
						ExternalUserID: eid,
						CustomerName:   nameMap[eid],
						Status:         status,
						FailReason:     failReason,
						TransferMsg:    rule.TransferMsg,
					}
					if err := tx.Create(&record).Error; err != nil {
						return err
					}
					transferred++
				}
				return nil
			}); saveErr != nil {
				log.Printf("[TransferScheduler] 保存转接记录失败: %v", saveErr)
			}
		}
	}

	// 更新 LastRunAt
	nowTime := time.Now()
	models.WriteTx(func(tx *gorm.DB) error {
		return tx.Model(&models.TransferRule{}).Where("id = ?", rule.ID).Update("last_run_at", nowTime).Error
	})

	if transferred > 0 {
		log.Printf("[TransferScheduler] 规则 [%s] 执行完成，转移 %d 位客户", rule.Name, transferred)
	}
}
