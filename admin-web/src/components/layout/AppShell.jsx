import { useState, useEffect, useCallback, Suspense } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket, WS_STATE } from '../../hooks/useWebSocket';
import { useToast } from '../../hooks/useToast';
import { usePolling } from '../../hooks/usePolling';
import { NAV_ROUTES, ROLE_MAP } from '../../utils/constants';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../../api/notifications';
import { formatTime } from '../../utils/formatters';
import NotificationPanel from '../NotificationPanel';

export default function AppShell() {
  const { userName, role, logout } = useAuth();
  const { on, off, connect, connected, connectionState, retry } = useWebSocket();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [currentTime, setCurrentTime] = useState('');

  const userInitials = (userName || 'AD').substring(0, 2).toUpperCase();
  const currentRoleName = ROLE_MAP[role] || '用户';

  const filteredNavRoutes = NAV_ROUTES.filter((r) => {
    if (r.roles && !r.roles.includes(role)) return false;
    return true;
  });

  const currentRouteName = NAV_ROUTES.find(
    (r) => r.path === location.pathname || (r.path !== '/' && location.pathname.startsWith(r.path))
  )?.title || '';

  // Clock
  useEffect(() => {
    const update = () => {
      setCurrentTime(
        new Date().toLocaleString('zh-CN', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      );
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  // Responsive collapse
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth < 1024) {
        setCollapsed(true);
        setMobileOpen(false);
      } else {
        setCollapsed(false);
      }
    };
    handler();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Connect WebSocket
  useEffect(() => {
    connect();
  }, [connect]);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ limit: 20 });
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  usePolling(fetchNotifications, 30000);

  // WS refresh notifications
  useEffect(() => {
    const handler = () => fetchNotifications();
    on('order_updated', handler);
    on('notification', handler);
    on('grab_alert', handler);
    return () => {
      off('order_updated', handler);
      off('notification', handler);
      off('grab_alert', handler);
    };
  }, [on, off, fetchNotifications]);

  // Close notif panel on outside click
  useEffect(() => {
    const close = () => setShowNotifPanel(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const handleMarkRead = async (n) => {
    if (!n.is_read) {
      await markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
  };

  const doLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface font-sans text-[#1C1C28]">
      {/* Logout Confirm */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" onKeyDown={(e) => { if (e.key === 'Escape') setShowLogoutConfirm(false); }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowLogoutConfirm(false)} aria-hidden="true" />
          <div className="relative bg-white rounded-2xl border-2 border-slate-200 w-full max-w-sm overflow-hidden animate-fade-in-up">
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0" aria-hidden="true">
                  <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 id="logout-dialog-title" className="text-lg font-bold text-slate-800">退出登录</h3>
              </div>
            </div>
            <div className="px-6 py-3">
              <p className="text-sm text-slate-600">确定要退出当前账号吗？</p>
            </div>
            <div className="px-6 pb-6 pt-2 flex justify-end gap-3">
              <button onClick={() => setShowLogoutConfirm(false)} className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">取消</button>
              <button onClick={doLogout} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl bg-amber-500 hover:bg-amber-600 transition-all">退出</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`flex flex-col shrink-0 bg-gradient-to-b from-[#3D28B2] to-[#2D1D8A] text-white/80 z-50 transition-all duration-300 ease-in-out border-r-2 border-[#4A32C8]/30 ${
          collapsed ? 'w-[80px]' : 'w-[280px]'
        } ${mobileOpen ? 'fixed inset-y-0 left-0 w-[280px] shadow-2xl' : 'hidden lg:flex'}`}
      >
        {/* Logo */}
        <div className={`flex items-center shrink-0 h-[72px] transition-all duration-300 border-b border-white/10 ${collapsed && !mobileOpen ? 'px-4 justify-center' : 'px-6 gap-3'}`}>
          <div className="w-10 h-10 shrink-0 bg-white/15 backdrop-blur rounded-xl flex items-center justify-center text-white font-bold text-lg tracking-wider border border-white/20">
            PD
          </div>
          {(!collapsed || mobileOpen) && (
            <span className="font-[Outfit] font-semibold text-[20px] text-white whitespace-nowrap tracking-tight">派单中控</span>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-5 scrollbar-hide">
          <nav className="px-3 space-y-0.5" aria-label="主导航菜单">
            {(!collapsed || mobileOpen) && (
              <p className="px-4 mb-3 mt-1 text-[11px] font-semibold text-white/40 uppercase tracking-[0.15em]">菜单</p>
            )}
            {filteredNavRoutes.map((route) => {
              const isActive = location.pathname === route.path || (route.path !== '/' && location.pathname.startsWith(route.path));
              return (
                <Link
                  key={route.path}
                  to={route.path}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed && !mobileOpen ? route.title : ''}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-3 no-underline transition-all duration-200 ease-in-out group rounded-xl relative ${
                    collapsed && !mobileOpen ? 'justify-center p-3' : 'px-4 py-2.5'
                  } ${
                    isActive
                      ? 'bg-white/15 text-white shadow-[0_0_12px_rgba(255,255,255,0.08)]'
                      : 'text-white/60 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] bg-white rounded-r shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                  )}
                  <div
                    className={`shrink-0 flex items-center w-5 h-5 transition-colors duration-200 ${isActive ? 'text-white' : 'text-white/50 group-hover:text-white'}`}
                    aria-hidden="true"
                  >
                    {route.icon}
                  </div>
                  {(!collapsed || mobileOpen) && (
                    <span className="text-[14px] font-medium">{route.title}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer — Collapse/Expand Toggle */}
        <div className="px-3 py-3 border-t border-white/10">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center gap-3 rounded-xl transition-all duration-200 hover:bg-white/15 text-white/60 hover:text-white ${
              collapsed && !mobileOpen ? 'justify-center p-2.5' : 'px-4 py-2.5'
            }`}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            <svg className={`w-4 h-4 shrink-0 transition-transform duration-300 ${collapsed && !mobileOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            {(!collapsed || mobileOpen) && (
              <span className="text-[13px] font-medium">收起菜单</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <header className="h-[72px] flex items-center justify-between px-5 lg:px-8 bg-white border-b-2 border-slate-200 shrink-0 sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2 -ml-1 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors lg:hidden" aria-label="打开导航菜单">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>

            <nav className="hidden sm:flex items-center gap-1.5 text-sm" aria-label="面包屑导航">
              <Link to="/" className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="首页">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
              </Link>
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              <span className="font-semibold text-slate-700">{currentRouteName}</span>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* WebSocket Connection Indicator */}
            <div
              className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-lg select-none ${
                connectionState === WS_STATE.OFFLINE ? 'cursor-pointer hover:bg-slate-100 transition-colors' : 'cursor-default'
              }`}
              title={
                connectionState === WS_STATE.CONNECTED
                  ? '实时连接正常'
                  : connectionState === WS_STATE.RECONNECTING
                  ? '正在重新连接...'
                  : connectionState === WS_STATE.OFFLINE
                  ? '后端不可达，点击重试'
                  : '连接已断开'
              }
              onClick={connectionState === WS_STATE.OFFLINE ? retry : undefined}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                  connectionState === WS_STATE.CONNECTED
                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                    : connectionState === WS_STATE.RECONNECTING
                    ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.5)]'
                    : connectionState === WS_STATE.OFFLINE
                    ? 'bg-slate-400'
                    : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                }`}
              />
              <span
                className={`hidden sm:inline ${
                  connectionState === WS_STATE.CONNECTED
                    ? 'text-emerald-600'
                    : connectionState === WS_STATE.RECONNECTING
                    ? 'text-amber-500'
                    : connectionState === WS_STATE.OFFLINE
                    ? 'text-slate-400'
                    : 'text-red-500'
                }`}
              >
                {connectionState === WS_STATE.CONNECTED
                  ? '已连接'
                  : connectionState === WS_STATE.RECONNECTING
                  ? '重连中'
                  : connectionState === WS_STATE.OFFLINE
                  ? '离线'
                  : '已断开'}
              </span>
            </div>

            <div className="hidden md:flex items-center gap-1.5 text-[13px] text-slate-400 font-medium bg-slate-50 px-3 py-1.5 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {currentTime}
            </div>

            {/* Notification Bell */}
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); setShowNotifPanel(!showNotifPanel); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors relative" aria-label={`通知${unreadCount > 0 ? `，${unreadCount}条未读` : ''}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 animate-pulse">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifPanel && (
                <NotificationPanel
                  notifications={notifications}
                  unreadCount={unreadCount}
                  onMarkRead={handleMarkRead}
                  onMarkAllRead={handleMarkAllRead}
                />
              )}
            </div>

            <div className="hidden sm:block w-px h-6 bg-slate-200" />

            {/* User */}
            <div className="flex items-center gap-2.5 hover:bg-slate-50 p-1.5 pr-3 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-slate-200/80">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500/20 to-brand-500/10 text-brand-500 font-bold text-sm flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-white">
                {userInitials}
              </div>
              <div className="hidden md:block text-right">
                <div className="text-[13px] font-semibold text-slate-700 leading-tight">{userName}</div>
                <div className="text-[11px] text-slate-400">{currentRoleName}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setShowLogoutConfirm(true); }} className="ml-1 text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="退出登录" aria-label="退出登录">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H8a3 3 0 01-3-3V7a3 3 0 013-3h2a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 lg:p-8 scroll-smooth bg-surface">
          <Suspense fallback={
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: '12px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                border: '3px solid #E5E7EB', borderTopColor: '#434FCF',
                animation: 'spin 0.6s linear infinite',
              }} />
              <span style={{ color: '#94A3B8', fontSize: '13px', fontWeight: 500 }}>加载中...</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          }>
            <div className="page-enter" key={location.pathname}>
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
