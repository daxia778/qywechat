import { createElement } from 'react';

export const STATUS_MAP = {
  PENDING: '待处理',
  GROUP_CREATED: '待处理',
  CONFIRMED: '待处理',
  DESIGNING: '进行中',
  REVISION: '进行中',
  AFTER_SALE: '进行中',
  DELIVERED: '进行中',
  COMPLETED: '已完成',
  REFUNDED: '已退款',
  CLOSED: '已退款',
};

export const STATUS_BADGE_MAP = {
  PENDING: 'warning',
  GROUP_CREATED: 'warning',
  CONFIRMED: 'warning',
  DESIGNING: 'primary',
  REVISION: 'primary',
  AFTER_SALE: 'primary',
  DELIVERED: 'primary',
  COMPLETED: 'success',
  REFUNDED: 'danger',
  CLOSED: 'danger',
};

export const ROLE_MAP = {
  admin: '系统管理员',
  sales: '谈单客服',
  follow: '跟单客服',
};

export const ROLE_CLASS_MAP = {
  sales: 'primary',
  follow: 'primary',
  admin: 'warning',
};

export const ROLE_AVATAR_CLASS_MAP = {
  sales: 'bg-[#434FCF]',
  follow: 'bg-[#2563EB]',
  admin: 'bg-[#FF6B2C]',
};

export const BADGE_VARIANT_CLASSES = {
  success: 'border bg-success-bg text-green-800 border-green-200',
  warning: 'border bg-warning-bg text-amber-800 border-amber-200',
  danger: 'border bg-danger-bg text-red-800 border-red-200',
  primary: 'border bg-brand-50 text-brand-500 border-brand-200',
  secondary: 'border bg-slate-50 text-slate-600 border-slate-200',
};

const svgProps = { xmlns: 'http://www.w3.org/2000/svg', fill: 'none', viewBox: '0 0 24 24', strokeWidth: 2, stroke: 'currentColor', className: 'w-5 h-5' };
const pathProps = { strokeLinecap: 'round', strokeLinejoin: 'round' };

function NavIcon({ d }) {
  return createElement('svg', svgProps, createElement('path', { ...pathProps, d }));
}

export const NAV_ROUTES = [
  {
    path: '/dashboard',
    title: '仪表盘',
    roles: ['admin', 'follow', 'sales'],
    icon: NavIcon({ d: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' }),
  },
  {
    path: '/orders',
    title: '订单大厅',
    roles: ['admin', 'follow', 'sales'],
    icon: NavIcon({ d: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z' }),
  },
  {
    path: '/payments',
    title: '收款流水',
    roles: ['admin', 'follow', 'sales'],
    icon: NavIcon({ d: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z' }),
  },
  {
    path: '/customers',
    title: '顾客管理',
    roles: ['admin', 'follow', 'sales'],
    icon: NavIcon({ d: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z' }),
  },
  {
    path: '/team',
    title: '客服绩效',
    roles: ['admin'],
    icon: NavIcon({ d: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z' }),
  },
  {
    path: '/employees',
    title: '员工管理',
    roles: ['admin'],
    icon: NavIcon({ d: 'M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm-1.875 6.75a4.5 4.5 0 00-4.125 2.694v.006h8.25v-.006a4.5 4.5 0 00-4.125-2.694z' }),
  },
  {
    path: '/revenue',
    title: '营收图表',
    roles: ['admin'],
    icon: NavIcon({ d: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' }),
  },
  {
    path: '/designers',
    title: '设计师花名册',
    roles: ['admin', 'follow', 'sales'],
    icon: NavIcon({ d: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' }),
  },
  // [隐藏] 联系我管理 — 后续根据业务需求再上线测试
  // {
  //   path: '/contact-ways',
  //   title: '联系我管理',
  //   roles: ['admin'],
  //   icon: NavIcon({ d: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z' }),
  // },
  {
    path: '/welcome-templates',
    title: '欢迎语模板',
    roles: ['admin'],
    icon: NavIcon({ d: 'M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z' }),
  },
];

export const ORDER_STATUSES = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待处理' },
  { value: 'DESIGNING', label: '设计中' },
  { value: 'REVISION', label: '修改中' },
  { value: 'AFTER_SALE', label: '售后中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REFUNDED', label: '已退款' },
];

export const STATUS_COLORS = {
  PENDING:       { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', dot: '#F59E0B' },
  GROUP_CREATED: { bg: '#EDE9FE', text: '#5B21B6', border: '#DDD6FE', dot: '#8B5CF6' },
  CONFIRMED:     { bg: '#E0E7FF', text: '#3730A3', border: '#C7D2FE', dot: '#6366F1' },
  DESIGNING:     { bg: '#DBEAFE', text: '#1E40AF', border: '#BFDBFE', dot: '#3B82F6' },
  DELIVERED:     { bg: '#D1FAE5', text: '#065F46', border: '#A7F3D0', dot: '#10B981' },
  REVISION:      { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', dot: '#F59E0B' },
  AFTER_SALE:    { bg: '#FEE2E2', text: '#991B1B', border: '#FECACA', dot: '#EF4444' },
  COMPLETED:     { bg: '#D1FAE5', text: '#065F46', border: '#A7F3D0', dot: '#059669' },
  REFUNDED:      { bg: '#FEE2E2', text: '#991B1B', border: '#FECACA', dot: '#DC2626' },
  CLOSED:        { bg: '#F1F5F9', text: '#475569', border: '#E2E8F0', dot: '#94A3B8' },
}

// 流水线节点（员工工作台顶部进度条用，v2.0 简化: 3+1）
export const PIPELINE_STAGES = [
  { key: 'pending',   status: ['PENDING'],    label: '待处理', icon: '📥', color: '#F59E0B' },
  { key: 'designing', status: ['DESIGNING'],   label: '设计中', icon: '🎨', color: '#3B82F6' },
  { key: 'completed', status: ['COMPLETED'],   label: '已完成', icon: '✅', color: '#10B981' },
]

// 订单列表 Tab（我的订单页用，进行中合并 3 个状态）
export const ORDER_TABS = [
  { key: '',                              label: '全部' },
  { key: 'PENDING',                       label: '待处理' },
  { key: 'DESIGNING,REVISION,AFTER_SALE', label: '进行中' },
  { key: 'COMPLETED',                     label: '已完成' },
  { key: 'REFUNDED',                      label: '已退款' },
]

export const ROLE_LABELS = {
  sales: '谈单客服',
  follow: '跟单客服',
  admin: '系统管理员',
}

/** 分 → 元格式化 */
export const fmtYuan = (fen) => {
  const yuan = (fen || 0) / 100
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 时间格式化 */
export const formatTime = (t) => {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
