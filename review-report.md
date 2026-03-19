# 代码审查报告 (第二版)
- 项目：PDD 派单管理系统
- 日期：2026-03-19
- 模式：dry-run（只报告不修复）
- 审查范围：全项目增量审查（基于第一轮修复后的代码）
- 审查轮次：第 2 轮

## 第一轮修复回顾

第一轮发现 33 个问题，已修复 18 个：

| 修复项 | 状态 |
|---|---|
| Dockerfile Go 1.25→1.24 | ✅ 已修复 |
| docker-compose JWT/密码弱 fallback | ✅ 已修复 |
| ListOrders/GetOrderDetail/GetOrderTimeline 权限校验 | ✅ 已修复 |
| 密码输入框 type=password | ✅ 已修复 |
| NAV_ROUTES icon HTML→React 组件 | ✅ 已修复 |
| WebSocket token URL→首帧认证 | ✅ 已修复 |
| AuthContext localStorage→storage.js | ✅ 已修复 |
| GetRevenueChart N+1→聚合查询 | ✅ 已修复 |
| GetTeamWorkload N+1 优化 | ✅ 已修复 |
| CSRF token store 数量上限 | ✅ 已修复 |
| Vue 遗留文件清理 (6个) | ✅ 已修复 |
| 旧 Badge.jsx 删除 | ✅ 已修复 |
| build.sh npm install→npm ci | ✅ 已修复 |
| .env.example JWT 示例值 | ✅ 已修复 |
| WebSocket 后端首帧认证同步 | ✅ 已修复 |
| order_handler.go slices.Contains | ✅ 已修复 |
| ws.go slices.Contains + any | ✅ 已修复 |
| admin_handler.go 聚合查询重构 | ✅ 已修复 |

## 第二轮增量审查 — 新发现的问题

### 🔴 严重（共 1 项）❌ 未修复

1. **[server/services/ocr_test.go:83] 编译错误 — parseDashscopeContent 未定义**
   - `go test ./services/...` 编译失败
   - 函数可能被重命名或未导出
   - 影响：CI 测试 pipeline 无法通过
   - 建议：检查 ocr.go 中对应函数，修正测试引用

### 🟡 警告（共 11 项）❌ 未修复

**后端（修复引入的新问题）:**
1. **[handlers/ws.go] 空 Origin 被放行**
   - WebSocket 握手未拒绝空 Origin 请求
   - 建议：拒绝空 Origin 或限制为已知域名

2. **[handlers/ws.go] JWT claims sub 为空时仍注册匿名 WS 连接**
   - 认证通过但 sub 为空的 token 可建立无身份连接
   - 建议：sub 为空时拒绝连接

3. **[middleware/csrf.go] 触发上限时全量清空，所有在线用户 CSRF 失效**
   - 清空策略过于粗暴，应改为 LRU 淘汰最旧 token
   - 建议：使用带过期时间的 map 或 LRU cache

4. **[handlers/order_handler.go] GetOrder 先查库再鉴权，订单存在性信息泄露**
   - 攻击者可通过 403 vs 404 判断订单是否存在
   - 建议：统一返回 404 或先鉴权再查库

5. **[WebSocketContext.jsx:110-114] 认证竞态 — 状态先于认证完成设为 CONNECTED**
   - onopen 时立即 CONNECTED + 刷新消息队列，但后端还没验证 token
   - 建议：后端回复 `{type:"auth_ok"}` 后才设 CONNECTED

6. **[storage.js:22] setAuth 中 token 无条件写入**
   - 若 token 为 undefined，localStorage 存入字符串 "undefined"
   - 导致 isAuthenticated 为 true 但请求全部 401
   - 建议：`if (token) localStorage.setItem(...)`

7. **[docker-compose.yml:11,34] PG_PASSWORD 仍有弱默认值 changeme**
   - 建议：改为 `${PG_PASSWORD:?PG_PASSWORD must be set}`

**仍存在的第一轮未修复问题:**
8. [server/.env] 真实密钥存在于本地文件（.gitignore 已排除，低风险）
9. [OrderDetailPage.jsx:121] order.price 无 null 保护，渲染 ¥NaN
10. [ToastContext.jsx:12] setTimeout 无清理引用，潜在内存泄漏
11. [deploy/nginx.conf:26-27] TLS 证书路径为占位符

**配置/测试:**
- [Dockerfile:12] CGO_ENABLED=1 但运行镜像缺 sqlite-libs，可能运行时崩溃
- [ci.yml:21] CI go build 未设 CGO_ENABLED=1，与 Dockerfile 不一致
- [.env.example:28] DEPLOY_MODE 默认 debug，直接 cp 使用会绕过 JWT 强度检查

### 🔵 建议（共 8 项）❌ 未修复

1. [admin_handler.go] startDate 时区截断依赖服务器本地时区，可能差 8 小时
2. [order_handler.go] 非 admin 可传 operator_id/designer_id 参数（无绕过风险，建议静默忽略）
3. [constants.js:44] NavIcon 在模块级调用非组件形式，cloneElement 时有隐患
4. [AuthContext.jsx:36] checkToken 直接读 localStorage 而非使用 state token
5. [order_handler_test.go] 多处 time.Sleep(100ms) 等待 async，CI 慢机器脆弱
6. [profit_test.go] 测试自定义函数而非生产代码
7. [handlers/employee_handler.go] ListEmployees 暴露敏感字段
8. [多处] /100 分→元换算未统一封装

### 🟢 正面亮点（第二轮确认）

- ✅ N+1 查询已彻底消除（GetRevenueChart + GetTeamWorkload）
- ✅ 角色权限过滤完整（ListOrders/GetOrderDetail/GetOrderTimeline）
- ✅ 分润数据仅 admin 可见
- ✅ XSS 修复完整（dangerouslySetInnerHTML 全部替换）
- ✅ WebSocket 首帧认证架构正确
- ✅ Vue 遗留文件 100% 清理
- ✅ storage.js 封装覆盖完整
- ✅ SQL 注入防护完备
- ✅ 抢单并发安全（原子 UPDATE + 写锁）

## 修复统计

### 累计
- 总发现：33 + 12 = 45 个问题（去重后）
- 已修复：18 个（第一轮修复）
- 待处理：20 个
  - 🔴 严重：1 个（ocr_test 编译错误）
  - 🟡 警告：11 个（安全 + 竞态 + 配置）
  - 🔵 建议：8 个（代码质量 + 测试质量）
- 已关闭（不再适用）：7 个（第一轮问题已被修复覆盖）

### 修复率
- 第一轮问题修复率：**55%** (18/33)
- 整体问题关闭率：**56%** (25/45)

## 建议下一步修复优先级

### P0 — 立即修复（影响 CI/构建）
1. ocr_test.go 编译错误 — 修正函数引用
2. Dockerfile CGO sqlite-libs — 运行时崩溃风险

### P1 — 本周修复（安全加固）
3. WebSocket 认证竞态 — 前后端协商 auth_ok 协议
4. CSRF store 改 LRU 淘汰策略
5. setAuth token 防御性检查
6. GetOrder 先鉴权再查库
7. PG_PASSWORD 弱默认值

### P2 — 排期优化
8. 时区处理、测试质量、代码规范

---
*报告由 auto-review (dry-run) 自动生成*
*第 2 轮 / 共 3 轮（max-rounds 3）*
*数据来源：review-backend-r2, review-frontend-r2, review-config-r2 三个审查代理*
*上一轮报告已合并，修复状态已更新*
