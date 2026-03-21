# PDD 派单管理系统 — 深度代码审计报告 V2

**审计日期**: 2026-03-21
**审计范围**: 46 Go 文件 + 40+ 前端文件 + Docker/Nginx/部署配置
**审计团队**: 8 Agent 并行（安全×2 / 后端质量×2 / 前端×2 / 架构部署×2）
**项目规模**: ~8000 行 Go + ~6000 行 JSX/JS

---

## 审计概览

| 维度 | P0 严重 | P1 重要 | P2 改进 | 小计 |
|------|---------|---------|---------|------|
| 安全漏洞 | 6 | 10 | 8 | 24 |
| 后端质量 | 7 | 10 | 12 | 29 |
| 前端质量 | 3 | 11 | 15 | 29 |
| 架构部署 | 3 | 9 | 11 | 23 |
| **合计（去重）** | **15** | **34** | **40** | **89** |

### 正面评价（做得好的方面）

1. SQL 注入防护完善 — 全部 GORM 查询使用参数化绑定
2. JWT 签名算法正确校验 `*jwt.SigningMethodHMAC`，防止 algorithm confusion 攻击
3. 密码存储规范 — bcrypt DefaultCost, PasswordHash 字段 `json:"-"` 不泄露
4. CSRF 实现安全 — crypto/rand 生成 token，原子化 check-and-delete
5. 安全响应头完整 — HSTS/CSP/X-Frame-Options/X-Content-Type-Options
6. 暴力破解防护 — Fail2Ban + Token Bucket 双重防护
7. CSV 导出防注入 — `sanitizeCSVCell` 正确处理公式注入
8. 抢单并发控制 — 乐观锁 `UPDATE WHERE status + RowsAffected`
9. WebSocket Origin 校验 + 首帧认证 + 10 秒超时
10. Docker 多阶段构建 + 非 root 用户 + exec 形式 ENTRYPOINT

---

## P0 严重问题（15个）

### [P0-01] uploads 目录公开可访问，无认证保护
- **文件**: `main.go:106`
- **代码**: `r.Static("/uploads", "uploads")` 注册在认证中间件之外
- **影响**: 任何人可直接访问 OCR 截图，截图含客户订单号、金额等 PII
- **修复**: 改为 JWT 保护下的 handler 提供文件，或使用签名 URL

### [P0-02] WriteTx 互斥锁与连接池矛盾 + 20+ 处写操作绕过 WriteTx
- **文件**: `models/db.go:69-71` + services/handlers 多处
- **问题**: `MaxOpenConns=8` 但 WriteTx 用 Mutex，直接 `models.DB` 写不受保护
- **绕过点（完整清单）**:

| 文件 | 行号 | 操作 |
|------|------|------|
| `services/order.go` | 290 | `Update("assign_retry_count")` |
| `services/order.go` | 330 | `Update("wecom_chat_id")` |
| `services/order.go` | 382 | `Update("deadline_reminded")` |
| `services/grab_monitor.go` | 57 | `Create(&Notification{})` |
| `services/grab_monitor.go` | 94 | `Update("grab_alert_sent")` |
| `services/wecom_sync.go` | 32 | `Create(&WecomGroupChat{})` |
| `services/wecom_sync.go` | 44 | `Model.Updates(...)` |
| `services/wecom_sync.go` | 55 | `Create(&WecomMessageLog{})` |
| `services/wecom_sync.go` | 125,140 | 循环内 Create/Updates |
| `services/wecom_sync.go` | 197-201 | 三个 Delete 操作 |
| `services/customer.go` | 53 | `Create(&Customer{})` |
| `services/customer.go` | 84,87 | `Model.Updates` / `DB.Exec` |
| `services/customer.go` | 174-176 | `Model.Update(...)` |
| `handlers/auth_handler.go` | 180 | DeviceLogin 更新 last_login |
| `handlers/auth_handler.go` | 239 | AdminLogin 更新 last_login |
| `handlers/admin_handler.go` | 179 | CreateEmployee `DB.Create` |
| `handlers/admin_handler.go` | 462 | RegenerateActivationCode `DB.Updates` |
| `handlers/wecom_handler.go` | 166,178 | 客户创建/更新 |
| `models/audit.go` | 47 | WriteAuditLog `DB.Create` |

### [P0-03] JWT 无撤销机制 — 密码重置/禁用后旧令牌仍可使用 24 小时
- **文件**: `middleware/auth.go:54-65`
- **场景**: 管理员重置密码/禁用员工，旧 JWT 在过期前仍有效
- **修复**: Employee 模型增加 `token_version`，JWT claims 中签入并校验

### [P0-04] SQLite 备份采用文件拷贝可能损坏
- **文件**: `services/backup.go:50-51`
- **问题**: `io.Copy` 在写事务进行中复制会产生损坏文件
- **修复**: 使用 `models.DB.Exec("VACUUM INTO ?", backupPath)`

### [P0-05] Debug 模式硬编码弱密码 Admin123!
- **文件**: `config/config.go:143-145`
- **问题**: 部署忘设环境变量 + ngrok 隧道暴露 = 直接被登录
- **修复**: debug 模式也用 crypto/rand 生成随机密码

### [P0-06] 审计日志写入失败完全静默
- **文件**: `models/audit.go:47`
- **问题**: `DB.Create(log)` 未检查错误，安全合规关键缺陷
- **修复**: 错误时写入 stdlog

### [P0-07] 企微回调未配置凭证时直接反射 echostr
- **文件**: `handlers/wecom_handler.go:62`
- **问题**: 用户可控参数原样返回，构成反射型回显漏洞
- **修复**: 未配置时返回 503

### [P0-08] 所有后台 goroutine (8个) 无退出机制
- **文件**: `main.go:47-65` + services 各调度器
- **问题**: 无 context.Context 或 stop channel，SIGTERM 后仍在运行
- **修复**: 传递可取消 context，select 监听 ctx.Done()

### [P0-09] FindOrCreateCustomer TOCTOU 竞态可创建重复顾客
- **文件**: `services/customer.go:22-58`
- **问题**: 先查后写无唯一约束兜底
- **修复**: 添加条件唯一索引 + WriteTx 包裹

### [P0-10] CSV 导出/Dashboard 全量加载到内存可 OOM
- **文件**: `handlers/export.go:68-69`, `services/order.go:442-447`
- **问题**: `Find(&orders)` 全量加载，数据量增长后可溢出
- **修复**: CSV 用 `Rows()` 游标，Dashboard 用 SQL 聚合

### [P0-11] S3 客户端初始化存在竞态条件
- **文件**: `services/oss.go:97-136`
- **问题**: check-then-set 无锁，并发上传时 data race
- **修复**: 使用 `sync.Once`

### [P0-12] JWT Token 暴露在 URL 中（CSV 导出）
- **文件**: `admin-web/src/api/admin.js:20`
- **代码**: `window.open(\`...&token=${getToken()}\`, '_blank')`
- **问题**: Token 泄露到浏览器历史、Nginx 日志、Referer 头
- **修复**: 改用 fetch + Blob 下载，或后端实现一次性 nonce

### [P0-13] JWT Token 存储在 localStorage
- **文件**: `admin-web/src/utils/storage.js:7`
- **问题**: 同源下任何 XSS 可窃取 token
- **修复**: 改用 HttpOnly + Secure + SameSite cookie

### [P0-14] ECharts Tooltip HTML 注入风险
- **文件**: `admin-web/src/pages/RevenuePage.jsx:204-215`
- **问题**: `formatter` 返回未转义的 HTML 字符串
- **修复**: 对动态值做 HTML 转义

### [P0-15] Nginx 端口暴露无速率限制
- **文件**: `docker-compose.yml:69-71`
- **问题**: 80/443 绑定 0.0.0.0，Nginx 无 `limit_req_zone`
- **修复**: 添加 Nginx 层速率限制

---

## P1 重要问题（34个）

### 安全与认证 (10)

| # | 文件 | 描述 |
|---|------|------|
| 1 | `main.go:72` | ClientIP 可被伪造 — 未调用 `SetTrustedProxies()`，绕过所有 IP 安全机制 |
| 2 | `middleware/auth.go:56-61` | JWT 缺少 `iat`/`nbf`/`jti` claims |
| 3 | `middleware/password.go:10` | bcrypt 72 字节截断无上限校验 |
| 4 | `auth_handler.go:38` | 审计日志内容注入 — 用户名直接拼接 |
| 5 | `services/websocket.go:162` | WebSocket 广播未做角色过滤，低权限用户可接收他人订单 |
| 6 | `config/config.go:98` | JWT_SECRET debug 模式每次重启变化，token 失效 |
| 7 | `config/config.go:87` | PGSSLMode 可被设为 "disable" 无校验 |
| 8 | `models/customer.go:12-15` | Customer Mobile/WechatID 未脱敏 |
| 9 | `models/wecom_data.go:35` | WecomMember.Mobile 明文存储 |
| 10 | `docker-compose.yml:48` | 默认管理员密码无复杂度校验 |

### 后端质量 (10)

| # | 文件 | 描述 |
|---|------|------|
| 11 | `handlers/order_handler.go:306` | "follow" 角色无法查看订单，落入 default 返回 403 |
| 12 | `services/grab_monitor.go:116` | N+1 查询 — GetGrabAlerts 循环查设计师姓名 |
| 13 | `services/grab_monitor.go:144` | N+1 查询 — GetDesignerGrabStats 每人 2 次查询 |
| 14 | `handlers/ws.go:149` | N+1 查询 — GetOrderDetail 逐条查操作人/设计师 |
| 15 | `services/wecom.go:168,422` | json.Unmarshal 错误被静默忽略 |
| 16 | `services/ocr.go:132,175` | 生产日志输出完整 API 响应含客户 PII |
| 17 | `services/backup.go:26` | os.MkdirAll 错误被忽略 |
| 18 | `handlers/order_handler.go:112` | CreateOrder 重复订单号返回 500 应为 409 |
| 19 | `models/db.go:52` | SQLite `_synchronous=NORMAL` 断电可丢事务 |
| 20 | `handlers/admin_handler.go:227` | 密码重置用错误的 AuditAction 常量 |

### 前端 (11)

| # | 文件 | 描述 |
|---|------|------|
| 21 | `LoginPage.jsx:50-60` | requestAnimationFrame 未清理 |
| 22 | `OrdersPage.jsx:49-68` | fetchOrders 缺 AbortController |
| 23 | `OrderDetailPage.jsx:63-71` | 客户详情请求缺取消机制 |
| 24 | `OrdersPage.jsx:66-73` | 搜索关键词变化时竞态条件（双重请求） |
| 25 | `ActivationCodesPage.jsx:21` | 回调函数存储在 state 中 |
| 26 | `AppShell.jsx:110-122` | 通知操作缺错误处理 |
| 27 | `App.jsx:6 + main.jsx:3` | index.css 被重复导入 |
| 28 | `utils/cn.js:1-2` | 引用未安装依赖 tailwind-merge/clsx |
| 29 | `CustomersPage.jsx:239-391` | Slide-over 面板缺焦点管理和 Escape 键 |
| 30 | `OrdersPage.jsx:156-163` | 图片灯箱缺键盘支持 |
| 31 | `api/client.js:34-37` | 多个并发 401 重复触发 logout |

### 架构部署 (3)

| # | 文件 | 描述 |
|---|------|------|
| 32 | `services/oss.go:46-48` | 文件类型校验仅基于扩展名，未校验 Magic Bytes |
| 33 | `services/websocket.go:63` | 无单用户 WS 连接数上限 (DoS) |
| 34 | `deploy/nginx.conf:42` | CSP 允许 `unsafe-inline` |

---

## P2 改进建议（40个）

### 后端 (19)

| # | 描述 |
|---|------|
| 1 | 7 个后台 goroutine 均无 context 优雅关闭 |
| 2 | 限速器清理 goroutine 泄漏 |
| 3 | security.go init() goroutine 无 stop |
| 4 | Wecom 通知错误丢弃未日志 |
| 5 | 6 处 ShouldBindJSON 错误信息暴露内部结构 |
| 6 | SQLite 特有函数 julianday/strftime 锁定数据库 |
| 7 | LIKE 查询中用户可注入通配符 |
| 8 | 冒泡排序应替换为 sort.Slice |
| 9 | 角色鉴权 switch 重复 4 次应提取公共函数 |
| 10 | Login/DeviceLogin/AdminLogin 流程高度重复 |
| 11 | 路由不完全 RESTful |
| 12 | 硬编码数字状态码应用常量 |
| 13 | 30+ 运行参数硬编码应提升为配置项 |
| 14 | 分润费率无范围校验 |
| 15 | generateUsername TOCTOU 竞态 |
| 16 | handlers/common.go init() 与 main.go 重复创建目录 |
| 17 | NoRoute API 路径应返回 404 JSON |
| 18 | health 端点暴露 uptime 信息 |
| 19 | PKCS7 Unpadding 未验证所有 padding 字节 |

### 前端 (15)

| # | 描述 |
|---|------|
| 20 | 确认弹窗/Modal 状态管理模式重复 4 处 |
| 21 | 按钮样式类名大量内联重复，未用 Button 组件 |
| 22 | ActivationCodesPage StatCard 与全局同名组件冲突 |
| 23 | EmployeeRow 内部重新定义同名常量 shadowing |
| 24 | CustomersPage 手动防抖未复用 useDebounce |
| 25 | 内联 style 标签定义动画 |
| 26 | TeamPage 初始加载失败无用户反馈 |
| 27 | RevenuePage 数据获取不支持取消 |
| 28 | WebSocket URL 不支持自定义后端地址 |
| 29 | chunk 重载逻辑可能导致循环刷新 |
| 30 | ConfirmModal aria-labelledby 使用硬编码 ID |
| 31 | EmployeesPage Credential Modal 缺可访问性 |
| 32 | MetricCard 不必要的 React 默认导入 |
| 33 | vite 未配置 source map 策略 |
| 34 | AuthContext role 默认回退 'admin' 应为最低权限 |

### 架构部署 (6)

| # | 描述 |
|---|------|
| 35 | Dockerfile 镜像标签未固定 digest |
| 36 | 二进制未使用 -trimpath 编译 |
| 37 | Nginx 静态资源 add_header 覆盖上层安全头 |
| 38 | 缺少 CI/CD 配置和自动化测试 |
| 39 | 缺少结构化日志 (slog/zerolog) |
| 40 | 缺少 Prometheus metrics 端点 |

---

## 修复优先级路线图

### Phase 1 — 立即修复（安全关键）
1. **uploads 目录加鉴权** (P0-01)
2. **services 层 WriteTx 全覆盖** (P0-02, 20+ 处)
3. **echostr 回显漏洞** (P0-07)
4. **JWT token URL 暴露** (P0-12)
5. **审计日志错误处理** (P0-06)
6. **Debug 默认密码改随机** (P0-05)
7. **SQLite 备份改 VACUUM INTO** (P0-04)

### Phase 2 — 短期修复（1-2周）
8. **JWT 撤销机制** (P0-03)
9. **ClientIP 可信代理配置** (P1-1)
10. **文件上传 Magic Bytes 校验** (P1-32)
11. **WS 连接数限制** (P1-33)
12. **follow 角色权限** (P1-11)
13. **N+1 查询优化** (P1-12/13/14)
14. **前端 AbortController 统一** (P1-22/23)

### Phase 3 — 中期优化（迭代中）
15. **JWT 迁移 HttpOnly cookie** (P0-13)
16. **goroutine 优雅关闭** (P0-08)
17. **CSV 导出流式写入** (P0-10)
18. **Nginx CSP 去 unsafe-inline** (P1-34)
19. **CI/CD 流水线** (P2-38)

---

## 健康评分

| 维度 | 得分 | 评价 |
|------|------|------|
| 安全性 | 62/100 | WriteTx 不完整、uploads 无鉴权、token 存储不安全、JWT 无撤销 |
| 代码质量 | 70/100 | handler 层好、services 层错误处理薄弱、N+1 查询 |
| 前端质量 | 72/100 | 架构合理、AbortController/节流不完善、可访问性有缺口 |
| 架构部署 | 75/100 | Docker 配置好、缺 CI/CD 和结构化日志 |
| **综合** | **70/100** | 中上水平，最集中的风险在 WriteTx 覆盖率和认证安全 |

---

*审计人: Claude Opus 4.6 — 8 Agent Team*
*生成时间: 2026-03-21*
