# PDD 派单管理系统 — 项目指南

## 项目概述
企微对接 + 客服录单 + OCR 防篡改 + 管理看板的全流程自动化系统。
面向 10-20 人的兼职客服+设计师团队，日单量 60-100 单，日营业额约 3000 元。

## 技术栈
- **后端**: Go 1.22+ / Gin / GORM / SQLite
- **前端管理端**: React 19 + Vite + TailwindCSS v4
- **桌面客服端**: Go + Wails v2 + Vue3
- **企业微信**: 自建应用 API（消息推送、建群、通讯录同步、回调）
- **OCR**: 智谱 GLM-4V / 通义千问 VL

## 项目结构
```
├── server/              # Go 后端 (Gin + GORM)
│   ├── config/          # 配置管理（环境变量加载）
│   ├── handlers/        # HTTP 处理器（API 路由处理）
│   ├── middleware/       # 中间件（JWT、CSRF、限速、安全头、企微加解密）
│   ├── models/          # 数据模型（GORM）
│   ├── services/        # 业务服务（企微、OCR、订单、WebSocket、备份）
│   └── main.go          # 入口 + 路由注册
├── admin-web/           # 管理端前端 (React 19 + Vite)
│   └── src/
│       ├── pages/       # 页面组件（React, .jsx）
│       ├── views/       # 旧 Vue 页面（待清理）
│       ├── components/  # 通用组件
│       └── contexts/    # React Context（Auth、WebSocket、Toast）
├── desktop-client/      # 桌面客服端 (Wails + Vue)
├── deploy/              # 部署配置 (Nginx)
├── docker-compose.yml   # Docker 编排
├── Dockerfile           # 多阶段构建
└── build.sh             # 一键构建脚本
```

## 端口规范
- **统一对外端口: 8200** — 开发/生产都用这个端口
- Go 后端内部端口: 8201（仅供 Vite 代理或 Docker 内部使用）

## 企业微信配置
- CorpID: `wwdb2f088115fa0fff`
- AgentID: `1000004`
- Secret: 已配置在 `server/.env`
- 回调地址: `https://{域名}/api/v1/wecom/callback`（需公网可达）
- Token / EncodingAESKey: 待企微后台配置回调时生成

## 已完成的功能模块

### 后端 (server/)
- [x] JWT 认证 + 设备绑定登录 + 暴力破解防护
- [x] 订单 CRUD + 状态流转引擎 (PENDING → GROUP_CREATED → DESIGNING → DELIVERED → COMPLETED)
- [x] OCR 识别（智谱 GLM-4V，截图提取订单号+金额）
- [x] 企微 access_token 管理（带缓存，过期前5分钟刷新）
- [x] 企微消息推送（文本/卡片）
- [x] 企微建群 + 需求播报
- [x] 企微回调验证 + 消息处理（"已交付"自动更新状态）
- [x] 企微通讯录同步（每小时）+ 90天数据清理
- [x] 企微消息加解密（wxbizmsgcrypt 完整移植）
- [x] 抢单分发 + 超时兜底（10分钟无人抢单自动指派）
- [x] 交付截止倒计时提醒（距交付3h自动催更）
- [x] 分润计算（平台扣点/设计师抽成/客服提成可配置）
- [x] SQLite 每日自动备份（保留7份）
- [x] 上传文件定时清理（7天过期）
- [x] WebSocket 实时推送
- [x] CSV 数据导出（订单/利润）
- [x] 安全中间件（CSRF、限速、安全头、请求体限制、可疑请求拦截）
- [x] 桌面客户端 OTA 版本更新

### 前端管理端 (admin-web/)
- [x] 登录页
- [x] Dashboard 数据看板
- [x] 订单列表 + 详情 + 时间线
- [x] 员工管理（增删改、设备解绑）
- [x] 团队工作负载
- [x] 营收图表
- [x] 通知面板
- [x] WebSocket 实时更新

### 桌面客服端 (desktop-client/)
- [x] 设备激活码验证 + MAC 绑定
- [x] 录单表单（主题、页数、交付时间、备注）
- [x] OCR 截图上传 + 金额锁定
- [x] 图片预览/缩放
- [x] 会话持久化

## 待完成 / 可优化
- [ ] 企微回调 Token/EncodingAESKey 配置（需公网域名+企微后台操作）
- [ ] 企微回调入站消息日志入库（incoming 方向）
- [ ] 管理端企微数据查看 API（WecomMember / GroupChat / MessageLog）
- [ ] 前端 Vue 遗留页面清理（views/ 目录下有旧 Vue 文件）
- [ ] 生产环境部署（服务器 + 域名 + HTTPS）
- [ ] 企微 OAuth/JSSDK 登录流（可选）

## 开发命令
```bash
# 后端
cd server && go run .

# 前端
cd admin-web && npm run dev

# 构建
./build.sh all

# Docker 部署
docker compose up -d
```

## 默认账号
- 管理员: `admin` / `admin888`

## 代码规范
- Go 代码遵循标准 Go 项目布局
- 前端使用 React + JSX（不是 TypeScript）
- TailwindCSS v4 用于样式
- API 路径统一 `/api/v1/` 前缀
- 敏感配置通过 `.env` 环境变量注入，禁止硬编码
