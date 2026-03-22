# PDD 派单管理系统 — V2 改造总览与后续规划

**生成日期**: 2026-03-21
**项目路径**: `/Users/admin/Desktop/企微需求对接`
**GitHub**: [daxia778/qywechat](https://github.com/daxia778/qywechat)
**访问地址**: `http://localhost:8200`

---

## 一、项目概述

PDD 派单管理系统是一套面向 PPT 定制服务团队的**全流程自动化工单平台**。

| 维度 | 数据 |
|:---|:---|
| 团队规模 | 10-20 人（兼职客服 + 设计师） |
| 日单量 | 60-100 单 |
| 日营业额 | ~¥3000 |
| 技术栈 | Go 1.24 + Gin + GORM + SQLite ｜ React 19 + Vite 6 + TailwindCSS v4 ｜ Wails v2 + Vue 3 |
| 端口 | 前端 8200 / 后端 8201 |
| UI 风格 | Brave 官网简约风，主题色 `#434FCF`，深紫侧边栏 `#3D28B2` |

**核心流程**:
```
截图粘贴 → AI OCR 识别 → 金额锁定 → 企微派单 → 设计师抢单 → 自动建群 → 需求播报 → 设计交付 → 状态流转
```

---

## 二、项目文件结构

```
企微需求对接/
├── server/                      # Go 后端 (46 个 .go 文件, ~7800 行)
│   ├── main.go                  #   入口 + 全量路由注册
│   ├── config/config.go         #   环境变量加载, 分润费率配置
│   ├── handlers/                #   HTTP 处理器 (13 文件)
│   │   ├── auth_handler.go      #     统一登录(V2) + 设备登录 + Token 验证
│   │   ├── admin_handler.go     #     员工CRUD + 自动账号生成(V2) + 重置密码(V2)
│   │   ├── order_handler.go     #     订单全生命周期: 创建/抢单/状态/看板
│   │   ├── profit_handler.go    #     四方分润计算(V2): 平台+设计师+谈单+跟单
│   │   ├── customer_handler.go  #     顾客 CRUD + 订单关联
│   │   ├── contact_handler.go   #     企微通讯录查询
│   │   ├── wecom_handler.go     #     企微回调 + 诊断 + 测试消息
│   │   ├── export.go            #     CSV 导出 (订单/利润)
│   │   ├── notification.go      #     通知推送
│   │   ├── version_handler.go   #     桌面客户端 OTA 更新
│   │   ├── ws.go                #     WebSocket 升级 + 订单详情/时间线
│   │   └── common.go            #     响应辅助函数
│   ├── middleware/               #   安全中间件 (9 文件)
│   │   ├── auth.go              #     JWT HMAC-SHA256 + 算法验证
│   │   ├── csrf.go              #     双重 Cookie+Header Token
│   │   ├── ratelimit.go         #     IP 级别频率限制
│   │   ├── security.go          #     暴力破解防护 + 可疑请求拦截
│   │   ├── password.go          #     bcrypt 密码 + 强度验证
│   │   ├── ip_whitelist.go      #     IP 白名单
│   │   ├── admin.go             #     管理员角色守卫
│   │   └── wxbizmsgcrypt.go     #     企微消息加解密 (完整移植)
│   ├── models/                   #   数据模型 (8 文件)
│   │   ├── models.go            #     Employee, Order, ActivationCode + 状态机
│   │   ├── db.go                #     GORM 初始化 + WAL + WriteTx
│   │   ├── customer.go          #     Customer 实体
│   │   ├── timeline.go          #     订单时间线事件
│   │   ├── notification.go      #     通知模型
│   │   ├── audit.go             #     审计日志
│   │   ├── version.go           #     OTA 版本
│   │   └── wecom_data.go        #     企微成员/群聊/消息日志
│   ├── services/                 #   业务逻辑 (10 文件)
│   │   ├── order.go             #     订单核心: 创建/抢单/状态流转/看板统计
│   │   ├── wecom.go             #     企微 API: Token/推送/建群/通讯录
│   │   ├── wecom_sync.go        #     企微通讯录每小时同步
│   │   ├── ocr.go               #     双模型 OCR: 智谱 GLM-4V + 通义千问 VL
│   │   ├── grab_monitor.go      #     抢单超时监控 (10分钟兜底)
│   │   ├── customer.go          #     顾客业务逻辑
│   │   ├── websocket.go         #     WebSocket Hub + 广播
│   │   ├── oss.go               #     文件存储 (本地/阿里云OSS)
│   │   ├── backup.go            #     SQLite 每日自动备份 (保留7份)
│   │   └── cleanup.go           #     上传文件7天自动清理
│   ├── data/pdd_order.db        #   SQLite 数据库
│   ├── data/backups/            #   每日备份快照
│   └── .env / .env.example      #   敏感配置
│
├── admin-web/                    # React 管理看板 (44 个 .jsx/.js 文件, ~5300 行)
│   ├── src/pages/               #   9 个页面组件
│   │   ├── LoginPage.jsx        #     登录: 打字机动画 + 玻璃卡片 + 记住我
│   │   ├── DashboardPage.jsx    #     看板: 4 KPI卡片 + 日环比 + 月度图表 + 设计师排行
│   │   ├── OrdersPage.jsx       #     订单列表: 状态筛选/搜索/分页/CSV导出/批量操作
│   │   ├── OrderDetailPage.jsx  #     订单详情: 三栏布局 + 时间线 + 利润明细
│   │   ├── EmployeesPage.jsx    #     员工管理(V2): 自动账号 + 重置密码 + 批量操作
│   │   ├── TeamPage.jsx         #     团队负载: 卡片式成员状态 + 负载进度条
│   │   ├── RevenuePage.jsx      #     营收分析(V2): 四方分润图表 + CSV导出
│   │   ├── CustomersPage.jsx    #     顾客管理: 搜索/编辑/订单历史
│   │   └── ActivationCodesPage.jsx  激活码管理: 生成/撤销/状态
│   ├── src/components/          #   通用组件
│   │   ├── layout/AppShell.jsx  #     主布局: 侧边栏 + 顶栏 + 角色路由过滤
│   │   ├── ConfirmModal.jsx     #     确认对话框
│   │   ├── NotificationPanel.jsx #    通知面板
│   │   ├── LoadingSpinner.jsx   #     加载指示器
│   │   └── ui/                  #     基础组件库 (Button/Card/Badge/StatCard)
│   ├── src/contexts/            #   全局状态
│   │   ├── AuthContext.jsx      #     认证 (V2: 支持4角色统一登录)
│   │   ├── WebSocketContext.jsx #     WS 连接 + 指数退避重连
│   │   └── ToastContext.jsx     #     Toast 通知
│   ├── src/api/                 #   API 客户端 (7 模块)
│   ├── src/hooks/               #   自定义 Hook (5 个)
│   ├── src/utils/               #   工具函数 (4 个)
│   ├── src/router/index.jsx     #   路由 + RequireAuth/RequireRole/LoginGuard
│   └── vite.config.js           #   Vite 6 + 端口8200 + 代理→8201
│
├── desktop-client/               # Wails 桌面客服端
│   ├── app.go                   #   设备登录 + OCR 提交
│   ├── crypto.go                #   AES-256-GCM 会话加密 + 设备指纹
│   ├── main.go                  #   Wails 窗口配置
│   └── frontend/src/App.vue     #   Vue 3 录单表单
│
├── .github/workflows/ci.yml     # CI/CD: Go Build+Test / Frontend Build / Tag Release
├── .claude/agents/              # 8 个 AI Agent 团队配置
├── deploy/                      # Nginx + 备份 + 加固脚本
├── Dockerfile                   # 多阶段构建
├── docker-compose.yml           # Docker 编排
├── build.sh                     # 一键构建脚本
│
├── ARCHITECTURE_REVIEW.md       # 架构审查报告 (7.2/10)
├── FRONTEND_REVIEW.md           # 前端迁移审查报告 (迁移完成度100%)
├── SECURITY_REVIEW.md           # 安全审查报告 (B+)
├── UI_REVIEW.md                 # UI 质量审查报告 (7.2/10)
├── PRD_GAP_ANALYSIS.md          # PRD 差距分析报告 (MVP 85%)
├── review-report.md             # 代码审查报告 (第三轮, 30项待修)
├── CLAUDE.md                    # Claude Code 项目指南
└── README.md                    # GitHub 仓库首页 (V2 已更新)
```

---

## 三、V2 改造已完成内容

### 3.1 Phase 1 — 后端认证 + 角色重构

**commit `157a923`** — `feat(v2): Phase 1 — 统一登录 + 4角色体系 + 自动账号生成 + 4方分润`

| 改动 | 说明 |
|:---|:---|
| 统一登录入口 | `/auth/admin_login` → `/auth/login`，所有角色共用 |
| 4 角色体系 | V1 的 `operator/designer/admin` → V2 的 `sales/follow/designer/admin` |
| 自动账号生成 | 创建员工仅需 `name + role`，系统自动生成 `role_NNN` 用户名 + 8位随机密码 |
| 重置密码 API | 新增 `PUT /employees/:id/reset_password`，生成新随机密码 |
| 4 方分润引擎 | 平台手续费 + 设计师佣金 + 谈单客服佣金 + 跟单客服佣金 |
| 分润配置 | 新增 `SALES_COMMISSION_RATE` (默认10%) + `FOLLOW_COMMISSION_RATE` (默认5%) |
| 角色兼容 | 旧 `operator` 数据在常量中映射为 `客服管家`，不影响存量数据 |

**涉及文件**: `server/main.go`, `server/handlers/admin_handler.go`, `server/handlers/auth_handler.go`, `server/handlers/profit_handler.go`, `server/config/config.go`, `server/models/models.go` 等 8 文件, +251/-117 行

### 3.2 Phase 2 — 前端适配 + 角色路由

**commit `441bebd`** — `feat(v2): Phase 2 — 前端适配统一登录 + 4角色体系 + 员工管理V2`

| 改动 | 说明 |
|:---|:---|
| 登录 API 切换 | `auth.js` 从 `/auth/admin_login` → `/auth/login` |
| AuthContext V2 | 同时兼容 V1 (`{ token, employee_name }`) 和 V2 (`{ token, user: { id, name, role } }`) 响应 |
| 角色常量更新 | `ROLE_MAP` / `ROLE_CLASS_MAP` / `ROLE_AVATAR_CLASS_MAP` 增加 `sales` + `follow` |
| NAV 角色过滤 | 订单/顾客对 `admin/sales/follow` 可见，团队/员工/设备/营收仅 `admin` 可见 |
| 员工管理 V2 | 表单简化为 `name + role`，成功后展示自动生成的用户名+密码 |
| 重置密码按钮 | 员工列表新增钥匙图标，点击重置密码并弹窗展示新凭证 |
| 登录页文案 | 副标题改为 "使用账号密码登录系统" |

**涉及文件**: `admin-web/src/api/auth.js`, `admin-web/src/contexts/AuthContext.jsx`, `admin-web/src/utils/constants.js`, `admin-web/src/api/admin.js`, `admin-web/src/pages/EmployeesPage.jsx`, `admin-web/src/pages/LoginPage.jsx` 共 6 文件, +97/-66 行

### 3.3 Phase 3 — 分润体系改造

**commit `e16c033`** — `feat(revenue): 分润体系从3方拆分升级为4方拆分 (Phase 3)`

| 改动 | 说明 |
|:---|:---|
| 图表图例 | `运营商佣金` → `谈单客服佣金` + `跟单客服佣金` (5项图例) |
| 堆叠柱状图 | 3 项成本 bar → 4 项成本 bar (5个独立 series) |
| CSV 导出 | 7 列 → 8 列，新增谈单/跟单佣金列 |
| 净利润率 KPI | `totalDeductRate` = 平台 + 设计师 + 谈单 + 跟单 |
| 头部费率标签 | 显示 4 项费率: 平台/设计师/谈单/跟单 |

**涉及文件**: `admin-web/src/pages/RevenuePage.jsx` 1 文件, +28/-14 行

### 3.4 其他改动

**commit `c4c3b16`** — README 全面升级至 V2

| 改动 | 说明 |
|:---|:---|
| 徽章更新 | 新增 Vite/TailwindCSS/CI Status 徽章 |
| 双栏 Highlights | 6 大核心能力展示 |
| 角色体系图 | 四角色层级图 + 权限对照表 |
| 分润引擎说明 | 费率计算树形图示例 |
| API Reference | 更新全部 V2 接口 (统一登录/员工创建/重置密码/利润分析) |
| CI/CD 章节 | GitHub Actions 流水线说明 |

**commit `619e4d6`** — 8 个 AI Agent 团队配置

| Agent | 用途 |
|:---|:---|
| `architect` | 系统架构师 — 整体架构设计 |
| `frontend-architect` | 前端架构师 — UI/UX 实现 |
| `core-developer` | 核心开发者 — 后端编码 |
| `code-reviewer` | 代码审查员 — 质量 + 安全 |
| `test-engineer` | 测试工程师 — 测试编写 |
| `designer-reviewer` | 设计师审查 — UI 美观度 |
| `boss-reviewer` | 老板审查 — ROI + 商业价值 |
| `operator-reviewer` | 运营审查 — 工作流效率 |

---

## 四、Git 提交历史 (全部 30 次)

| # | Commit | 说明 | 阶段 |
|:---:|:---|:---|:---|
| 30 | `c4c3b16` | docs: README 升级至 V2 | **V2** |
| 29 | `e16c033` | feat: 分润体系 3方→4方 (Phase 3) | **V2** |
| 28 | `441bebd` | feat: 前端适配统一登录 + 4角色 (Phase 2) | **V2** |
| 27 | `157a923` | feat: 统一登录 + 4角色 + 自动账号 (Phase 1) | **V2** |
| 26 | `619e4d6` | feat: 创建 8 个 Agent 团队配置 | **V2** |
| 25 | `1ec9c31` | chore: V2 改造前全量备份 | **V2** |
| 24 | `3903a80` | feat: Dashboard KPI 重构 + 日环比 | 优化 |
| 23 | `7e8876f` | fix: lint cleanup + WS联通 + 通知铃铛 | 修复 |
| 22 | `ebc59e0` | perf: inline loading skeleton 消除白屏 | 性能 |
| 21 | `974c582` | perf: Suspense 移入 AppShell 内容区 | 性能 |
| 20 | `f9f267e` | refactor: 侧边栏收起按钮 | 重构 |
| 19 | `beee6d7` | refactor: 侧边栏 collapse toggle | 重构 |
| 18 | `8e59c69` | feat: Brave UI 大改版 + 安全加固 | **里程碑** |
| 17 | `4a8c959` | feat: v0.3.0 部署+企微诊断+客户管理+UI | **里程碑** |
| 16 | `612c936` | feat: 5轮审查修复 41 项 | 修复 |
| 15 | `353db35` | chore: CI优化+测试+架构文档 | DevOps |
| 14 | `c26badd` | docs: 美化 README + 部署配置 | 文档 |
| 13 | `4735807` | feat: Vue → React 全前端重构 | **里程碑** |
| 12 | `de98c28` | feat: 设备登录持久化+OCR+图片缩放 | 功能 |
| 11 | `7ddb6fd` | feat: TailwindCSS v4 + 设备解绑 + CI | 功能 |
| 10 | `bc9b480` | feat: 图片预览缩放 Modal | 功能 |
| 9 | `72efb2d` | fix: 激活码校验绕过漏洞 | **安全** |
| 8 | `9447327` | fix: 桌面端 UX 改进 | 修复 |
| 7 | `181dfa8` | feat: 智谱 OCR + 会话持久化 | 功能 |
| 6 | `8718984` | feat: JWT 管理端认证 + SQLite 备份 | **里程碑** |
| 5 | `33750b0` | chore: Vite 分包优化 | 性能 |
| 4 | `e0b8ed4` | refactor: 企业风 UI 大改 + 后端加固 | UI |
| 3 | `54d5eea` | feat: Phase 3 Vue3 管理端 | 功能 |
| 2 | `53dcd03` | feat: Phase 1 & 2 Complete | **初始** |
| 1 | *(init)* | 项目初始化 | **初始** |

---

## 五、审查报告综合摘要

### 5.1 各维度评分

| 审查维度 | 评分 | 审查人 |
|:---|:---:|:---|
| 架构健康度 | **7.2/10** | 系统架构师 |
| 安全等级 | **B+** | 代码审查员 |
| UI 设计质量 | **7.2/10** | 设计师审查 |
| 前端迁移完成度 | **100%** | 前端架构师 |
| MVP 核心功能 | **85%** | 老板视角审查 |
| 代码问题关闭率 | **55%** (41/75) | 代码审查 (三轮) |

### 5.2 架构亮点 (做得好的)

1. **双数据库兼容**: `WriteTx()` 透明封装 SQLite/Postgres 差异，迁移零成本
2. **状态机设计**: `ValidTransitions` + `StatusChangePermission` 声明式定义
3. **安全纵深防御**: 网络层(限速/拦截) → 应用层(JWT/CSRF/暴力破解) → 数据层(bcrypt/参数化) 完整链
4. **WebSocket 生产级**: 并发安全写 + 双层心跳 + Origin 检查 + 前端指数退避
5. **OCR 三层容错**: 智谱 GLM-4V → 通义千问 VL → 正则兜底

### 5.3 未修复问题汇总 (30 项, 来自第三轮代码审查)

#### 🔴 严重 (6 项)

| # | 问题 | 位置 | 影响 |
|:---:|:---|:---|:---|
| 1 | `grab_monitor.go` AssignedAt nil 指针 panic | services/grab_monitor.go:75-76 | 监控 goroutine 永久停止 |
| 2 | `GetGrabAlerts` 同样 nil 解引用 | services/grab_monitor.go:128 | API 500 |
| 3 | 诊断接口暴露 corp_id/agent_id | handlers/wecom_handler.go:224 | admin 被盗可获企微身份 |
| 4 | access_token 在 URL 中日志泄露 | services/wecom.go:116,140 | Token 泄露风险 |
| 5 | `/customers` 路由缺少角色守卫 | router/index.jsx:125 | **顾客 PII 泄露给 designer** |
| 6 | CustomersPage 首次加载无 loading | CustomersPage.jsx:32 | 空状态闪现 |

#### 🟡 警告 (14 项)

| 分类 | 内容 |
|:---|:---|
| 性能 | Dashboard 全量加载仅为计数、N+1 查询 (grab_monitor, team_workload) |
| 安全 | TestSendMessage 发给 @all、DB 错误类型未区分、json.Unmarshal 错误忽略 |
| 并发 | FindOrCreateCustomer 竞态条件 (TOCTOU)、UpdateCustomerStats 无事务 |
| 逻辑 | GrabAlertCount vs GetGrabAlerts 语义不一致、昨日异常抢单窗口计算错误 |
| 前端 | CSS 冲突、handleSave 未 await、响应取值链模糊、memo 失效 |

#### 🔵 建议 (10 项)

UpdateCustomer 无法清空字段、URL 未 QueryEscape、LIKE 前缀通配符、GetCustomerWithOrders 未分页、wecom_chat_id 暴露、内联动画重复注入、filteredNavRoutes 缺 useMemo、防抖不统一、死代码、魔法数字

### 5.4 安全审查关键发现

| 级别 | 问题 | 预估修复 |
|:---|:---|:---:|
| **H-3** | `ListOrders` 缺角色权限过滤 — 任何角色可查所有订单 | 0.5h |
| **H-4** | `GetOrderDetail/Timeline` 缺权限校验 — 知道ID即可查任意订单 | 0.5h |
| **H-1** | JWT 无法撤销 — 禁用员工 token 24h 内仍有效 | 2h |
| **H-2** | WebSocket 无连接数上限 — 资源耗尽型 DoS | 1h |
| **M-1** | CSRF 对 `upload_ocr` / `orders/create` 豁免过宽 | 0.5h |
| **M-6** | OTA `download_url` 未校验域名 — 供应链攻击向量 | 0.5h |

---

## 六、后续建议 — 分级别路线图

### ⚡ P0 — 立即修复 (安全 + 崩溃, 1-2 天)

> 这些问题直接影响系统安全性和稳定性，应最优先处理。

| # | 任务 | 来源 | 预估 |
|:---:|:---|:---|:---:|
| 1 | **`grab_monitor.go` nil panic 修复** — AssignedAt nil 检查 + defer recover | 代码审查 #1,#2 | 1h |
| 2 | **后台 goroutine 添加 panic recovery** — GrabMonitor/TimeoutWatcher/DeadlineReminder | 代码审查 #15 | 1h |
| 3 | **`/customers` 前端路由加角色守卫** — 移入 `RequireRole(['admin','sales','follow'])` | 代码审查 #5 | 0.5h |
| 4 | **`ListOrders` 后端角色权限过滤** — operator 只看自己的、designer 只看自己的 | 安全审查 H-3 | 0.5h |
| 5 | **`GetOrderDetail/Timeline` 权限校验** — 复用 `GetOrder` 的校验逻辑 | 安全审查 H-4 | 0.5h |

### 🔧 P1 — 本周修复 (逻辑 + 性能 + 安全, 3-5 天)

| # | 任务 | 来源 | 预估 |
|:---:|:---|:---|:---:|
| 6 | **JWT 撤销机制** — 添加 `iat` + 员工模型增加 `token_revoked_at` | 安全审查 H-1 | 2h |
| 7 | **FindOrCreateCustomer 竞态条件** — 改用 `FirstOrCreate` 或加唯一索引 | 代码审查 #9 | 1h |
| 8 | **Dashboard 全量加载改 SQL 聚合** — SELECT COUNT(*), SUM(price) | 代码审查 #14 | 1h |
| 9 | **N+1 查询优化** — GetGrabAlerts/GetDesignerGrabStats 批量查询 | 代码审查 #13 | 2h |
| 10 | **敏感信息脱敏** — 诊断接口 corp_id 脱敏、error log 中 token 脱敏 | 代码审查 #3,#4 | 1h |
| 11 | **WebSocket 连接数上限** — 每用户最多 3 个并发 WS 连接 | 安全审查 H-2 | 1h |
| 12 | **CSRF 豁免收窄** — 移除 upload_ocr/orders/create 的豁免 | 安全审查 M-1 | 0.5h |
| 13 | **CustomersPage loading 初始化** — `useState(true)` 消除空状态闪现 | 代码审查 #6 | 0.5h |

### 📋 P2 — 下周排期 (功能补全 + 代码质量, 5-7 天)

| # | 任务 | 来源 | 预估 |
|:---:|:---|:---|:---:|
| 14 | **企微自动加好友** — 对接 `add_contact_way` + `externalcontact` API | PRD 差距 P0 | 2-3d |
| 15 | **恶意抢单检测与告警** — 统计超时未进展比例 + 推送告警 | PRD 差距 P1 | 1-2d |
| 16 | **建立 employee service 层** — 员工 CRUD 从 handler 下沉到 services/ | 架构审查 P2 | 1d |
| 17 | **统一错误响应格式** — 抽取 `Success()`/`Error()`/`Paginated()` 标准函数 | 架构审查 P2 | 1d |
| 18 | **SQLite 备份方式修复** — 使用 `VACUUM INTO` 替代 io.Copy | 架构审查 P1 | 0.5d |
| 19 | **GetRevenueChart N 次查询优化** — 改为 SQL GROUP BY date 聚合 | 架构审查 P1 | 0.5d |
| 20 | **删除 Vue 遗留代码** — `rm -rf admin-web/src/views/` + `admin-web-vue-backup/` | 前端审查 Phase 1 | 0.5h |

### 🎨 P3 — 两周内 (UI 提升, 3-5 天)

> 以下为之前和你讨论过的 UI 改进方向，基于设计师审查报告。

| # | 任务 | 来源 | 预估 |
|:---:|:---|:---|:---:|
| 21 | **Design Token 统一** — `bg-[#465FFF]` → `bg-brand-500` 等 100+ 处批量替换 | UI 审查 P0-1 | 2h |
| 22 | **组件库落地** — Dashboard/Orders/Employees 页面改用 `ui/` 组件 | UI 审查 P0-2 | 1d |
| 23 | **表格全局基础样式** — 在 index.css 补全 table/th/td 样式 | UI 审查 P0-3 | 1h |
| 24 | **公共阴影 utility** — 提取 `.shadow-card` / `.shadow-card-hover` | UI 审查 P1-4 | 0.5h |
| 25 | **KPI 卡片骨架屏** — 加载中显示 skeleton 而非 "0" | UI 审查 P1-5 | 1h |
| 26 | **主按钮渐变升级** — CTA 按钮 `linear-gradient(135deg, #465FFF, #6366F1)` | UI 审查 P1-6 | 0.5h |
| 27 | **表格响应式改进** — 水平滚动提示 + 关键列 sticky | UI 审查 P2-8 | 1d |
| 28 | **封装 Input/Select/Table 组件** | UI 审查 P2-9 | 1d |

### 📈 P4 — 月度规划 (业务拓展 + 长期投入)

| # | 任务 | 来源 | 预估 |
|:---:|:---|:---|:---:|
| 29 | **分润报表 Excel + 月结自动化** — excelize 生成 .xlsx | PRD 差距 P1 | 2d |
| 30 | **顾客满意度追踪** — 评价链接 + 设计师绩效 | PRD 差距 P2 | 3-4d |
| 31 | **防盗版水印系统** — 文件中转 + 支付确认释放 | PRD 差距 P2 | 5-7d |
| 32 | **SQLite → PostgreSQL 迁移** — GORM 换 driver + 数据迁移 | PRD 差距 P3 | 1-2d |
| 33 | **结构化日志** — 迁移到 slog/zerolog，JSON 格式 | 架构审查 P3 | 1d |
| 34 | **Dark Mode** — Tailwind `dark:` 前缀 + 深色 token | UI 审查 P3-14 | 2-3d |
| 35 | **图标系统统一** — 全部改用 lucide-react，移除 50+ inline SVG | UI 审查 P3-13 | 1d |
| 36 | **监控可观测性** — Prometheus metrics + 日志轮转 | 架构审查 P3 | 2d |

---

## 七、之前讨论过的重点提议回顾

### 7.1 你提出的核心要求

| 要求 | 状态 | 说明 |
|:---|:---:|:---|
| V2 四角色体系改造 | ✅ 已完成 | admin/sales/follow/designer, Phase 1-2 |
| 四方分润拆分 | ✅ 已完成 | 平台+设计师+谈单+跟单, Phase 3 |
| 统一登录入口 | ✅ 已完成 | `/auth/login` 替代 `/auth/admin_login` |
| 自动生成账号密码 | ✅ 已完成 | `role_NNN` + 8位随机密码 |
| 重置密码功能 | ✅ 已完成 | 后端 API + 前端按钮 + 凭证弹窗 |
| Brave 风格 UI | ✅ 已有基础 | 登录页 8.5/10，内页 7.0-7.5 |
| 8 Agent 团队 | ✅ 已创建 | 配置文件 + 实际调用审查 |
| GitHub 仓库装修 | ✅ 已完成 | README V2 全面升级 + 推送 |
| 大厂开发标准 | ✅ 执行中 | commit 里程碑提交 + CI 流水线 |
| uiverse.io 组件参考 | 🔲 待执行 | UI 审查已给出具体建议 (P3 级别) |
| 前端设计高品质 | 🔲 持续优化 | Design Token 统一 + 组件库落地 |

### 7.2 V2 改造文档中提到但尚未实施的项

| 项目 | 优先级 | 说明 |
|:---|:---:|:---|
| 顾客建档独立实体 | P0 | 已有 Customer 模型，但客服端表单仅作订单字段存储 |
| 企微自动加好友 | P0 | PRD 标注核心价值，日省 1-3h 人工 |
| 恶意抢单检测 | P1 | 防止设计师抢单不做 |
| Excel 分润报表 | P1 | 当前仅 CSV，缺自动月结 |
| 企微回调 Token 配置 | P1 | 需公网域名 + 企微后台操作 |
| staff-web 员工端 | P2 | 已有骨架 (`staff-web/`)，仅 LoginPage |
| 生产环境部署 | P2 | 服务器 + 域名 + HTTPS + ngrok 替代 |

---

## 八、设计系统速查 (Brave-Inspired Design Tokens)

### 配色

| Token | 色值 | 用途 |
|:---|:---|:---|
| `brand-500` | `#465FFF` | 主色 — 按钮/链接/激活态 |
| `brand-600` | `#3641F5` | hover 态 |
| `brand-700` | `#2B35CF` | active 态 |
| `success` | `#22AD5C` | 成功/启用 |
| `warning` | `#F59E0B` | 警告 |
| `danger` | `#F04438` | 危险/删除 |
| `sidebar-bg` | `#1C2434` | 侧边栏 |
| `page-bg` | `#F1F5F9` | 页面背景 |

### 圆角

| 场景 | 值 |
|:---|:---|
| 卡片/面板/Modal | `rounded-2xl` (16px) |
| 按钮/输入框/菜单 | `rounded-xl` (12px) |
| Badge/头像 | `rounded-full` |

### 字体

| 场景 | 字体 | 大小 |
|:---|:---|:---|
| 页面标题 | Outfit | 26px / extrabold |
| 卡片标题 | Outfit | 18px / bold |
| KPI 数值 | Outfit | 24-28px / bold |
| 正文 | Inter | 14px / regular |
| 表头 | Inter | 12px / semibold |

---

## 九、CI/CD 状态

`.github/workflows/ci.yml` 三个 Job:

- **backend**: Go 1.23 build + test (每次 push/PR)
- **frontend**: Node 20 npm ci + build (每次 push/PR)
- **release**: Tag `v*` 触发 → Linux AMD64 二进制 + 前端产物 → GitHub Release

目前 CI 状态: [![CI](https://img.shields.io/github/actions/workflow/status/daxia778/qywechat/ci.yml?style=flat-square)](https://github.com/daxia778/qywechat/actions)

---

## 十、快速参考

### 启动命令

```bash
# 后端
cd server && go run .              # → :8201

# 前端
cd admin-web && npm run dev        # → :8200 (代理 API→:8201)

# 桌面端
cd desktop-client && wails dev

# Docker 一键部署
docker compose up -d
```

### 默认账号

- 管理员: `admin` / `admin888`

### 关键端口

| 组件 | 端口 | 说明 |
|:---|:---:|:---|
| 前端 (Vite dev) | 8200 | 唯一用户入口 |
| 后端 (Gin) | 8201 | 内部，不直接访问 |
| 后端 (prod) | 8200 | 一体化服务 |

---

*本文档由 Claude Code 自动生成，基于项目源码、Git 历史、5 份审查报告及历次对话记录综合整理。*
*生成时间: 2026-03-21*
