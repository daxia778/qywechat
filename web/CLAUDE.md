# Web 前端指南（统一端：管理后台 + 员工工作台）

React 19 + Vite + TailwindCSS v4 + React Router v6

## 目录结构
```
web/src/
├── main.jsx                # 入口
├── App.jsx                 # 根组件: AuthProvider → ToastProvider → WebSocketProvider → AppRouter
├── index.css               # 全局样式 (TailwindCSS v4)
├── router/index.jsx        # 路由配置 (lazy-load + ErrorBoundary + RequireAuth/RequireRole)
├── api/                    # API 请求层 (axios)
│   ├── client.js           # axios 实例 (baseURL=/api/v1, JWT 拦截器, CSRF 自动附加)
│   ├── auth.js             # 登录/登出/token校验
│   ├── orders.js           # 订单 CRUD
│   ├── admin.js            # 管理端 API (员工/Dashboard/团队/导出)
│   ├── customers.js        # 顾客 API
│   ├── payments.js         # 收款流水 API
│   ├── revenue.js          # 营收图表 API
│   └── notifications.js    # 通知 API
├── pages/                  # 页面组件
│   ├── LoginPage.jsx       # 登录页
│   ├── DashboardPage.jsx   # 数据看板 (MetricCard + 图表)
│   ├── OrdersPage.jsx      # 订单列表 (筛选/搜索/批量操作)
│   ├── OrderDetailPage.jsx # 订单详情 + 时间线
│   ├── EmployeesPage.jsx   # 员工管理 (CRUD/设备解绑)
│   ├── TeamPage.jsx        # 团队工作负载
│   ├── RevenuePage.jsx     # 营收图表
│   ├── CustomersPage.jsx   # 顾客管理
│   ├── PaymentsPage.jsx    # 收款流水
│   ├── ActivationCodesPage.jsx # 激活码管理
│   └── GrabAlertsPage.jsx  # 抢单监控告警
├── components/             # 通用组件
│   ├── layout/AppShell.jsx # 布局壳 (侧边栏 + 顶栏 + Outlet)
│   ├── ConfirmModal.jsx    # 确认弹窗
│   ├── EmptyState.jsx      # 空状态占位
│   ├── ExportDialog.jsx    # 导出对话框
│   ├── LoadingSpinner.jsx  # 加载动画
│   ├── MetricCard.jsx      # 指标卡片
│   ├── NotificationPanel.jsx # 通知面板
│   ├── OrderMatchModal.jsx # 订单匹配弹窗
│   └── ToastContainer.jsx  # Toast 通知容器
├── contexts/               # React Context
│   ├── AuthContext.jsx     # 认证状态 (token/role/isAuthenticated)
│   ├── ToastContext.jsx    # Toast 通知队列
│   └── WebSocketContext.jsx # WebSocket 连接管理
├── hooks/                  # 自定义 Hooks
│   ├── useAuth.js          # 认证 hook (从 AuthContext)
│   ├── useConfirm.js       # 确认弹窗 hook
│   ├── useDebounce.js      # 防抖
│   ├── useOrderActions.js  # 订单操作 (状态变更/抢单)
│   ├── useOrderFilters.js  # 订单筛选状态管理
│   ├── usePolling.js       # 轮询 hook
│   ├── useToast.js         # Toast hook (从 ToastContext)
│   └── useWebSocket.js     # WebSocket hook
└── utils/
    ├── cn.js               # className 合并工具
    ├── constants.js         # 常量 (状态映射/颜色)
    ├── formatters.js        # 格式化 (金额/日期/状态)
    └── storage.js           # localStorage 封装 (token/auth)

## 路由表

| 路径 | 页面 | 权限 |
|------|------|------|
| `/login` | LoginPage | 公开 (已登录跳转 `/`) |
| `/` | DashboardPage | 登录 |
| `/orders` | OrdersPage | 登录 |
| `/orders/:id` | OrderDetailPage | 登录 |
| `/customers` | CustomersPage | admin/sales/follow |
| `/team` | TeamPage | admin |
| `/employees` | EmployeesPage | admin |
| `/activation-codes` | ActivationCodesPage | admin |
| `/revenue` | RevenuePage | admin |
| `/payments` | PaymentsPage | admin |
| `/grab-alerts` | GrabAlertsPage | admin |

### 员工路由（`/s/` 前缀，StaffGuard 保护）

| 路径 | 页面 | 权限 |
|------|------|------|
| `/s/dashboard` | StaffDashboard | staff |
| `/s/orders` | MyOrdersPage | staff |
| `/s/orders/:id` | StaffOrderDetail | staff |

## 关键模式

### API 调用
- 所有请求通过 `api/client.js`，baseURL=/api/v1
- JWT token 自动从 localStorage 附加到 Authorization header
- CSRF token 从响应头自动捕获并附加到写操作
- 401 响应自动清除认证并触发 `auth:logout` 事件

### 状态管理
- 无 Redux，全部用 React Context + useState/useEffect
- AuthContext: 认证状态全局共享
- WebSocketContext: WS 连接全局共享，页面订阅消息
- ToastContext: 全局通知队列

### 设计规范
- TailwindCSS v4 (不是 v3，注意语法差异)
- 主色: `#434FCF` (靛蓝)
- 圆角: 组件 12px，卡片 16px
- 风格: 简约现代，参考 Brave 官网

## CSS 陷阱与注意事项

### 全局样式优先级
- `index.css` 中有全局 `th`/`td` 样式（padding、font-size 等），**不要在全局 th 上设 `text-align`**，否则会覆盖组件内 Tailwind 的 `text-center`/`text-left` class，导致表头和数据对齐不一致
- 全局 `th` padding: `12px 12px`，响应式在 `<1024px` 缩小为 `10px`，`<640px` 缩小为 `8px 6px`

### 表格布局规范
- 使用 `table-layout: fixed` + `colgroup` **全百分比宽度**（总和 = 100%）
- **禁止**像素和百分比混用：窄屏时像素列会挤掉百分比列，宽屏时百分比列膨胀失控
- **禁止**让某列不设宽度（`<col />`）：`table-layout: fixed` 下该列会吞掉所有剩余空间
- 内容溢出用 `overflow-hidden` + `truncate` 处理
- OrdersPage 当前列宽：复选框 4% / 订单信息 28% / 客户 13% / 金额 10% / 负责人 16% / 状态 9% / 操作 20%

### 部署
- 构建: `cd web && npm run build`
- 部署路径: `scp -r dist/* root@118.31.56.141:/opt/pdd-server/dist/`
- **注意**: 是 `/opt/pdd-server/dist/`，不是 `/opt/pdd-order-system/dist/`

## 开发命令
```bash
cd web && npm run dev    # 启动 (端口 8200, 代理 /api → 8201)
cd web && npm run build  # 构建
```
