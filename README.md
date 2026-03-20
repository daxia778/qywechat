<div align="center">

<img src="https://img.shields.io/badge/%E6%B4%BE%E5%8D%95%E7%AE%A1%E7%90%86-PDD-434FCF?style=for-the-badge&labelColor=3D28B2" alt="PDD"/>

# PDD 派单管理系统 <sup>V2</sup>

**Enterprise WeChat + AI-Powered Order Dispatch Platform**

<br/>

[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Gin](https://img.shields.io/badge/Gin-Framework-0090D1?style=flat-square)](https://gin-gonic.com)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-v4-38BDF8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Wails](https://img.shields.io/badge/Wails-v2-DF0000?style=flat-square)](https://wails.io)
[![CI](https://img.shields.io/github/actions/workflow/status/daxia778/qywechat/ci.yml?style=flat-square&label=CI&logo=githubactions&logoColor=white)](https://github.com/daxia778/qywechat/actions)
[![License](https://img.shields.io/badge/License-Private-red?style=flat-square)](.)

<br/>

> *全链路自动化派单 — 从客服截图到设计师交付，一键搞定*

<br/>

```
  截图粘贴 ──→ AI 智能识别 ──→ 订单锁定 ──→ 企微派单 ──→ 设计师抢单 ──→ 建群协作
```

<br/>

</div>

## Highlights

<table>
<tr>
<td width="50%" valign="top">

### :brain: AI OCR 防篡改
截图粘贴即解析，订单号 + 金额 + 时间三字段锁定，杜绝人工篡改。双模型容灾 — 智谱 GLM-4V-Plus 优先，通义千问 VL 自动回退，OCR 零停机。

### :lock: 设备指纹绑定
硬件 UUID + MAC + 主机名三重指纹，首次激活即永久绑定。AES-256-GCM 加密本地会话。

### :chart_with_upwards_trend: 实时管理看板
WebSocket 驱动，订单状态变更秒级推送。营收趋势、利润构成、团队负载全方位可视化。

</td>
<td width="50%" valign="top">

### :speech_balloon: 企微深度集成
自动建群、消息通知、状态流转同步，全程企微内闭环。回调事件实时处理，通讯录每小时同步。

### :busts_in_silhouette: V2 四角色体系
`管理员` · `谈单客服` · `跟单客服` · `设计师` — 细粒度权限控制，统一登录入口，自动生成账号密码。

### :moneybag: 四方分润引擎
平台手续费 + 设计师佣金 + 谈单客服佣金 + 跟单客服佣金 — 可配置费率，自动计算净利润，CSV 一键导出。

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
│  │  JWT +   │  │  CRUD +  │  │ Dashboard│  │    Real-time     │   │
│  │  Unified │  │   State  │  │  Revenue │  │    Broadcast     │   │
│  │  Login   │  │  Machine │  │  Profit  │  │                  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
│       │             │             │                  │              │
│  ┌────▼─────────────▼─────────────▼──────────────────▼───────────┐  │
│  │                      Service Layer                             │  │
│  │  OCR (GLM-4V / Qwen-VL)  ·  WeCom API  ·  Profit Engine     │  │
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
| **SQLite / PostgreSQL** | 数据库 |
| **JWT + bcrypt** | 认证 + 密码安全 |
| **智谱 GLM-4V / 通义千问 VL** | 双模型 OCR |
| **WeCom Server API** | 企微消息 + 建群 + 通讯录 |
| **WebSocket Hub** | 实时广播 |

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
│   ├── middleware/          #   中间件 (JWT, CSRF, rate-limit, security)
│   ├── models/              #   数据模型 (Employee, Order, Timeline, Audit)
│   ├── services/            #   业务逻辑 (OCR, WeChat, OSS, WebSocket)
│   └── main.go              #   入口 & 路由注册
│
├── admin-web/               # React 管理看板
│   ├── src/pages/           #   页面 (Dashboard, Orders, Revenue, Team, Employees)
│   ├── src/components/      #   UI 组件库 (AppShell, ConfirmModal, Toast, ...)
│   ├── src/api/             #   API 客户端
│   ├── src/contexts/        #   全局状态 (Auth, Toast, WebSocket)
│   └── src/utils/           #   常量 + 格式化工具
│
├── desktop-client/          # Wails 桌面客服端
│   ├── app.go               #   Go 后端 (设备登录, OCR, 提交)
│   ├── crypto.go            #   设备指纹 + AES-256-GCM 会话加密
│   ├── main.go              #   Wails 窗口配置
│   └── frontend/src/        #   Vue 3 前端 (App.vue)
│
├── .github/workflows/       # GitHub Actions CI/CD
│   └── ci.yml               #   Backend Build + Frontend Build + Release
├── deploy/nginx.conf        # Nginx 反代配置
├── Dockerfile               # 多阶段构建
├── docker-compose.yml       # Docker 编排
└── build.sh                 # 一键构建脚本
```

---

## V2 Role System

V2 引入四角色体系，替代 V1 的三角色模型：

```
  ┌──────────────────────────────────────────────────────────────┐
  │                        管理员 (Admin)                         │
  │        全局权限 · 员工管理 · 营收分析 · 系统配置               │
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
| **管理员** | 全局数据 · 员工增删 · 设备管理 · 营收图表 | — |
| **谈单客服** | 订单创建 · 客户管理 · OCR 录单 | 谈单佣金 (可配置) |
| **跟单客服** | 订单跟进 · 客户管理 · 催单 | 跟单佣金 (可配置) |
| **设计师** | 抢单 · 设计交付 · 我的订单 | 设计师佣金 (可配置) |

---

## Order State Machine

```
                     ┌────────────────────────────────────────────┐
                     │                                            │
  ┌──────────┐   ┌───▼───────┐   ┌──────────┐   ┌──────────┐   ┌┴─────────┐
  │ PENDING  │──▶│  GROUP    │──▶│DESIGNING │──▶│DELIVERED │──▶│COMPLETED │
  │  待处理  │   │ CREATED   │   │  设计中  │   │  已交付  │   │  已完成  │
  └────┬─────┘   │  已建群   │   └────┬─────┘   └────┬─────┘   └──────────┘
       │         └─────┬─────┘        │              │
       ▼               ▼              ▼              ▼
  ┌──────────────────────────────────────────────────────┐
  │         REFUNDED (已退款) / CLOSED (已关闭)           │
  └──────────────────────────────────────────────────────┘
```

---

## Profit Engine (V2)

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
cd admin-web
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
docker compose up -d    # 一键部署
```

---

## Configuration

通过 `server/.env` 管理，参考 `.env.example`：

| 变量 | 说明 | 必填 |
|:---|:---|:---:|
| `SERVER_PORT` | 后端端口 (默认 8201) | Yes |
| `JWT_SECRET` | JWT HMAC-SHA256 签名密钥 | Yes |
| `ZHIPU_API_KEY` | 智谱 AI OCR 密钥 | Yes |
| `DASHSCOPE_API_KEY` | 通义千问 VL 备用密钥 | No |
| `WECOM_CORP_ID` | 企微企业 ID | Yes |
| `WECOM_AGENT_ID` | 企微应用 ID | Yes |
| `WECOM_SECRET` | 企微应用 Secret | Yes |
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
| **Device Binding** | 硬件 UUID + MAC + 主机名三重指纹，首次激活即永久绑定 |
| **One-Time Code** | 激活码使用后立即销毁 (bcrypt hash + prefix index) |
| **Session Encrypt** | AES-256-GCM 加密本地会话，密钥为设备指纹 |
| **Anti-Tamper OCR** | AI 识别结果锁定表单，前端 readonly + 服务端校验双重防篡改 |
| **Rate Limiting** | 登录失败计数 + IP 级别频率限制 |
| **CSRF Protection** | 双重 Cookie + Header Token 校验 |
| **Brute Force Guard** | 连续失败自动锁定，滑动窗口计数 |

---

## API Reference

<details>
<summary><b>Auth</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| POST | `/api/v1/auth/login` | 统一登录 (V2) |
| POST | `/api/v1/auth/device_login` | 设备激活码 / 指纹静默登录 |
| GET | `/api/v1/auth/validate_token` | 校验 JWT Token |

</details>

<details>
<summary><b>Orders</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| POST | `/api/v1/orders/upload_ocr` | 上传截图 AI 识别 |
| POST | `/api/v1/orders/create` | 创建新订单 |
| POST | `/api/v1/orders/grab` | 设计师抢单 |
| GET | `/api/v1/orders/list` | 订单列表 (筛选+分页) |
| GET | `/api/v1/orders/:id` | 订单详情 + 时间线 |
| PUT | `/api/v1/orders/:id/status` | 更新订单状态 |
| GET | `/api/v1/admin/orders/export` | CSV 导出 |

</details>

<details>
<summary><b>Admin</b></summary>

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
| GET | `/api/v1/admin/team_workload` | 团队工作量 |
| GET | `/api/v1/admin/activation_codes` | 激活码管理 |

</details>

<details>
<summary><b>WeChat Work</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| ANY | `/api/v1/wecom/callback` | 企微事件回调 |
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
| Docker | `8200` → container | 宿主机映射 |
| Nginx | `80/443` → `8200` | HTTPS 反代 |

---

## CI/CD

GitHub Actions 自动化流水线 (`.github/workflows/ci.yml`)：

- **Push to `main`** — Go build + test, Frontend build
- **Pull Request** — 同上，保障代码质量
- **Tag `v*`** — 自动构建 Linux AMD64 二进制 + 前端产物，创建 GitHub Release

---

## License

Private — All rights reserved.

<div align="center">
<br/>
<sub>Built with Go + React + Wails + WeCom API</sub>
<br/>
<sub>Designed with Brave-inspired UI by <a href="https://github.com/daxia778">@daxia778</a></sub>
</div>
