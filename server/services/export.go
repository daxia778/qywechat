package services

import (
	"fmt"
	"math"
	"sort"
	"time"

	"pdd-order-system/config"
	"pdd-order-system/models"

	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

// ExportFilter 导出筛选条件
type ExportFilter struct {
	StartDate   string
	EndDate     string
	EmployeeIDs []uint  // 支持多员工筛选
	Role        string  // 按角色筛选: sales/designer/follow
	Status      string  // 按状态筛选
}

// perfData 员工绩效聚合数据（用于绩效报表导出）
type perfData struct {
	Name         string
	Role         string
	OrderCount   int
	TotalAmount  int
	Commission   int
	CompletedCnt int
	RefundedCnt  int
}

// ── 样式常量 ──────────────────────────────────────────

const (
	headerFillColor = "1F3864" // 深蓝色表头背景
	headerFontColor = "FFFFFF" // 白色表头字体
	refundFontColor = "CC0000" // 退款行红色字体
	summaryKeyColor = "2B579A" // 汇总标签颜色
)

// ── 角色中文映射 ──────────────────────────────────────

var roleCN = map[string]string{
	"sales":    "谈单客服",
	"designer": "设计师",
	"follow":   "跟单客服",
	"admin":    "管理员",
}

// ── 状态中文映射 ──────────────────────────────────────

var statusCN = map[string]string{
	"PENDING":       "待处理",
	"GROUP_CREATED": "已建群",
	"CONFIRMED":     "已确认",
	"DESIGNING":     "设计中",
	"DELIVERED":     "已交付",
	"REVISION":      "修改中",
	"AFTER_SALE":    "售后中",
	"COMPLETED":     "已完成",
	"REFUNDED":      "已退款",
	"CLOSED":        "已关闭",
}

// centsToYuan 分转元
func centsToYuan(cents int) float64 {
	return float64(cents) / 100.0
}

// fmtYuan 格式化为人民币字符串
func fmtYuan(cents int) string {
	return fmt.Sprintf("%.2f", centsToYuan(cents))
}

// ExportOrderReport 导出订单报表（多 Sheet Excel）
func ExportOrderReport(filter ExportFilter) (*excelize.File, error) {
	f := excelize.NewFile()

	// 创建通用样式
	headerStyle, _ := createHeaderStyle(f)
	moneyStyle, _ := createMoneyStyle(f)
	refundStyle, _ := createRefundStyle(f)
	refundMoneyStyle, _ := createRefundMoneyStyle(f)
	summaryKeyStyle, _ := createSummaryKeyStyle(f)
	summaryValStyle, _ := createSummaryValStyle(f)

	// 解析日期
	var startTime, endTime time.Time
	var err error
	if filter.StartDate != "" {
		startTime, err = time.Parse("2006-01-02", filter.StartDate)
		if err != nil {
			startTime = time.Now().AddDate(0, -1, 0).Truncate(24 * time.Hour)
		}
	} else {
		startTime = time.Now().AddDate(0, -1, 0).Truncate(24 * time.Hour)
	}
	if filter.EndDate != "" {
		endTime, err = time.Parse("2006-01-02", filter.EndDate)
		if err != nil {
			endTime = time.Now().Truncate(24 * time.Hour)
		}
		endTime = endTime.Add(24 * time.Hour) // 包含结束日当天
	} else {
		endTime = time.Now().Add(24 * time.Hour).Truncate(24 * time.Hour)
	}

	// Sheet 1: 汇总
	writeSheetSummary(f, startTime, endTime, filter, headerStyle, summaryKeyStyle, summaryValStyle, moneyStyle)

	// Sheet 2: 订单明细
	writeSheetOrders(f, startTime, endTime, filter, headerStyle, moneyStyle, refundStyle, refundMoneyStyle)

	// Sheet 3: 员工业绩
	writeSheetEmployeePerformance(f, startTime, endTime, filter, headerStyle, moneyStyle)

	// Sheet 4: 收款流水
	writeSheetPayments(f, startTime, endTime, headerStyle, moneyStyle)

	// 删除默认的 Sheet1（excelize 默认创建）
	f.DeleteSheet("Sheet1")

	// 激活第一个 sheet
	idx, _ := f.GetSheetIndex("汇总")
	f.SetActiveSheet(idx)

	return f, nil
}

// ── 订单查询构建器 ──────────────────────────────────

func buildOrderQuery(startTime, endTime time.Time, filter ExportFilter) *gorm.DB {
	query := models.DB.Where("created_at >= ? AND created_at < ?", startTime, endTime)

	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}

	if len(filter.EmployeeIDs) > 0 {
		var employees []models.Employee
		models.DB.Where("id IN ?", filter.EmployeeIDs).Find(&employees)

		if len(employees) > 0 {
			// 按角色分组收集 WecomUserID
			var salesIDs, designerIDs, followIDs []string
			for _, emp := range employees {
				switch emp.Role {
				case "sales":
					salesIDs = append(salesIDs, emp.WecomUserID)
				case "designer":
					designerIDs = append(designerIDs, emp.WecomUserID)
				case "follow":
					followIDs = append(followIDs, emp.WecomUserID)
				default:
					// admin 等角色，匹配所有角色字段
					salesIDs = append(salesIDs, emp.WecomUserID)
					designerIDs = append(designerIDs, emp.WecomUserID)
					followIDs = append(followIDs, emp.WecomUserID)
				}
			}

			// 构建 OR 条件
			db := models.DB
			orQuery := db
			first := true
			if len(salesIDs) > 0 {
				orQuery = db.Where("operator_id IN ?", salesIDs)
				first = false
			}
			if len(designerIDs) > 0 {
				if first {
					orQuery = db.Where("designer_id IN ?", designerIDs)
					first = false
				} else {
					orQuery = orQuery.Or("designer_id IN ?", designerIDs)
				}
			}
			if len(followIDs) > 0 {
				if first {
					orQuery = db.Where("follow_operator_id IN ?", followIDs)
				} else {
					orQuery = orQuery.Or("follow_operator_id IN ?", followIDs)
				}
			}
			query = query.Where(orQuery)
		}
	}

	if filter.Role != "" {
		switch filter.Role {
		case "sales":
			query = query.Where("operator_id != ''")
		case "designer":
			query = query.Where("designer_id != ''")
		case "follow":
			query = query.Where("follow_operator_id != ''")
		}
	}

	return query
}

// ── Sheet 1: 汇总 ──────────────────────────────────

func writeSheetSummary(f *excelize.File, startTime, endTime time.Time, filter ExportFilter, headerStyle, keyStyle, valStyle, moneyStyle int) {
	sheet := "汇总"
	f.NewSheet(sheet)

	// 查询数据（应用筛选条件）
	var orders []models.Order
	buildOrderQuery(startTime, endTime, filter).Find(&orders)

	// 统计
	var totalRevenue, pddRevenue, wecomRevenue, manualRevenue int
	var totalOrders, refundCount int
	var platformFeeSum, designerCommSum, salesCommSum, followCommSum, netProfitSum int

	for _, o := range orders {
		totalOrders++
		if o.Status == models.StatusRefunded {
			refundCount++
			continue
		}

		totalAmount := o.Price + o.ExtraPrice
		totalRevenue += totalAmount

		// 使用订单上已计算的分润字段
		platformFeeSum += o.PlatformFee
		designerCommSum += o.DesignerCommission
		salesCommSum += o.SalesCommission
		followCommSum += o.FollowCommission
		netProfitSum += o.NetProfit
	}

	// 按来源统计收款
	var payments []models.PaymentRecord
	models.DB.Where("paid_at >= ? AND paid_at < ?", startTime, endTime).Find(&payments)
	for _, p := range payments {
		switch p.Source {
		case "pdd":
			pddRevenue += p.Amount
		case "wecom":
			wecomRevenue += p.Amount
		case "manual":
			manualRevenue += p.Amount
		}
	}

	// 如果没有收款记录，则用订单总额作为显示
	if pddRevenue+wecomRevenue+manualRevenue == 0 && totalRevenue > 0 {
		manualRevenue = totalRevenue
	}

	// 设置列宽
	f.SetColWidth(sheet, "A", "A", 24)
	f.SetColWidth(sheet, "B", "B", 20)

	// 标题
	f.SetCellValue(sheet, "A1", "PDD 派单管理系统 - 报表汇总")
	titleStyle, _ := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true, Size: 16, Color: headerFillColor},
	})
	f.SetCellStyle(sheet, "A1", "A1", titleStyle)
	f.MergeCell(sheet, "A1", "B1")

	dateRange := fmt.Sprintf("统计区间: %s ~ %s", startTime.Format("2006-01-02"), endTime.Add(-24*time.Hour).Format("2006-01-02"))
	f.SetCellValue(sheet, "A2", dateRange)
	dateStyle, _ := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Size: 11, Color: "666666"},
	})
	f.SetCellStyle(sheet, "A2", "A2", dateStyle)
	f.MergeCell(sheet, "A2", "B2")

	// 分润费率
	pfRate := config.C.PlatformFeeRate
	dcRate := config.C.DesignerCommissionRate
	scRate := config.C.SalesCommissionRate
	fcRate := config.C.FollowCommissionRate

	// 如果订单分润字段都为 0 但有营收，按比例计算
	if platformFeeSum == 0 && totalRevenue > 0 {
		platformFeeSum = int(math.Round(float64(totalRevenue) * float64(pfRate) / 100.0))
		designerCommSum = int(math.Round(float64(totalRevenue) * float64(dcRate) / 100.0))
		salesCommSum = int(math.Round(float64(totalRevenue) * float64(scRate) / 100.0))
		followCommSum = int(math.Round(float64(totalRevenue) * float64(fcRate) / 100.0))
		netProfitSum = totalRevenue - platformFeeSum - designerCommSum - salesCommSum - followCommSum
	}

	// 计算新指标
	effectiveOrders := totalOrders - refundCount
	dayCount := int(endTime.Sub(startTime).Hours() / 24)
	if dayCount < 1 {
		dayCount = 1
	}

	// 写入汇总数据
	row := 4
	writeKV := func(key, val string) {
		f.SetCellValue(sheet, fmt.Sprintf("A%d", row), key)
		f.SetCellValue(sheet, fmt.Sprintf("B%d", row), val)
		f.SetCellStyle(sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("A%d", row), keyStyle)
		f.SetCellStyle(sheet, fmt.Sprintf("B%d", row), fmt.Sprintf("B%d", row), valStyle)
		row++
	}

	writeKV("总营收", fmt.Sprintf("\u00a5%s", fmtYuan(totalRevenue)))
	writeKV("  拼多多收款", fmt.Sprintf("\u00a5%s", fmtYuan(pddRevenue)))
	writeKV("  企微收款", fmt.Sprintf("\u00a5%s", fmtYuan(wecomRevenue)))
	writeKV("  手动录入", fmt.Sprintf("\u00a5%s", fmtYuan(manualRevenue)))
	row++ // 空行
	writeKV("总订单数", fmt.Sprintf("%d 单", totalOrders))
	writeKV("退款数", fmt.Sprintf("%d 单", refundCount))

	// 新增指标：退款率
	refundRate := "0.00%"
	if totalOrders > 0 {
		refundRate = fmt.Sprintf("%.2f%%", float64(refundCount)/float64(totalOrders)*100)
	}
	writeKV("退款率", refundRate)

	// 新增指标：平均客单价
	avgOrderValue := "\u00a50.00"
	if effectiveOrders > 0 {
		avgOrderValue = fmt.Sprintf("\u00a5%.2f", centsToYuan(totalRevenue/effectiveOrders))
	}
	writeKV("平均客单价", avgOrderValue)

	// 新增指标：日均单量
	writeKV("日均单量", fmt.Sprintf("%.1f 单", float64(totalOrders)/float64(dayCount)))

	// 新增指标：日均营收
	writeKV("日均营收", fmt.Sprintf("\u00a5%.2f", centsToYuan(totalRevenue)/float64(dayCount)))

	row++ // 空行
	writeKV("四方分润汇总", "")
	writeKV(fmt.Sprintf("  平台手续费 (%d%%)", pfRate), fmt.Sprintf("\u00a5%s", fmtYuan(platformFeeSum)))
	writeKV(fmt.Sprintf("  设计师佣金 (%d%%)", dcRate), fmt.Sprintf("\u00a5%s", fmtYuan(designerCommSum)))
	writeKV(fmt.Sprintf("  谈单客服佣金 (%d%%)", scRate), fmt.Sprintf("\u00a5%s", fmtYuan(salesCommSum)))
	writeKV(fmt.Sprintf("  跟单客服佣金 (%d%%)", fcRate), fmt.Sprintf("\u00a5%s", fmtYuan(followCommSum)))
	writeKV("  净利润", fmt.Sprintf("\u00a5%s", fmtYuan(netProfitSum)))
}

// ── Sheet 2: 订单明细 ──────────────────────────────

func writeSheetOrders(f *excelize.File, startTime, endTime time.Time, filter ExportFilter, headerStyle, moneyStyle, refundStyle, refundMoneyStyle int) {
	sheet := "订单明细"
	f.NewSheet(sheet)

	// 查询订单（应用筛选条件）
	var orders []models.Order
	buildOrderQuery(startTime, endTime, filter).Order("created_at DESC").Find(&orders)

	// 预加载员工名称映射
	nameMap := loadEmployeeNameMap()

	// 表头（新增：交付时间、完成时间、备注摘要）
	headers := []string{
		"订单号", "客户昵称", "联系方式", "金额(元)", "页数", "状态",
		"跟单客服", "谈单客服", "设计师",
		"平台费", "设计师佣金", "谈单佣金", "跟单佣金", "净利润",
		"创建时间", "交付时间", "完成时间", "备注摘要",
	}

	for col, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(col+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	headerEnd, _ := excelize.CoordinatesToCellName(len(headers), 1)
	f.SetCellStyle(sheet, "A1", headerEnd, headerStyle)

	// 设置列宽
	colWidths := []float64{18, 12, 14, 12, 6, 8, 10, 10, 10, 10, 10, 10, 10, 10, 18, 18, 18, 30}
	for i, w := range colWidths {
		colName, _ := excelize.ColumnNumberToName(i + 1)
		f.SetColWidth(sheet, colName, colName, w)
	}

	// 金额列索引 (0-based): 3, 9, 10, 11, 12, 13
	moneyCols := []int{3, 9, 10, 11, 12, 13}

	// 写入数据
	for i, o := range orders {
		row := i + 2
		isRefunded := o.Status == models.StatusRefunded

		// 获取客户信息
		customerName := ""
		if o.CustomerID > 0 {
			var customer models.Customer
			if models.DB.First(&customer, o.CustomerID).Error == nil {
				customerName = customer.Nickname
			}
		}

		totalAmount := o.Price + o.ExtraPrice

		// 计算分润（如果订单字段上有值就直接用，否则按比例算）
		pf := o.PlatformFee
		dc := o.DesignerCommission
		sc := o.SalesCommission
		fc := o.FollowCommission
		np := o.NetProfit
		if pf == 0 && dc == 0 && totalAmount > 0 && !isRefunded {
			pfRate := config.C.PlatformFeeRate
			dcRate := config.C.DesignerCommissionRate
			scRate := config.C.SalesCommissionRate
			fcRate := config.C.FollowCommissionRate
			pf = int(math.Round(float64(totalAmount) * float64(pfRate) / 100.0))
			dc = int(math.Round(float64(totalAmount) * float64(dcRate) / 100.0))
			sc = int(math.Round(float64(totalAmount) * float64(scRate) / 100.0))
			fc = int(math.Round(float64(totalAmount) * float64(fcRate) / 100.0))
			np = totalAmount - pf - dc - sc - fc
		}

		statusText := statusCN[o.Status]
		if statusText == "" {
			statusText = o.Status
		}

		// 交付时间
		deliveredAt := ""
		if o.DeliveredAt != nil {
			deliveredAt = o.DeliveredAt.Format("2006-01-02 15:04:05")
		}

		// 完成时间
		completedAt := ""
		if o.CompletedAt != nil {
			completedAt = o.CompletedAt.Format("2006-01-02 15:04:05")
		}

		// 备注摘要（截取前50字符，用 []rune 正确处理中文）
		remarkSummary := o.Remark
		runes := []rune(remarkSummary)
		if len(runes) > 50 {
			remarkSummary = string(runes[:50]) + "..."
		}

		rowData := []interface{}{
			o.OrderSN,
			customerName,
			o.CustomerContact,
			centsToYuan(totalAmount),
			o.Pages,
			statusText,
			resolveName(nameMap, o.FollowOperatorID),
			resolveName(nameMap, o.OperatorID),
			resolveName(nameMap, o.DesignerID),
			centsToYuan(pf),
			centsToYuan(dc),
			centsToYuan(sc),
			centsToYuan(fc),
			centsToYuan(np),
			o.CreatedAt.Format("2006-01-02 15:04:05"),
			deliveredAt,
			completedAt,
			remarkSummary,
		}

		for col, val := range rowData {
			cell, _ := excelize.CoordinatesToCellName(col+1, row)
			f.SetCellValue(sheet, cell, val)
		}

		// 设置金额列样式
		if isRefunded {
			// 退款行：所有单元格红色
			rowStart, _ := excelize.CoordinatesToCellName(1, row)
			rowEnd, _ := excelize.CoordinatesToCellName(len(headers), row)
			f.SetCellStyle(sheet, rowStart, rowEnd, refundStyle)
			// 退款行金额列也用红色
			for _, mc := range moneyCols {
				cell, _ := excelize.CoordinatesToCellName(mc+1, row)
				f.SetCellStyle(sheet, cell, cell, refundMoneyStyle)
			}
		} else {
			for _, mc := range moneyCols {
				cell, _ := excelize.CoordinatesToCellName(mc+1, row)
				f.SetCellStyle(sheet, cell, cell, moneyStyle)
			}
		}
	}

	// 冻结首行
	f.SetPanes(sheet, &excelize.Panes{
		Freeze:      true,
		Split:       false,
		XSplit:      0,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
	})
}

// ── Sheet 3: 员工业绩 ──────────────────────────────

func writeSheetEmployeePerformance(f *excelize.File, startTime, endTime time.Time, filter ExportFilter, headerStyle, moneyStyle int) {
	sheet := "员工业绩"
	f.NewSheet(sheet)

	// 查询所有员工
	var employees []models.Employee
	models.DB.Where("is_active = ?", true).Find(&employees)

	// 查询区间内的订单（应用筛选条件）
	var orders []models.Order
	buildOrderQuery(startTime, endTime, filter).Find(&orders)

	// 按员工聚合
	perfMap := make(map[string]*perfData)

	// 初始化所有活跃员工
	for _, emp := range employees {
		perfMap[emp.WecomUserID] = &perfData{
			Name: emp.Name,
			Role: emp.Role,
		}
	}

	for _, o := range orders {
		totalAmount := o.Price + o.ExtraPrice

		// 谈单客服 (sales)
		if o.OperatorID != "" {
			pd := getOrCreatePerf(perfMap, o.OperatorID, "sales")
			pd.OrderCount++
			pd.TotalAmount += totalAmount
			pd.Commission += o.SalesCommission
			if o.Status == models.StatusCompleted {
				pd.CompletedCnt++
			}
			if o.Status == models.StatusRefunded {
				pd.RefundedCnt++
			}
		}

		// 设计师
		if o.DesignerID != "" {
			pd := getOrCreatePerf(perfMap, o.DesignerID, "designer")
			pd.OrderCount++
			pd.TotalAmount += totalAmount
			pd.Commission += o.DesignerCommission
			if o.Status == models.StatusCompleted {
				pd.CompletedCnt++
			}
			if o.Status == models.StatusRefunded {
				pd.RefundedCnt++
			}
		}

		// 跟单客服
		if o.FollowOperatorID != "" {
			pd := getOrCreatePerf(perfMap, o.FollowOperatorID, "follow")
			pd.OrderCount++
			pd.TotalAmount += totalAmount
			pd.Commission += o.FollowCommission
			if o.Status == models.StatusCompleted {
				pd.CompletedCnt++
			}
			if o.Status == models.StatusRefunded {
				pd.RefundedCnt++
			}
		}
	}

	// 转为 slice 并按订单数降序排列
	var perfList []*perfData
	for _, pd := range perfMap {
		if pd.OrderCount == 0 {
			continue
		}
		perfList = append(perfList, pd)
	}
	sort.Slice(perfList, func(i, j int) bool {
		return perfList[i].OrderCount > perfList[j].OrderCount
	})

	// 表头（新增：日均单量、平均客单价、完成率、退款率）
	headers := []string{"员工姓名", "角色", "经手订单数", "经手总金额(元)", "佣金收入(元)", "完成订单数", "退款订单数", "日均单量", "平均客单价(元)", "完成率", "退款率"}
	for col, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(col+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	headerEnd, _ := excelize.CoordinatesToCellName(len(headers), 1)
	f.SetCellStyle(sheet, "A1", headerEnd, headerStyle)

	// 设置列宽
	colWidths := []float64{14, 10, 12, 16, 14, 12, 12, 10, 16, 10, 10}
	for i, w := range colWidths {
		colName, _ := excelize.ColumnNumberToName(i + 1)
		f.SetColWidth(sheet, colName, colName, w)
	}

	// 计算天数
	dayCount := int(endTime.Sub(startTime).Hours() / 24)
	if dayCount < 1 {
		dayCount = 1
	}

	// 写入数据
	row := 2
	for _, pd := range perfList {
		roleText := roleCN[pd.Role]
		if roleText == "" {
			roleText = pd.Role
		}

		// 日均单量
		dailyOrders := float64(pd.OrderCount) / float64(dayCount)

		// 平均客单价
		avgPrice := 0.0
		if pd.OrderCount > 0 {
			avgPrice = centsToYuan(pd.TotalAmount) / float64(pd.OrderCount)
		}

		// 完成率
		completionRate := "0.0%"
		if pd.OrderCount > 0 {
			completionRate = fmt.Sprintf("%.1f%%", float64(pd.CompletedCnt)/float64(pd.OrderCount)*100)
		}

		// 退款率
		refundRate := "0.0%"
		if pd.OrderCount > 0 {
			refundRate = fmt.Sprintf("%.1f%%", float64(pd.RefundedCnt)/float64(pd.OrderCount)*100)
		}

		f.SetCellValue(sheet, fmt.Sprintf("A%d", row), pd.Name)
		f.SetCellValue(sheet, fmt.Sprintf("B%d", row), roleText)
		f.SetCellValue(sheet, fmt.Sprintf("C%d", row), pd.OrderCount)
		f.SetCellValue(sheet, fmt.Sprintf("D%d", row), centsToYuan(pd.TotalAmount))
		f.SetCellValue(sheet, fmt.Sprintf("E%d", row), centsToYuan(pd.Commission))
		f.SetCellValue(sheet, fmt.Sprintf("F%d", row), pd.CompletedCnt)
		f.SetCellValue(sheet, fmt.Sprintf("G%d", row), pd.RefundedCnt)
		f.SetCellValue(sheet, fmt.Sprintf("H%d", row), fmt.Sprintf("%.1f", dailyOrders))
		f.SetCellValue(sheet, fmt.Sprintf("I%d", row), avgPrice)
		f.SetCellValue(sheet, fmt.Sprintf("J%d", row), completionRate)
		f.SetCellValue(sheet, fmt.Sprintf("K%d", row), refundRate)

		// 金额列样式
		f.SetCellStyle(sheet, fmt.Sprintf("D%d", row), fmt.Sprintf("D%d", row), moneyStyle)
		f.SetCellStyle(sheet, fmt.Sprintf("E%d", row), fmt.Sprintf("E%d", row), moneyStyle)
		f.SetCellStyle(sheet, fmt.Sprintf("I%d", row), fmt.Sprintf("I%d", row), moneyStyle)

		row++
	}

	// 冻结首行
	f.SetPanes(sheet, &excelize.Panes{
		Freeze:      true,
		Split:       false,
		XSplit:      0,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
	})
}

// ── Sheet 4: 收款流水 ──────────────────────────────

func writeSheetPayments(f *excelize.File, startTime, endTime time.Time, headerStyle, moneyStyle int) {
	sheet := "收款流水"
	f.NewSheet(sheet)

	// 查询收款记录
	var payments []models.PaymentRecord
	models.DB.Where("paid_at >= ? AND paid_at < ?", startTime, endTime).Order("paid_at DESC").Find(&payments)

	// 预加载订单号映射
	orderSNMap := make(map[uint]string)
	customerMap := make(map[uint]string)
	if len(payments) > 0 {
		var orderIDs []uint
		var custIDs []uint
		for _, p := range payments {
			if p.OrderID > 0 {
				orderIDs = append(orderIDs, p.OrderID)
			}
			if p.CustomerID > 0 {
				custIDs = append(custIDs, p.CustomerID)
			}
		}
		if len(orderIDs) > 0 {
			var ords []models.Order
			models.DB.Where("id IN ?", orderIDs).Find(&ords)
			for _, o := range ords {
				orderSNMap[o.ID] = o.OrderSN
			}
		}
		if len(custIDs) > 0 {
			var custs []models.Customer
			models.DB.Where("id IN ?", custIDs).Find(&custs)
			for _, c := range custs {
				customerMap[c.ID] = c.Nickname
			}
		}
	}

	nameMap := loadEmployeeNameMap()

	// 来源中文
	sourceCN := map[string]string{
		"pdd":    "拼多多",
		"wecom":  "企微",
		"manual": "手动录入",
	}

	// 表头
	headers := []string{"交易单号", "来源", "金额(元)", "关联订单号", "客户昵称", "收款员工", "支付时间", "匹配方式"}
	for col, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(col+1, 1)
		f.SetCellValue(sheet, cell, h)
	}
	headerEnd, _ := excelize.CoordinatesToCellName(len(headers), 1)
	f.SetCellStyle(sheet, "A1", headerEnd, headerStyle)

	// 设置列宽
	colWidths := []float64{22, 10, 12, 18, 12, 12, 18, 10}
	for i, w := range colWidths {
		colName, _ := excelize.ColumnNumberToName(i + 1)
		f.SetColWidth(sheet, colName, colName, w)
	}

	// 写入数据
	for i, p := range payments {
		row := i + 2

		src := sourceCN[p.Source]
		if src == "" {
			src = p.Source
		}

		orderSN := orderSNMap[p.OrderID]
		custName := customerMap[p.CustomerID]

		matchMethod := ""
		switch p.MatchMethod {
		case "auto":
			matchMethod = "自动匹配"
		case "manual":
			matchMethod = "手动匹配"
		default:
			matchMethod = p.MatchMethod
		}

		f.SetCellValue(sheet, fmt.Sprintf("A%d", row), p.TransactionID)
		f.SetCellValue(sheet, fmt.Sprintf("B%d", row), src)
		f.SetCellValue(sheet, fmt.Sprintf("C%d", row), centsToYuan(p.Amount))
		f.SetCellValue(sheet, fmt.Sprintf("D%d", row), orderSN)
		f.SetCellValue(sheet, fmt.Sprintf("E%d", row), custName)
		f.SetCellValue(sheet, fmt.Sprintf("F%d", row), resolveName(nameMap, p.PayeeUserID))
		f.SetCellValue(sheet, fmt.Sprintf("G%d", row), p.PaidAt.Format("2006-01-02 15:04:05"))
		f.SetCellValue(sheet, fmt.Sprintf("H%d", row), matchMethod)

		// 金额列样式
		f.SetCellStyle(sheet, fmt.Sprintf("C%d", row), fmt.Sprintf("C%d", row), moneyStyle)
	}

	// 冻结首行
	f.SetPanes(sheet, &excelize.Panes{
		Freeze:      true,
		Split:       false,
		XSplit:      0,
		YSplit:      1,
		TopLeftCell: "A2",
		ActivePane:  "bottomLeft",
	})
}

// ── 样式创建辅助 ──────────────────────────────────

func createHeaderStyle(f *excelize.File) (int, error) {
	return f.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Bold:  true,
			Size:  11,
			Color: headerFontColor,
		},
		Fill: excelize.Fill{
			Type:    "pattern",
			Color:   []string{headerFillColor},
			Pattern: 1,
		},
		Alignment: &excelize.Alignment{
			Horizontal: "center",
			Vertical:   "center",
		},
		Border: []excelize.Border{
			{Type: "bottom", Color: "AAAAAA", Style: 1},
		},
	})
}

func createMoneyStyle(f *excelize.File) (int, error) {
	return f.NewStyle(&excelize.Style{
		NumFmt: 4, // #,##0.00
		Alignment: &excelize.Alignment{
			Horizontal: "right",
		},
	})
}

func createRefundStyle(f *excelize.File) (int, error) {
	return f.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Color: refundFontColor,
		},
	})
}

func createRefundMoneyStyle(f *excelize.File) (int, error) {
	return f.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Color: refundFontColor,
		},
		NumFmt: 4, // #,##0.00
		Alignment: &excelize.Alignment{
			Horizontal: "right",
		},
	})
}

func createSummaryKeyStyle(f *excelize.File) (int, error) {
	return f.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Bold:  true,
			Size:  11,
			Color: summaryKeyColor,
		},
	})
}

func createSummaryValStyle(f *excelize.File) (int, error) {
	return f.NewStyle(&excelize.Style{
		Font: &excelize.Font{
			Bold: true,
			Size: 12,
		},
		Alignment: &excelize.Alignment{
			Horizontal: "right",
		},
	})
}

// ── 辅助函数 ──────────────────────────────────

func loadEmployeeNameMap() map[string]string {
	var employees []models.Employee
	models.DB.Find(&employees)
	m := make(map[string]string, len(employees))
	for _, e := range employees {
		m[e.WecomUserID] = e.Name
	}
	return m
}

func resolveName(nameMap map[string]string, id string) string {
	if id == "" {
		return ""
	}
	if name, ok := nameMap[id]; ok {
		return name
	}
	return id
}

func getOrCreatePerf(m map[string]*perfData, id, role string) *perfData {
	pd, ok := m[id]
	if !ok {
		pd = &perfData{Name: id, Role: role}
		m[id] = pd
	}
	return pd
}
