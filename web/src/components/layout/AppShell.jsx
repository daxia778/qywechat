import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useWebSocket, WS_STATE } from '../../hooks/useWebSocket';
import { useToast } from '../../hooks/useToast';
import { usePolling } from '../../hooks/usePolling';
import { useThrottledCallback } from '../../hooks/useThrottledCallback';
import { useNotificationSound } from '../../hooks/useNotificationSound';
import { NAV_ROUTES, ROLE_MAP } from '../../utils/constants';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../../api/notifications';
import { formatTime } from '../../utils/formatters';
// NotificationPanel removed — sound bell only
import SoundPopover from '../SoundPopover';
import OrderMatchModal from '../OrderMatchModal';

export default function AppShell() {
  const { userName, role, logout } = useAuth();
  const { on, off, connect, connected, connectionState, retry } = useWebSocket();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSoundSettings, setShowSoundSettings] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [matchContactInfo, setMatchContactInfo] = useState(null);

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

  // 通知轮询降频: 30s → 120s（通知不是高频业务操作，WS 负责实时推送）
  usePolling(fetchNotifications, 120000);

  // ── 声音系统 ──
  const {
    enabled: soundEnabled, volume: soundVolume, soundType,
    soundTypes, setEnabled: setSoundEnabled, setVolume: setSoundVolume,
    setSoundType, play: playSound, preview: previewSound,
  } = useNotificationSound();

  // WS 触发通知刷新加 5s 节流 + 播放提示音
  const throttledNotifRefresh = useThrottledCallback(() => {
    fetchNotifications();
    playSound(); // 收到新通知时播放提示音
  }, 5000);
  // 新订单也触发提示音（独立节流，不影响通知刷新频率）
  const throttledOrderSound = useThrottledCallback(() => {
    playSound();
  }, 3000);
  useEffect(() => {
    on('notification', throttledNotifRefresh);
    on('grab_alert', throttledNotifRefresh);
    on('order_updated', throttledOrderSound);
    return () => {
      off('notification', throttledNotifRefresh);
      off('grab_alert', throttledNotifRefresh);
      off('order_updated', throttledOrderSound);
    };
  }, [on, off, throttledNotifRefresh, throttledOrderSound]);

  // WS: new_external_contact triggers match modal
  useEffect(() => {
    const handler = (payload) => {
      setMatchContactInfo(payload);
      setMatchModalVisible(true);
      toast('有新好友添加，请匹配对应订单', 'info', '好友匹配');
    };
    on('new_external_contact', handler);
    return () => off('new_external_contact', handler);
  }, [on, off, toast]);

  // Close sound settings on outside click
  useEffect(() => {
    const close = () => setShowSoundSettings(false);
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
    <div className="flex h-screen overflow-hidden bg-[#f8f9fa] font-sans text-[#1C1C28]">
      {/* Order Match Modal */}
      <OrderMatchModal
        visible={matchModalVisible}
        contactInfo={matchContactInfo}
        onClose={() => setMatchModalVisible(false)}
        onMatched={() => fetchNotifications()}
      />

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
        className={`flex flex-col shrink-0 text-white z-50 transition-all duration-300 ease-in-out ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        } ${mobileOpen ? 'fixed inset-y-0 left-0 w-[260px] shadow-2xl' : 'hidden lg:flex'}`}
        style={{ background: 'linear-gradient(160deg, #2834b7 0%, #434fcf 100%)' }}
      >
        {/* Logo */}
        <div className={`flex items-center shrink-0 h-[64px] border-b border-white/[0.12] ${collapsed && !mobileOpen ? 'px-3 justify-center' : 'px-5 gap-2.5'}`}>
          <div className="w-9 h-9 shrink-0 rounded-xl bg-white/15 flex items-center justify-center text-white backdrop-blur-sm">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>analytics</span>
          </div>
          {(!collapsed || mobileOpen) && (
            <div className="flex flex-col justify-center">
              <h1 className="text-[18px] font-bold text-white tracking-tight leading-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>智序系统</h1>
              <p className="text-[10px] text-white/60 font-normal tracking-[0.04em]">Order Management</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3 scrollbar-hide">
          <nav className="px-3 space-y-0.5" aria-label="主导航菜单">
            {(!collapsed || mobileOpen) && (
              <p className="px-3 mb-2 mt-2 text-[13px] font-medium text-white/40 tracking-[0.06em]">菜单</p>
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
                  className={`flex items-center gap-3 no-underline transition-all duration-200 ease-in-out group rounded-lg relative ${
                    collapsed && !mobileOpen ? 'justify-center p-3 mx-0' : 'px-3 py-2.5 mx-0'
                  } ${
                    isActive
                      ? 'bg-white/[0.18] text-white font-semibold'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <div
                    className={`shrink-0 flex items-center w-5 h-5 transition-colors duration-200 ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white'}`}
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
        <div className="px-3 py-3 border-t border-white/[0.12]">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center gap-3 rounded-lg transition-all duration-200 hover:bg-white/10 text-white/50 hover:text-white ${
              collapsed && !mobileOpen ? 'justify-center p-2.5' : 'px-3 py-2.5'
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
        <header className="h-[64px] flex items-center justify-between px-3 sm:px-5 lg:px-6 bg-white border-b border-[#e1e3e4] border-l-2 border-l-[#434fcf]/20 shrink-0 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2 -ml-1 rounded-lg hover:bg-[#f3f4f5] text-[#454654] transition-colors lg:hidden shrink-0" aria-label="打开导航菜单">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>

            <div className="flex flex-col justify-center min-w-0">
              <h2 className="text-[15px] font-bold text-[#191c1d] truncate leading-tight">{currentRouteName || '首页'}</h2>
              <span className="text-[11px] text-[#9a9bab] font-medium tabular-nums leading-tight">{currentTime}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">

            {/* WebSocket Connection Indicator */}
            <div
              className={`shrink-0 flex items-center gap-1.5 px-1.5 py-1 rounded-md ${
                connectionState === WS_STATE.OFFLINE ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
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
                className={`inline-block w-2 h-2 rounded-full transition-colors duration-300 ${
                  connectionState === WS_STATE.CONNECTED
                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.45)]'
                    : connectionState === WS_STATE.RECONNECTING
                    ? 'bg-amber-400 animate-breathe shadow-[0_0_6px_rgba(251,191,36,0.4)]'
                    : connectionState === WS_STATE.OFFLINE
                    ? 'bg-[#c8cad0]'
                    : 'bg-red-500 animate-soft-pulse shadow-[0_0_6px_rgba(239,68,68,0.4)]'
                }`}
              />
              <span className={`hidden lg:inline text-[12px] font-medium whitespace-nowrap ${
                connectionState === WS_STATE.CONNECTED
                  ? 'text-emerald-600'
                  : connectionState === WS_STATE.RECONNECTING
                  ? 'text-amber-500'
                  : connectionState === WS_STATE.OFFLINE
                  ? 'text-[#9a9bab]'
                  : 'text-red-500'
              }`}>
                {connectionState === WS_STATE.CONNECTED ? '已连接' : connectionState === WS_STATE.RECONNECTING ? '重连中' : connectionState === WS_STATE.OFFLINE ? '离线' : '已断开'}
              </span>
            </div>

            {/* ── 提示音铃铛 ── */}
            <div className="relative shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); setSoundEnabled(!soundEnabled); }}
                className={`w-[36px] h-[36px] flex items-center justify-center rounded-lg transition-all duration-200 relative ${soundEnabled ? 'bg-brand-50 text-brand-500 hover:bg-brand-100' : 'bg-[#f3f4f5] text-slate-400 hover:bg-[#e7e8e9]'}`}
                title={soundEnabled ? '提示音已开启' : '提示音已关闭'}
              >
                {soundEnabled ? (
                  <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                ) : (
                  <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                )}
              </button>
              <button onClick={(e) => { e.stopPropagation(); setShowSoundSettings(!showSoundSettings); }} className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-all shadow-sm border ${showSoundSettings ? 'bg-brand-500 border-brand-400 text-white' : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'}`} title="音色设置">
                <svg className="w-[9px] h-[9px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
              {showSoundSettings && (
                <SoundPopover
                  soundVolume={soundVolume} setSoundVolume={setSoundVolume}
                  soundType={soundType} soundTypes={soundTypes}
                  setSoundType={setSoundType} previewSound={previewSound}
                  onClose={() => setShowSoundSettings(false)}
                />
              )}
            </div>

            {/* User Avatar + Name + Logout */}
            <div className="flex items-center gap-1.5 hover:bg-[#f3f4f5] p-1 pr-1.5 rounded-xl cursor-pointer transition-colors shrink-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                style={{ background: 'linear-gradient(135deg, #2834b7, #434fcf)' }}
                title={`${userName} · ${currentRoleName}`}
              >
                {userInitials}
              </div>
              <div className="hidden lg:flex flex-col justify-center mr-1">
                <span className="text-[13px] font-semibold text-[#191c1d] leading-tight whitespace-nowrap">{userName}</span>
                <span className="text-[11px] text-[#9a9bab] leading-tight whitespace-nowrap">{currentRoleName}</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setShowLogoutConfirm(true); }} className="text-[#9a9bab] hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors shrink-0" title="退出登录" aria-label="退出登录">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H8a3 3 0 01-3-3V7a3 3 0 013-3h2a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-6 lg:p-10 scroll-smooth bg-surface">
          <Suspense fallback={
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: '12px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                border: '3px solid #E5E7EB', borderTopColor: '#434FCF',
                animation: 'spin 0.6s linear infinite',
              }} />
              <span style={{ color: '#94A3B8', fontSize: '13px', fontWeight: 500 }}>加载中...</span>
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
