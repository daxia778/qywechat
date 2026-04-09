import { lazy, Suspense, Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AppShell from '../components/layout/AppShell';

// ── Lazy-load with auto-retry on chunk failure ──
function lazyWithRetry(importFn) {
  return lazy(() =>
    importFn().catch((err) => {
      const reloadCount = parseInt(sessionStorage.getItem('chunk_reload') || '0', 10);
      if (reloadCount < 3) {
        sessionStorage.setItem('chunk_reload', String(reloadCount + 1));
        window.location.reload();
        return new Promise(() => {});
      }
      sessionStorage.removeItem('chunk_reload');
      throw err;
    })
  );
}

// ── Error Boundary ──
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error?.message || '未知错误' };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', minHeight: '300px', gap: '16px',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: '#F5F3FF', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#434FCF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p style={{ color: '#64748B', fontSize: 14 }}>页面加载遇到问题</p>
          <button
            onClick={() => { sessionStorage.removeItem('chunk_reload'); window.location.reload(); }}
            style={{
              padding: '10px 24px', borderRadius: 12, border: '2px solid #434FCF',
              background: '#434FCF', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Admin Pages ──
const LoginPage = lazyWithRetry(() => import('../pages/LoginPage'));
const DashboardPage = lazyWithRetry(() => import('../pages/DashboardPage'));
const OrdersPage = lazyWithRetry(() => import('../pages/OrdersPage'));
const OrderDetailPage = lazyWithRetry(() => import('../pages/OrderDetailPage'));
const TeamPage = lazyWithRetry(() => import('../pages/TeamPage'));
const EmployeesPage = lazyWithRetry(() => import('../pages/EmployeesPage'));
const RevenuePage = lazyWithRetry(() => import('../pages/RevenuePage'));
const CustomersPage = lazyWithRetry(() => import('../pages/CustomersPage'));
const PaymentsPage = lazyWithRetry(() => import('../pages/PaymentsPage'));
const DesignersRosterPage = lazyWithRetry(() => import('../pages/DesignersRosterPage'));
// [隐藏] 联系我管理 — 后续根据业务需求再上线测试
// const ContactWaysPage = lazyWithRetry(() => import('../pages/ContactWaysPage'));
const WelcomeTemplatesPage = lazyWithRetry(() => import('../pages/WelcomeTemplatesPage'));

// ── Staff Pages ──
const StaffLayout = lazyWithRetry(() => import('../components/layout/StaffLayout'));
const StaffDashboard = lazyWithRetry(() => import('../pages/staff/StaffDashboard'));
const MyOrdersPage = lazyWithRetry(() => import('../pages/staff/MyOrdersPage'));
const StaffOrderDetail = lazyWithRetry(() => import('../pages/staff/StaffOrderDetail'));
const StaffPaymentsPage = lazyWithRetry(() => import('../pages/staff/StaffPaymentsPage'));

function LoadingFallback() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '200px', gap: '12px' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #E5E7EB', borderTopColor: '#434FCF',
        animation: 'spin 0.6s linear infinite',
      }} />
      <span style={{ color: '#94A3B8', fontSize: '13px', fontWeight: 500 }}>加载中...</span>
    </div>
  );
}

function RequireAuth() {
  const { isAuthenticated, ready } = useAuth();
  if (!ready) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminGuard() {
  const { role } = useAuth();
  if (role !== 'admin') return <Navigate to="/s/dashboard" replace />;
  return <Outlet />;
}

function StaffGuard() {
  const { role } = useAuth();
  if (role === 'admin') return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function LoginGuard() {
  const { isAuthenticated, ready, role } = useAuth();
  if (!ready) return null;
  if (isAuthenticated) return <Navigate to={role === 'admin' ? '/dashboard' : '/s/dashboard'} replace />;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LoginPage />
    </Suspense>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route element={<RequireAuth />}>
            
            {/* ── 管理员视图 ── */}
            <Route element={<AdminGuard />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/orders/:id" element={<OrderDetailPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/revenue" element={<RevenuePage />} />
                <Route path="/payments" element={<PaymentsPage />} />
                <Route path="/designers" element={<DesignersRosterPage />} />
                {/* [隐藏] 联系我管理 — 后续根据业务需求再上线测试 */}
                {/* <Route path="/contact-ways" element={<ContactWaysPage />} /> */}
                <Route path="/welcome-templates" element={<WelcomeTemplatesPage />} />
              </Route>
            </Route>

            {/* ── 员工视图 ── */}
            <Route path="/s" element={<StaffGuard />}>
              <Route element={<StaffLayout />}>
                <Route index element={<Navigate to="/s/dashboard" replace />} />
                <Route path="dashboard" element={<StaffDashboard />} />
                <Route path="orders" element={<MyOrdersPage />} />
                <Route path="orders/:id" element={<StaffOrderDetail />} />
                <Route path="payments" element={<StaffPaymentsPage />} />
                <Route path="designers" element={<DesignersRosterPage />} />
              </Route>
            </Route>

          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
