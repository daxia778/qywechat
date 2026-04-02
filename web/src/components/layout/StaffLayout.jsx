import { useState, useEffect, useCallback, Suspense } from 'react'
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { ROLE_LABELS } from '../../utils/constants'

const NAV_ITEMS = [
  {
    path: '/s/dashboard',
    title: '工作台',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    path: '/s/orders',
    title: '订单管理',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
]

export default function StaffLayout() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [currentTime, setCurrentTime] = useState('')

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '员工'
  const userInitials = (user?.name || '员工').substring(0, 2)

  const currentRouteName = NAV_ITEMS.find(
    (r) => r.path === location.pathname || location.pathname.startsWith(r.path)
  )?.title || '工作台'

  // Clock
  useEffect(() => {
    const update = () => {
      setCurrentTime(
        new Date().toLocaleString('zh-CN', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      )
    }
    update()
    const id = setInterval(update, 60000)
    return () => clearInterval(id)
  }, [])

  // Responsive collapse
  useEffect(() => {
    const handler = () => {
      if (window.innerWidth < 1024) {
        setCollapsed(true)
        setMobileOpen(false)
      } else {
        setCollapsed(false)
      }
    }
    handler()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const doLogout = async () => {
    setShowLogoutConfirm(false)
    await logout()
    toast('已退出登录', 'success')
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8f9fa] font-sans text-[#1C1C28]">
      {/* Logout Confirm */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowLogoutConfirm(false)} />
          <div className="relative bg-white rounded-2xl border-2 border-slate-200 w-full max-w-sm overflow-hidden animate-fade-in-up">
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="text-lg font-bold text-slate-800">退出登录</h3>
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

      {/* ── Sidebar ── */}
      <aside
        className={`flex flex-col shrink-0 text-white z-50 transition-all duration-300 ease-in-out ${
          collapsed ? 'w-[72px]' : 'w-[260px]'
        } ${mobileOpen ? 'fixed inset-y-0 left-0 w-[260px] shadow-2xl' : 'hidden lg:flex'}`}
        style={{ background: 'linear-gradient(160deg, #2834b7 0%, #434fcf 100%)' }}
      >
        {/* Logo */}
        <div className={`flex items-center shrink-0 h-[64px] border-b border-white/[0.12] ${collapsed && !mobileOpen ? 'px-3 justify-center' : 'px-5 gap-2.5'}`}>
          <div className="w-9 h-9 shrink-0 rounded-xl bg-white/15 flex items-center justify-center text-white backdrop-blur-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          </div>
          {(!collapsed || mobileOpen) && (
            <div className="flex flex-col justify-center">
              <h1 className="text-[18px] font-bold text-white tracking-tight leading-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>智序系统</h1>
              <p className="text-[10px] text-white/60 font-normal tracking-[0.04em]">Staff Portal</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3 scrollbar-hide">
          <nav className="px-3 space-y-0.5">
            {(!collapsed || mobileOpen) && (
              <p className="px-3 mb-2 mt-2 text-[10px] font-semibold text-white/40 uppercase tracking-[0.12em]">菜单</p>
            )}
            {NAV_ITEMS.map((route) => {
              const isActive = location.pathname === route.path || (route.path !== '/' && location.pathname.startsWith(route.path))
              return (
                <NavLink
                  key={route.path}
                  to={route.path}
                  onClick={() => setMobileOpen(false)}
                  title={collapsed && !mobileOpen ? route.title : ''}
                  className={`flex items-center gap-3 no-underline transition-all duration-200 ease-in-out group rounded-lg relative ${
                    collapsed && !mobileOpen ? 'justify-center p-3 mx-0' : 'px-3 py-2.5 mx-0'
                  } ${
                    isActive
                      ? 'bg-white/[0.18] text-white font-semibold'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <div className={`shrink-0 flex items-center w-5 h-5 transition-colors duration-200 ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white'}`}>
                    {route.icon}
                  </div>
                  {(!collapsed || mobileOpen) && (
                    <span className="text-[14px] font-medium">{route.title}</span>
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="px-3 py-3 border-t border-white/[0.12]">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center gap-3 rounded-lg transition-all duration-200 hover:bg-white/10 text-white/50 hover:text-white ${
              collapsed && !mobileOpen ? 'justify-center p-2.5' : 'px-3 py-2.5'
            }`}
          >
            <svg className={`w-4 h-4 shrink-0 transition-transform duration-300 ${collapsed && !mobileOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
            {(!collapsed || mobileOpen) && (
              <span className="text-[13px] font-medium">收起菜单</span>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <header className="h-[64px] flex items-center justify-between px-3 sm:px-5 lg:px-6 bg-white border-b border-[#e1e3e4] border-l-2 border-l-[#434fcf]/20 shrink-0 sticky top-0 z-40">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2 -ml-1 rounded-lg hover:bg-[#f3f4f5] text-[#454654] transition-colors lg:hidden shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="flex flex-col justify-center min-w-0">
              <h2 className="text-[15px] font-bold text-[#191c1d] truncate leading-tight">{currentRouteName}</h2>
              <span className="text-[11px] text-[#9a9bab] font-medium tabular-nums leading-tight">{currentTime}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* User Avatar + Name + Logout */}
            <div className="flex items-center gap-1.5 hover:bg-[#f3f4f5] p-1 pr-1.5 rounded-xl cursor-pointer transition-colors shrink-0">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                style={{ background: 'linear-gradient(135deg, #2834b7, #434fcf)' }}
                title={`${user?.name} · ${roleLabel}`}
              >
                {userInitials}
              </div>
              <div className="hidden lg:flex flex-col justify-center mr-1">
                <span className="text-[13px] font-semibold text-[#191c1d] leading-tight whitespace-nowrap">{user?.name || '员工'}</span>
                <span className="text-[11px] text-[#9a9bab] leading-tight whitespace-nowrap">{roleLabel}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setShowLogoutConfirm(true) }}
                className="text-[#9a9bab] hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                title="退出登录"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H8a3 3 0 01-3-3V7a3 3 0 013-3h2a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-6 lg:p-10 scroll-smooth bg-[#f8f9fa]">
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
  )
}
