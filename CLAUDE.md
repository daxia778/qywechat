# PDD 派单管理系统

企微对接 + 客服录单 + OCR 防篡改 + 管理看板，面向 10-20 人兼职团队，日单量 60-100。

## 按需加载规则（必读）

本项目采用分层 CLAUDE.md 架构，**严禁跳过 CLAUDE.md 直接读源码**。工作流程：

1. **先读本文件**（根 CLAUDE.md）了解全局架构
2. **根据任务涉及的模块**，读取对应子目录的 CLAUDE.md：
   - 后端任务 → 先读 `server/CLAUDE.md`（路由、模型、服务一览）
   - 前端任务 → 先读 `web/CLAUDE.md`（组件、路由、API 调用模式）
   - 全栈任务 → 两个都读
3. **只有在 CLAUDE.md 信息不足时**，才去读具体源码文件，且只读相关文件的相关部分
4. **新增/重大改动后**，同步更新对应 CLAUDE.md

这样做的目的：避免每次对话重复读取 2 万行源码，CLAUDE.md 已包含模块职责、数据模型、API 路由、状态机等关键信息。

## 技术栈
- **后端**: Go 1.22+ / Gin / GORM / SQLite → 详见 `server/CLAUDE.md`
- **前端管理端**: React 19 + Vite + TailwindCSS v4 → 详见 `web/CLAUDE.md`
- **桌面客服端**: Go + Wails v2 + Vue3 (`desktop-client/`)
- **员工前端**: 已合并入 `web/`（统一前端）
- **企业微信**: 自建应用 API（消息推送、建群、通讯录同步、回调）
- **OCR**: 智谱 GLM-4V / 通义千问 VL

## 项目结构
```
├── server/          # Go 后端 (详见 server/CLAUDE.md)
├── web/             # 统一前端 (管理端+员工端, 详见 web/CLAUDE.md)
├── desktop-client/  # 桌面客服端 (Wails + Vue)
├── deploy/          # 部署配置 (Nginx)
└── docs/            # 文档
```

## 端口规范
- **8200**: 用户访问端口（Vite dev / 生产静态服务）
- **8201**: Go 后端内部端口
- 开发时 Vite 代理 `/api` → 8201、`/ws` → ws://8201
- **严禁使用其他端口**

## 企业微信
- CorpID: `wwdb2f088115fa0fff` / AgentID: `1000004`
- 回调: `https://{域名}/api/v1/wecom/callback`
- 配置在 `server/.env`

## 开发命令
```bash
cd server && go run .              # 后端
cd web && npm run dev              # 前端
./build.sh all                     # 全量构建
docker compose up -d               # Docker 部署
```

## 部署
- **生产服务器**: `118.31.56.141`
- **前端部署路径**: `/opt/pdd-server/dist/`（注意：不是 `/opt/pdd-order-system/dist/`）
- **前端部署命令**: `cd web && npm run build && scp -r dist/* root@118.31.56.141:/opt/pdd-server/dist/`
- **后端服务**: systemd 管理，路径 `/opt/pdd-server/`

## 默认账号
- 管理员: `admin` / `admin888`

## 代码规范
- Go 标准布局，前端 React + JSX（不用 TypeScript）
- API 路径 `/api/v1/` 前缀
- 敏感配置通过 `.env` 注入，禁止硬编码
- 金额单位统一用 **分**

---

## SaaS 演进战略讨论记录 (2026-03-27)

### 项目远景
从 PPT 定制服务的单体工具演进为 **AI 客服 SaaS 平台**，核心能力是 AI 客服 + 多平台私域引流。

### 三步走路线图

**Phase 1（基础打磨 — ✅ 已完成）**

> 核心目标：打通全链路数据交互、完善权限隔离、补齐前端页面、修复已知 Bug

#### 1.1 前端页面补全 ✅
| 模块 | 文件 | 说明 |
|------|------|------|
| 收款流水管理 | `admin-web/src/pages/PaymentsPage.jsx` | 列表/筛选/手动录入/关联订单/汇总卡片/企微同步 |
| 收款 API 封装 | `admin-web/src/api/payments.js` | 5 个接口全部封装 |
| 抢单监控看板 | `admin-web/src/pages/GrabAlertsPage.jsx` | 超时未抢单告警列表 |
| 抢单 API 封装 | `admin-web/src/api/admin.js → getGrabAlerts` | 已封装 |
| 顾客合并交互 | `admin-web/src/pages/CustomersPage.jsx` | 合并 UI + `mergeCustomers` API |
| 顾客 API 封装 | `admin-web/src/api/customers.js` | 含 `mergeCustomers(primaryId, duplicateId)` |
| 路由注册 | `admin-web/src/router/index.jsx` | `/payments` `/grab-alerts` 均已注册，admin 权限保护 |
| Vue 遗留清理 | — | `admin-web/src/views/` 目录已删除 |

#### 1.2 角色权限隔离 ✅
- 公共过滤函数: `server/handlers/common.go → filterByRole()`
- 订单列表 `ListOrders`: 按角色自动限定数据范围 (admin 全部 / sales 按 operator_id / designer 按 designer_id / follow 按 follow_operator_id|operator_id)
- 订单详情 `GetOrder`: 逐角色鉴权，非本人无权查看
- 状态流转 `UpdateOrderStatus`: 基于 `StatusChangePermission` 允许表 + 属主校验
- 金额修改 `UpdateOrderAmount`: 仅 admin/designer，designer 限改自己订单
- 个人统计 `GetMyStats`: 自动按角色过滤订单范围
- 收款流水: admin 全部，follow/sales/designer 仅自己相关

#### 1.3 金额修改→分润重算闭环 ✅
- Handler: `server/handlers/order_handler.go → UpdateOrderAmount()`
- 流程: 参数校验 → 事务内更新 price/pages + 写 `OrderTimeline` 审计日志 → 事务提交后调用 `TriggerProfitRecalculation()`
- 分润引擎: `server/services/profit.go`
  - `CalculateProfit()` — 纯计算，按费率拆分各方佣金
  - `RecalculateAndSave()` — 计算 + 事务内落库
  - `TriggerProfitRecalculation()` — 异步触发，不阻塞接口响应
  - `ClearProfitFields()` — 退款场景清零
- 触发时机: 订单创建 / 金额修改 / 状态变更为 COMPLETED / 退款清零

#### 1.4 对话数据采集 ✅
- 模型: `server/models/wecom_data.go → WecomMessageLog`
- 入站写入: `server/handlers/wecom_handler.go` 企微回调解析后写入
- 同步补充: `server/services/wecom_sync.go` 定期同步 + 90 天自动清理
- 关联查询: `server/handlers/admin_handler.go` 群消息查询接口 (`GET /admin/wecom/groups/:chat_id/messages`)
- 目的: 积累 AI 客服训练语料，利用订单状态机作为天然自动标签

#### 1.5 已知 Bug 修复 ✅
| Bug | 修复状态 |
|-----|---------|
| notifications/all/read 404 | ✅ 后端已补 `MarkAllNotificationsRead` handler + `PUT /admin/notifications/all/read` 路由 |
| 前端 API 调用路径 | ✅ `notifications.js` 路径与后端一致 |

#### 1.6 遗留问题（已全部修复）✅
| 问题 | 说明 | 状态 |
|------|------|------|
| `.env` BASE_URL 指向旧 IP | 已修正为 `http://118.31.56.141:8200` | ✅ 已修复 |

**Phase 2（企微 API 就绪后）**
- 企微客户群建群、外部联系人匹配
- PDD 开放平台 API 对接（替代手工 OCR 录单）
- PPT 自动化出稿（NotebookLM 无头浏览器交互 → 后续转国产 API）
- AI 客服知识库构建

**Phase 3（中远期）**
- 多租户架构改造（`tenant_id` 注入）
- 多平台适配（钉钉 / 飞书 / 其他电商平台）
- SaaS 产品化（基础版 AI 客服 + 升级版私域引流）

### 关键架构决策

#### 1. 多 Agent 架构
```
Agent 调度中心 (Router)
  ├── PDD Agent     → 拼多多售前自动答疑（标准话术，高自动化）
  ├── WeCom Agent   → 企微私域服务（需求沟通，中等自动化）
  └── 未来 Agent     → 飞书 / 钉钉 ...
所有 Agent 共享底层业务层（订单/客户/分润）
```
- AI Agent = 大脑（理解意图、决策回复）
- Platform API = 手脚（执行建群、发消息、改状态等动作）
- 知识库 + 标注数据 = 记忆（从历史对话学习话术模式）

#### 2. PPT 自动化策略
- 当前实践：NotebookLM 生成初稿 → 设计师用蒙版微调 → 交付
- 技术路线：无头浏览器与 NotebookLM 交互 → 后续转国产 API（合规）→ 深度定制
- 定位：**设计师提效工具**，非直接面客交付物
- 痛点：NotebookLM 生成的 PPT 不可编辑，后续需解决格式转换

#### 3. 数据标注策略（零成本起步）
- 利用订单状态机作为**天然自动标签**
- `PENDING` 阶段消息 → 询价/交期（标准可自动化）
- `DESIGNING` 阶段消息 → 催稿/改需求（复杂，需谨慎）
- `DELIVERED` 阶段消息 → 确认/修改意见（判断结单或转改稿）
- 实现方式：企微回调入站消息写入 `WecomMessageLog`，关联 `order_sn`

#### 4. 平台抽象层预留
- 将 `services/wecom.go` 关键方法抽象为 `PlatformMessenger` 接口
- 当前仅实现 `WecomMessenger`
- 后续新增平台只需新增实现，不碰业务代码
