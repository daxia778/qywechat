<div align="center">

# PDD 派单管理系统

**Enterprise WeChat + AI-Powered Order Dispatch Platform**

[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Gin](https://img.shields.io/badge/Gin-Framework-0090D1?style=flat-square)](https://gin-gonic.com)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Wails](https://img.shields.io/badge/Wails-v2-DF0000?style=flat-square)](https://wails.io)
[![License](https://img.shields.io/badge/License-Private-red?style=flat-square)]()

<br/>

*全链路自动化派单 — 从客服截图到设计师交付，一键搞定*

<br/>

```
  截图粘贴 ──→ AI 智能识别 ──→ 订单锁定 ──→ 企微派单 ──→ 设计师抢单 ──→ 建群协作
```

</div>

---

## Overview

PDD 派单管理系统是一套面向 PPT 定制服务的**全流程自动化工单平台**，集成企业微信(WeCom)消息通知、AI 图像识别(OCR)防篡改校验、实时 WebSocket 看板于一体。

### Core Capabilities

| Capability | Description |
|:---|:---|
| **AI OCR 防篡改** | 截图粘贴即解析，订单号 + 金额 + 时间三字段锁定，杜绝人工篡改 |
| **一次性激活码** | 设备首次激活后永久绑定硬件指纹，激活码即刻销毁，防窃取代签 |
| **企微深度集成** | 自动建群、消息通知、状态流转同步，全程企微内闭环 |
| **实时管理看板** | WebSocket 驱动，订单状态变更秒级推送，营收数据可视化 |
| **双模型容灾** | 智谱 GLM-4V-Plus 优先，通义千问 VL 自动回退，OCR 零停机 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients                                  │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │  Desktop App │    │  Admin Web   │    │  WeChat Work │     │
│   │  (Wails+Vue) │    │ (React+Vite) │    │  (Callback)  │     │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘     │
│          │                   │                   │              │
└──────────┼───────────────────┼───────────────────┼──────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Go Backend (Gin)                             │
│                                                                 │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
│   │  Auth   │  │ Orders  │  │  Admin  │  │   WebSocket     │  │
│   │  JWT +  │  │ CRUD +  │  │ Dashboard│  │   Real-time     │  │
│   │ Device  │  │ State   │  │ Revenue │  │   Broadcast     │  │
│   │ Binding │  │ Machine │  │ Export  │  │                 │  │
│   └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘  │
│        │            │            │                 │            │
│   ┌────▼────────────▼────────────▼─────────────────▼────────┐  │
│   │                    Service Layer                         │  │
│   │  OCR (GLM-4V / Qwen-VL)  │  WeChat Work API  │  OSS   │  │
│   └─────────────────────────┬────────────────────────────────┘  │
│                             │                                   │
│   ┌─────────────────────────▼────────────────────────────────┐  │
│   │              SQLite / PostgreSQL (GORM)                   │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

<table>
<tr>
<td width="50%">

### Backend
- **Language** — Go 1.24
- **Framework** — Gin + GORM
- **Database** — SQLite (dev) / PostgreSQL (prod)
- **Auth** — JWT + bcrypt + Device Fingerprint
- **OCR** — Zhipu GLM-4V-Plus / DashScope Qwen-VL
- **Messaging** — WeCom (企业微信) Server API
- **Real-time** — WebSocket Hub
- **Storage** — Local / Aliyun OSS (S3-compatible)

</td>
<td width="50%">

### Frontend
- **Admin Web** — React 19 + Vite + TailwindCSS v4
- **Desktop Client** — Wails v2 + Vue 3 (macOS/Win)
- **State** — React Context + Custom Hooks
- **Charts** — Revenue & Workload Visualization
- **Security** — CSRF Protection + Rate Limiting

</td>
</tr>
</table>

---

## Project Structure

```
qywechat/
├── server/                  # Go 后端服务
│   ├── config/              #   配置加载 (.env)
│   ├── handlers/            #   路由处理 (auth, order, admin, wecom, ws)
│   ├── middleware/          #   中间件 (JWT, CSRF, rate-limit, security)
│   ├── models/              #   数据模型 (Employee, Order, Timeline, Audit)
│   ├── services/            #   业务逻辑 (OCR, WeChat, OSS, WebSocket)
│   └── main.go             #   入口 & 路由注册
│
├── admin-web/               # React 管理看板
│   ├── src/pages/           #   页面 (Dashboard, Orders, Revenue, Team)
│   ├── src/components/      #   UI 组件库
│   ├── src/api/             #   API 客户端
│   └── src/contexts/        #   全局状态 (Auth, Toast, WebSocket)
│
├── desktop-client/          # Wails 桌面客服端
│   ├── app.go               #   Go 后端 (设备登录, OCR, 提交)
│   ├── crypto.go            #   设备指纹 + AES-256-GCM 会话加密
│   ├── main.go              #   Wails 窗口配置
│   └── frontend/src/        #   Vue 3 前端 (App.vue)
│
├── deploy/                  # 部署配置
│   └── nginx.conf           #   Nginx 反代配置
├── Dockerfile               # 多阶段构建
├── docker-compose.yml       # Docker 编排
└── build.sh                 # 一键构建脚本
```

---

## Order State Machine

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
  ┌─────────┐   ┌──▼────────┐   ┌──────────┐   ┌──────────┐   ┌─┴────────┐
  │ PENDING │──▶│  GROUP    │──▶│DESIGNING │──▶│DELIVERED │──▶│COMPLETED │
  │         │   │ CREATED   │   │          │   │          │   │          │
  └────┬────┘   └─────┬─────┘   └─────┬────┘   └─────┬────┘   └──────────┘
       │              │               │               │
       │              │               │               │
       ▼              ▼               ▼               ▼
  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
  │REFUNDED │   │ REFUNDED │   │ REFUNDED │   │ REFUNDED │
  │ CLOSED  │   │  CLOSED  │   │  CLOSED  │   │  CLOSED  │
  └─────────┘   └──────────┘   └──────────┘   └──────────┘
```

---

## Quick Start

### Prerequisites

- Go 1.24+
- Node.js 18+
- (Optional) Docker & Docker Compose

### 1. Backend

```bash
cd server
cp .env.example .env    # 编辑配置: 数据库、API 密钥、企微信息等
go run .                # 启动在 :8200
```

### 2. Admin Web

```bash
cd admin-web
npm install
npm run dev             # 启动在 :8200 (代理 API 到后端)
```

### 3. Desktop Client

```bash
cd desktop-client
wails dev               # 开发模式
wails build             # 构建 .app / .exe
```

### 4. Docker (Production)

```bash
docker compose up -d    # 一键启动所有服务
```

---

## Configuration

所有配置通过 `server/.env` 管理，参考 `.env.example`：

| 变量 | 说明 | 必填 |
|:---|:---|:---:|
| `SERVER_PORT` | 服务端口 | Yes |
| `JWT_SECRET` | JWT 签名密钥 | Yes |
| `ZHIPU_API_KEY` | 智谱 AI OCR 密钥 | Yes |
| `DASHSCOPE_API_KEY` | 通义千问 VL 备用密钥 | No |
| `WECOM_CORP_ID` | 企微企业 ID | Yes |
| `WECOM_AGENT_ID` | 企微应用 ID | Yes |
| `WECOM_SECRET` | 企微应用 Secret | Yes |
| `ADMIN_DEFAULT_PASSWORD` | 管理员初始密码 | Yes |
| `OSS_PROVIDER` | 存储后端 (`local` / `aliyun`) | No |

---

## Security

| Feature | Implementation |
|:---|:---|
| **Device Binding** | 硬件 UUID + MAC + 主机名三重指纹，首次激活即永久绑定 |
| **One-Time Code** | 激活码使用后立即销毁 (bcrypt hash + prefix index) |
| **Session Encrypt** | AES-256-GCM 加密本地会话，密钥为设备指纹 |
| **Anti-Tamper OCR** | AI 识别结果锁定表单，前端 readonly + 服务端校验双重防篡改 |
| **Rate Limiting** | 登录失败计数 + IP 级别频率限制 |
| **CSRF Protection** | 双重 Cookie + Header Token 校验 |
| **Brute Force Guard** | 连续失败自动锁定，滑动窗口计数 |

---

## API Endpoints

<details>
<summary><b>Auth</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| POST | `/api/v1/auth/device_login` | 设备激活码登录 / 指纹静默登录 |
| POST | `/api/v1/auth/admin_login` | 管理后台用户名密码登录 |
| GET | `/api/v1/auth/validate_token` | 校验 JWT Token 有效性 |

</details>

<details>
<summary><b>Orders</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| POST | `/api/v1/orders/upload_ocr` | 上传截图 AI 识别订单信息 |
| POST | `/api/v1/orders/create` | 创建新订单 |
| POST | `/api/v1/orders/grab` | 设计师抢单 |
| GET | `/api/v1/orders/list` | 订单列表 (多条件筛选) |
| GET | `/api/v1/orders/:id` | 订单详情 |
| PUT | `/api/v1/orders/:id/status` | 更新订单状态 |

</details>

<details>
<summary><b>Admin</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| GET | `/api/v1/admin/dashboard` | 看板统计数据 |
| GET | `/api/v1/admin/revenue_chart` | 营收趋势图表 |
| GET | `/api/v1/admin/employees` | 员工列表管理 |
| GET | `/api/v1/admin/team_workload` | 团队工作量统计 |
| GET | `/api/v1/admin/audit_logs` | 审计日志 |

</details>

<details>
<summary><b>WeChat Work</b></summary>

| Method | Path | Description |
|:---|:---|:---|
| ANY | `/api/v1/wecom/callback` | 企微事件回调 (消息/审批) |
| GET | `/api/v1/ws` | WebSocket 实时推送 |

</details>

---

## Port Convention

**Unified external port: `8200`**

| Component | Port | Role |
|:---|:---:|:---|
| Vite Dev Server | `8200` | 开发入口，反代 API 到后端 |
| Go Backend | `8200` | HTTP API + WebSocket + 静态资源 |
| Docker (prod) | `8200` → container | 宿主机端口映射 |
| Nginx (prod) | `80/443` → `8200` | HTTPS 反代 |

---

## License

Private — All rights reserved.

<div align="center">
<br/>
<sub>Built with Go + React + Vue + Wails + WeCom API</sub>
</div>
