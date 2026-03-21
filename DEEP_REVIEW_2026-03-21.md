# PDD 派单管理系统 — 深度代码审查报告

> **审查日期**: 2026-03-21
> **审查引擎**: Claude Opus 4.6 × 4 并行代理
> **审查维度**: 安全漏洞 · Go 后端质量 · 前端架构 · 系统部署
> **审查范围**: 全量代码（47 个 Go 文件 + 35 个 JSX/JS 文件 + Docker/CI/Nginx 配置）

---

## 审查总览

| 维度 | 🔴 严重 | 🟡 中等 | 🟣 改进 | 审查文件数 |
|:---:|:---:|:---:|:---:|:---:|
| 安全漏洞 | 5 | 8 | 7 | 全部 handler + middleware + service |
| 后端质量 | 8 | 11 | 9 | 47 个 .go 文件 |
| 前端架构 | 6 | 11 | 10 | 35 个 JSX/JS 文件 |
| 架构部署 | 5 | 10 | 11 | Docker/CI/Nginx/build |
| **合计** | **24** | **40** | **37** | — |

---

## 第一部分：严重问题（必须修复）

### 🔒 安全类

| # | 问题 | 文件:行 | 影响 |
|---|------|---------|------|
| SEC-01 | JWT 无 `iat` 字段，无法吊销 Token。员工被禁用后 24h 内仍可操作 | `server/middleware/auth.go:56-61` | 权限绕过 |
| SEC-02 | `AdminLogin` 未校验 admin 角色，任何员工可登录管理端 | `server/handlers/auth_handler.go:193-235` | 越权访问 |
| SEC-03 | PostgreSQL 连接 `sslmode=disable`，凭证明文传输 | `server/models/db.go:42-43` | 凭证泄露 |
| SEC-04 | `/orders/create` 和 `/orders/upload_ocr` 豁免 CSRF 校验 | `server/middleware/csrf.go:51-62` | CSRF 攻击 |
| SEC-05 | WebSocket Token 通过 URL Query 传输，日志泄露风险 | `server/handlers/ws.go:38` | Token 泄露 |

### ⚙️ 后端质量类

| # | 问题 | 文件:行 | 影响 |
|---|------|---------|------|
| BE-01 | `UpdateOrderStatus` 在 `c.JSON()` 响应后继续写库，失败不可感知 | `server/handlers/order_handler.go:252-276` | 数据丢失 |
| BE-02 | **20+ 处**写操作绕过 `WriteTx`，SQLite 并发写冲突 | 多文件（详见后端报告） | database is locked |
| BE-03 | PKCS7 Unpadding 未校验 padding 范围，恶意回调可致 panic | `server/middleware/wxbizmsgcrypt.go:141-142` | 进程崩溃 |
| BE-04 | `wxbizmsgcrypt` 使用 `math/rand` 而非 `crypto/rand` | `server/middleware/wxbizmsgcrypt.go:13,119` | 加密不安全 |
| BE-05 | `generateUsername` 竞态条件，并发创建员工时用户名冲突 | `server/handlers/admin_handler.go:97-101` | 数据冲突 |
| BE-06 | CSV 导出无分页，全量加载到内存可致 OOM | `server/handlers/export.go:68-69` | 服务崩溃 |
| BE-07 | `GetDashboardStats` 执行 15+ 次查询且内存循环求和 | `server/services/order.go:432-614` | 性能瓶颈 |
| BE-08 | 角色名 "operator" vs "sales" 不一致，sales 用户无法查看订单 | `order_handler.go:232` vs `models.go:32` | 功能故障 |

### 🎨 前端类

| # | 问题 | 文件:行 | 影响 |
|---|------|---------|------|
| FE-01 | Context Provider value 每次渲染创建新对象，全局级联重渲染 | `AuthContext.jsx:72`, `ToastContext:36`, `WebSocketContext:230` | 性能严重 |
| FE-02 | API 401 用 `window.location.href` 硬跳转，丢失全部 SPA 状态 | `api/client.js:36-37` | 体验差 |
| FE-03 | WebSocket auth error 时无限重连（重试 5 次无效连接） | `WebSocketContext.jsx:113-116,146-164` | 资源浪费 |
| FE-04 | `fetchOrders` useEffect 依赖数组重复触发 | `OrdersPage.jsx:66-68` | 竞态请求 |
| FE-05 | 所有 API 调用缺少 `AbortController` 取消机制 | 全部页面组件 | 内存泄漏 |
| FE-06 | ECharts 实例生命周期管理有时序 Bug | `DashboardPage.jsx:53`, `RevenuePage.jsx:332-353` | 图表异常 |

### 🏗️ 架构部署类

| # | 问题 | 文件:行 | 影响 |
|---|------|---------|------|
| ARCH-01 | 容器以 root 用户运行 | `Dockerfile:19-33` | 容器逃逸风险 |
| ARCH-02 | `app` 服务端口绕过 Nginx 直接暴露到宿主机 | `docker-compose.yml:53-54` | 安全绕过 |
| ARCH-03 | JWT 默认密钥 + PG 密码硬编码在源码中 | `config.go:94,82` | 凭证泄露 |
| ARCH-04 | 生产服务器 IP `120.26.139.90` 硬编码在仓库中 | `docker-compose.lite.yml:17` | 基础设施暴露 |
| ARCH-05 | 缺少 `.dockerignore`，构建上下文包含 `.git`/`node_modules` 等 | 项目根目录 | 构建慢+泄露 |

---

## 第二部分：中等问题（建议修复）

### 🔒 安全类（8 项）

| # | 问题 | 文件:行 |
|---|------|---------|
| SEC-06 | 默认管理员密码 `Admin123!` / `admin888` 硬编码 | `config.go:128`, `CLAUDE.md` |
| SEC-07 | 上传文件仅校验扩展名，未验证 Magic Bytes | `services/oss.go:44-49` |
| SEC-08 | OCR 服务存在路径穿越风险（SSRF） | `order_handler.go:34-38` |
| SEC-09 | 审计日志直接拼接用户输入（Log Injection） | `auth_handler.go:37` |
| SEC-10 | JWT Token 存储在 localStorage，易被 XSS 窃取 | `admin-web/src/utils/storage.js:23` |
| SEC-11 | CORS `AllowCredentials:true` 配合可配置 Origins | `main.go:81-87` |
| SEC-12 | 企微诊断接口向 `@all` 全员发送测试消息 | `services/wecom.go:479-486` |
| SEC-13 | WebSocket 无单用户连接数限制 | `services/websocket.go` |

### ⚙️ 后端质量类（11 项）

| # | 问题 | 文件:行 |
|---|------|---------|
| BE-09 | 审计日志 action 误用（密码重置记录为 EmployeeAdd） | `admin_handler.go:224,459` |
| BE-10 | `strftime`/`julianday` 仅适用 SQLite，不兼容 PostgreSQL | `admin_handler.go:51`, `order.go:529,575` |
| BE-11 | 9 个后台 goroutine 无法优雅关闭（无 context 取消） | 全部 services |
| BE-12 | 分润计算使用整数除法，精度丢失（每单可差数分） | `profit_handler.go:48-52` |
| BE-13 | `UpdateCustomer` 空字符串被跳过，无法清空昵称/备注 | `customer_handler.go:76-81` |
| BE-14 | CSV 导出无审计日志，被盗 token 可静默导出全部数据 | `export.go:35-108` |
| BE-15 | CSRF token 全内存存储，多实例部署不可用 | `middleware/csrf.go:20` |
| BE-16 | 角色鉴权 switch-case 逻辑在 4 个 handler 中重复 | `order_handler.go`, `ws.go` |
| BE-17 | N+1 查询：`GetGrabAlerts` 和 `GetDesignerGrabStats` | `services/grab_monitor.go:116-153` |
| BE-18 | S3 客户端初始化无并发保护（应用 `sync.Once`） | `services/oss.go:97-100` |
| BE-19 | SQLite 备份用 `copyFile`，WAL 模式下可能不一致 | `services/backup.go:50-54` |

### 🎨 前端类（11 项）

| # | 问题 | 文件 |
|---|------|------|
| FE-07 | ConfirmModal 模式在 3 个页面重复实现 | `OrdersPage`, `OrderDetailPage`, `EmployeesPage` |
| FE-08 | 大量内联 SVG（15+ 处），已安装 lucide-react 但未使用 | 全部页面 |
| FE-09 | 按钮样式类 30+ 次重复，未使用已有 Button 组件 | 全部页面 |
| FE-10 | `<table>` 缺少 `scope`/`aria-label` 等语义化属性 | `OrdersPage`, `EmployeesPage`, `RevenuePage` |
| FE-11 | `BADGE_VARIANT_CLASSES` 在 EmployeeRow 内部重复定义 | `EmployeesPage.jsx:499-505` |
| FE-12 | `OrderRow` 接收 11 个 props（典型 prop drilling） | `OrdersPage.jsx:289` |
| FE-13 | Modal/Lightbox 缺少 ESC 关闭 + 焦点陷阱 + aria 属性 | `OrdersPage`, `EmployeesPage` |
| FE-14 | `useTypewriter`/`useCountUp` hooks 定义在页面文件内 | `LoginPage.jsx:7-63` |
| FE-15 | 轮询间隔在不同页面硬编码且各不相同 | `DashboardPage`, `OrdersPage`, `TeamPage` |
| FE-16 | staff-web 与 admin-web 有大量可共享但未共用的代码 | `staff-web/src/` 全部 |
| FE-17 | ECharts ResizeObserver 回调无 debounce | `DashboardPage.jsx:146-148` |

### 🏗️ 架构部署类（10 项）

| # | 问题 | 文件 |
|---|------|------|
| ARCH-06 | Nginx SSL 证书 volume 为空，启动会崩溃 | `docker-compose.yml:74,80` |
| ARCH-07 | Go 版本四处不一致（CI:1.23 / Docker:1.24 / CLAUDE.md:1.22+） | `ci.yml`, `Dockerfile`, `CLAUDE.md`, `README` |
| ARCH-08 | CI `CGO_ENABLED=0` vs Docker `CGO_ENABLED=1` 矛盾 | `ci.yml:33` vs `Dockerfile:17` |
| ARCH-09 | `build.sh` 交叉编译缺少 `CGO_ENABLED=0` | `build.sh:30` |
| ARCH-10 | CLAUDE.md 泄露企微 CorpID/AgentID | `CLAUDE.md:45-46` |
| ARCH-11 | `.gitignore` 未覆盖 `.env`/`data/`/`uploads/`/`backups/` | `.gitignore` |
| ARCH-12 | 仅使用 GORM AutoMigrate，无版本化迁移机制 | `db.go:74` |
| ARCH-13 | 7 个后台调度器缺乏统一生命周期管理 | `main.go:47-65` |
| ARCH-14 | Health 端点公开泄露 uptime 和数据库类型 | `main.go:111-126` |
| ARCH-15 | Nginx `listen 443 ssl http2` 写法已弃用 | `deploy/nginx.conf:22` |

---

## 第三部分：已做好的安全措施（值得肯定）

项目在安全方面已做了大量正确的工作：

1. **JWT 算法校验** — 明确校验 `SigningMethodHMAC`，防止 algorithm confusion
2. **bcrypt 密码哈希** — 全部密码使用 bcrypt 存储
3. **SQL 注入防护** — 全部使用 GORM 参数化查询
4. **暴力破解防护** — 登录限速 5 次/分钟 + IP 封锁 10 次/10 分钟
5. **CSRF Token** — 基于随机 token + check-and-delete 原子操作
6. **安全响应头** — X-Content-Type-Options, X-Frame-Options, HSTS, CSP 全配
7. **可疑请求拦截** — 拦截 PHP/ASP/WP 扫描探测 + UA 黑名单
8. **请求体大小限制** — 2MB 通用 + 10MB 文件上传
9. **文件上传白名单** — 仅允许图片扩展名
10. **CSV 注入防护** — `sanitizeCSVCell` 函数
11. **WebSocket Origin 校验** — 匹配 CORS 白名单
12. **角色权限分层** — 订单查询按角色过滤
13. **抢单身份校验** — 从 JWT 获取真实用户 ID 防代抢
14. **生产环境 JWT 密钥强制校验** — 非 debug 模式禁止默认密钥
15. **前端响应式设计** — 整体做得不错

---

## 第四部分：优先修复路线图

### P0 — 立即修复（影响生产安全）

| 优先级 | 编号 | 问题 | 预估工时 |
|:---:|:---:|------|:---:|
| 1 | BE-08 | 角色名 "operator" vs "sales" 不一致（sales 用户无法查看订单） | 30min |
| 2 | BE-02 | 所有写操作统一走 `WriteTx` | 2h |
| 3 | BE-03 | PKCS7 Unpadding 越界校验 | 15min |
| 4 | SEC-02 | AdminLogin 添加 admin 角色校验 | 15min |
| 5 | SEC-04 | 移除 orders/create 和 upload_ocr 的 CSRF 豁免 | 1h |
| 6 | ARCH-05 | 创建 `.dockerignore` | 10min |
| 7 | ARCH-01 | Dockerfile 添加非 root 用户 | 15min |
| 8 | ARCH-02 | 移除 app 服务端口暴露 | 5min |

### P1 — 本周完成（影响数据安全和稳定性）

| 编号 | 问题 | 预估工时 |
|:---:|------|:---:|
| SEC-01 | JWT 添加 `iat` + 用户状态校验 | 2-4h |
| SEC-03 | PG `sslmode` 改为可配置 | 30min |
| SEC-05 | WS Token 改为首帧认证 | 1h |
| BE-04 | `wxbizmsgcrypt` 换用 `crypto/rand` | 15min |
| BE-06 | CSV 导出改用流式写出 | 1h |
| BE-07 | Dashboard 统计改用 SQL 聚合 | 2h |
| FE-01 | Context value 用 `useMemo` 包裹 | 30min |
| ARCH-03 | 移除硬编码 JWT 密钥和 PG 密码默认值 | 30min |
| ARCH-04 | 移除硬编码生产 IP | 5min |

### P2 — 两周内完成（影响代码质量和可维护性）

| 编号 | 问题 | 预估工时 |
|:---:|------|:---:|
| FE-02 | API 401 改为 React Router 导航 | 1h |
| FE-05 | 添加 AbortController | 2h |
| FE-07 | 提取 `useConfirmModal` hook | 1h |
| FE-08 | 统一使用 lucide-react 替代内联 SVG | 2h |
| BE-11 | 后台 goroutine 添加 context 优雅关闭 | 3h |
| BE-12 | 分润计算精度修复 | 1h |
| BE-17 | N+1 查询优化 | 1h |
| ARCH-07 | 统一 Go 版本 | 30min |
| ARCH-08 | 统一 CGO_ENABLED 策略 | 30min |

---

## 审查方法论

本次审查采用 **4 代理并行深度分析**模式，等效于 Claude Code Review 的多代理架构：

```
┌─────────────────────────────────────────────┐
│              审查协调器 (Opus 4.6)            │
├──────────┬──────────┬──────────┬─────────────┤
│ 🔒 安全   │ ⚙️ 后端   │ 🎨 前端   │ 🏗️ 架构     │
│ 审查代理  │ 质量代理  │ 架构代理  │ 部署代理    │
│ 38 calls │ 42 calls │ 24 calls │ 25 calls   │
│ 185s     │ 196s     │ 166s     │ 178s       │
└──────────┴──────────┴──────────┴─────────────┘
           总计 129 次工具调用 · 总耗时 ~3.3 分钟
```

每个代理独立阅读全部相关源码文件，按各自维度深入分析后输出结构化报告，最终由协调器去重、排序、汇总。

---

*Generated by Claude Opus 4.6 Multi-Agent Review · 2026-03-21*
