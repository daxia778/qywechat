import { createElement } from 'react';

export const STATUS_MAP = {
  PENDING: '待处理',
  GROUP_CREATED: '已建群',
  CONFIRMED: '已确认',
  DESIGNING: '设计中',
  DELIVERED: '已交付',
  COMPLETED: '已完成',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

export const STATUS_BADGE_MAP = {
  PENDING: 'warning',
  GROUP_CREATED: 'primary',
  CONFIRMED: 'primary',
  DESIGNING: 'primary',
  DELIVERED: 'success',
  COMPLETED: 'success',
  REFUNDED: 'danger',
  CLOSED: 'secondary',
};

export const ROLE_MAP = {
  admin: '系统管理员',
  sales: '谈单客服',
  follow: '跟单客服',
  designer: '设计师',
  operator: '客服管家', // 兼容旧数据
};

export const ROLE_CLASS_MAP = {
  sales: 'primary',
  follow: 'primary',
  designer: 'secondary',
  admin: 'warning',
  operator: 'primary', // 兼容旧数据
};

export const ROLE_AVATAR_CLASS_MAP = {
  sales: 'bg-[#434FCF]',
  follow: 'bg-[#2563EB]',
  designer: 'bg-[#8B5CF6]',
  admin: 'bg-[#FF6B2C]',
  operator: 'bg-[#434FCF]', // 兼容旧数据
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
    path: '/',
    title: '仪表盘',
    roles: ['admin', 'follow', 'sales', 'designer'],
    icon: NavIcon({ d: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' }),
  },
  {
    path: '/orders',
    title: '订单管理',
    roles: ['admin', 'follow', 'sales', 'designer'],
    icon: NavIcon({ d: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z' }),
  },
  {
    path: '/payments',
    title: '收款流水',
    roles: ['admin', 'follow', 'sales', 'designer'],
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
    title: '团队负载',
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
];

export const ORDER_STATUSES = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待处理' },
  { value: 'GROUP_CREATED', label: '已建群' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'DESIGNING', label: '设计中' },
  { value: 'DELIVERED', label: '已交付' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REFUNDED', label: '已退款' },
  { value: 'CLOSED', label: '已关闭' },
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

// 流水线节点（员工工作台顶部进度条用）
export const PIPELINE_STAGES = [
  { key: 'pending',   status: ['PENDING', 'GROUP_CREATED', 'CONFIRMED'], label: '待处理', icon: '📥', color: '#F59E0B' },
  { key: 'designing', status: ['DESIGNING'],                             label: '设计中', icon: '🎨', color: '#3B82F6' },
  { key: 'delivered', status: ['DELIVERED'],                              label: '已交付', icon: '📦', color: '#8B5CF6' },
  { key: 'completed', status: ['COMPLETED'],                             label: '已完成', icon: '✅', color: '#10B981' },
]

// 订单列表 Tab（我的订单页用）
export const ORDER_TABS = [
  { key: '',          label: '全部' },
  { key: 'PENDING',   label: '待处理' },
  { key: 'DESIGNING', label: '设计中' },
  { key: 'DELIVERED', label: '已交付' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'REVISION',  label: '修改中' },
  { key: 'AFTER_SALE',label: '售后' },
]

export const ROLE_LABELS = {
  designer: '设计师',
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
