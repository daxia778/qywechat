<div align="center">

<img src="https://img.shields.io/badge/%E6%B4%BE%E5%8D%95%E7%AE%A1%E7%90%86-PDD-434FCF?style=for-the-badge&labelColor=3D28B2" alt="PDD"/>

# PDD 派单管理系统

**Enterprise WeChat + AI-Powered Order Dispatch Platform**

<br/>

[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Gin](https://img.shields.io/badge/Gin-Framework-0090D1?style=flat-square)](https://gin-gonic.com)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Wails](https://img.shields.io/badge/Wails-v2-DF0000?style=flat-square)](https://wails.io)
[![CI](https://img.shields.io/github/actions/workflow/status/daxia778/qywechat/ci.yml?style=flat-square&label=CI&logo=githubactions&logoColor=white)](https://github.com/daxia778/qywechat/actions)
[![Go Report](https://goreportcard.com/badge/github.com/daxia778/qywechat?style=flat-square)](https://goreportcard.com/report/github.com/daxia778/qywechat)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

<br/>

> *全链路自动化派单 — 从客服截图到设计师交付，一键搞定*

<br/>

```
  截图粘贴 ──→ AI OCR 识别 ──→ 订单锁定 ──→ 企微派单 ──→ 设计师抢单 ──→ 建群协作
  文本粘贴 ──→ AI 智能提取 ─┘
```

<br/>

</div>

## Highlights

<table>
<tr>
<td width="50%" valign="top">

### :brain: AI OCR + 文本解析
截图粘贴即解析，订单号 + 金额 + 时间三字段锁定，杜绝人工篡改。双模型容灾 — 智谱 GLM-4V-Plus 优先，通义千问 VL 自动回退。文本粘贴一键提取联系方式/主题/页数/时间。

### :lock: 设备指纹绑定
硬件 UUID + MAC + 主机名三重指纹，首次激活即永久绑定。AES-256-GCM 加密本地会话。

### :chart_with_upwards_trend: 实时管理看板
WebSocket 驱动，订单状态变更秒级推送。营收趋势、利润构成、团队负载全方位可视化。

</td>
<td width="50%" valign="top">

### :speech_balloon: 企微深度集成
自动建群、消息通知、状态流转同步，全程企微内闭环。回调事件实时处理，通讯录每小时同步。

### :busts_in_silhouette: 四角色体系
`管理员` · `谈单客服` · `跟单客服` · `设计师` — 细粒度权限控制，统一登录入口，自动生成账号密码。

### :moneybag: 四方分润引擎
平台手续费 + 设计师佣金 + 谈单客服佣金 + 跟单客服佣金 — 可配置费率，自动计算净利润，Excel/CSV 一键导出。

</td>
</tr>
</table>

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Clients                                   │
│                                                                     │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐     │
│   │  Desktop App │    │  Admin Web   │    │  WeChat Work     │     │
│   │  Wails + Vue │    │ React + Vite │    │  Callback + Bot  │     │
│   └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘     │
└──────────┼───────────────────┼─────────────────────┼────────────────┘
           │                   │                     │
           ▼                   ▼                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Go Backend (Gin)  :8201                        │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   Auth   │  │  Orders  │  │  Admin   │  │    WebSocket     │   │
│  │ JWT +    │  │ CRUD +   │  │Dashboard │  │    Real-time     │   │
│  │ Blacklist│  │  State   │  │ Revenue  │  │    Broadcast     │   │
│  │ Refresh  │  │ Machine  │  │ Profit   │  │                  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
│       │             │             │                  │              │
│  ┌────▼─────────────▼─────────────▼──────────────────▼───────────┐  │
│  │                      Service Layer                             │  │
│  │  OCR (GLM-4V / Qwen-VL)  ·  WeCom API  ·  Profit Engine     │  │
│  │  Token Blacklist  ·  Grab Monitor  ·  Deadline Reminder      │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                              │                                      │
│  ┌──────────────────────────▼────────────────────────────────────┐  │
│  │                SQLite / PostgreSQL (GORM)                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

<table>
<tr>
<td width="50%" valign="top">

#### :gear: Backend
| Tech | Role |
|:---|:---|
| **Go 1.24** | 主语言 |
| **Gin** | HTTP 框架 |
| **GORM** | ORM + 自动迁移 |
| **SQLite / PostgreSQL** | 数据库 (双驱动) |
| **JWT + bcrypt** | 认证 + Token 黑名单 + 刷新机制 |
| **智谱 GLM-4V / 通义千问 VL** | 双模型 OCR 容灾 |
| **智谱 GLM-4-Air** | 文本智能解析 (正则+LLM) |
| **WeCom Server API** | 企微消息 + 建群 + 通讯录 + 收款 |
| **WebSocket Hub** | 实时广播 |
| **golangci-lint + gosec** | 静态分析 + 安全扫描 |

</td>
<td width="50%" valign="top">

#### :art: Frontend
| Tech | Role |
|:---|:---|
| **React 19** | 管理端 UI |
| **Vite 6** | 构建工具 |
| **TailwindCSS v4** | 样式系统 |
| **ECharts** | 营收 + 利润图表 |
| **Lucide Icons** | 图标库 |
| **ESLint 9** | 代码质量 |
| **Wails v2 + Vue 3** | 桌面客服端 |

</td>
</tr>
</table>

---

## Project Structure

```
qywechat/
├── server/                  # Go 后端服务
│   ├── config/              #   配置加载 (.env)
│   ├── handlers/            #   路由处理 (auth, order, admin, profit, wecom, ws)
│   │   └── response.go      #   统一错误码 + 响应格式
│   ├── middleware/          #   中间件 (JWT + 黑名单, CSRF, rate-limit, security)
│   ├── models/              #   数据模型 (Employee, Order, Timeline, Audit)
│   ├── services/            #   业务逻辑 (OCR, WeChat, OSS, WebSocket, Profit)
│   ├── testutil/            #   测试基础设施 (内存 SQLite)
│   ├── .golangci.yml        #   Lint 配置 (11 linters + gosec)
│   └── main.go              #   入口 & 路由注册
│
├── web/                     # React 管理看板 + 员工工作台
│   ├── src/pages/           #   页面 (Dashboard, Orders, Revenue, Team, Employees, Staff)
│   ├── src/components/      #   UI 组件库 (AppShell, ConfirmModal, Toast, DesignerSelectModal, ...)
│   ├── src/api/             #   API 客户端
│   ├── src/contexts/        #   全局状态 (Auth, Toast, WebSocket)
│   ├── src/utils/           #   常量 + 格式化工具 + cn() (tailwind-merge)
│   └── eslint.config.js     #   ESLint 9 flat config
│
├── desktop-client/          # Wails 桌面客服端
│   ├── app.go               #   Go 后端 (设备登录, OCR, 提交)
│   ├── crypto.go            #   设备指纹 + AES-256-GCM 会话加密
│   ├── main.go              #   Wails 窗口配置
│   └── frontend/src/        #   Vue 3 前端 (App.vue)
│
├── deploy/                  # 部署配置
│   ├── nginx.conf           #   Nginx 反代 + 限速
│   └── security-headers.conf#   安全响应头 (HSTS, CSP, XFO)
├── .github/workflows/       # GitHub Actions CI/CD
│   └── ci.yml               #   Lint + Security Scan + Test + Build + Release
├── Dockerfile               # 3 阶段多阶段构建
├── docker-compose.yml       # Docker 编排 (PostgreSQL + App + Nginx)
├── docker-compose.lite.yml  # 轻量编排 (SQLite 单容器)
└── build.sh                 # 一键构建脚本
```

---

## Role System

四角色体系：

```
  ┌──────────────────────────────────────────────────────────────┐
  │                        管理员 (Admin)                         │
  │    全局权限 · 员工管理 · 营收分析 · 订单转派 · 系统配置       │
  └───────────────────────┬──────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │  谈单客服    │ │  跟单客服    │ │   设计师     │
  │   (Sales)    │ │   (Follow)   │ │  (Designer)  │
  │              │ │              │ │              │
  │ 录单 · OCR   │ │ 跟进 · 催单  │ │ 抢单 · 交付  │
  │ 订单管理     │ │ 订单管理     │ │ 设计制作     │
  └──────────────┘ └──────────────┘ └──────────────┘
```

| 角色 | 权限范围 | 分润 |
|:---|:---|:---|
| **管理员** | 全局数据 · 员工增删 · 设备管理 · 营收图表 · 订单转派 | — |
| **谈单客服** | 订单创建 · 客户管理 · OCR 录单 | 谈单佣金 (可配置) |
| **跟单客服** | 订单跟进 · 客户管理 · 催单 | 跟单佣金 (可配置) |
| **设计师** | 抢单 · 设计交付 · 我的订单 | 设计师佣金 (可配置) |

---

## Order State Machine

```
                     ┌────────────────────────────────────────────┐
                     │              ◀── 订单转派 (管理员)          │
  ┌──────────┐   ┌───▼───────┐   ┌──────────┐   ┌──────────┐   ┌┴─────────┐
  │ PENDING  │──▶│  GROUP    │──▶│DESIGNING │──▶│DELIVERED │──▶│COMPLETED │
  │  待处理  │   │ CREATED   │   │  设计中  │   │  已交付  │   │  已完成  │
  └────┬─────┘   │  已建群   │   └────┬─────┘   └────┬─────┘   └──────────┘
       │         └─────┬─────┘        │              │
       │               │         ┌────▼─────┐   ┌────▼─────┐
       │               │         │AFTER_SALE│◀──│ REVISION │
       │               │         │  售后中  │──▶│  改稿中  │
       │               │         └────┬─────┘   └──────────┘
       ▼               ▼              ▼
  ┌──────────────────────────────────────────────────────┐
  │         REFUNDED (已退款) / CLOSED (已关闭)           │
  └──────────────────────────────────────────────────────┘
```

---

## Profit Engine

四方分润，费率可配置：

```
  总营收 ¥1000
  ├── 平台手续费    6%    →  ¥60
  ├── 设计师佣金   30%    → ¥300
  ├── 谈单客服佣金 10%    → ¥100
  ├── 跟单客服佣金  5%    →  ¥50
  └── 净利润       49%    → ¥490
```

---

## Quick Start

### Prerequisites

- Go 1.24+
- Node.js 18+ (npm)
- (Optional) Docker & Docker Compose

### 1. Backend

```bash
cd server
cp .env.example .env    # 编辑: JWT_SECRET, WECOM_*, ZHIPU_API_KEY 等
go run .                # 启动在 :8201
```

### 2. Admin Web

```bash
cd web
npm install
npm run dev             # 启动在 :8200 (自动代理 API → :8201)
```

### 3. Desktop Client

```bash
cd desktop-client
wails dev               # 开发模式
wails build             # 构建 .app / .exe
```

### 4. Docker (Production)

```bash
# 完整版 (PostgreSQL + Nginx)
docker compose up -d

# 轻量版 (SQLite 单容器)
docker compose -f docker-compose.lite.yml up -d
```

---

## Configuration

通过 `server/.env` 管理，参考 `.env.example`：

| 变量 | 说明 | 必填 |
|:---|:---|:---:|
| `SERVER_PORT` | 后端端口 (默认 8201) | Yes |
| `JWT_SECRET_KEY` | JWT HMAC-SHA256 签名密钥 | Yes |
| `ZHIPU_API_KEY` | 智谱 AI OCR 密钥 | Yes |
| `DASHSCOPE_API_KEY` | 通义千问 VL 备用密钥 | No |
| `WECOM_CORP_ID` | 企微企业 ID | Yes |
| `WECOM_AGENT_ID` | 企微应用 ID | Yes |
| `WECOM_CORP_SECRET` | 企微应用 Secret | Yes |
| `ADMIN_DEFAULT_PASSWORD` | 管理员初始密码 | Yes |
| `PLATFORM_FEE_RATE` | 平台手续费率 (%) | No |
| `DESIGNER_COMMISSION_RATE` | 设计师佣金率 (%) | No |
| `SALES_COMMISSION_RATE` | 谈单客服佣金率 (%) | No |
| `FOLLOW_COMMISSION_RATE` | 跟单客服佣金率 (%) | No |

---

## Security

| Feature | Implementation |
|:---|:---|
| **Unified Auth** | 统一 `/auth/login` 入口，JWT + bcrypt，支持四角色 |
| **Token Blacklist** | JTI 黑名单 + 用户级全量失效，密码重置/禁用即时注销所有会话 |
| **Token Refresh** | `/auth/refresh` 签发新 token，旧 token 自动加入黑名单 |
| **Device Binding** | 硬件 UUID + MAC + 主机名三重指纹，首次激活即永久绑定 |
| **One-Time Code** | 激活码使用后立即销毁 (bcrypt hash + prefix index) |
| **Session Encrypt** | AES-256-GCM 加密本地会话，密钥为设备指纹 |
| **Anti-Tamper OCR** | AI 识别结果锁定表单，前端 readonly + 服务端校验双重防篡改 |
| **Rate Limiting** | Nginx 层 (30r/s API, 5r/m 登录) + 应用层双重限速 |
| **CSRF Protection** | 双重 Cookie + Header Token 校验 |
| **Brute Force Guard** | 连续失败自动锁定 IP，滑动窗口计数 |
| **Security Headers** | HSTS / X-Frame-Options / CSP / X-Content-Type-Options |
| **Unified Error Response** | 统一错误码格式，防止内部错误信息泄露给客户端 |
| **Security Scan** | CI 集成 gosec 静态安全分析 |

---

## API Reference

<details>
<summary><b>Auth (认证)</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| POST | `/api/v1/auth/login` | 统一登录 (V2) |
| POST | `/api/v1/auth/device_login` | 设备激活码 / 指纹静默登录 |
| POST | `/api/v1/auth/admin_login` | 管理员登录 (兼容旧前端) |
| GET | `/api/v1/auth/validate_token` | 校验 JWT Token |
| POST | `/api/v1/auth/logout` | 注销 Token (加入黑名单) |
| POST | `/api/v1/auth/refresh` | 刷新 Token (签发新 token) |

</details>

<details>
<summary><b>Orders (订单)</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| POST | `/api/v1/orders/upload_ocr` | 上传截图 AI 识别 |
| POST | `/api/v1/orders/parse_text` | AI 文本智能解析 |
| POST | `/api/v1/orders/create` | 创建新订单 |
| POST | `/api/v1/orders/grab` | 设计师抢单 |
| GET | `/api/v1/orders/list` | 订单列表 (筛选+分页) |
| GET | `/api/v1/orders/:id` | 订单详情 |
| GET | `/api/v1/orders/:id/detail` | 订单详情 (扩展) |
| GET | `/api/v1/orders/:id/timeline` | 订单时间线 |
| GET | `/api/v1/orders/:id/profit` | 订单分润明细 |
| PUT | `/api/v1/orders/:id/status` | 更新订单状态 |
| PUT | `/api/v1/orders/:id/amount` | 修改订单金额 |
| PUT | `/api/v1/orders/:id/reassign` | 订单转派设计师 (admin) |
| PUT | `/api/v1/orders/batch-status` | 批量更新状态 (max 100) |
| GET | `/api/v1/orders/pending-match` | 待匹配订单 |
| POST | `/api/v1/orders/:id/match` | 匹配订单联系人 |

</details>

<details>
<summary><b>Payments (收款)</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| GET | `/api/v1/payments` | 收款流水列表 |
| POST | `/api/v1/payments` | 手动录入收款 |
| PUT | `/api/v1/payments/:id/match` | 匹配收款与订单 |
| GET | `/api/v1/payments/summary` | 收款汇总统计 |
| POST | `/api/v1/payments/sync-wecom` | 同步企微收款 |

</details>

<details>
<summary><b>Admin (管理)</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| GET | `/api/v1/admin/dashboard` | 看板统计 |
| GET | `/api/v1/admin/revenue_chart` | 营收趋势 |
| GET | `/api/v1/admin/profit_breakdown` | 利润构成分析 |
| GET | `/api/v1/admin/employees` | 员工列表 |
| POST | `/api/v1/admin/employees` | 创建员工 (自动生成账号) |
| PUT | `/api/v1/admin/employees/:id/toggle` | 启用/禁用 |
| PUT | `/api/v1/admin/employees/:id/reset_password` | 重置密码 |
| PUT | `/api/v1/admin/employees/:id/unbind` | 解绑设备 |
| DELETE | `/api/v1/admin/employees/:id` | 删除员工 |
| PUT | `/api/v1/admin/employees/batch_toggle` | 批量启用/禁用 |
| POST | `/api/v1/admin/employees/batch_delete` | 批量删除 |
| GET | `/api/v1/admin/team_workload` | 团队工作量 |
| GET | `/api/v1/admin/activation_codes` | 激活码管理 |
| PUT | `/api/v1/admin/activation_codes/:id/pause` | 暂停激活码 |
| PUT | `/api/v1/admin/activation_codes/:id/regenerate` | 重新生成激活码 |
| GET | `/api/v1/admin/customers` | 顾客列表 |
| GET | `/api/v1/admin/customers/:id` | 顾客详情 |
| PUT | `/api/v1/admin/customers/:id` | 更新顾客 |
| POST | `/api/v1/admin/customers/merge` | 合并顾客 |
| GET | `/api/v1/admin/grab_alerts` | 抢单异常告警 |
| GET | `/api/v1/admin/audit_logs` | 审计日志 |
| GET | `/api/v1/admin/notifications` | 通知列表 |
| PUT | `/api/v1/admin/notifications/:id/read` | 标记已读 |
| GET | `/api/v1/admin/orders/export` | CSV 导出订单 |
| GET | `/api/v1/admin/profit/export` | CSV 导出利润 |
| GET | `/api/v1/admin/export/excel` | Excel 多 Sheet 导出 |

</details>

<details>
<summary><b>WeChat Work (企微)</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| ANY | `/api/v1/wecom/callback` | 企微事件回调 |
| GET | `/api/v1/admin/wecom/members` | 通讯录成员 |
| GET | `/api/v1/admin/wecom/groups` | 群聊列表 |
| GET | `/api/v1/admin/wecom/groups/:chat_id/messages` | 群消息记录 |
| GET | `/api/v1/admin/wecom/diagnostic` | 企微连接诊断 |
| POST | `/api/v1/admin/wecom/sync` | 触发通讯录同步 |
| POST | `/api/v1/admin/contact_way` | 创建联系我 |
| GET | `/api/v1/admin/contact_ways` | 联系我列表 |
| GET | `/api/v1/ws` | WebSocket 实时推送 |

</details>

---

## Port Convention

> **统一外部端口: `8200`**

| Component | Port | Role |
|:---|:---:|:---|
| Vite Dev Server | `8200` | 开发入口，反代 API → `:8201` |
| Go Backend | `8201` | HTTP API + WebSocket |
| Go Backend (prod) | `8200` | API + 静态资源一体 |
| Docker | `80/443` → container | Nginx 反代 |

---

## CI/CD

GitHub Actions 自动化流水线 (`.github/workflows/ci.yml`)：

| Trigger | Backend | Frontend |
|:---|:---|:---|
| **Push / PR to `main`** | `go vet` → `golangci-lint` → `gosec` → `go test -cover` → `go build` | `npm ci` → `eslint` → `vite build` |
| **Tag `v*`** | 交叉编译 Linux AMD64 二进制 | 构建生产产物 |
| **Release** | 自动创建 GitHub Release + 附件下载 | |

---

## Development

```bash
# 后端热重载 (推荐 air)
cd server && air

# 前端开发
cd web && npm run dev

# 运行后端测试
cd server && go test ./... -v -count=1

# 运行 lint
cd server && golangci-lint run
cd web && npm run lint

# 构建 Docker 镜像
docker compose build
```

---

## Changelog

### v1.7.1.3 (Latest)

**营收分析仪表盘现代化**
- 营收与订单趋势图切换为双柱状图（品牌色 Indigo + Sky），替代旧版曲线图
- 新增 ECharts DataZoom 滑动区间选择器，支持拖拽缩放查看任意时间范围
- 新增自定义日期选择器（日历），与"近7天/14天/30天"快捷按钮并列
- 利润构成图例与 X 轴日期间距优化，消除重叠

**设计师排行表格重构**
- 改用百分比 `colgroup` 列宽分配（12%/20%/22%/23%/23%），消除大面积空白
- 数值列居中对齐，`tabular-nums` 等宽数字排列
- 排名徽章保留圆形色标（金/银/铜），数据列紧凑对齐

**风控中心 UI 统一**
- 风控中心 SVG 图标替换为纯线条风格（stroke-only），与全局简约主题一致
- 色彩体系统一至品牌色板（Indigo/Slate），移除突兀的填充色块

### v1.6.2

**AI 智能文本解析**
- 新增文本解析接口 `POST /api/v1/orders/parse_text`
- 正则预提取 + GLM-4-Air LLM 兜底的混合策略
- SHA256 哈希 30 分钟缓存，避免重复消耗 Token
- 自动提取：联系方式（手机号/wxid_/微信号）、PPT 主题、页数、交付时间、备注

**桌面端 UI 规范化**
- 文本输入 → AI 提取 → 确认卡片的两步交互流程
- 纯文字标签 + 统一排版（复用 form-label / form-input / form-row 设计体系）
- 区域分隔线，视觉层次更清晰

**多平台编译**
- macOS ARM64 (Apple Silicon) ✅
- macOS AMD64 (Intel) ✅
- Windows AMD64 ✅

**Bug 修复**
- 修复正则误吞 `wxid_` 前缀的 bug
- 修复 CSRF 白名单缺少 parse_text 接口
- 修复 respondOK 响应格式与桌面端不匹配

### v1.6.0

**客户转接（在职继承）**
- 新增客户转接管理页面，支持企微外部联系人在职转移
- 自动转接规则引擎：按添加天数自动触发转接（6小时检查周期）
- 转接记录管理：状态追踪（pending/waiting/success/failed）
- 企微 API 集成：`transfer_customer` + `transfer_result` 双接口

**接单流程优化**
- 接单时必须选择设计师，与花名册联动
- 新增 DesignerSelectModal 组件：搜索/选择/新建设计师一体化
- 支持从花名册选择已有设计师或即时创建新设计师

**建群推送客户联系方式**
- 企微建群消息中自动包含客户联系方式，方便跟单直接加好友

**佣金薪资导出增强**
- Excel 导出新增"薪资明细" Sheet，按员工汇总佣金
- 支持设置员工底薪，应发合计 = 底薪 + 佣金合计
- 佣金分列显示：谈单/跟单/设计三类佣金独立统计

**代码质量**
- 10 组深度代码审查 agent 覆盖前后端全部改动
- 修复 `go vet` 测试文件参数不匹配问题
- 修复 ExportDialog 角色值不一致 bug
- CI 流水线路径修正（`admin-web` → `web`）

### v1.3.0

**跟单客服模块增强**
- 跟单客服新增「收款流水」模块（StaffPaymentsPage），支持查看/筛选/手动录入/关联订单
- 收款汇总统计按角色过滤（admin 全局，follow 仅看自己关联订单）
- 关联订单支持可视化选择（自动加载最近订单列表，搜索筛选）

**订单流程完善**
- 关联设计师时自动设置 cost_price = 订单总价 × 25%（默认设计师成本）
- 换设计师逻辑完善：旧设计师接单数自动减一 + 时间线记录「从 ZZZ 换为 YYY」
- 退款强制填写原因（后端校验 refund_reason 非空）

**收款对账报表**
- 新增 GET /payments/report 对账报表接口（按日/周/月聚合）
- PaymentsPage 新增报表视图切换，ECharts 趋势图

**抢单告警管理**
- GrabAlertsPage 完整重构：统计卡片 + 筛选 + 批量处理 + 30s 轮询
- 新增 3 个后端接口：告警统计/单条处理/批量处理

**企微集成增强**
- 订单详情页一键创建企微群（DESIGNING 状态 + 无群时显示）
- 联系我管理页面（ContactWaysPage）：创建/列表/QR码展示
- ContactWay 数据模型持久化到数据库

**OCR 防篡改**
- 截图上传时计算 SHA256 哈希，创建订单时校验哈希一致性
- Order 模型新增 ScreenshotHash 字段
- 桌面客服端同步支持哈希提交

**分润引擎优化**
- CalculateProfit 集成 PaymentRecord 实际收款数据
- 有匹配收款记录时使用实际收款金额计算分润

**UI/UX 改进**
- Modal 弹窗使用 createPortal 渲染到 body，避免父容器 overflow-hidden 遮挡
- 员工端导航按角色动态过滤显示
- 域名部署：zhiyuanshijue.ltd（Nginx + Let's Encrypt SSL）

### v1.2.0
- Token 黑名单 + 刷新机制，密码重置即时注销
- 管理员订单转派功能 (设计师重新分配)
- 统一错误码响应格式，消除内部错误泄露
- CI 增强: golangci-lint + gosec + ESLint + coverage
- 测试覆盖率提升 (26 个新测试用例)
- 批量订单状态更新 (max 100)
- 设计超时 48h 告警 (企微 + 站内 + WebSocket 三通道)
- Dashboard 查询优化 (20+ → ~13 次 SQL)
- Nginx 安全加固 (限速 + 安全头抽取)
- Docker 资源限制 + 日志轮转

### v1.1.0
- 四角色体系 (管理员/谈单/跟单/设计师)
- 企微深度集成 (建群/消息/通讯录/收款)
- AI 双模型 OCR 容灾
- 实时 WebSocket 看板
- 四方分润引擎

---

## License

MIT License — see [LICENSE](LICENSE) for details.

<div align="center">
<br/>
<sub>Built with Go + React + Wails + WeCom API</sub>
<br/>
<sub>Designed by <a href="https://github.com/daxia778">@daxia778</a></sub>
</div>
