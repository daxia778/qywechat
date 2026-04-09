# PDD 派单管理系统

企微对接 + 客服录单 + OCR 防篡改 + 管理看板，面向 10-20 人兼职团队，日单量 60-100。

## 按需加载规则（必读）

本项目采用分层 CLAUDE.md 架构，**严禁跳过 CLAUDE.md 直接读源码**。工作流程：

1. **先读本文件**（根 CLAUDE.md）了解全局架构
2. **根据任务涉及的模块**，读取对应子目录的 CLAUDE.md：
   - 后端任务 → 先读 `server/CLAUDE.md`
   - 前端任务 → 先读 `web/CLAUDE.md`
   - 桌面客户端任务 → 先读 `desktop-client/CLAUDE.md`
   - 全栈任务 → 读取所有涉及模块的 CLAUDE.md
3. **只有在 CLAUDE.md 信息不足时**，才去读具体源码文件，且只读相关文件的相关部分（用 offset+limit）
4. **新增/重大改动后**，同步更新对应 CLAUDE.md

## 技术栈
- **后端**: Go 1.22+ / Gin / GORM / SQLite → `server/CLAUDE.md`
- **前端**: React 19 + Vite + TailwindCSS v4 → `web/CLAUDE.md`
- **桌面客服端**: Go + Wails v2 + Vue3 → `desktop-client/CLAUDE.md`
- **企业微信**: 自建应用 API（消息推送、建群、通讯录同步、回调）
- **OCR**: 智谱 GLM-4V / 通义千问 VL

## 项目结构
```
├── server/          # Go 后端
├── web/             # 统一前端 (管理端+员工端)
├── desktop-client/  # 桌面客服端 (单管家)
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
- **域名**: `https://zhiyuanshijue.ltd`
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
