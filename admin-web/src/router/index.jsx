import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AppShell from '../components/layout/AppShell';

// Lazy-loaded page components for code splitting
const LoginPage = lazy(() => import('../pages/LoginPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const OrdersPage = lazy(() => import('../pages/OrdersPage'));
const OrderDetailPage = lazy(() => import('../pages/OrderDetailPage'));
const TeamPage = lazy(() => import('../pages/TeamPage'));
const EmployeesPage = lazy(() => import('../pages/EmployeesPage'));
const RevenuePage = lazy(() => import('../pages/RevenuePage'));

function LoadingFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '200px' }}>
      <span style={{ color: '#999', fontSize: '14px' }}>Loading...</span>
    </div>
  );
}

function RequireAuth() {
  const { isAuthenticated, ready } = useAuth();
  if (!ready) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireRole({ roles }) {
  const { role } = useAuth();
  if (!roles.includes(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function LoginGuard() {
  const { isAuthenticated, ready } = useAuth();
  if (!ready) return null;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LoginPage />
    </Suspense>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/team" element={<TeamPage />} />
              <Route element={<RequireRole roles={['admin']} />}>
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/revenue" element={<RevenuePage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
