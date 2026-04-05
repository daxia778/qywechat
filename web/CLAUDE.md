# Web 前端指南（统一端：管理后台 + 员工工作台）

React 19 + Vite 6 + TailwindCSS v4 + React Router v6

## 目录结构
```
web/src/
├── main.jsx                # 入口
├── App.jsx                 # 根组件: AuthProvider → ToastProvider → WebSocketProvider → AppRouter
├── index.css               # 全局样式 (TailwindCSS v4)
├── router/index.jsx        # 路由 (lazyWithRetry + ErrorBoundary + RequireAuth/AdminGuard/StaffGuard)
├── api/                    # API 请求层
│   ├── client.js           # axios 实例 (baseURL=/api/v1, JWT/CSRF 拦截器, 401 自动登出)
│   ├── auth.js             # login/adminLogin/validateToken/logoutApi
│   ├── orders.js           # 订单 CRUD + OCR + 批量 + 设计师 + addOrderNote + createOrderGroup
│   ├── admin.js            # 管理端 (员工/Dashboard/团队/导出/激活码/抢单告警/联系我)
│   ├── customers.js        # 顾客 CRUD + 合并
│   ├── payments.js         # 收款流水 + 企微同步 + getPaymentReport(对账报表)
│   ├── revenue.js          # 营收图表 + 分润明细
│   └── notifications.js    # 通知管理
├── pages/                  # 页面组件
│   ├── LoginPage.jsx       # 登录（按 role 跳转: admin → /dashboard, staff → /s/dashboard）
│   ├── DashboardPage.jsx   # 数据看板 (MetricCard + ECharts + WebSocket 实时更新)
│   ├── OrdersPage.jsx      # 订单列表 (筛选标签/搜索400ms防抖/分页/批量/导出)
│   ├── OrderDetailPage.jsx # 订单详情 + 时间线 + 金额修改
│   ├── CustomersPage.jsx   # 顾客管理 + 合并重复
│   ├── EmployeesPage.jsx   # 员工管理 (CRUD/启禁用/重置密码/设备解绑/批量)
│   ├── TeamPage.jsx        # 团队工作负载
│   ├── RevenuePage.jsx     # 营收图表 (ECharts) + 分润明细
│   ├── PaymentsPage.jsx    # 收款流水 (汇总/录入/关联订单/企微同步)
│   ├── DesignersRosterPage.jsx # 设计师花名册
│   ├── ActivationCodesPage.jsx # 激活码管理
│   ├── GrabAlertsPage.jsx  # 抢单超时告警
│   ├── ContactWaysPage.jsx # 企微「联系我」管理（创建/列表/QR码）
│   └── staff/              # 员工端页面
│       ├── StaffDashboard.jsx   # 员工个人工作台
│       ├── MyOrdersPage.jsx     # 我的订单
│       ├── StaffOrderDetail.jsx # 订单详情（员工视角）
│       └── StaffPaymentsPage.jsx # 跟单客服收款流水（查看/筛选/手动录入/关联订单）
├── components/             # 通用组件
│   ├── layout/AppShell.jsx # 管理员布局 (侧边栏+顶栏+通知铃铛+WS状态指示+登出)
│   ├── layout/StaffLayout.jsx # 员工端简化布局
│   ├── ui/Button.jsx       # 按钮 (variant: primary/secondary/ghost/danger, size, loading)
│   ├── ui/Badge.jsx        # 徽标 (variant: success/warning/danger/info)
│   ├── ui/Card.jsx         # 卡片容器
│   ├── ui/PageHeader.jsx   # 页面标题栏 + actions slot
│   ├── ui/RefreshButton.jsx # 旋转刷新按钮
│   ├── ui/StatCard.jsx     # 统计卡片（简洁版）
│   ├── ConfirmModal.jsx    # 确认弹窗 (info/danger/warning, 可选输入框+KV明细)
│   ├── EmptyState.jsx      # 空状态占位
│   ├── ExportDialog.jsx    # 导出对话框（日期范围选择）
│   ├── LoadingSpinner.jsx  # 加载动画
│   ├── MetricCard.jsx      # 指标卡片（含趋势）
│   ├── NotificationPanel.jsx # 右侧抽屉通知面板
│   ├── OrderMatchModal.jsx # 订单-收款匹配弹窗
│   ├── PaymentMatchModal.jsx # 收款关联订单弹窗
│   └── ToastContainer.jsx  # Toast 通知容器
├── contexts/
│   ├── AuthContext.jsx     # 认证: token/userName/userId/role/ready + login/logout/checkToken
│   ├── ToastContext.jsx    # Toast: toasts[] + toast(msg,type,title)/removeToast
│   └── WebSocketContext.jsx # WS: connected/authenticating/reconnecting/disconnected/offline
├── hooks/
│   ├── useAuth.js          # → AuthContext
│   ├── useToast.js         # → ToastContext
│   ├── useWebSocket.js     # → WebSocketContext + WS_STATE 常量
│   ├── useDebounce.js      # useDebounce(value, delay=300)
│   ├── usePolling.js       # usePolling(cb, interval, enabled) + Page Visibility API
│   ├── useConfirm.js       # 确认弹窗状态统一管理
│   ├── useOrderFilters.js  # 订单筛选/分页/WS订阅/轮询(WS连接120s/断开60s)
│   └── useOrderActions.js  # 订单操作: 状态变更/批量/转派/选择
└── utils/
    ├── cn.js               # cn() = twMerge(clsx())
    ├── constants.js         # STATUS_MAP/状态颜色
    ├── formatters.js        # 金额(分→元)/日期/状态格式化
    └── storage.js           # localStorage: getToken/setAuth/clearAuth/getRole...
```

## 路由表

### 管理员路由（AdminGuard → AppShell 布局）
| 路径 | 页面 | 权限 |
|------|------|------|
| `/login` | LoginPage | 公开 |
| `/dashboard` | DashboardPage | admin |
| `/orders` | OrdersPage | admin |
| `/orders/:id` | OrderDetailPage | admin |
| `/customers` | CustomersPage | admin |
| `/team` | TeamPage | admin |
| `/employees` | EmployeesPage | admin |
| `/revenue` | RevenuePage | admin |
| `/payments` | PaymentsPage | admin |
| `/designers` | DesignersRosterPage | admin |
| `/contact-ways` | ContactWaysPage | admin |

### 员工路由（StaffGuard → StaffLayout 布局）
| 路径 | 页面 | 权限 |
|------|------|------|
| `/s/dashboard` | StaffDashboard | staff |
| `/s/orders` | MyOrdersPage | staff |
| `/s/orders/:id` | StaffOrderDetail | staff |
| `/s/designers` | DesignersRosterPage | staff |
| `/s/payments` | StaffPaymentsPage | staff (roles: ['follow']) |

## 关键模式

### API 调用
- client.js: baseURL=/api/v1, timeout=15000
- 请求拦截: JWT 自动附加 Authorization, 写操作附加 X-CSRF-Token
- 响应拦截: 捕获 x-csrf-token 头缓存; 401 自动 clearAuth + 派发 auth:logout 事件
- 错误: error.displayMessage 从 response.data.message 提取

### 状态管理
- 无 Redux/Zustand，全部用 Context + useState/useEffect
- 三层嵌套: Auth → Toast → WebSocket
- 服务端数据由各页面本地 state 管理，无共享缓存层
- 实时: WS `order_updated` 事件触发刷新 + 轮询兜底

### WebSocket
- 连接: /api/v1/ws → 发送 auth → 收到 auth_ok → 30s 心跳 ping/pong
- 断线重连: 指数退避 2s→4s→8s…最大30s + 30% jitter，超5次进入 offline 静默
- 可手动 retry() 从 offline 恢复

### 设计规范
- TailwindCSS **v4**（注意语法与 v3 不同）
- 主色: `#434FCF`（靛蓝）
- 圆角: 组件 12px，卡片 16px
- 图标: lucide-react v0.460
- 图表: echarts v5.5
- 风格: 简约现代，参考 Brave 官网

### CSS 注意事项
- index.css 有全局 th/td 样式，**不要在全局 th 上设 text-align**
- 表格用 `table-layout: fixed` + `colgroup` 全百分比宽度（总和=100%）
- **禁止**像素和百分比混用，**禁止**让某列不设宽度

### 表单处理
- 无表单库，受控组件 + useState
- 搜索: useDebounce(keyword, 400) 防抖

## 开发命令
```bash
cd web && npm run dev    # 启动 (端口 8200, 代理 /api → 8201)
cd web && npm run build  # 构建
# 部署: scp -r dist/* root@118.31.56.141:/opt/pdd-server/dist/
```

## 前端开发经验与注意事项

### Modal 弹窗
- 父容器有 `overflow-hidden` 时，`position: fixed` 的 Modal 会被裁剪
- 解决方案：用 `createPortal(modal, document.body)` 渲染到 body
- 引入：`import { createPortal } from 'react-dom'`
- StaffLayout.jsx 的 main 区域有 overflow-hidden，所有页面内的 Modal 都需要 Portal

### 组件设计模式
- OrderSearchInput：自动加载最近 20 条订单 + 搜索筛选 + 可视化选择
  - 用户不会记住订单 ID，必须提供可视化列表
  - useDebounce(400ms) 防抖搜索
  - 选中状态显示绿色勾选 chip，可一键清除
- 导航按角色过滤：NAV_ITEMS 加 `roles` 字段，useMemo 按 user.role 过滤

### UI 设计规范
- 品牌色：#434FCF（hover: #3640b5）
- 卡片阴影：shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]
- 卡片边框：border-black/[0.06]（ghost border）
- 卡片圆角：rounded-2xl
- hover 上浮：hover:-translate-y-0.5 + 阴影加深
- 数字字体：font-['Outfit',sans-serif] tabular-nums tracking-tight
- 状态标签：圆角胶囊 rounded-full + 对应颜色 bg + 小圆点指示器
- 图标：统一用 lucide-react，不手写 SVG
- 动画：animate-scale-in（Modal 入场）、animate-fade-in-up（列表项）
- 加载态：skeleton pulse 或 RefreshCw animate-spin

### 金额展示
- 后端返回分，前端 formatCurrency(amount / 100) 转元
- ¥ 符号单独 span，字号略小
- 数字用 Outfit 字体 + tabular-nums 等宽对齐
