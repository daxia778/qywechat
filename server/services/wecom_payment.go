package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"pdd-order-system/models"

	"gorm.io/gorm"
)

// ─── 企微对外收款同步服务 ──────────────────────────

const (
	wecomPaymentSyncInterval = 2 * time.Hour // 每 2 小时同步一次
	wecomPaymentLookback     = 4 * time.Hour // 每次拉取最近 4 小时（2 小时重叠补偿）
	wecomPaymentPageSize     = 1000          // 每页最大条数
)

// ─── API 请求/响应结构体 ──────────────────────────

// WecomBillListRequest 企微收款列表请求
type WecomBillListRequest struct {
	BeginTime   int64  `json:"begin_time"`
	EndTime     int64  `json:"end_time"`
	PayeeUserID string `json:"payee_userid,omitempty"`
	Cursor      string `json:"cursor,omitempty"`
	Limit       int    `json:"limit,omitempty"`
}

// WecomBillListResponse 企微收款列表响应
type WecomBillListResponse struct {
	ErrCode    int             `json:"errcode"`
	ErrMsg     string          `json:"errmsg"`
	NextCursor string          `json:"next_cursor"`
	BillList   []WecomBillItem `json:"bill_list"`
}

// WecomBillItem 单条收款记录
type WecomBillItem struct {
	TransactionID  string `json:"transaction_id"`
	TradeState     int    `json:"trade_state"`
	PayTime        int64  `json:"pay_time"`
	TotalFee       int    `json:"total_fee"`
	PayeeUserID    string `json:"payee_userid"`
	ExternalUserID string `json:"external_userid"`
	PayerName      string `json:"payer_name"`
	Remark         string `json:"remark"`
}

// WecomPaymentSyncResult 同步结果统计
type WecomPaymentSyncResult struct {
	Total      int `json:"total"`       // 拉取总数
	Created    int `json:"created"`     // 新增条数
	Skipped    int `json:"skipped"`     // 去重跳过
	Matched    int `json:"matched"`     // 自动关联订单
	FailedSave int `json:"failed_save"` // 保存失败
}

// ─── 核心同步逻辑 ──────────────────────────

// SyncWecomPayments 拉取企微对外收款记录并同步到本地
// 每次拉取最近 4 小时的数据（有 2 小时重叠作为补偿窗口）
func SyncWecomPayments() (*WecomPaymentSyncResult, error) {
	if Wecom == nil || !Wecom.IsConfigured() {
		return nil, fmt.Errorf("企微客户端未配置，跳过收款同步")
	}

	token, err := Wecom.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("获取 access_token 失败: %w", err)
	}

	now := time.Now()
	endTime := now.Unix()
	beginTime := now.Add(-wecomPaymentLookback).Unix()

	result := &WecomPaymentSyncResult{}
	cursor := ""

	for {
		// 构造请求
		reqBody := WecomBillListRequest{
			BeginTime: beginTime,
			EndTime:   endTime,
			Cursor:    cursor,
			Limit:     wecomPaymentPageSize,
		}

		url := fmt.Sprintf("%s/externalpay/get_bill_list?access_token=%s", Wecom.BaseURL(), token)
		respBody, err := Wecom.RawPostJSON(url, reqBody)
		if err != nil {
			return result, fmt.Errorf("调用企微收款 API 失败: %w", err)
		}

		var apiResp WecomBillListResponse
		if err := json.Unmarshal(respBody, &apiResp); err != nil {
			return result, fmt.Errorf("解析企微收款响应失败: %w", err)
		}
		if apiResp.ErrCode != 0 {
			return result, fmt.Errorf("企微收款 API 错误: %d %s", apiResp.ErrCode, apiResp.ErrMsg)
		}

		// 处理每条账单
		for i := range apiResp.BillList {
			bill := &apiResp.BillList[i]
			result.Total++

			// 去重: 检查 transaction_id 是否已存在
			var exists int64
			models.DB.Model(&models.PaymentRecord{}).
				Where("transaction_id = ?", bill.TransactionID).
				Count(&exists)
			if exists > 0 {
				result.Skipped++
				continue
			}

			// 映射交易状态
			tradeState := mapWecomTradeState(bill.TradeState)

			// 构造收款记录
			paidAt := time.Unix(bill.PayTime, 0)
			payment := models.PaymentRecord{
				TransactionID:  bill.TransactionID,
				Amount:         bill.TotalFee,
				Source:         "wecom",
				PayeeUserID:    bill.PayeeUserID,
				ExternalUserID: bill.ExternalUserID,
				TradeState:     tradeState,
				PaidAt:         &paidAt,
				Remark:         bill.Remark,
			}

			// 尝试自动关联
			matched := matchPaymentToOrder(models.DB, &payment)
			if matched {
				result.Matched++
			}

			// 保存到数据库
			if err := models.WriteTx(func(tx *gorm.DB) error {
				return tx.Create(&payment).Error
			}); err != nil {
				log.Printf("   保存收款记录失败: txn=%s err=%v", bill.TransactionID, err)
				result.FailedSave++
				continue
			}

			result.Created++

			// 自动关联成功且交易成功，触发分润重算
			if matched && payment.OrderID != 0 && tradeState == "SUCCESS" {
				TriggerProfitRecalculation(payment.OrderID)
			}
		}

		// 分页: 如果有 next_cursor 则继续拉取
		if apiResp.NextCursor == "" || len(apiResp.BillList) == 0 {
			break
		}
		cursor = apiResp.NextCursor
	}

	log.Printf("   企微收款同步完成 | 拉取=%d 新增=%d 跳过=%d 关联=%d 失败=%d",
		result.Total, result.Created, result.Skipped, result.Matched, result.FailedSave)

	return result, nil
}

// ─── 自动关联逻辑 ──────────────────────────

// matchPaymentToOrder 通过 external_userid 自动关联收款到订单
// 返回 true 表示成功关联到订单
func matchPaymentToOrder(db *gorm.DB, payment *models.PaymentRecord) bool {
	if payment.ExternalUserID == "" {
		return false
	}

	// 1. 通过 external_user_id 查找 Customer
	var customer models.Customer
	if err := db.Where("external_user_id = ?", payment.ExternalUserID).First(&customer).Error; err != nil {
		// 找不到对应顾客，留待手动匹配
		return false
	}

	payment.CustomerID = customer.ID

	// 2. 查找该 Customer 最近的活跃订单（非终态）
	var activeOrders []models.Order
	db.Where("customer_id = ? AND status NOT IN ?", customer.ID,
		[]string{models.StatusRefunded, models.StatusClosed, models.StatusCompleted}).
		Order("created_at DESC").
		Limit(5).
		Find(&activeOrders)

	if len(activeOrders) == 0 {
		// 没有活跃订单，仅关联顾客，不关联订单
		return false
	}

	if len(activeOrders) == 1 {
		// 只有一个活跃订单，自动关联
		now := time.Now()
		payment.OrderID = activeOrders[0].ID
		payment.MatchedAt = &now
		payment.MatchMethod = "auto"
		return true
	}

	// 多个活跃订单，无法确定，留待手动匹配
	// 仅关联顾客，match_method 留空
	return false
}

// mapWecomTradeState 将企微交易状态码映射为字符串
func mapWecomTradeState(state int) string {
	switch state {
	case 1:
		return "WAIT_PAY"
	case 2:
		return "SUCCESS"
	case 3:
		return "CLOSED"
	case 4:
		return "REFUND"
	default:
		return fmt.Sprintf("UNKNOWN_%d", state)
	}
}

// ─── 定时调度器 ──────────────────────────

// StartWecomPaymentSyncScheduler 启动企微对外收款定时同步调度器（每 2 小时）
func StartWecomPaymentSyncScheduler(ctx context.Context) {
	if Wecom == nil || !Wecom.IsConfigured() {
		log.Println("   企微未配置，收款同步调度器未启动")
		return
	}

	log.Println("   企微对外收款同步调度器已启动 (每2小时)")

	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("   企微收款同步调度器 panic: %v", r)
			}
		}()

		ticker := time.NewTicker(wecomPaymentSyncInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("   企微收款同步调度器已停止")
				return
			case <-ticker.C:
				func() {
					defer func() {
						if r := recover(); r != nil {
							log.Printf("   企微收款同步 tick panic: %v", r)
						}
					}()
					if _, err := SyncWecomPayments(); err != nil {
						log.Printf("   企微收款同步失败: %v", err)
					}
				}()
			}
		}
	}()
}
