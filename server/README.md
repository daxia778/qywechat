# PDD 派单与客勤管理系统

Go + Gin 后端服务，实现客服录单、OCR 防篡改、企微自动建群、管理看板的全流程自动化。

## 技术栈

- **后端**: Go 1.24 + Gin + GORM + SQLite (WAL)
- **认证**: JWT + 激活码 + MAC 地址绑定
- **企微**: 企业微信 API (消息/建群/卡片通知)
- **OCR**: 智谱 GLM-4V / 阿里通义千问 VL

## 快速开始

```bash
# 1. 复制环境配置
cp .env.example .env
# 编辑 .env 填入企微和 OCR 密钥

# 2. 安装依赖
go mod tidy

# 3. 构建 & 运行
go build -o pdd-server .
./pdd-server
# 后端 API 启动在 http://localhost:8201 (内部端口，不直接访问)
# 统一入口请访问 http://localhost:8200 (前端 dev server 或生产构建)
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/device_login` | 客服设备登录 |
| POST | `/api/v1/orders/upload_ocr` | 上传订单截图 OCR |
| POST | `/api/v1/orders/create` | 创建订单 |
| POST | `/api/v1/orders/grab` | 设计师抢单 |
| PUT  | `/api/v1/orders/:id/status` | 更新订单状态 |
| GET  | `/api/v1/orders/list` | 订单列表 |
| GET  | `/api/v1/orders/:id` | 订单详情 |
| GET  | `/api/v1/admin/dashboard` | 仪表盘数据 |
| GET  | `/api/v1/admin/revenue_chart` | 营收折线图 |
| GET  | `/api/v1/admin/employees` | 员工列表 |
| POST | `/api/v1/admin/employees` | 添加员工 |
| PUT  | `/api/v1/admin/employees/:id/toggle` | 启用/禁用员工 |
| GET  | `/api/v1/admin/team_workload` | 设计师负载矩阵 |

## 订单状态流转

```
PENDING → GROUP_CREATED → DESIGNING → DELIVERED → COMPLETED
(待接单)    (已建群)       (进行中)    (已交付)    (已完结)
```

## 项目结构

```
server/
├── main.go              # 入口
├── config/config.go     # 配置管理
├── models/
│   ├── models.go        # 数据模型 (Employee, Order)
│   └── db.go            # 数据库初始化 (SQLite WAL)
├── handlers/handlers.go # HTTP 处理器
├── middleware/auth.go   # JWT 认证中间件
├── services/
│   ├── wecom.go         # 企微 API 客户端
│   ├── ocr.go           # OCR 截图解析
│   └── order.go         # 订单业务逻辑
└── .env                 # 环境变量
```
