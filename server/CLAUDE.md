# Server 后端指南

Go 1.22+ / Gin / GORM / SQLite（可切 PostgreSQL）

## 目录结构
```
server/
├── main.go              # 入口 + 路由注册 + 后台调度器启动
├── seed.go              # 种子数据（空库自动填充）
├── config/config.go     # 环境变量配置（Config 结构体，全局 config.C）
├── models/              # GORM 数据模型
│   ├── models.go        # Employee + Order + 状态机
│   ├── db.go            # 数据库初始化 + AutoMigrate
│   ├── customer.go      # Customer 顾客模型
│   ├── payment.go       # Payment 收款流水
│   ├── notification.go  # Notification 通知
│   ├── timeline.go      # OrderTimeline 操作时间线
│   ├── audit.go         # AuditLog 审计日志
│   ├── version.go       # AppVersion 客户端版本
│   ├── token_blacklist.go # TokenBlacklist JWT 黑名单
│   └── wecom_data.go    # WecomMember/GroupChat/MessageLog 企微数据
├── handlers/            # HTTP 处理器
│   ├── response.go      # 统一响应: respondOK/respondList/respondError/badRequest/notFound...
│   ├── common.go        # 公共工具函数
│   ├── auth_handler.go  # Login/DeviceLogin/AdminLogin/Logout/RefreshToken/ValidateToken
│   ├── order_handler.go # CRUD/状态流转/OCR上传/抢单/批量操作/重新分配
│   ├── admin_handler.go # Dashboard/员工管理/团队工作负载/审计日志/激活码
│   ├── customer_handler.go  # 顾客 CRUD + 合并
│   ├── contact_handler.go   # 企微「联系我」
│   ├── payment_handler.go   # 收款流水 CRUD + 企微支付同步
│   ├── profit_handler.go    # 分润明细 + 报表
│   ├── export_handler.go    # CSV/Excel 导出
│   ├── export.go            # Excel 多 Sheet 导出逻辑
│   ├── notification.go      # 通知列表/标记已读
│   ├── version_handler.go   # 客户端 OTA 版本检查/发布
│   ├── wecom_handler.go     # 企微回调/通讯录/群聊/诊断
│   └── ws.go                # WebSocket 处理
├── middleware/          # 中间件
│   ├── auth.go          # JWT 鉴权 (JWTAuth)
│   ├── admin.go         # AdminOnly 角色校验
│   ├── csrf.go          # CSRF 防护
│   ├── security.go      # 安全头 + BruteForceGuard + SuspiciousRequestFilter
│   ├── ratelimit.go     # API/登录限速
│   ├── ip_whitelist.go  # 管理端 IP 白名单
│   ├── password.go      # 密码强度校验
│   └── wxbizmsgcrypt.go # 企微消息加解密（移植自官方 SDK）
├── services/            # 业务服务
│   ├── wecom.go         # 企微 API 客户端（access_token 缓存、消息推送、建群）
│   ├── wecom_sync.go    # 企微通讯录同步（每小时）
│   ├── wecom_payment.go # 企微对外收款同步
│   ├── ocr.go           # OCR 识别（智谱 GLM-4V / 通义千问 VL）
│   ├── order.go         # 订单业务（状态流转、分润触发、通知推送）
│   ├── profit.go        # 分润计算引擎
│   ├── customer.go      # 顾客服务（从订单回填迁移、合并）
│   ├── grab_monitor.go  # 恶意抢单检测
│   ├── stats.go         # 统计聚合
│   ├── export.go        # 导出文件生成
│   ├── oss.go           # 文件存储（本地/阿里云 OSS）
│   ├── websocket.go     # WebSocket Hub（广播/房间）
│   ├── backup.go        # SQLite 每日备份
│   ├── cleanup.go       # 上传文件 7 天清理
│   └── dbcompat.go      # 数据库兼容层
└── testutil/setup.go    # 测试辅助
```

## 核心数据模型

### Employee（员工）
- 角色: `sales`(谈单客服) / `designer`(设计师) / `follow`(跟单客服) / `admin`(管理员)
- 登录: Username + PasswordHash (bcrypt)，桌面端支持 MachineID 设备绑定
- 状态: `idle` / `busy`

### Order（订单）
- 金额单位: **分**（所有 Price/Commission 字段均为分）
- 状态机: `PENDING → GROUP_CREATED → CONFIRMED → DESIGNING → DELIVERED → COMPLETED`
- 分支: `DELIVERED → REVISION → DESIGNING`（修改循环）
- 售后: `DESIGNING/DELIVERED/REVISION → AFTER_SALE`
- 终态: `REFUNDED` / `CLOSED`
- 分润字段: PlatformFee / DesignerCommission / SalesCommission / FollowCommission / NetProfit

### Customer（顾客）
- 通过 CustomerContact 关联订单，支持合并

### Payment（收款流水）
- 支持手动录入 + 企微对外收款自动同步
- 可关联订单 (OrderID)

## API 路由概览

所有 API 前缀: `/api/v1`

| 路由组 | 中间件 | 说明 |
|--------|--------|------|
| `/auth/login` | BruteForceGuard + LoginRateLimit | 公开登录 |
| `/wecom/callback` | 无 | 企微回调（公开） |
| `/ws` | 无 | WebSocket（token via query） |
| `/auth/*` | JWTAuth | Token 校验/注销/刷新 |
| `/orders/*` | JWTAuth | 订单 CRUD + 状态 + OCR |
| `/payments/*` | JWTAuth | 收款流水 |
| `/admin/*` | JWTAuth + AdminOnly + IPWhitelist | 管理端所有功能 |

## 后台调度器（main.go 中启动）
- BackupScheduler: SQLite 每日备份
- OrderTimeoutWatcher: 超时自动派单
- DeadlineReminderWatcher: 交付截止提醒
- GrabMonitor: 恶意抢单检测
- UploadCleanupScheduler: 文件 7 天清理
- WecomSyncScheduler: 通讯录每小时同步
- WecomDataCleanupScheduler: 企微数据 90 天清理
- WecomPaymentSyncScheduler: 收款每 2 小时同步

## 响应格式
- 成功: `respondOK(c, data)` / `respondList(c, data, total)` / `respondMessage(c, "msg")`
- 错误: `badRequest(c, "msg")` / `notFound(c, "msg")` / `forbidden(c, "msg")` / `internalError(c, "msg")`
- 错误结构: `{"code": "BAD_REQUEST", "message": "..."}`

## 配置（环境变量）
- 全局: `config.C`（`config.Config` 结构体）
- 关键变量: `DB_TYPE` / `JWT_SECRET_KEY` / `WECOM_*` / `OCR_PROVIDER` / `ZHIPU_API_KEY` / `SERVER_PORT(8201)` / 分润费率 `*_RATE`
- 分润默认: 平台 30% + 设计师 25% + 客服 10% + 跟单 5% = 70%，净利润 30%

## 开发命令
```bash
cd server && go run .          # 启动后端 (端口 8201)
cd server && go test ./...     # 运行测试
```
