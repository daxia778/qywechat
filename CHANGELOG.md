# Changelog

本项目的所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [v1.4.0] - 2026-04-06

企微私域自动化 — 客户自动录入 + 欢迎语发送 + 订单自动建群 + 删除联系人回调 + 欢迎语模板管理 + 跨平台兼容修复 + 代码质量提升

### Added
- 企微客户自动录入：新增联系人时自动同步至系统客户库
- 欢迎语自动发送：新客户添加后自动推送配置好的欢迎语
- 订单自动建群：订单创建后自动拉群，群内自动拉入管理员
- 删除联系人回调：企微侧删除联系人时系统同步处理
- 欢迎语模板管理：支持后台配置和管理多套欢迎语模板

### Changed
- UI 装修与文档更新，统一发布二进制产物

### Fixed
- 跨平台兼容性修复（Windows/macOS/Linux）
- 代码质量提升，整体稳定性增强

## [v1.3.0] - 2026-04-06

跟单客服收款模块 + 订单流程完善 + 收款对账报表 + 抢单告警管理 + 企微集成增强 + OCR 防篡改 + UI 装修

### Added
- 员工端全面重构：MyOrdersPage 表格化展示 + StaffDashboard 渐变卡片 + 设计师花名册
- 建群优化：订单建群自动拉入管理员
- TeamPage 客服绩效页重构，数据可视化增强
- 补全「修改中」「售后中」订单状态 + 佣金调整标注 + 操作按钮扩展
- Staff Dashboard 现代化改造为 SaaS minimal bento 风格

### Changed
- v2.0 架构改造 + 桌面端表单重构 + 图标修复
- UI 细节优化：图标统一迁移至 lucide-react，新增设计规范文档
- 各模块 CLAUDE.md 配置文件更新

### Fixed
- v1.3 深度审查修复：全端适配 v2.0 状态机 + 企微集成一致性 + 前端样式统一

## [v1.2.0] - 2026-03-30

Token 黑名单 + 刷新机制 + 转派功能 + 统一错误码 + CI 增强

### Added
- Token 黑名单机制与自动刷新，提升会话安全性
- 订单转派功能：支持管理员将订单重新分配给其他员工
- 统一错误码体系，前后端错误处理规范化
- 端到端测试（e2e）+ 多处 handler/中间件问题修复
- 新增收款流水管理页、抢单监控页、顾客合并功能
- 增强 Excel 导出功能：多维筛选 + 汇总指标 + 导出弹窗
- 订单时间线补全、利润权限控制、设备在线状态优化
- 订单详情改为居中浮窗弹窗（背景模糊 + 双栏布局）
- 响应式表格布局 + 非管理员仪表盘 + 顶栏优化
- GitHub Actions Windows 编译工作流

### Changed
- 8-Agent 深度审查与大厂规范代码巩固
- 版本号对齐：README 和 package 文件统一为 v1.2.0
- 审查前代码快照机制，用于回滚基准点

### Fixed
- 修复 5 项 P0 安全漏洞
- 修复桌面端 CSRF 拦截上传 + 静默登录刷新 MAC 地址
- 修复 OCR 截图清空按钮缺失问题（旧订单图片锁死无法开新单）
- 修正利润计算测试用例匹配当前默认费率
- CI 修复：gosec 扫描、Go 版本兼容、lint 错误、e2e 测试

### Security
- gosec 安全扫描报告问题修复
- 企微 SDK 已知安全警告排除处理

## [v1.1.0] - 2026-03-20

四角色体系 + 企微深度集成 + AI OCR 双模型 + WebSocket 看板 + 四方分润

### Added
- 四角色体系：管理员、客服、设计师、财务，统一登录 + 自动账号生成
- 四方分润引擎：从 3 方拆分升级为 4 方拆分（公司/客服/设计师/平台）
- 订单备注图片附件功能（全栈实现）
- WebSocket 实时看板：抢单告警 WS 联通 + 通知铃铛
- KPI 卡片重构为 4 指标布局 + 日环比对比
- 8 个 Agent 团队成员配置文件
- Brave 风格 UI 大改版 + chunk 错误恢复机制

### Changed
- 全面优化：Token 安全、订单转派、统一错误处理、CI 增强、测试覆盖率
- MetricCard 重构为 Stripe/Vercel 风格卡片
- README 全面升级至 V2（四角色体系 + 四方分润 + CI/CD）
- 侧边栏折叠按钮从顶栏移入侧边栏底部
- 仓库装修：README 重写、LICENSE、Topics

### Fixed
- 前后端数据互通修复 + 后端缺失路由补全
- CI 测试失败修复：状态机测试对齐 + handler 测试隔离
- excelize/v2 依赖缺失问题修复
- lint 清理 + `interface{}` 迁移为 `any`

### Security
- Token 安全机制增强

## [v0.5.0] - 2026-03-15

前端 V2 改造 + 四角色适配 + 性能优化

### Added
- Phase 1：统一登录 + 4 角色体系 + 自动账号生成
- Phase 2：前端适配统一登录 + 员工管理 V2
- Phase 3：分润体系升级为 4 方拆分

### Changed
- Suspense 移入 AppShell 内容区域，侧边栏加载期间保持可见
- inline loading skeleton 嵌入 index.html，消除全量刷新白屏

### Fixed
- 前后端数据互通修复 + 后端缺失路由补全

## [v0.3.0] - 2026-03-10

部署上线 + 企微诊断 API + 客户管理 + UI 大改版

### Added
- 部署上线（阿里云 ECS + systemd 服务）
- 企微诊断 API
- 客户管理模块
- 前端从 Vue 迁移至 React，整个前端重构
- 设备登录持久化、OCR 识别、图片缩放拖拽

### Changed
- UI 大改版，全新视觉风格

### Fixed
- 5 轮审查修复：安全加固、性能优化、UI 升级、bug 修复（41 项）

## [v0.1.0] - 2026-03-01

项目初始版本 — 基础框架搭建

### Added
- Go 后端服务基础框架
- Vue3 管理后台（Phase 1-3）
- 桌面端 OCR 客户端：智谱 Files OCR 集成 + 会话持久化
- JWT 管理员认证 + Vue 登录页
- SQLite 每日自动备份
- 设备解绑 API + CI 流水线
- Tailwind CSS v4 集成

### Fixed
- 激活码验证绕过漏洞修复（阻止 MAC 自动登录绕过）
- 桌面端 OCR 和会话持久化 UX 改进

### Security
- 强制激活码校验，修复认证绕过漏洞
- HTTP 安全头配置
- Vite chunks 分包优化

[v1.4.0]: https://github.com/daxia778/qywechat/compare/v1.3.0...v1.4.0
[v1.3.0]: https://github.com/daxia778/qywechat/compare/v1.2.0...v1.3.0
[v1.2.0]: https://github.com/daxia778/qywechat/compare/v1.1.0...v1.2.0
[v1.1.0]: https://github.com/daxia778/qywechat/compare/v0.5.0...v1.1.0
[v0.5.0]: https://github.com/daxia778/qywechat/compare/v0.3.0...v0.5.0
[v0.3.0]: https://github.com/daxia778/qywechat/compare/v0.1.0...v0.3.0
[v0.1.0]: https://github.com/daxia778/qywechat/releases/tag/v0.1.0
