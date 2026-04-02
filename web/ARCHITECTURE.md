# PDD Admin Web -- React 19 Frontend Architecture

> System architecture document for the React rewrite of the PDD Dispatch Management System (派单中控平台).
> Replaces the Vue 3 SPA at `admin-web-vue-backup/`.

---

## 1. Directory Structure

```
admin-web/src/
├── main.jsx                    # Entry point: render App, nothing else
├── App.jsx                     # Root component: providers + router
├── index.css                   # Global styles (Tailwind + design tokens)
│
├── api/                        # API client layer
│   ├── client.js               # Axios instance, interceptors, CSRF
│   ├── auth.js                 # POST /auth/admin_login, GET /auth/validate_token
│   ├── orders.js               # CRUD: /orders/list, /orders/:id, /orders/:id/status, etc.
│   ├── admin.js                # /admin/dashboard, /admin/employees, /admin/team_workload, etc.
│   ├── revenue.js              # /admin/revenue_chart, /admin/profit_breakdown
│   └── notifications.js        # /admin/notifications, mark read
│
├── contexts/                   # React Context providers
│   ├── AuthContext.jsx          # Auth state: token, user, role, login/logout
│   ├── ToastContext.jsx         # Global toast notification dispatch
│   └── WebSocketContext.jsx     # WS connection lifecycle, event pub/sub
│
├── hooks/                      # Custom React hooks
│   ├── useAuth.js              # Shortcut: useContext(AuthContext)
│   ├── useToast.js             # Shortcut: useContext(ToastContext)
│   ├── useWebSocket.js         # Shortcut: useContext(WebSocketContext)
│   └── usePolling.js           # Generic setInterval + cleanup hook
│
├── components/                 # Shared/reusable UI components
│   ├── layout/
│   │   ├── AppShell.jsx        # Sidebar + Header + <Outlet />
│   │   ├── Sidebar.jsx         # Collapsible nav, logo, user footer
│   │   └── Header.jsx          # Breadcrumb, clock, notifications bell, user dropdown, logout
│   ├── ConfirmModal.jsx        # Reusable confirm dialog (info/warning/danger, optional input)
│   ├── ToastContainer.jsx      # Renders toast stack via portal
│   ├── Badge.jsx               # Status badge (success/warning/danger/primary/secondary)
│   ├── EmptyState.jsx          # Generic "no data" placeholder
│   ├── LoadingSpinner.jsx      # Centered spinner overlay
│   └── NotificationPanel.jsx   # Dropdown notification list in Header
│
├── pages/                      # Route-level page components (1:1 with routes)
│   ├── LoginPage.jsx           # Admin login with animated canvas
│   ├── DashboardPage.jsx       # KPI cards, monthly bar chart, team load, designer ranking
│   ├── OrdersPage.jsx          # Order table with status tabs, search, pagination, actions
│   ├── OrderDetailPage.jsx     # Order info, profit breakdown, timeline
│   ├── TeamPage.jsx            # Designer workload grid cards
│   ├── EmployeesPage.jsx       # Employee CRUD table, add modal, activation code modal
│   └── RevenuePage.jsx         # Revenue/order trend chart with time range selector
│
├── router/
│   └── index.jsx               # Route definitions, auth guards, role guards
│
├── utils/
│   ├── constants.js            # Status maps, role maps, nav config
│   ├── formatters.js           # formatTime, formatCurrency helpers
│   └── storage.js              # localStorage wrapper (pdd_token, pdd_role, etc.)
│
└── assets/
    ├── hero.png                # Login branding image (if used)
    └── (static assets)
```

### Rationale

- **`api/`** isolates all HTTP calls behind named functions. Pages never import Axios directly.
- **`contexts/`** holds the three pieces of global state (auth, toast, WebSocket). No external state library needed.
- **`hooks/`** provides shorthand access to contexts and reusable logic (polling).
- **`components/`** are stateless or lightly-stateful UI building blocks, independent of routing.
- **`pages/`** are route-level components that orchestrate data fetching and compose `components/`.
- **`router/`** centralizes route config, guards, and metadata (titles, icons, role restrictions).

---

## 2. Component Hierarchy

```
<React.StrictMode>
  <AuthProvider>                          ← contexts/AuthContext
    <ToastProvider>                       ← contexts/ToastContext
      <WebSocketProvider>                 ← contexts/WebSocketContext
        <BrowserRouter>
          <Routes>
            <Route path="/login"  element={<LoginPage />} />
            <Route element={<RequireAuth />}>       ← auth guard wrapper
              <Route element={<AppShell />}>        ← layout: sidebar + header + outlet
                <Route path="/"           element={<DashboardPage />} />
                <Route path="/orders"     element={<OrdersPage />} />
                <Route path="/orders/:id" element={<OrderDetailPage />} />
                <Route path="/team"       element={<TeamPage />} />
                <Route element={<RequireRole roles={['admin']} />}>  ← role guard
                  <Route path="/employees" element={<EmployeesPage />} />
                  <Route path="/revenue"   element={<RevenuePage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </BrowserRouter>
      </WebSocketProvider>
    </ToastProvider>
  </AuthProvider>
  <ToastContainer />                    ← portaled toast stack
</React.StrictMode>
```

### AppShell Layout

```
┌──────────────────────────────────────────────────┐
│  Sidebar (280px / 80px collapsed)                │
│  ┌────────────────────────────────────────────┐  │
│  │ Logo: "PD" + "派单中控"                     │  │
│  │ Nav Links (filtered by role)               │  │
│  │ User Footer (avatar, name, role)           │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Main Area                                       │
│  ┌────────────────────────────────────────────┐  │
│  │ Header (72px)                              │  │
│  │   [Collapse] [Breadcrumb]    [Clock] [Bell]│  │
│  │                              [User] [Exit] │  │
│  ├────────────────────────────────────────────┤  │
│  │ <Outlet /> (scrollable page content area)  │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

---

## 3. Data Flow Pattern

### 3.1 Auth State

```
localStorage (pdd_token, pdd_user_name, pdd_user_id, pdd_role)
       │
       ▼
  AuthContext.Provider
  ├── state: { token, userName, userId, role, isAuthenticated }
  ├── login(username, password) → POST /auth/admin_login → set localStorage + state
  ├── logout() → clear localStorage + state + navigate(/login)
  └── validateToken() → GET /auth/validate_token → verify or logout
       │
       ▼
  Consumed by: RequireAuth guard, AppShell (user display), pages (role checks)
```

### 3.2 API Data (per-page)

Each page component owns its own data-fetching state using `useState` + `useEffect`:

```
Page Component
  ├── useState: data, loading, error
  ├── useEffect: fetch on mount + dependency changes
  ├── usePolling(fetchFn, interval): auto-refresh (Dashboard 30s, Orders 15s, Team 10s)
  └── useWebSocket: subscribe to events for real-time refresh
```

No global order/employee store. Each page fetches its own data. This matches the existing Vue pattern and avoids unnecessary complexity.

### 3.3 WebSocket Events

```
WebSocketContext.Provider
  ├── connect() → ws(s)://{host}/api/v1/ws?token={jwt}
  ├── disconnect()
  ├── on(eventType, callback)   → register listener
  ├── off(eventType, callback)  → remove listener
  └── connected: boolean
       │
       ▼  Message format: { type: string, payload: any }
       │
  Event types consumed:
  ├── "order_updated"  → OrdersPage re-fetches, App re-fetches notifications
  ├── "notification"   → App re-fetches notification count
  └── "*" (wildcard)   → debug/logging
```

### 3.4 Toast Notifications

```
ToastContext.Provider
  ├── toast(message, type?, title?)  → adds to stack
  ├── removeToast(id)
  └── toasts: Array<{id, message, type, title}>
       │
       ▼
  ToastContainer (React portal to document.body)
  └── Renders animated toast cards with auto-dismiss (4s)
```

---

## 4. Routing Architecture

### 4.1 Route Table

| Path            | Component          | Auth | Roles          | Nav Title | Hidden |
|-----------------|--------------------|------|----------------|-----------|--------|
| `/login`        | `LoginPage`        | No   | Public         | 登录      | Yes    |
| `/`             | `DashboardPage`    | Yes  | All            | 仪表盘    | No     |
| `/orders`       | `OrdersPage`       | Yes  | All            | 订单大厅  | No     |
| `/orders/:id`   | `OrderDetailPage`  | Yes  | All            | 订单详情  | Yes    |
| `/team`         | `TeamPage`         | Yes  | All            | 团队负载  | No     |
| `/employees`    | `EmployeesPage`    | Yes  | `admin`        | 员工管理  | No     |
| `/revenue`      | `RevenuePage`      | Yes  | `admin`        | 营收图表  | No     |

### 4.2 Auth Guard (`RequireAuth`)

A wrapper `<Outlet />` component that:
1. Reads `token` from `AuthContext`.
2. If no token, redirects to `/login`.
3. On mount, calls `validateToken()`. If 401, clears auth and redirects.
4. On success, renders `<Outlet />` and initiates WebSocket connection + notification polling.

### 4.3 Role Guard (`RequireRole`)

A wrapper `<Outlet />` component that:
1. Reads `role` from `AuthContext`.
2. If `role` is not in `props.roles`, redirects to `/`.
3. Otherwise, renders `<Outlet />`.

### 4.4 Login Page Redirect

If user navigates to `/login` while already authenticated (has token), redirect to `/`.

---

## 5. State Management Strategy

### Decision: React Context + Local State (no Redux/Zustand)

**Why:**
- The app has only 3 pieces of truly global state: auth, toast, and WebSocket connection.
- All page data (orders, employees, revenue, dashboard stats) is page-local and fetched on demand.
- The existing Vue app uses the same pattern (no Vuex/Pinia) successfully.
- Adding Redux or Zustand would be over-engineering for this application size.

### Context Breakdown

| Context            | State                                       | Consumers                          |
|--------------------|---------------------------------------------|------------------------------------|
| `AuthContext`      | token, userName, userId, role               | Guards, AppShell, all pages        |
| `ToastContext`     | toasts[], toast(), removeToast()            | All pages, AppShell                |
| `WebSocketContext` | connected, on(), off()                      | AppShell (notifications), pages    |

### Page-Level State

Each page manages its own state with `useState`. Data-fetching follows a consistent pattern:

```jsx
const [data, setData] = useState(initialValue);
const [loading, setLoading] = useState(false);

const fetchData = useCallback(async () => {
  setLoading(true);
  try {
    const res = await api.getData(params);
    setData(res);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}, [params]);

useEffect(() => { fetchData(); }, [fetchData]);
usePolling(fetchData, 15000);  // auto-refresh
```

---

## 6. API Client Design

### 6.1 Axios Instance (`api/client.js`)

```js
import axios from 'axios';
import { getToken, clearAuth } from '../utils/storage';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});
```

### 6.2 Request Interceptor

```js
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

### 6.3 Response Interceptor

```js
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuth();              // Remove token, user info from localStorage
      window.location.href = '/login';  // Hard redirect to avoid stale state
    }
    return Promise.reject(error);
  }
);
```

### 6.4 JWT Token Management

- **Storage**: `localStorage` keys: `pdd_token`, `pdd_user_name`, `pdd_user_id`, `pdd_role`.
- **Attachment**: Every request via the Axios interceptor.
- **Validation**: On initial app load, `GET /auth/validate_token` verifies the stored token.
- **Expiry**: If any API returns 401, the interceptor clears all auth data and redirects.
- **WebSocket**: Token passed as query param `?token={jwt}` during WS handshake.

### 6.5 API Module Examples

```js
// api/orders.js
import client from './client';

export const listOrders = (params) => client.get('/orders/list', { params });
export const getOrderDetail = (id) => client.get(`/orders/${id}/detail`);
export const getOrderTimeline = (id) => client.get(`/orders/${id}/timeline`);
export const updateOrderStatus = (id, data) => client.put(`/orders/${id}/status`, data);
export const uploadOCR = (formData) => client.post('/orders/upload_ocr', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```

```js
// api/admin.js
import client from './client';

export const getDashboard = () => client.get('/admin/dashboard');
export const listEmployees = () => client.get('/admin/employees');
export const createEmployee = (data) => client.post('/admin/employees', data);
export const toggleEmployee = (id) => client.put(`/admin/employees/${id}/toggle`);
export const unbindDevice = (id) => client.put(`/admin/employees/${id}/unbind`);
export const getTeamWorkload = () => client.get('/admin/team_workload');
export const exportOrdersCSV = (params) =>
  window.open(`/api/v1/admin/orders/export?${new URLSearchParams(params)}&token=${getToken()}`);
```

### 6.6 Error Handling Convention

Pages catch errors at the call site and display via toast:

```js
try {
  await updateOrderStatus(id, { status: 'COMPLETED' });
  toast('Order completed', 'success');
  refetch();
} catch (err) {
  toast(err.response?.data?.error || err.message, 'error');
}
```

---

## 7. WebSocket Integration

### 7.1 Connection Lifecycle

```
App Mount → AuthContext validates token
  ├── Success → WebSocketContext.connect()
  │             ├── Build URL: ws(s)://{host}/api/v1/ws?token={jwt}
  │             ├── new WebSocket(url)
  │             ├── onopen  → set connected = true
  │             ├── onmessage → JSON.parse → dispatch to listeners
  │             ├── onclose → set connected = false, schedule reconnect
  │             └── onerror → ws.close() (triggers onclose → reconnect)
  │
  └── Failure (401) → redirect to /login, no WS connection
```

### 7.2 Reconnection Strategy

- **Delay**: 3 seconds after `onclose` fires.
- **Method**: `setTimeout(connect, 3000)` — simple, matches the existing Vue implementation.
- **Cleanup**: `clearTimeout(reconnectTimer)` on manual disconnect or unmount.
- **No exponential backoff**: The system operates on a local network / single-server deployment; 3s fixed delay is sufficient.

### 7.3 Event Dispatch

```
WebSocketContext internally maintains:
  listeners: Map<string, Set<Function>>

  on(eventType, callback)  → listeners.get(eventType).add(callback)
  off(eventType, callback) → listeners.get(eventType).delete(callback)

Message format from server:
  { "type": "order_updated", "payload": { ... } }
  { "type": "notification",  "payload": { ... } }

Dispatch logic:
  onmessage = (event) => {
    const data = JSON.parse(event.data);
    listeners.get(data.type)?.forEach(cb => cb(data.payload));
    listeners.get('*')?.forEach(cb => cb(data));  // wildcard
  };
```

### 7.4 Consumer Pattern (in pages)

```jsx
const { on, off } = useWebSocket();

useEffect(() => {
  const handler = () => fetchOrders();
  on('order_updated', handler);
  return () => off('order_updated', handler);
}, []);
```

### 7.5 Notification Integration (in AppShell/Header)

```jsx
// Subscribe to WS events that should refresh notification count
on('order_updated', fetchNotifications);
on('notification', fetchNotifications);

// Also poll every 30 seconds as fallback
usePolling(fetchNotifications, 30000);
```

---

## 8. Complete API Contract Reference

Derived from `server/main.go` route definitions.

### Public Endpoints (no auth)

| Method | Path                       | Purpose                           |
|--------|----------------------------|-----------------------------------|
| POST   | `/auth/admin_login`        | Admin login (username + password) |
| POST   | `/auth/device_login`       | Device login (activation code)    |
| GET    | `/ws`                      | WebSocket (token via query param) |
| GET    | `/app/version`             | Client OTA version check          |
| ANY    | `/wecom/callback`          | WeCom server callback             |
| GET    | `/health`                  | Health check                      |

### Authenticated Endpoints (JWT required)

| Method | Path                       | Purpose                            |
|--------|----------------------------|------------------------------------|
| GET    | `/auth/validate_token`     | Validate JWT, returns role+userid  |
| GET    | `/orders/list`             | List orders (paginated, filtered)  |
| GET    | `/orders/:id`              | Get single order                   |
| GET    | `/orders/:id/detail`       | Order detail + profit + people     |
| GET    | `/orders/:id/timeline`     | Order status timeline              |
| POST   | `/orders/create`           | Create new order                   |
| POST   | `/orders/grab`             | Grab/claim order                   |
| PUT    | `/orders/:id/status`       | Update order status                |
| POST   | `/orders/upload_ocr`       | Upload OCR image                   |

### Admin-Only Endpoints (JWT + admin role)

| Method | Path                               | Purpose                          |
|--------|-------------------------------------|----------------------------------|
| GET    | `/admin/dashboard`                  | Dashboard KPIs + monthly data    |
| GET    | `/admin/revenue_chart`              | Revenue chart (days param)       |
| GET    | `/admin/employees`                  | List all employees               |
| POST   | `/admin/employees`                  | Create employee                  |
| PUT    | `/admin/employees/:id/toggle`       | Toggle employee active status    |
| PUT    | `/admin/employees/:id/unbind`       | Unbind device fingerprint        |
| GET    | `/admin/team_workload`              | Team workload grid               |
| GET    | `/admin/profit_breakdown`           | Profit breakdown                 |
| GET    | `/admin/audit_logs`                 | Audit log list                   |
| POST   | `/admin/versions`                   | Create app version               |
| GET    | `/admin/activation_codes`           | List activation codes            |
| PUT    | `/admin/activation_codes/:id/pause` | Pause/resume activation code     |
| GET    | `/admin/notifications`              | List notifications               |
| PUT    | `/admin/notifications/:id/read`     | Mark notification as read        |
| GET    | `/admin/orders/export`              | Export orders CSV                 |
| GET    | `/admin/profit/export`              | Export profit CSV                 |

---

## 9. Order Status State Machine

```
PENDING → GROUP_CREATED → DESIGNING → DELIVERED → COMPLETED
   │           │              │           │
   │           │              │           └──→ REFUNDED
   │           │              └──────────────→ REFUNDED
   │           └─────────────────────────────→ CLOSED
   └─────────────────────────────────────────→ CLOSED
```

Status labels (Chinese):

| Status          | Label   | Badge Class |
|-----------------|---------|-------------|
| `PENDING`       | 待处理  | `warning`   |
| `GROUP_CREATED` | 已建群  | `primary`   |
| `DESIGNING`     | 设计中  | `secondary` |
| `DELIVERED`     | 已交付  | `secondary` |
| `COMPLETED`     | 已完成  | `success`   |
| `REFUNDED`      | 已退款  | `warning`   |
| `CLOSED`        | 已关闭  | `danger`    |

---

## 10. Role-Based Access Control

### Roles

| Role       | Chinese   | Access                                          |
|------------|-----------|--------------------------------------------------|
| `admin`    | 系统管理员 | All pages, all actions                           |
| `operator` | 客服管家   | Dashboard, Orders, Team (no Employees, Revenue)  |
| `designer` | 设计师     | Dashboard, Orders, Team (limited order actions)  |

### Action Permissions (Order Operations)

| Action       | admin | operator (own) | designer (own) |
|--------------|-------|----------------|----------------|
| Confirm group| Yes   | Yes            | No             |
| Assign design| Yes   | Yes            | No             |
| Mark deliver | Yes   | No             | Yes            |
| Mark complete| Yes   | Yes            | No             |
| Refund       | Yes   | Yes            | No             |
| Close order  | Yes   | No             | No             |

---

## 11. Styling Strategy

### Approach: Tailwind CSS 4 + Global Design Tokens

Port the existing `main.css` from the Vue app verbatim. It already defines:
- Design tokens via `@theme` (brand colors, semantic colors)
- Component classes: `.card`, `.card-header`, `.btn`, `.badge`, `.table-container`, `.form-*`
- Fonts: Inter (body), Outfit (headings)
- Animations: fadeInUp, skeleton-shimmer, pageIn

### Tailwind Configuration

The existing CSS uses `@import "tailwindcss"` (v4 syntax). The React app will use the same approach:

```css
/* index.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
@import "tailwindcss";

@theme {
  --color-brand-25:  #F5F8FF;
  --color-brand-50:  #EFF4FF;
  --color-brand-100: #D1E0FF;
  --color-brand-500: #465FFF;
  --color-brand-600: #3641F5;
  --color-brand-700: #2B35CF;
  /* ... same tokens as Vue version ... */
}
/* ... rest of existing main.css ... */
```

No CSS Modules or CSS-in-JS. Use utility classes inline + the global component classes.

---

## 12. Dependencies List

### Production Dependencies

```json
{
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "react-router-dom": "^7.5.0",
  "axios": "^1.9.0",
  "echarts": "^5.6.0"
}
```

| Package            | Version  | Purpose                                           |
|--------------------|----------|---------------------------------------------------|
| `react`            | ^19.1.0  | Already installed. Core UI library                |
| `react-dom`        | ^19.1.0  | Already installed. DOM renderer                   |
| `react-router-dom` | ^7.5.0   | Client-side routing, guards, nested layouts       |
| `axios`            | ^1.9.0   | HTTP client with interceptor support              |
| `echarts`          | ^5.6.0   | Charts (bar chart on Dashboard, line+bar on Revenue) |

### Dev Dependencies

```json
{
  "@tailwindcss/vite": "^4.1.0",
  "tailwindcss": "^4.1.0"
}
```

| Package             | Version | Purpose                                          |
|---------------------|---------|--------------------------------------------------|
| `tailwindcss`       | ^4.1.0  | Utility-first CSS framework (v4, CSS-native)     |
| `@tailwindcss/vite` | ^4.1.0  | Vite plugin for Tailwind v4                       |

### What We Deliberately Exclude

| Library         | Reason                                                    |
|-----------------|-----------------------------------------------------------|
| Redux / Zustand | Not needed; 3 contexts cover all global state             |
| React Query     | Over-engineering; simple useEffect + polling is sufficient |
| Styled Components / Emotion | Tailwind utility classes are the existing pattern |
| Framer Motion   | CSS transitions + keyframes are sufficient                |
| dayjs / date-fns| `toLocaleString('zh-CN')` covers all formatting needs     |
| i18n libraries  | App is Chinese-only                                       |

### Install Commands

```bash
cd admin-web

# Production deps
npm install react-router-dom@^7.5.0 axios@^1.9.0 echarts@^5.6.0

# Dev deps (Tailwind v4)
npm install -D tailwindcss@^4.1.0 @tailwindcss/vite@^4.1.0
```

### Vite Config Update

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:9800',   // Go backend
      '/ws':  { target: 'ws://localhost:9800', ws: true },
    },
  },
});
```

---

## 13. Navigation Configuration

Centralized in `utils/constants.js`:

```js
export const NAV_ROUTES = [
  { path: '/',          title: '仪表盘',  icon: 'LayoutDashboard' },
  { path: '/orders',    title: '订单大厅', icon: 'ClipboardDocumentList' },
  { path: '/team',      title: '团队负载', icon: 'UserGroup' },
  { path: '/employees', title: '员工管理', icon: 'Identification', roles: ['admin'] },
  { path: '/revenue',   title: '营收图表', icon: 'ChartBarSquare', roles: ['admin'] },
];
```

Icons are inline SVGs (same Heroicons as the Vue version), stored as React components or dangerouslySetInnerHTML strings in the nav config. No icon library dependency needed.

---

## 14. Key Implementation Notes

### 14.1 Login Page Canvas Animation

The Vue login page has an interactive particle canvas with Orb physics. Port this as a `useCanvas` hook or a dedicated `<ParticleCanvas />` component using `useRef` + `useEffect` + `requestAnimationFrame`. The logic is self-contained and framework-agnostic.

### 14.2 ECharts Integration

Use ECharts' modular imports (tree-shaking):

```js
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
```

Charts mount into a `ref`-ed div. Dispose on unmount. Resize on window resize.

### 14.3 Auto-Refresh Intervals

| Page       | Polling Interval | WebSocket Events         |
|------------|-----------------|--------------------------|
| Dashboard  | 30s             | `order_updated`          |
| Orders     | 15s             | `order_updated`          |
| Team       | 10s             | none (polling only)      |
| Employees  | none            | none (manual refresh)    |
| Revenue    | none            | none (manual refresh)    |
| Notifications | 30s          | `order_updated`, `notification` |

### 14.4 Pagination

Orders page uses server-side pagination:
- Query params: `limit=50`, `offset=page*50`, `status`, `keyword`
- Response: `{ data: Order[], total: number }`

### 14.5 CSRF

The backend has CSRF middleware. The Axios client must:
- Read `X-CSRF-Token` from response headers (exposed via CORS `ExposeHeaders`)
- Attach it back on state-changing requests (POST, PUT, DELETE) via `X-CSRF-Token` request header

---

## 15. File Count Summary

| Category    | Files | Description                     |
|-------------|-------|---------------------------------|
| API         | 5     | client + 4 endpoint modules     |
| Contexts    | 3     | Auth, Toast, WebSocket          |
| Hooks       | 4     | useAuth, useToast, useWS, usePolling |
| Components  | 9     | Layout (3) + shared (6)        |
| Pages       | 7     | One per route                   |
| Router      | 1     | Route config + guards           |
| Utils       | 3     | Constants, formatters, storage  |
| Styles      | 1     | index.css (Tailwind + tokens)   |
| Config      | 1     | vite.config.js update           |
| **Total**   | **34**| Lean, maintainable codebase     |

---

## 16. Migration Checklist (Vue -> React)

| Vue Concept                    | React Equivalent                          |
|--------------------------------|-------------------------------------------|
| `<template>` + `<script setup>` | JSX function component                   |
| `ref()`, `reactive()`         | `useState()`                              |
| `computed()`                   | `useMemo()` or derived inline             |
| `watch()`                      | `useEffect()` with deps                   |
| `onMounted()` / `onUnmounted()` | `useEffect()` + cleanup return          |
| `provide()` / `inject()`      | `React.createContext` + `useContext()`     |
| `vue-router` + `<router-view>` | `react-router-dom` + `<Outlet />`        |
| `v-if` / `v-for` / `v-model`  | Ternary/`&&` / `.map()` / controlled inputs |
| `v-html`                      | `dangerouslySetInnerHTML` (nav icons only) |
| Scoped `<style>`              | Tailwind utilities (same as before)        |
| `$router.push()`              | `useNavigate()` hook                       |
| `$route.params`               | `useParams()` hook                         |

---

*Document produced by the Architect agent. All designs are based on thorough analysis of the existing Vue frontend (`admin-web-vue-backup/src/`) and Go backend routes (`server/main.go`).*
