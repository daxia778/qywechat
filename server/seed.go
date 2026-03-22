package main

import (
	"fmt"
	"log"
	"math/rand"
	"time"

	"pdd-order-system/models"

	"golang.org/x/crypto/bcrypt"
)

// SeedData 检测空库并填充测试数据
func SeedData() {
	var count int64
	models.DB.Model(&models.Employee{}).Count(&count)
	if count > 1 { // > 1 因为 admin 可能已存在
		log.Println("[Seed] 数据库已有数据，跳过种子数据填充")
		return
	}

	log.Println("[Seed] 开始填充测试数据...")

	empMap := seedEmployees()
	customers := seedCustomers()
	orders := seedOrders(empMap, customers)
	seedPayments(orders)

	log.Println("[Seed] 测试数据填充完成")
}

// ────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────

func hashPwd(plain string) string {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("[Seed] bcrypt 失败: %v", err)
	}
	return string(h)
}

func tp(t time.Time) *time.Time { return &t }

// daysAgo 返回 d 天前的随机工作时间 (8:00-18:00)
func daysAgo(d int) time.Time {
	return time.Now().Truncate(24*time.Hour).
		AddDate(0, 0, -d).
		Add(time.Duration(8+rand.Intn(10))*time.Hour + time.Duration(rand.Intn(60))*time.Minute)
}

// hoursAfter 在 base 之后加 h 小时 + 随机分钟
func hoursAfter(base time.Time, h int) time.Time {
	return base.Add(time.Duration(h)*time.Hour + time.Duration(rand.Intn(45))*time.Minute)
}

// calcProfit 按默认费率计算分润 (5% / 40% / 10% / 5%)
func calcProfit(price int) (pf, dc, sc, fc, np int) {
	pf = price * 5 / 100   // 平台扣点
	dc = price * 40 / 100  // 设计师
	sc = price * 10 / 100  // 谈单客服
	fc = price * 5 / 100   // 跟单客服
	np = price - pf - dc - sc - fc
	return
}

// ────────────────────────────────────────────────────────
// 1. 员工
// ────────────────────────────────────────────────────────

type empInfo struct {
	WecomUserID string
	Name        string
	Role        string
}

func seedEmployees() map[string]empInfo {
	type def struct {
		Username, Name, Role, Pwd string
	}

	defs := []def{
		{"admin", "管理员柒", "admin", "admin888"},
		{"follow_001", "小王", "follow", "pass1234"},
		{"follow_002", "小李", "follow", "pass1234"},
		{"sales_001", "测试客服", "sales", "pass1234"},
		{"designer_001", "阿杰", "designer", "pass1234"},
		{"designer_002", "小美", "designer", "pass1234"},
		{"designer_003", "大刘", "designer", "pass1234"},
	}

	result := make(map[string]empInfo, len(defs))
	for _, d := range defs {
		var exists models.Employee
		if err := models.DB.Where("username = ?", d.Username).First(&exists).Error; err == nil {
			log.Printf("[Seed] 员工 %s 已存在，跳过", d.Username)
			result[d.Role+"_"+d.Username] = empInfo{exists.WecomUserID, exists.Name, exists.Role}
			continue
		}
		emp := models.Employee{
			WecomUserID:  d.Username, // 测试数据: WecomUserID = Username
			Username:     d.Username,
			Name:         d.Name,
			Role:         d.Role,
			PasswordHash: hashPwd(d.Pwd),
			Status:       "idle",
			IsActive:     true,
		}
		if err := models.DB.Create(&emp).Error; err != nil {
			log.Printf("[Seed] 创建员工 %s 失败: %v", d.Username, err)
			continue
		}
		result[d.Role+"_"+d.Username] = empInfo{emp.WecomUserID, emp.Name, emp.Role}
		log.Printf("[Seed]   + 员工: %s (%s)", d.Name, d.Role)
	}
	return result
}

// ────────────────────────────────────────────────────────
// 2. 顾客
// ────────────────────────────────────────────────────────

func seedCustomers() []models.Customer {
	now := time.Now()
	ago7 := now.AddDate(0, 0, -7)
	ago15 := now.AddDate(0, 0, -15)
	ago25 := now.AddDate(0, 0, -25)

	custs := []models.Customer{
		{Nickname: "张总", Mobile: "13800138001", WechatID: "zhangzong_wx", TotalOrders: 3, TotalAmount: 15000, FirstOrderAt: tp(ago25), LastOrderAt: tp(ago7)},
		{Nickname: "李经理", Mobile: "13800138002", WechatID: "lijingli_wx", ExternalUserID: "wmEXTERNAL001", TotalOrders: 2, TotalAmount: 8000, FirstOrderAt: tp(ago15), LastOrderAt: tp(ago7)},
		{Nickname: "王秘书", Mobile: "13800138003", ExternalUserID: "wmEXTERNAL002", TotalOrders: 1, TotalAmount: 3000, FirstOrderAt: tp(ago7), LastOrderAt: tp(ago7)},
		{Nickname: "赵老板", Mobile: "13800138004", WechatID: "zhaolaoba_wx", ExternalUserID: "wmEXTERNAL003", TotalOrders: 5, TotalAmount: 28000, FirstOrderAt: tp(ago25), LastOrderAt: tp(now)},
		{Nickname: "孙助理", Mobile: "13800138005"},
		{Nickname: "周总监", Mobile: "13800138006", WechatID: "zhouzongjian", ExternalUserID: "wmEXTERNAL004", TotalOrders: 2, TotalAmount: 12000, FirstOrderAt: tp(ago15), LastOrderAt: tp(ago7)},
		{Nickname: "吴经理", Mobile: "13800138007"},
		{Nickname: "郑主任", Mobile: "13800138008", WechatID: "zhengzhuren", TotalOrders: 1, TotalAmount: 5000, FirstOrderAt: tp(ago15), LastOrderAt: tp(ago15)},
		{Nickname: "钱总", Mobile: "13800138009", ExternalUserID: "wmEXTERNAL005", TotalOrders: 4, TotalAmount: 22000, FirstOrderAt: tp(ago25), LastOrderAt: tp(now)},
		{Nickname: "陈经理", Mobile: "13800138010", WechatID: "chenjingli"},
		{Nickname: "林主管", Mobile: "13800138011"},
		{Nickname: "黄总助", Mobile: "13800138012", WechatID: "huangzongzhu", ExternalUserID: "wmEXTERNAL006", TotalOrders: 1, TotalAmount: 3500, FirstOrderAt: tp(ago7), LastOrderAt: tp(ago7)},
		{Nickname: "何经理", Mobile: "13800138013"},
		{Nickname: "马主任", Mobile: "13800138014", WechatID: "mazhuren", TotalOrders: 2, TotalAmount: 9000, FirstOrderAt: tp(ago15), LastOrderAt: tp(ago7)},
		{Nickname: "刘总", Mobile: "13800138015", ExternalUserID: "wmEXTERNAL007", TotalOrders: 3, TotalAmount: 16000, FirstOrderAt: tp(ago25), LastOrderAt: tp(now)},
	}

	created := make([]models.Customer, 0, len(custs))
	for i := range custs {
		if err := models.DB.Create(&custs[i]).Error; err != nil {
			log.Printf("[Seed] 创建顾客 %s 失败: %v", custs[i].Nickname, err)
			continue
		}
		created = append(created, custs[i])
	}
	log.Printf("[Seed]   + 顾客: %d 个", len(created))
	return created
}

// ────────────────────────────────────────────────────────
// 3. 订单 + 时间线
// ────────────────────────────────────────────────────────

type orderDef struct {
	custIdx    int
	price      int
	pages      int
	topic      string
	status     string
	daysAgo    int
	costPrice  int
	extraPages int
	extraPrice int
	remark     string
	refundMsg  string
}

func seedOrders(empMap map[string]empInfo, customers []models.Customer) []models.Order {
	sales := "sales_001"
	designers := []string{"designer_001", "designer_002", "designer_003"}
	follows := []string{"follow_001", "follow_002"}

	// 29 orders covering all statuses
	specs := []orderDef{
		// ── COMPLETED (8) ── 较早创建
		{0, 5800, 20, "年度工作总结PPT", models.StatusCompleted, 28, 2300, 0, 0, "客户要求高端大气风格", ""},
		{1, 3500, 12, "产品发布会演示", models.StatusCompleted, 25, 1400, 0, 0, "", ""},
		{3, 8800, 40, "融资路演PPT", models.StatusCompleted, 22, 3500, 5, 500, "A轮融资，需要英文版", ""},
		{5, 6200, 25, "品牌策划方案", models.StatusCompleted, 20, 2500, 0, 0, "", ""},
		{7, 4500, 18, "教育培训课件", models.StatusCompleted, 17, 1800, 0, 0, "幼儿教育主题", ""},
		{8, 7200, 30, "商业计划书", models.StatusCompleted, 14, 2900, 3, 300, "", ""},
		{13, 5000, 22, "季度业绩汇报", models.StatusCompleted, 12, 2000, 0, 0, "", ""},
		{14, 4800, 16, "市场调研报告", models.StatusCompleted, 10, 1900, 0, 0, "需要数据图表", ""},

		// ── AFTER_SALE (2) ──
		{3, 9500, 45, "年会颁奖典礼", models.StatusAfterSale, 15, 3800, 0, 0, "客户要求修改配色方案", ""},
		{8, 6800, 28, "企业文化手册", models.StatusAfterSale, 11, 2700, 0, 0, "", ""},

		// ── REFUNDED (2) ──
		{6, 3200, 10, "活动宣传PPT", models.StatusRefunded, 18, 0, 0, 0, "", "客户取消活动，申请全额退款"},
		{9, 4000, 15, "内部培训资料", models.StatusRefunded, 9, 1600, 0, 0, "", "设计风格不满意，协商退款"},

		// ── CLOSED (1) ──
		{10, 2800, 8, "简历PPT", models.StatusClosed, 23, 0, 0, 0, "客户失联", ""},

		// ── DELIVERED (3) ──
		{2, 3800, 14, "项目汇报PPT", models.StatusDelivered, 8, 1500, 0, 0, "", ""},
		{4, 5500, 24, "毕业论文答辩", models.StatusDelivered, 7, 2200, 2, 200, "加急", ""},
		{11, 4200, 18, "数据分析报告", models.StatusDelivered, 6, 1700, 0, 0, "", ""},

		// ── REVISION (2) ──
		{1, 5200, 20, "新品推广方案", models.StatusRevision, 6, 2100, 0, 0, "第二次修改", ""},
		{5, 6500, 26, "投标文件PPT", models.StatusRevision, 5, 2600, 0, 0, "甲方要求调整图表", ""},

		// ── DESIGNING (4) ──
		{3, 7500, 32, "战略规划PPT", models.StatusDesigning, 5, 3000, 0, 0, "", ""},
		{8, 4300, 16, "产品手册设计", models.StatusDesigning, 5, 1700, 0, 0, "", ""},
		{13, 3600, 12, "周会汇报PPT", models.StatusDesigning, 4, 1400, 0, 0, "每周例会用", ""},
		{14, 8200, 38, "集团年报PPT", models.StatusDesigning, 3, 3300, 4, 400, "页数较多，注意排版", ""},

		// ── CONFIRMED (2) ──
		{0, 4600, 18, "客户答谢会PPT", models.StatusConfirmed, 3, 1800, 0, 0, "", ""},
		{7, 3900, 14, "公开课课件", models.StatusConfirmed, 2, 1600, 0, 0, "", ""},

		// ── GROUP_CREATED (2) ──
		{2, 5100, 20, "展会宣传PPT", models.StatusGroupCreated, 2, 0, 0, 0, "", ""},
		{11, 3300, 10, "个人作品集", models.StatusGroupCreated, 1, 0, 0, 0, "", ""},

		// ── PENDING (3) ──
		{4, 4800, 20, "婚礼策划方案", models.StatusPending, 1, 0, 0, 0, "需要浪漫风格", ""},
		{9, 6000, 25, "企业宣传片脚本", models.StatusPending, 0, 0, 0, 0, "", ""},
		{12, 3500, 12, "述职报告PPT", models.StatusPending, 0, 0, 0, 0, "", ""},
	}

	orders := make([]models.Order, 0, len(specs))

	for i, s := range specs {
		created := daysAgo(s.daysAgo)
		custID := uint(0)
		contact := ""
		if s.custIdx < len(customers) {
			custID = customers[s.custIdx].ID
			contact = customers[s.custIdx].Mobile
		}

		designerIdx := i % len(designers)
		followIdx := i % len(follows)

		orderSN := fmt.Sprintf("PDD%s%03d", created.Format("20060102"), i+1)

		o := models.Order{
			OrderSN:          orderSN,
			CustomerContact:  contact,
			CustomerID:       custID,
			Price:            s.price,
			OperatorID:       sales,
			Topic:            s.topic,
			Pages:            s.pages,
			ExtraPages:       s.extraPages,
			ExtraPrice:       s.extraPrice,
			CostPrice:        s.costPrice,
			Status:           s.status,
			Remark:           s.remark,
			RefundReason:     s.refundMsg,
			CreatedAt:        created,
			UpdatedAt:        created,
		}

		// 设置 deadline: 创建后 3-7 天
		deadline := created.AddDate(0, 0, 3+rand.Intn(5))
		o.Deadline = tp(deadline)

		// 非 PENDING/GROUP_CREATED 的订单分配设计师和跟单
		needDesigner := s.status != models.StatusPending && s.status != models.StatusGroupCreated
		needFollow := needDesigner

		if needDesigner {
			o.DesignerID = designers[designerIdx]
		}
		if needFollow {
			o.FollowOperatorID = follows[followIdx]
		}

		// GROUP_CREATED 有跟单但没设计师
		if s.status == models.StatusGroupCreated {
			o.FollowOperatorID = follows[followIdx]
		}

		// 设置各阶段时间戳
		if needDesigner {
			assignT := hoursAfter(created, 1)
			o.AssignedAt = tp(assignT)
		}

		switch s.status {
		case models.StatusDelivered:
			o.DeliveredAt = tp(hoursAfter(created, 24+rand.Intn(48)))
		case models.StatusCompleted:
			deliverT := hoursAfter(created, 24+rand.Intn(48))
			completeT := hoursAfter(deliverT, 2+rand.Intn(24))
			o.DeliveredAt = tp(deliverT)
			o.CompletedAt = tp(completeT)
		case models.StatusClosed:
			o.ClosedAt = tp(hoursAfter(created, 48))
		case models.StatusRefunded:
			o.ClosedAt = tp(hoursAfter(created, 24+rand.Intn(48)))
		}

		// 分润 (仅 COMPLETED / AFTER_SALE / DELIVERED 有意义)
		totalPrice := s.price + s.extraPrice
		switch s.status {
		case models.StatusCompleted, models.StatusAfterSale:
			pf, dc, sc, fc, np := calcProfit(totalPrice)
			o.PlatformFee = pf
			o.DesignerCommission = dc
			o.SalesCommission = sc
			o.FollowCommission = fc
			o.NetProfit = np
		case models.StatusDelivered:
			// 已交付但未完成，也预算分润
			pf, dc, sc, fc, np := calcProfit(totalPrice)
			o.PlatformFee = pf
			o.DesignerCommission = dc
			o.SalesCommission = sc
			o.FollowCommission = fc
			o.NetProfit = np
		}

		if err := models.DB.Create(&o).Error; err != nil {
			log.Printf("[Seed] 创建订单 %s 失败: %v", orderSN, err)
			continue
		}
		orders = append(orders, o)

		// 生成时间线
		seedTimeline(o, sales, designers[designerIdx], follows[followIdx])
	}

	log.Printf("[Seed]   + 订单: %d 单", len(orders))

	// 额外: 为部分订单添加 amount_changed / pages_changed 事件
	seedExtraTimelineEvents(orders)

	return orders
}

// statusChain 根据目标状态返回从 PENDING 到目标状态的状态链
func statusChain(target string) []string {
	full := []string{
		models.StatusPending,
		models.StatusGroupCreated,
		models.StatusConfirmed,
		models.StatusDesigning,
		models.StatusDelivered,
		models.StatusCompleted,
	}

	switch target {
	case models.StatusPending:
		return nil
	case models.StatusGroupCreated:
		return full[:2]
	case models.StatusConfirmed:
		return full[:3]
	case models.StatusDesigning:
		return full[:4]
	case models.StatusDelivered:
		return full[:5]
	case models.StatusCompleted:
		return full[:6]
	case models.StatusRevision:
		// PENDING->...->DELIVERED->REVISION
		return append(full[:5], models.StatusRevision)
	case models.StatusAfterSale:
		// PENDING->...->COMPLETED->AFTER_SALE
		return append(full[:6], models.StatusAfterSale)
	case models.StatusRefunded:
		// PENDING->...->DESIGNING->REFUNDED
		return append(full[:4], models.StatusRefunded)
	case models.StatusClosed:
		return []string{models.StatusPending, models.StatusClosed}
	}
	return nil
}

// operatorForTransition 根据状态转换决定操作人
func operatorForTransition(toStatus, salesID, designerID, followID string) (string, string) {
	switch toStatus {
	case models.StatusGroupCreated, models.StatusConfirmed, models.StatusDesigning:
		return salesID, nameFor(salesID)
	case models.StatusDelivered:
		return designerID, nameFor(designerID)
	case models.StatusCompleted, models.StatusRevision, models.StatusAfterSale:
		return followID, nameFor(followID)
	case models.StatusRefunded:
		return salesID, nameFor(salesID)
	case models.StatusClosed:
		return "admin", "管理员柒"
	}
	return salesID, nameFor(salesID)
}

func nameFor(wecomID string) string {
	m := map[string]string{
		"admin":        "管理员柒",
		"sales_001":    "小张",
		"follow_001":   "小王",
		"follow_002":   "小李",
		"designer_001": "阿杰",
		"designer_002": "小美",
		"designer_003": "大刘",
	}
	if n, ok := m[wecomID]; ok {
		return n
	}
	return wecomID
}

func seedTimeline(o models.Order, salesID, designerID, followID string) {
	chain := statusChain(o.Status)
	if len(chain) < 2 {
		return
	}

	baseTime := o.CreatedAt
	for i := 1; i < len(chain); i++ {
		from := chain[i-1]
		to := chain[i]
		opID, opName := operatorForTransition(to, salesID, designerID, followID)
		eventTime := hoursAfter(baseTime, 1+i*2)

		evt := models.OrderTimeline{
			OrderID:      o.ID,
			EventType:    "status_changed",
			FromStatus:   from,
			ToStatus:     to,
			OperatorID:   opID,
			OperatorName: opName,
			CreatedAt:    eventTime,
		}
		models.DB.Create(&evt)
		baseTime = eventTime
	}
}

func seedExtraTimelineEvents(orders []models.Order) {
	count := 0
	for _, o := range orders {
		// 给第 3 单 (index=2) 添加 amount_changed
		if o.Status == models.StatusCompleted && count == 0 {
			evt := models.OrderTimeline{
				OrderID:      o.ID,
				EventType:    "amount_changed",
				OldValue:     fmt.Sprintf("%d", o.Price-500),
				NewValue:     fmt.Sprintf("%d", o.Price),
				OperatorID:   "sales_001",
				OperatorName: "小张",
				Remark:       "客户追加需求，调整价格",
				CreatedAt:    hoursAfter(o.CreatedAt, 6),
			}
			models.DB.Create(&evt)
			count++
			continue
		}
		// 给 pages_changed
		if o.ExtraPages > 0 && count == 1 {
			evt := models.OrderTimeline{
				OrderID:      o.ID,
				EventType:    "pages_changed",
				OldValue:     fmt.Sprintf("%d", o.Pages),
				NewValue:     fmt.Sprintf("%d", o.Pages+o.ExtraPages),
				OperatorID:   "sales_001",
				OperatorName: "小张",
				Remark:       "客户要求加页",
				CreatedAt:    hoursAfter(o.CreatedAt, 8),
			}
			models.DB.Create(&evt)
			count++
			continue
		}
		// 再加一个 amount_changed
		if o.Status == models.StatusDesigning && count == 2 {
			evt := models.OrderTimeline{
				OrderID:      o.ID,
				EventType:    "amount_changed",
				OldValue:     fmt.Sprintf("%d", o.Price-300),
				NewValue:     fmt.Sprintf("%d", o.Price),
				OperatorID:   "sales_001",
				OperatorName: "小张",
				Remark:       "价格微调",
				CreatedAt:    hoursAfter(o.CreatedAt, 4),
			}
			models.DB.Create(&evt)
			count++
		}
		if count >= 3 {
			break
		}
	}
	log.Printf("[Seed]   + 额外时间线事件: %d 条", count)
}

// ────────────────────────────────────────────────────────
// 4. 收款流水
// ────────────────────────────────────────────────────────

func seedPayments(orders []models.Order) {
	payCount := 0

	for _, o := range orders {
		// 所有非 PENDING 订单至少有一条 PDD 收款
		if o.Status == models.StatusPending {
			continue
		}

		paidAt := hoursAfter(o.CreatedAt, rand.Intn(3))
		txID := fmt.Sprintf("PDD-%s-%d", o.OrderSN, paidAt.Unix())
		matchedAt := hoursAfter(paidAt, 0)

		pr := models.PaymentRecord{
			TransactionID:  txID,
			OrderID:        o.ID,
			CustomerID:     o.CustomerID,
			Amount:         o.Price,
			Source:         "pdd",
			PayeeUserID:    o.OperatorID,
			TradeState:     "SUCCESS",
			PaidAt:         paidAt,
			MatchedAt:      tp(matchedAt),
			MatchMethod:    "auto",
			Remark:         "PDD平台收款",
		}
		if err := models.DB.Create(&pr).Error; err != nil {
			log.Printf("[Seed] 创建收款记录失败: %v", err)
			continue
		}
		payCount++

		// COMPLETED 的部分订单有企微追加收款 (每隔2个COMPLETED订单)
		if o.Status == models.StatusCompleted && o.ExtraPrice > 0 {
			wecomPaidAt := hoursAfter(paidAt, 24+rand.Intn(48))
			wecomTxID := fmt.Sprintf("WECOM-%d-%04d", wecomPaidAt.Unix(), rand.Intn(10000))
			wpr := models.PaymentRecord{
				TransactionID:  wecomTxID,
				OrderID:        o.ID,
				CustomerID:     o.CustomerID,
				Amount:         o.ExtraPrice,
				Source:         "wecom",
				PayeeUserID:    o.FollowOperatorID,
				TradeState:     "SUCCESS",
				PaidAt:         wecomPaidAt,
				MatchedAt:      tp(hoursAfter(wecomPaidAt, 1)),
				MatchMethod:    "auto",
				Remark:         "企微追加收款（加页费用）",
			}
			if err := models.DB.Create(&wpr).Error; err == nil {
				payCount++
			}
		}

		// 再给2个 COMPLETED 订单加企微追加收款（模拟客户加急费）
		if o.Status == models.StatusCompleted && o.Pages > 25 {
			wecomPaidAt2 := hoursAfter(paidAt, 36+rand.Intn(24))
			wecomTxID2 := fmt.Sprintf("WECOM-%d-%04d", wecomPaidAt2.Unix(), rand.Intn(10000))
			wpr2 := models.PaymentRecord{
				TransactionID:  wecomTxID2,
				OrderID:        o.ID,
				CustomerID:     o.CustomerID,
				Amount:         500 + rand.Intn(1000),
				Source:         "wecom",
				PayeeUserID:    o.FollowOperatorID,
				TradeState:     "SUCCESS",
				PaidAt:         wecomPaidAt2,
				MatchedAt:      tp(hoursAfter(wecomPaidAt2, 0)),
				MatchMethod:    "manual",
				Remark:         "企微追加收款（加急费）",
			}
			if err := models.DB.Create(&wpr2).Error; err == nil {
				payCount++
			}
		}
	}

	// 3 条手动录入
	manualPayments := []struct {
		orderIdx int
		amount   int
		remark   string
	}{
		{0, 200, "客户微信转账补差价"},
		{3, 500, "线下现金收款补录"},
		{7, 300, "支付宝转账补录"},
	}

	for _, mp := range manualPayments {
		if mp.orderIdx >= len(orders) {
			continue
		}
		o := orders[mp.orderIdx]
		manualPaidAt := hoursAfter(o.CreatedAt, 48+rand.Intn(24))
		manualTxID := fmt.Sprintf("MANUAL-%d-%04d", manualPaidAt.Unix(), rand.Intn(10000))
		mpr := models.PaymentRecord{
			TransactionID:  manualTxID,
			OrderID:        o.ID,
			CustomerID:     o.CustomerID,
			Amount:         mp.amount,
			Source:         "manual",
			PayeeUserID:    "sales_001",
			TradeState:     "SUCCESS",
			PaidAt:         manualPaidAt,
			MatchMethod:    "manual",
			Remark:         mp.remark,
		}
		if err := models.DB.Create(&mpr).Error; err == nil {
			payCount++
		}
	}

	log.Printf("[Seed]   + 收款流水: %d 条", payCount)
}
