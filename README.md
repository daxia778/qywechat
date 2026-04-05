<div align="center">

# PDD 派单管理系统

**企业微信深度集成的全链路派单管理平台**

<br/>

[![Go](https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Wails](https://img.shields.io/badge/Wails-v2-DF0000?style=flat-square)](https://wails.io)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/daxia778/qywechat?style=flat-square&color=green)](https://github.com/daxia778/qywechat/releases)

<br/>

从客户添加到设计交付，全流程企微内闭环。

```
客户扫码 --> 自动录入+欢迎语 --> 截图OCR识别 --> 订单建群 --> 设计师交付 --> 四方分润
```

</div>

---

## 功能特性

**角色与权限**
- 四角色体系：管理员 / 谈单客服 / 跟单客服 / 设计师花名册
- 细粒度权限控制，统一登录入口，自动生成账号密码
- 设备指纹绑定（硬件 UUID + MAC + 主机名），AES-256-GCM 会话加密

**订单全生命周期**
- 完整状态机：PENDING -> DESIGNING -> DELIVERED -> COMPLETED -> REFUNDED
- 支持售后改稿、订单转派、批量状态更新
- 订单时间线追踪，每次操作自动记录

**企微私域自动化（v1.4.0）**
- 客户扫码自动录入系统 + 欢迎语发送
- 订单进入设计阶段自动创建企微群
- 删除联系人回调处理 + 欢迎语模板管理
- 通讯录定时同步、消息通知、事件回调

**AI OCR 识别**
- 智谱 GLM-4V-Plus 优先，通义千问 VL 自动回退，双模型零停机
- 截图粘贴即解析，订单号 + 金额 + 时间三字段锁定
- SHA256 哈希防篡改（上传校验 + 服务端二次校验）

**四方分润引擎**
- 平台手续费 + 设计师佣金 + 谈单客服佣金 + 跟单客服佣金
- 费率可配置，自动计算净利润，Excel/CSV 一键导出
- 集成实际收款数据，支持收款对账报表

**实时看板**
- WebSocket 驱动，订单状态变更秒级推送
- 营收趋势、利润构成、团队负载可视化（ECharts）
- 抢单异常告警 + 设计超时 48h 预警

**跨平台桌面客户端**
- Wails v2 + Vue 3 构建，支持 macOS / Windows
- 激活码登录 + 设备指纹绑定
- 截图粘贴 OCR + 一键提交订单

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                             │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────┐   │
│  │ Desktop App │  │  Admin Web  │  │  WeChat Work      │   │
│  │ Wails + Vue │  │React + Vite │  │  Callback + Bot   │   │
│  └──────┬──────┘  └──────┬──────┘  └────────┬──────────┘   │
└─────────┼────────────────┼──────────────────┼───────────────┘
          │                │                  │
          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   Go Backend (Gin) :8201                     │
│                                                             │
│  Auth (JWT)  ·  Orders (CRUD + FSM)  ·  Admin Dashboard     │
│  WebSocket Hub  ·  Profit Engine  ·  Payment Records        │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   Service Layer                        │  │
│  │  OCR (GLM-4V / Qwen-VL)  ·  WeCom API (私域自动化)    │  │
│  │  Token Blacklist  ·  Grab Monitor  ·  Contact Way      │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼────────────────────────────────┐  │
│  │              SQLite / PostgreSQL (GORM)                 │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| 层级 | 技术选型 |
|:---|:---|
| **后端** | Go 1.24, Gin, GORM, SQLite/PostgreSQL, JWT + bcrypt |
| **前端** | React 19, Vite 6, TailwindCSS v4, ECharts |
| **桌面端** | Wails v2, Vue 3 |
| **AI OCR** | 智谱 GLM-4V-Plus, 通义千问 VL |
| **企微** | WeCom Server API (消息/建群/通讯录/回调/联系我) |
| **CI/CD** | GitHub Actions (lint + security scan + test + build + release) |

---

## 快速开始

### 环境要求

- Go 1.24+
- Node.js 18+
- (可选) Docker & Docker Compose

### 后端

```bash
cd server
cp .env.example .env    # 编辑: JWT_SECRET, WECOM_*, ZHIPU_API_KEY 等
go run .                # 启动在 :8201
```

### 前端

```bash
cd web
npm install
npm run dev             # 启动在 :8200，自动代理 API -> :8201
```

### 桌面客户端

```bash
cd desktop-client
wails dev               # 开发模式
wails build             # 构建 .app / .exe
```

---

## 部署

### Docker 部署

```bash
# 完整版 (PostgreSQL + Nginx)
docker compose up -d

# 轻量版 (SQLite 单容器)
docker compose -f docker-compose.lite.yml up -d
```

### 手动部署

```bash
# 前端构建
cd web && npm run build

# 后端交叉编译
cd server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o pdd-server .

# 上传到服务器
scp -r web/dist/* root@YOUR_SERVER:/opt/pdd-server/dist/
scp server/pdd-server root@YOUR_SERVER:/opt/pdd-server/

# 使用 systemd 管理进程
systemctl restart pdd-server
```

### 配置项

通过 `server/.env` 管理，参考 `.env.example`：

| 变量 | 说明 | 必填 |
|:---|:---|:---:|
| `JWT_SECRET_KEY` | JWT 签名密钥 | Yes |
| `ZHIPU_API_KEY` | 智谱 AI OCR 密钥 | Yes |
| `DASHSCOPE_API_KEY` | 通义千问 VL 备用密钥 | No |
| `WECOM_CORP_ID` | 企微企业 ID | Yes |
| `WECOM_AGENT_ID` | 企微应用 ID | Yes |
| `WECOM_CORP_SECRET` | 企微应用 Secret | Yes |
| `PLATFORM_FEE_RATE` | 平台手续费率 (%) | No |
| `DESIGNER_COMMISSION_RATE` | 设计师佣金率 (%) | No |
| `SALES_COMMISSION_RATE` | 谈单客服佣金率 (%) | No |
| `FOLLOW_COMMISSION_RATE` | 跟单客服佣金率 (%) | No |

---

## 项目结构

```
qywechat/
├── server/                  # Go 后端
│   ├── config/              #   配置加载
│   ├── handlers/            #   路由处理 (auth, order, admin, wecom, ws)
│   ├── middleware/          #   中间件 (JWT, CSRF, rate-limit)
│   ├── models/              #   数据模型
│   ├── services/            #   业务逻辑 (OCR, WeChat, Profit, WebSocket)
│   └── main.go              #   入口
│
├── web/                     # React 管理看板
│   └── src/
│       ├── pages/           #   页面组件
│       ├── components/      #   UI 组件库
│       ├── api/             #   API 客户端
│       └── contexts/        #   全局状态 (Auth, Toast, WebSocket)
│
├── desktop-client/          # Wails 桌面客户端
│   ├── app.go               #   Go 后端 (设备登录, OCR)
│   ├── crypto.go            #   设备指纹 + 会话加密
│   └── frontend/src/        #   Vue 3 前端
│
├── deploy/                  # Nginx + 安全头配置
├── .github/workflows/       # CI/CD
├── Dockerfile               # 多阶段构建
├── docker-compose.yml       # 完整编排
└── docker-compose.lite.yml  # 轻量编排 (SQLite)
```

---

## 版本历史

### v1.4.0 (2026-04-06)

**企微私域自动化**
- 客户扫码自动录入系统 + 欢迎语自动发送
- 订单进入设计阶段自动创建企微协作群
- 删除联系人回调处理，客户流失自动标记
- 欢迎语模板管理（后台可配置）

### v1.3.0 (2026-04-06)

**跟单客服模块 + 收款对账**
- 跟单客服收款流水模块，支持查看/筛选/手动录入/关联订单
- 收款对账报表（按日/周/月聚合 + ECharts 趋势图）
- 抢单告警管理重构：统计卡片 + 筛选 + 批量处理
- 企微联系我管理页面（创建/列表/QR码展示）
- OCR SHA256 哈希防篡改
- 分润引擎集成实际收款数据

### v1.2.0

**安全与稳定性**
- Token 黑名单 + 刷新机制，密码重置即时注销所有会话
- 管理员订单转派功能
- 统一错误码响应格式
- CI 增强：golangci-lint + gosec + ESLint + coverage
- 设计超时 48h 告警（企微 + 站内 + WebSocket 三通道）

### v1.1.0

**核心功能上线**
- 四角色体系（管理员/谈单客服/跟单客服/设计师）
- 企微深度集成（建群/消息/通讯录/收款）
- AI 双模型 OCR 容灾
- 实时 WebSocket 看板
- 四方分润引擎

---

## License

MIT License -- see [LICENSE](LICENSE) for details.

<div align="center">
<br/>
<sub>Built with Go + React + Wails + WeCom API</sub>
<br/>
<sub>Designed by <a href="https://github.com/daxia778">@daxia778</a></sub>
</div>
