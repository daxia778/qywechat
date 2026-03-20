# 代码审查报告 (第三版)
- 项目：PDD 派单管理系统
- 日期：2026-03-20
- 模式：dry-run（只报告不修复）
- 审查范围：新增模块增量审查（Customer、GrabMonitor、Contact、前后端数据连接）
- 审查轮次：第 3 轮（基于 5 任务并行开发后的代码）

## 审查范围

### 后端（10 文件）
- server/models/customer.go, server/services/customer.go, server/services/grab_monitor.go
- server/handlers/customer_handler.go, server/handlers/contact_handler.go
- server/handlers/wecom_handler.go, server/handlers/admin_handler.go
- server/services/wecom.go, server/services/order.go, server/main.go

### 前端（10 文件）
- CustomersPage.jsx, customers.js, DashboardPage.jsx, TeamPage.jsx
- OrderDetailPage.jsx, OrdersPage.jsx, AppShell.jsx
- WebSocketContext.jsx, constants.js, router/index.jsx

---

## 发现的问题（按严重程度）

### 🔴 严重（共 6 项）❌ 未修复

**后端：**
1. **[services/grab_monitor.go:75-76,89] AssignedAt 空指针 panic**
   - `order.AssignedAt.Format(...)` 和 `time.Since(*order.AssignedAt)` 未做 nil 检查
   - SQL 虽有 IS NOT NULL，但 GORM 某些驱动可能返回零值
   - goroutine 无 recover，panic 会导致监控永久停止
   - 建议：循环开头添加 `if order.AssignedAt == nil { continue }`

2. **[services/grab_monitor.go:128] GetGrabAlerts 同样存在 nil 解引用**
   - `int(time.Since(*o.AssignedAt).Minutes())` — API handler 中 panic 会导致 500
   - 建议：同 #1 添加 nil 检查

3. **[handlers/wecom_handler.go:224-228,281-286] 诊断接口暴露 corp_id/agent_id**
   - WecomDiagnostic 响应直接返回企微企业标识
   - admin 账号被盗可获取企微身份
   - 建议：脱敏（前4后4）或仅返回 "已配置" 布尔值

4. **[services/wecom.go:116,140,191...] access_token 在 URL 中，日志泄露风险**
   - 企微 API 设计限制，但服务端错误日志可能记录完整 URL
   - 建议：error log 中对 token 做脱敏处理

**前端：**
5. **[router/index.jsx:125] /customers 路由缺少角色守卫**
   - 位于 RequireRole 包裹之外，designer 角色可访问全部顾客 PII（手机号、微信号）
   - 建议：移入 `RequireRole roles={['admin', 'operator']}` 包裹

6. **[CustomersPage.jsx:32-44] 首次加载无 loading 状态**
   - `loading` 初始值为 `false`，首次 fetch 未设置 loading
   - 导致 "暂无顾客" 空状态短暂闪现
   - 建议：`useState(true)` 或首次加载也设 loading

### 🟡 警告（共 14 项）❌ 未修复

**后端：**
7. **[services/wecom.go:481] TestSendMessage 发送给 @all 全员**
   - 诊断功能每次调用给全企业发消息，造成骚扰
   - 建议：改为只发送给当前管理员自身

8. **[handlers/wecom_handler.go:159] handleAddExternalContact 未区分 DB 错误类型**
   - 所有 Error != nil 都当作"不存在"处理，DB 异常会掩盖真实故障
   - 建议：检查 `gorm.ErrRecordNotFound`

9. **[services/customer.go:22-58] FindOrCreateCustomer 竞态条件（TOCTOU）**
   - 先查后建不在事务中，mobile/wechat_id 无唯一索引
   - 并发请求相同 contact 可创建重复记录
   - 建议：改用 `FirstOrCreate` 或添加唯一索引

10. **[services/customer.go:84,87-90] UpdateCustomerStats 两次 DB 写入无事务**
    - 两次写操作错误返回值被丢弃，存在不一致风险
    - 建议：合并为一次 SQL 或使用事务

11. **[services/order.go:591-595] GrabAlertCount vs GetGrabAlerts 语义不一致**
    - Dashboard 查 `grab_alert_sent = false`（未告警），API 查所有超时
    - 建议：统一语义或明确命名

12. **[services/order.go:607] 昨日异常抢单时间窗口计算错误**
    - `yesterdayStart - 30min` 作为下界，与"昨日异常抢单数"业务含义不符
    - 建议：改为 assigned_at 在昨日范围内且超时的订单

13. **[services/grab_monitor.go:116-131,144-168] N+1 查询**
    - GetGrabAlerts 每个订单查一次 employee
    - GetDesignerGrabStats 每个设计师 2 次 COUNT
    - 建议：批量查询 + GROUP BY 聚合

14. **[services/order.go:442-473] Dashboard 加载全量订单对象仅为计数求和**
    - 多处 Find(&orders) 后 Go 遍历求和，应改为 SQL 聚合
    - 建议：SELECT COUNT(*), SUM(price) 替代

15. **[services/grab_monitor.go:26-32, order.go:276,343] 后台 goroutine 无 panic recovery**
    - GrabMonitor、TimeoutWatcher、DeadlineReminder 均无 defer recover
    - 任何 panic 导致定时任务永久停止，主程序无感知
    - 建议：添加 defer recover + 自动重启

16. **[services/wecom.go:168,422,496] json.Unmarshal 错误被忽略**
    - 企微返回非 JSON（502 页面）时误判为成功
    - 建议：检查 Unmarshal 错误返回值

**前端：**
17. **[OrdersPage.jsx:217] CSS 类冲突**
    - `py-2.5` 和 `py-1.5` 冲突，`rounded-xl` 和 `rounded-lg` 冲突
    - 建议：移除多余的冲突类

18. **[CustomersPage.jsx:108] handleSave 中 fetchCustomers 未 await**
    - 详情面板刷新可能与列表不一致
    - 建议：添加 await

19. **[OrderDetailPage.jsx:61] 响应取值链模糊**
    - `res.data.data || res.data` 不确定后端格式
    - 建议：与后端对齐统一响应结构

20. **[OrdersPage.jsx:289] memo 失效 — openMoreMenu 导致全行重渲染**
    - 菜单 toggle 时所有 OrderRow 重新渲染
    - 建议：改为 `isMenuOpen` 布尔值 prop

### 🔵 建议（共 10 项）❌ 未修复

21. **[customer_handler.go:76-81] UpdateCustomer 无法清空 nickname/remark**
22. **[services/wecom.go:355,388] URL 参数未做 QueryEscape**
23. **[services/customer.go:103] LIKE 前缀通配符无法利用索引**
24. **[services/customer.go:126] GetCustomerWithOrders 未分页**
25. **[OrderDetailPage.jsx:263] wecom_chat_id 暴露给设计师角色**
26. **[CustomersPage.jsx:382-390] 内联 style@keyframes 重复注入**
27. **[AppShell.jsx:30-33] filteredNavRoutes 缺少 useMemo**
28. **[CustomersPage.jsx:52-66] 手动防抖 vs 已有 useDebounce hook 不统一**
29. **[DashboardPage.jsx:42-45] profitMargin useMemo 计算但从未使用（死代码）**
30. **[TeamPage.jsx:82,86] 魔法数字 10 硬编码（设计师容量上限）**

---

## 修复统计

### 本轮
- 总发现：30 个问题
- 已修复：0 个（dry-run 模式）
- 待处理：30 个

### 累计（含前两轮）
- 总发现：45 + 30 = 75 个问题（去重后）
- 已修复：41 个（前 5 轮审查修复）
- 待处理：30 个（本轮新发现）
- 整体关闭率：**55%** (41/75)

## 修复优先级建议

### P0 — 立即修复（安全+崩溃）
1. grab_monitor.go AssignedAt nil panic（#1, #2）— 会导致监控 goroutine 永久停止
2. router/index.jsx /customers 角色守卫缺失（#5）— 顾客 PII 数据泄露
3. 后台 goroutine 添加 panic recovery（#15）— #1/#2 的安全网

### P1 — 本周修复（逻辑+性能）
4. FindOrCreateCustomer 竞态条件（#9）
5. DB 错误类型未区分（#8）
6. Dashboard 全量加载改 SQL 聚合（#14）
7. N+1 查询优化（#13）
8. 敏感信息脱敏（#3, #4）
9. CustomersPage loading 状态（#6）

### P2 — 排期优化
10. 前端性能（memo 失效、useMemo、防抖统一）
11. 代码质量（死代码、魔法数字、CSS 冲突）
12. 企微 API 错误处理（json.Unmarshal、URL 编码）

---
*报告由 auto-review (dry-run) 自动生成*
*第 3 轮 / dry-run 模式 / max-rounds 2*
*数据来源：review-backend-r3, review-frontend-r3 两个审查代理*
