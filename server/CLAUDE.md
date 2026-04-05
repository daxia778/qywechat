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
│   ├── token_blacklist.go # TokenBlacklist JWT 黑名单（持久化到 DB，重启不丢）
│   ├── freelance_designer.go # FreelanceDesigner 自由设计师花名册
│   └── wecom_data.go    # WecomMember/GroupChat/WecomMessageLog 企微数据
├── handlers/            # HTTP 处理器
│   ├── response.go      # 统一响应: respondOK/respondList/respondError/badRequest/notFound/forbidden/internalError
│   ├── common.go        # 公共工具: filterByRole() 按角色过滤数据范围
│   ├── auth_handler.go  # Login/DeviceLogin/AdminLogin/Logout/RefreshToken/ValidateToken
│   ├── order_handler.go # CRUD/状态流转/OCR上传/附件上传/抢单/批量操作/重分配/统计
│   ├── admin_handler.go # Dashboard/员工管理/团队工作负载/花名册/审计日志/激活码/抢单告警/企微数据
│   ├── customer_handler.go  # 顾客 CRUD + 合并去重
│   ├── contact_handler.go   # 企微「联系我」方式创建/列表
│   ├── payment_handler.go   # 收款流水 CRUD + 汇总 + 企微支付同步
│   ├── profit_handler.go    # 分润明细 + 盈利报表
│   ├── export_handler.go    # 导出路由绑定
│   ├── export.go            # Excel 多 Sheet 导出逻辑
│   ├── notification.go      # 通知列表/标记已读（单条+全部）
│   ├── version_handler.go   # 客户端 OTA 版本检查/发布
│   ├── wecom_handler.go     # 企微回调解析/通讯录/群聊消息/诊断
│   ├── ws.go                # WebSocket 连接处理
│   └── designer_handler.go  # 自由设计师花名册 CRUD + 统计
├── middleware/          # 中间件
│   ├── auth.go          # JWTAuth(): JWT 鉴权 + 黑名单校验
│   ├── admin.go         # AdminOnly(): 角色校验
│   ├── csrf.go          # CSRFMiddleware(): X-CSRF-Token 防护
│   ├── security.go      # SecurityHeaders/BruteForceGuard/SuspiciousRequestFilter/MaxBodySize(10MB)
│   ├── ratelimit.go     # APIRateLimit(60/min/IP) / LoginRateLimit(5/min/IP)
│   ├── ip_whitelist.go  # AdminIPWhitelist(): 管理端 IP 白名单
│   ├── password.go      # 密码强度校验
│   └── wxbizmsgcrypt.go # 企微消息加解密（移植自官方 SDK）
├── services/            # 业务服务
│   ├── wecom.go         # 企微 API 客户端（access_token 内存缓存自动续期、消息推送、建群）
│   ├── wecom_sync.go    # 企微通讯录定时同步（每小时）+ 90天过期清理
│   ├── wecom_payment.go # 企微对外收款定时同步（每2小时）
│   ├── ocr.go           # OCR：智谱 GLM-4V（默认）/ 通义千问 VL
│   ├── order.go         # 订单业务（状态流转、分润触发、企微通知推送）
│   ├── profit.go        # 分润引擎: CalculateProfit/RecalculateAndSave/TriggerProfitRecalculation/ClearProfitFields
│   ├── customer.go      # 顾客服务（从历史订单回填迁移、合并去重）
│   ├── grab_monitor.go  # 恶意抢单检测监控
│   ├── stats.go         # 统计聚合（Dashboard 数据）
│   ├── export.go        # 导出文件生成（CSV/Excel）
│   ├── oss.go           # 文件存储（本地 uploads/ / 阿里云 OSS / S3）
│   ├── websocket.go     # WebSocket Hub（广播/房间管理）
│   ├── backup.go        # SQLite 每日定时备份
│   ├── cleanup.go       # 上传文件 7 天过期清理
│   └── dbcompat.go      # 数据库兼容层（SQLite/PostgreSQL 差异抹平）
└── testutil/setup.go    # 测试辅助
```

## 核心数据模型

### Employee（员工）
- 关键字段: ID, WecomUserID(唯一), Name, Role(sales/follow/admin), Username(唯一), PasswordHash(bcrypt), MachineID(设备指纹), MacAddress, Status(idle/busy), ActiveOrderCount, IsActive, LastLoginAt, LastLoginIP
- 登录: 密码登录 + 桌面端 MachineID 设备绑定

### Order（订单）
- 金额: **分**（Price/Commission 均为分）
- 关联: OperatorID(谈单客服), FreelanceDesignerID(花名册外键), FollowOperatorID(跟单客服), CustomerID
- 分润字段: PlatformFee, DesignerCommission, SalesCommission, FollowCommission, NetProfit
- 附件: ScreenshotPath, AttachmentURLs(JSON)
- 状态机:
```
PENDING → DESIGNING → COMPLETED → REFUNDED
                   ↘ REVISION → DESIGNING（循环）
                   ↘ AFTER_SALE → COMPLETED / REFUNDED
```
- 状态权限: DESIGNING/COMPLETED/REFUNDED/REVISION/AFTER_SALE 需 admin 或 follow 角色

### 其他模型
- **Customer**: 通过 CustomerContact 关联订单，支持合并去重
- **Payment**: 手动录入 + 企微收款自动同步，可关联 OrderID
- **FreelanceDesigner**: 自由设计师花名册
- **WecomMember/GroupChat/WecomMessageLog**: 企微通讯录、客户群、消息日志
- **AppVersion**: 客户端 OTA 版本
- **TokenBlacklist**: JWT 黑名单（持久化，重启恢复）
- **OrderTimeline**: 操作时间线（状态变更/金额修改审计链）
- **AuditLog**: 系统级审计日志

## API 路由全表

所有路由前缀: `/api/v1`

### 公开路由
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/auth/login` | 密码登录（BruteForceGuard + LoginRateLimit）|
| POST | `/auth/device_login` | 设备登录（激活码 + 指纹）|
| POST | `/auth/admin_login` | 管理员登录 |
| ANY | `/wecom/callback` | 企微回调 |
| GET | `/ws` | WebSocket（token via query）|
| GET | `/app/version` | 客户端版本检查 |

### 认证路由（JWT）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/auth/validate_token` | Token 校验 |
| POST | `/auth/logout` | 登出 |
| POST | `/auth/refresh` | 刷新 Token |

### 订单路由（JWT）
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/orders/upload_ocr` | OCR 截图上传 |
| POST | `/orders/upload_attachment` | 附件上传 |
| GET | `/orders/list` | 订单列表（按角色自动过滤）|
| GET | `/orders/:id` | 订单详情 |
| POST | `/orders/create` | 创建订单 |
| GET | `/orders/follow-staff` | 跟单客服列表 |
| GET | `/orders/designers` | 搜索设计师 |
| GET | `/orders/designers/list` | 设计师列表+统计 |
| POST | `/orders/designers` | 创建设计师 |
| PUT | `/orders/:id/assign-designer` | 分配设计师 |
| PUT | `/orders/:id/adjust-commission` | 调整佣金 |
| PUT | `/orders/batch-status` | 批量更新状态 |
| PUT | `/orders/:id/status` | 更新状态 |
| PUT | `/orders/:id/amount` | 修改金额（触发分润重算）|
| GET | `/orders/:id/detail` | 详情 |
| GET | `/orders/:id/timeline` | 时间线 |
| GET | `/orders/:id/profit` | 分润详情 |
| GET | `/orders/pending-match` | 待匹配订单 |
| POST | `/orders/:id/match` | 匹配订单联系人 |
| PUT | `/orders/:id/reassign` | 转派订单 |
| GET | `/orders/my-stats` | 个人统计 |

### 收款路由（JWT）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/payments` | 列表 |
| POST | `/payments` | 创建 |
| PUT | `/payments/:id/match` | 关联订单 |
| GET | `/payments/summary` | 汇总 |
| POST | `/payments/sync-wecom` | 企微同步 |

### 管理端路由（JWT + AdminOnly + IPWhitelist）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin/dashboard` | 看板数据 |
| GET | `/admin/revenue_chart` | 营收图表 |
| GET/POST | `/admin/employees` | 员工列表/创建 |
| PUT | `/admin/employees/:id/toggle` | 启用/禁用 |
| PUT | `/admin/employees/:id/reset_password` | 重置密码 |
| PUT | `/admin/employees/:id/unbind` | 解绑设备 |
| DELETE | `/admin/employees/:id` | 删除员工 |
| PUT | `/admin/employees/batch_toggle` | 批量启用禁用 |
| POST | `/admin/employees/batch_delete` | 批量删除 |
| GET | `/admin/team_workload` | 团队负载 |
| GET | `/admin/team_roster` | 团队花名册 |
| GET | `/admin/profit_breakdown` | 分润明细 |
| GET | `/admin/audit_logs` | 审计日志 |
| GET | `/admin/activation_codes` | 激活码列表 |
| PUT | `/admin/activation_codes/:id/pause` | 暂停激活码 |
| PUT | `/admin/activation_codes/:id/regenerate` | 重新生成 |
| GET | `/admin/grab_alerts` | 抢单告警 |
| GET/PUT | `/admin/customers/:id` | 顾客详情/更新 |
| GET | `/admin/customers` | 顾客列表 |
| POST | `/admin/customers/merge` | 合并顾客 |
| POST | `/admin/contact_way` | 创建联系我 |
| GET | `/admin/contact_ways` | 联系我列表 |
| GET | `/admin/wecom/members` | 企微成员 |
| GET | `/admin/wecom/groups` | 企微群 |
| GET | `/admin/wecom/groups/:chat_id/messages` | 群消息 |
| GET | `/admin/wecom/diagnostic` | 企微诊断 |
| POST | `/admin/wecom/sync` | 手动触发同步 |
| GET/PUT | `/admin/notifications` | 通知管理 |
| GET | `/admin/orders/export` | 导出订单CSV |
| GET | `/admin/profit/export` | 导出分润CSV |
| GET | `/admin/export/excel` | 导出Excel |
| GET | `/admin/metrics` | 运行指标 |

## 后台调度器
| 调度器 | 周期 | 功能 |
|--------|------|------|
| BackupScheduler | 每日 | SQLite 备份 |
| DeadlineReminderWatcher | 持续 | 交付截止倒计时提醒 |
| UploadCleanupScheduler | 定期 | 7天过期文件清理 |
| WecomSyncScheduler | 每小时 | 企微通讯录同步 |
| WecomDataCleanupScheduler | 定期 | 企微数据90天清理 |
| WecomPaymentSyncScheduler | 每2小时 | 企微收款同步 |
| StartFailMapCleaner | 后台 | 暴力破解记录清理 |
| StartCSRFCleanup | 后台 | CSRF token 清理 |
| StartTokenCleanup | 后台 | JWT 黑名单清理 |

所有调度器通过 `context.WithCancel` 统一管理，优雅关闭时一并取消。

## 分润引擎（services/profit.go）
- 默认费率: 平台 30% + 设计师 25% + 谈单客服 10% + 跟单客服 5% = 70%，净利润 30%
- 触发时机: 订单创建 / 金额修改 / 状态变更为 COMPLETED / 退款清零
- `TriggerProfitRecalculation()` 异步触发不阻塞接口

## 配置（环境变量 → config.C）
关键变量: `DB_TYPE(sqlite)` / `JWT_SECRET_KEY` / `WECOM_*` / `OCR_PROVIDER(zhipu)` / `ZHIPU_API_KEY` / `DASHSCOPE_API_KEY` / `SERVER_PORT(8201)` / `DEPLOY_MODE(debug)` / `OSS_PROVIDER(local)` / `ADMIN_ALLOWED_IPS` / 各分润费率 `*_RATE`

## 响应格式
- 成功: `respondOK(c, data)` / `respondList(c, data, total)` / `respondMessage(c, "msg")`
- 错误: `badRequest/notFound/forbidden/internalError(c, "msg")` → `{"code": "BAD_REQUEST", "message": "..."}`

## 开发命令
```bash
cd server && go run .          # 启动后端 (端口 8201)
cd server && go test ./...     # 运行测试
```
