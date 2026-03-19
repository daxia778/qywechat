# PDD 派单管理系统 -- 架构健康度审查报告

**审查日期**: 2026-03-19
**审查人**: 系统架构师 (Architect Agent)
**项目阶段**: MVP 完成，进入优化和功能补全阶段

---

## 架构健康度总评分: 7.2 / 10

项目整体架构清晰，分层合理，安全防护做得相当到位。对于一个面向 10-20 人团队、日单量 60-100 的内部系统来说，技术选型务实且适当。主要扣分项在：handler 层存在部分越权直操数据库的代码坏味道、缺少统一错误处理机制、SQLite 备份方式不够安全、以及若干性能隐患。

---

## 一、server/ 分层架构评价

### 1.1 整体分层 (评分: 7/10)

```
config/     -- 配置加载 (单一职责，良好)
models/     -- 数据模型 + DB 初始化 (职责适中)
handlers/   -- HTTP 处理器 (存在部分越权)
services/   -- 业务逻辑 (核心业务集中于此，良好)
middleware/ -- 横切关注点 (安全、认证、限速，良好)
```

**优点**:
- 分层边界总体清晰，业务核心逻辑（订单创建/抢单/状态流转/自动派单）集中在 `services/order.go`
- `models/` 只定义数据结构和 DB 初始化，没有业务逻辑污染
- `middleware/` 职责单一，每个文件对应一个横切关注点
- `WriteTx()` 封装了 SQLite 写串行化，对上层透明

**问题**:

#### [P1] Handler 越权直操数据库

以下 handler 绕过 service 层直接操作 `models.DB`，违反分层原则：

| 文件 | 行号 | 问题 |
|------|------|------|
| `admin_handler.go` | L46 | `GetRevenueChart` 直接 `models.DB.Where(...).Find(&orders)` 循环逐天查询 |
| `admin_handler.go` | L90-94 | `ListEmployees` 直接 `models.DB.Find(&employees)` |
| `admin_handler.go` | L113-168 | `CreateEmployee` 直接操作 `models.DB` 做存在性检查和创建 |
| `admin_handler.go` | L193-199 | `toggleEmployeeActive` 直接 `models.DB.Save(&emp)` |
| `admin_handler.go` | L238 | `UnbindDevice` 直接 `models.DB.Model(&emp).Update(...)` |
| `admin_handler.go` | L246-269 | `GetTeamWorkload` 直接在 handler 中逐员工查询订单数 |
| `admin_handler.go` | L289 | `ListActivationCodes` 直接查询 |
| `admin_handler.go` | L314-331 | `ListAuditLogs` 直接查询 |
| `order_handler.go` | L176 | `GrabOrder` 中异步 goroutine 直接 `models.DB.Model(order).Update(...)` |
| `order_handler.go` | L228-231 | `UpdateOrderStatus` 中直接 `models.DB.First(&order, ...)` |
| `order_handler.go` | L251 | `UpdateOrderStatus` 退款原因更新直接用 `models.WriteTx` |
| `order_handler.go` | L264 | `UpdateOrderStatus` 时间线记录直接 `models.DB.Create(...)` |
| `order_handler.go` | L299-329 | `ListOrders` 完整的查询逻辑在 handler 中 |
| `order_handler.go` | L344 | `GetOrder` 直接查询 |

**影响**: 当前规模下尚可接受，但随着业务增长会导致：逻辑分散难测试、重复代码、事务边界不清晰。

**建议**: 将所有数据库操作下沉到 `services/` 或新建 `repository/` 层。handler 只做参数校验、调用 service、返回响应。

#### [P2] Service 层缺少员工管理服务

`services/` 中有 `order.go`、`wecom.go`、`ocr.go`、`websocket.go`、`backup.go`、`cleanup.go`，但**没有** `employee.go`。所有员工相关逻辑散落在 `admin_handler.go` 中。

#### [P3] 统计查询逻辑在 Handler 中

`GetRevenueChart` (admin_handler.go:L27-73) 用 Go 循环逐天查询数据库并在内存中计算总和。这应该是一个 SQL 聚合查询，放在 service 层中。相比之下，`GetDashboardStats` (services/order.go:L397-524) 做得很好，使用了批量聚合查询避免 N+1。

### 1.2 models/ 层 (评分: 8/10)

**优点**:
- 数据结构定义清晰，GORM tag 规范
- 状态机 (`ValidTransitions`, `StatusChangePermission`) 定义在 model 层是正确的位置
- `WriteTx()` 封装 SQLite 写串行化，设计精准
- SQLite 连接参数配置合理：WAL 模式、30s busy_timeout、外键开启
- 手动索引补充 (`ensureIndexes`) 弥补了 AutoMigrate 的不足

**问题**:
- `models/audit.go`, `models/timeline.go`, `models/notification.go`, `models/wecom_data.go` 存放了辅助模型，结构合理
- Employee 模型字段较多（19 个字段），但对当前业务规模是可接受的

### 1.3 middleware/ 层 (评分: 9/10)

**优点**:
- JWT 认证正确验证了签名算法（防 algorithm confusion 攻击）
- 暴力破解防护（Fail2Ban 思想）实现完整：10 分钟窗口、10 次触发、30 分钟封锁
- 限速器架构良好：每个中间件实例独立的 `rateLimiterStore`，不同路由组互不干扰
- 限速器有后台清理 goroutine（3 分钟一次清理 5 分钟未见的 IP）
- CSRF 防护已实现
- 安全头全覆盖（HSTS、CSP、X-Frame-Options 等）
- 可疑请求过滤拦截了常见扫描器路径
- 请求体大小限制双重防护（全局 2MB + 上传 10MB）
- 密码强度验证独立模块

**问题**:
- [P3] `BruteForceGuard` 的 `failMap` 是进程内存，重启后清零。在当前单实例部署下没问题，但扩展到多实例需要用 Redis。

---

## 二、admin-web/ 前端架构评价 (评分: 7/10)

### 2.1 组件结构

```
src/
  api/          -- HTTP 客户端 + 各模块 API (良好的关注点分离)
  components/   -- 通用组件 + ui/ 子目录
  contexts/     -- React Context (Auth, WebSocket, Toast)
  hooks/        -- 自定义 hooks (useAuth, useWebSocket, usePolling, useToast)
  pages/        -- 页面级组件 (7 个页面)
  router/       -- 路由配置
  utils/        -- 工具函数
```

**优点**:
- API 层封装得体：`client.js` 统一处理 JWT 注入、CSRF token、401 自动跳转
- WebSocket Context 实现成熟：指数退避重连、心跳机制、消息队列缓冲、连接状态管理
- Context 使用恰当，没有 prop drilling 问题
- `ui/` 子目录做了基础 UI 组件抽取（Button, Badge, Card, StatCard 等）

**问题**:

#### [P2] 页面组件可能职责过重

7 个页面文件承载了所有的业务逻辑。随着功能增长，`OrdersPage.jsx` 和 `DashboardPage.jsx` 可能变得过大。建议适时拆分为子组件。

#### [P3] 前端 Vue 遗留

CLAUDE.md 中提到 `views/` 目录下有旧 Vue 文件待清理，`admin-web-vue-backup/` 目录也仍存在于项目根目录。这是技术债务。

#### [P3] 缺少 TypeScript

项目使用纯 JSX，没有类型系统。对当前规模可接受，但随着团队和代码量增长，类型安全会成为痛点。

---

## 三、模块间耦合度分析 (评分: 7.5/10)

### 3.1 依赖关系图

```
main.go
  +-- config       (无外部依赖)
  +-- models        (依赖 config)
  +-- services      (依赖 config, models)
  +-- handlers      (依赖 models, services, middleware)
  +-- middleware     (依赖 config)
```

**结论**: 没有循环依赖。依赖方向是单向的：`handlers -> services -> models -> config`。这是健康的。

### 3.2 耦合问题

#### [P2] Handler 直接依赖 models 包

如 1.1 节所述，`handlers/` 大量直接 import 和使用 `models.DB`。理想状态下 handler 应该只依赖 `services/`（或接口），不直接操作数据层。

#### [P2] 全局变量耦合

以下全局变量被跨包直接引用：

| 变量 | 位置 | 引用方 |
|------|------|--------|
| `models.DB` | models/db.go | handlers/*, services/* |
| `services.Hub` | services/websocket.go | handlers/order_handler.go |
| `services.Wecom` | services/wecom.go | handlers/*, services/order.go |
| `config.C` | config/config.go | 全局 |

这些全局变量在当前单进程架构下没有实际问题，但阻碍了单元测试的 mock 注入。`config.C` 作为只读配置是可接受的。

#### [P3] handlers/common.go 的 init() 函数

`handlers/common.go` 中 `init()` 调用 `os.MkdirAll("uploads", 0o755)`，而 `main.go` 中也有相同调用。存在重复，且 `init()` 产生的副作用不够透明。

---

## 四、技术债务清单

按严重度排序：

### 严重 (P1) -- 应尽快修复

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | SQLite 备份使用文件拷贝而非 `sqlite3 .backup` | services/backup.go:L62-80 | WAL 模式下直接 `io.Copy` 可能拷贝到不一致的数据。正确做法是使用 SQLite 的 Online Backup API 或 `.backup` 命令 |
| 2 | `GetRevenueChart` 循环 N 次查询数据库 | admin_handler.go:L41-57 | 查看 90 天数据时会发起 90 次 DB 查询。应改为单条 SQL GROUP BY date 聚合 |
| 3 | `GetTeamWorkload` N+1 查询 | admin_handler.go:L257-279 | 每个员工一次 COUNT 查询。应改为 GROUP BY 聚合（参考 `GetDashboardStats` 中的做法） |

### 中等 (P2) -- 规划修复

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 4 | 缺少统一错误处理/响应格式 | handlers/*.go | 每个 handler 自行构造错误响应，格式不完全一致。应抽取统一的 `ErrorResponse(c, code, msg)` |
| 5 | 缺少 employee service 层 | handlers/admin_handler.go | 员工 CRUD 逻辑散落在 handler 中，违反分层 |
| 6 | 异步 goroutine 中的错误被静默丢弃 | order_handler.go:L116-129, L166-178 | `go func()` 中企微通知/建群失败只有 `_ = ...`，无重试、无告警 |
| 7 | OCR 图片完整读入内存后 base64 编码 | services/ocr.go:L52-65 | 大图片会消耗 ~4x 文件大小的内存。当前有 10MB 上传限制所以风险可控 |
| 8 | docker-compose 默认密码 | docker-compose.yml:L11,49 | `PG_PASSWORD:-changeme` 和 `ADMIN_DEFAULT_PASSWORD:-admin888` 作为默认值存在风险，虽然 config 层有生产环境检查 |
| 9 | `admin-web-vue-backup/` 目录残留 | 项目根目录 | 版本库中不应保留备份目录 |

### 低 (P3) -- 可后续优化

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 10 | JWT 无 `iat` (issued at) 和 `jti` (JWT ID) | middleware/auth.go:L56-61 | 无法做 token revocation。当前场景（内部系统、少量用户）可接受 |
| 11 | `UpdateOrderStatus` handler 中发送响应后仍有后续操作 | order_handler.go:L257-281 | `c.JSON(200, ...)` 在 L257，但 L260-281 还在写时间线、广播 WS、发通知。如果这些操作失败，客户端已收到成功响应 |
| 12 | 缺少结构化日志 | 全局 | 使用 `log.Printf` + emoji 前缀。生产环境建议用 `slog` 或 `zerolog`，输出 JSON 格式方便 ELK 采集 |
| 13 | S3 客户端懒初始化无并发保护 | services/oss.go:L97-99 | `if s3Client != nil` 检查不是线程安全的。可用 `sync.Once` |
| 14 | WebSocket 连接没有上限控制 | services/websocket.go | 理论上可以无限注册连接。当前用户规模 (10-20 人) 不是问题 |
| 15 | 前端缺少 TypeScript | admin-web/ | 随代码量增长会影响可维护性 |

---

## 五、性能瓶颈点分析

### 5.1 SQLite 并发 (评分: 7/10)

**已做的好**:
- WAL 模式 + `_busy_timeout=30000` + `_synchronous=NORMAL`
- `WriteTx()` 全局写锁串行化，有效防止 `database is locked`
- 连接池配置合理 (MaxIdle=4, MaxOpen=8)
- Postgres 模式下自动跳过写锁

**潜在瓶颈**:
- 全局写锁意味着所有写操作排队。60-100 单/天 (约 7 秒一单) 完全没问题，但如果业务增长 10x 需要迁移到 Postgres
- `GetDashboardStats` 涉及 8+ 次 DB 查询，全部走读路径，WAL 下没问题但可以合并减少开销

### 5.2 WebSocket 管理 (评分: 8/10)

**已做的好**:
- `safeConn` 封装保证了并发写安全
- 双层心跳机制：服务端 WebSocket ping (30s) + 客户端应用层 ping/pong
- `Broadcast` 先复制连接列表再写入，避免持锁写
- 前端重连策略完善：指数退避 + 随机抖动 + 消息队列

**潜在问题**:
- 广播时逐连接串行写，10-20 个连接没问题，但连接数大幅增长后需要考虑并行写或使用 channel

### 5.3 OCR 调用策略 (评分: 7/10)

**已做的好**:
- 主备双模型策略（智谱 GLM-4V 优先，通义千问 VL 回退）
- JSON 解析失败后有正则兜底提取
- 120 秒超时合理（VLM 推理耗时长）

**可优化**:
- 无并发限制：大量并发 OCR 请求可能打满外部 API 配额
- 无结果缓存：相同截图重复上传会重复调用 API
- 同步阻塞请求：用户上传后需等待 OCR 完成才能继续，可考虑异步 + WebSocket 通知

---

## 六、配置管理评价 (评分: 8/10)

**优点**:
- 所有敏感配置通过环境变量注入，代码中无硬编码凭证
- 生产环境强制校验：JWT 密钥不能用默认值、管理员密码不能为空
- debug 模式有明确的降级默认值和日志警告
- `.env` 文件在 `.gitignore` 中
- docker-compose 使用 `${VAR:-default}` 语法，部署时通过 `.env` 注入

**问题**:
- [P3] 配置结构是扁平的 `Config` struct，30+ 字段。可以按功能分组为嵌套 struct（DB, Wecom, OCR, Auth, OSS 等）提升可读性
- [P3] 没有配置验证框架，每个字段的合法性检查分散在 `Init()` 中

---

## 七、部署架构评价 (评分: 8/10)

**优点**:
- Docker 多阶段构建（Go 编译 + 前端构建 + 运行时镜像）
- docker-compose 三层架构：Postgres + App + Nginx
- 健康检查覆盖：Postgres (`pg_isready`)、App (`/health endpoint`)
- Postgres 不暴露端口到宿主机
- 数据卷持久化（pg_data, app_uploads, app_data）
- 优雅关闭（graceful shutdown with 5s timeout）

**问题**:
- [P3] Nginx SSL 证书卷是空的 (`nginx_certs`)，需要配合 certbot 或外部证书管理
- [P3] 没有日志收集和监控方案（Prometheus metrics、日志轮转等）

---

## 八、安全评价 (评分: 8.5/10)

这是本项目最突出的亮点之一。

**已实现的安全措施**:
1. JWT 认证 + 签名算法验证（防 algorithm confusion）
2. bcrypt 密码哈希（含激活码）
3. 暴力破解防护（Fail2Ban 机制）
4. CSRF 防护（Double Submit Token）
5. 可疑请求过滤（扫描器拦截）
6. 安全响应头全覆盖（HSTS, CSP, X-Frame-Options 等）
7. 请求体大小限制（双重防护）
8. IP 限速（通用 + 登录特化）
9. 文件上传白名单（仅允许图片格式）
10. SQL 注入防护（GORM 参数化查询）
11. 设备指纹绑定（MachineID）
12. 激活码一次性使用（激活后销毁）
13. 审计日志（登录、安全事件、员工操作）
14. WebSocket Origin 检查
15. CORS 配置可控

**安全改进建议**:
- [P3] 添加 `Helmet` 等级别的 HTTP header 审计
- [P3] 考虑 JWT refresh token 机制（当前 24 小时过期，无续期）

---

## 九、改进建议总结

### 短期 (1-2 周)

1. **修复 SQLite 备份方式**: 使用 `database/sql` 的 connection 调用 `sqlite3_backup_*` API，或使用 `VACUUM INTO` 命令替代文件拷贝
2. **修复 N+1 查询**: `GetRevenueChart` 改为 SQL GROUP BY 聚合，`GetTeamWorkload` 参考 `GetDashboardStats` 的批量查询模式
3. **Handler 中发送响应后的操作移到响应前完成，或改为异步**

### 中期 (2-4 周)

4. **建立 employee service 层**: 新建 `services/employee.go`，将员工 CRUD 逻辑从 handler 下沉
5. **统一错误响应**: 抽取 `handlers/response.go` 提供 `Success()`, `Error()`, `Paginated()` 等标准响应函数
6. **异步 goroutine 错误处理**: 添加重试机制或失败通知，至少要有日志记录
7. **清理 Vue 遗留**: 删除 `admin-web-vue-backup/` 目录和 `views/` 中的旧文件

### 长期 (1-3 月)

8. **引入结构化日志**: 迁移到 `slog` 或 `zerolog`，统一日志格式
9. **考虑 TypeScript 迁移**: 前端逐步引入 TypeScript
10. **监控和可观测性**: 添加 Prometheus metrics endpoint、日志集中收集
11. **当业务量增长时迁移到 Postgres**: docker-compose 已具备 Postgres 支持，代码层也已兼容

---

## 十、架构亮点

1. **双数据库兼容设计**: `WriteTx()` 透明封装 SQLite/Postgres 差异，迁移零成本
2. **状态机设计**: `ValidTransitions` + `StatusChangePermission` 将业务规则声明式定义，清晰可维护
3. **安全纵深防御**: 从网络层（限速、可疑请求拦截）到应用层（JWT、CSRF、暴力破解防护）到数据层（bcrypt、参数化查询）形成完整的防御链
4. **WebSocket 实现成熟度**: 并发安全写、双层心跳、Origin 检查、前端指数退避重连 -- 这是生产级的实现
5. **OCR 主备切换 + 正则兜底**: 三层容错保证了 OCR 的可用性

---

*报告结束。本报告仅做架构评估，未修改任何源代码。*
