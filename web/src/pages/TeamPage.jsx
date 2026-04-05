import { useState, useCallback, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { usePolling } from '../hooks/usePolling';
import { getTeamRoster } from '../api/admin';
import { fmtYuan } from '../utils/constants';
import { cn } from '../utils/cn';
import PageHeader from '../components/ui/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';

const ROLE_LABEL = { sales: '谈单客服', follow: '跟单客服' };

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#434fcf,#6366f1)',
  'linear-gradient(135deg,#ec4899,#f43f5e)',
  'linear-gradient(135deg,#10b981,#14b8a6)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#3b82f6,#6366f1)',
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
];

function getAvatarGradient(name) {
  const code = [...(name || '')].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[code % AVATAR_GRADIENTS.length];
}

export default function TeamPage() {
  const { toast } = useToast();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState('month_orders');
  const [sortDir, setSortDir] = useState('desc');
  const [roleFilter, setRoleFilter] = useState('all');

  const fetchData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await getTeamRoster();
      setStaff(res.data.data || []);
      if (manual) toast('绩效数据已刷新', 'success');
    } catch (err) {
      if (manual) toast('加载失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);
  usePolling(fetchData, 30000);

  const filtered = staff.filter(s => roleFilter === 'all' || s.role === roleFilter);
  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // KPI
  const totalStaff = staff.length;
  const onlineCount = staff.filter(s => s.is_online).length;
  const totalMonthOrders = staff.reduce((s, m) => s + (m.month_orders || 0), 0);
  const totalMonthRevenue = staff.reduce((s, m) => s + (m.month_revenue || 0), 0);

  const roleFilters = [
    { key: 'all', label: '全部' },
    { key: 'sales', label: '谈单客服' },
    { key: 'follow', label: '跟单客服' },
  ];

  return (
    <div className="px-6 py-7 max-w-[1200px] mx-auto space-y-6">
      {/* Header */}
      <PageHeader title="客服绩效" subtitle="谈单 & 跟单客服业绩数据追踪">
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl border-2 cursor-pointer transition-all',
            'text-brand-500 bg-brand-50 border-brand-100 hover:bg-brand-100',
            refreshing && 'opacity-60 pointer-events-none'
          )}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={cn('w-4 h-4', refreshing && 'animate-spin')}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.182-3.182" />
          </svg>
          {refreshing ? '刷新中...' : '刷新数据'}
        </button>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="客服总数"
          value={totalStaff}
          iconBg="bg-indigo-50"
          iconColor="text-brand-500"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          }
        />
        <KpiCard
          label="当前在线"
          value={onlineCount}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-500"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          }
        />
        <KpiCard
          label="本月订单"
          value={totalMonthOrders}
          iconBg="bg-amber-50"
          iconColor="text-amber-500"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          }
        />
        <KpiCard
          label="本月营收"
          value={`¥${fmtYuan(totalMonthRevenue)}`}
          iconBg="bg-red-50"
          iconColor="text-red-500"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Role Filter Tabs */}
      <div className="flex gap-2">
        {roleFilters.map(t => (
          <button
            key={t.key}
            onClick={() => setRoleFilter(t.key)}
            className={cn(
              'px-4 py-1.5 text-[13px] font-semibold rounded-lg border-[1.5px] cursor-pointer transition-all',
              roleFilter === t.key
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-surface-container-lowest ghost-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table style={{ tableLayout: 'fixed' }} className="w-full text-[13px]">
              <colgroup>
                <col style={{ width: '20%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-100">
                  <th className="text-left pl-5 pr-3">客服</th>
                  <th>角色</th>
                  <th>状态</th>
                  <SortTh label="总订单" field="total_orders" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="进行中" field="designing_orders" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="已完成" field="completed_orders" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="退款率" field="refund_rate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="本月单量" field="month_orders" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="本月营收" field="month_revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="累计佣金" field="total_commission" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m, idx) => (
                  <StaffRow key={m.id} member={m} isLast={idx === sorted.length - 1} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* -- Sub Components -- */

function KpiCard({ icon, label, value, iconBg, iconColor }) {
  return (
    <div className="bg-surface-container-lowest ghost-border rounded-2xl p-5 flex items-center gap-4">
      <div className={cn('w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0', iconBg, iconColor)}>
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
        <div className="text-[22px] font-extrabold text-slate-800 tabular-nums font-[Outfit] leading-tight">{value}</div>
      </div>
    </div>
  );
}

function SortTh({ label, field, sortKey, sortDir, onSort }) {
  const active = sortKey === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="text-center cursor-pointer select-none group"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"
          className={cn('w-3 h-3 transition-colors', active ? 'text-brand-500' : 'text-slate-300 group-hover:text-slate-400')}
        >
          {active && sortDir === 'asc' ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          ) : active && sortDir === 'desc' ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
          )}
        </svg>
      </span>
    </th>
  );
}

function StaffRow({ member: m, isLast }) {
  const isSales = m.role === 'sales';
  return (
    <tr className={cn(
      'transition-colors duration-100 hover:bg-slate-50/80',
      !isLast && 'border-b border-slate-100'
    )}>
      {/* Name + Avatar */}
      <td className="pl-5 pr-3 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white text-sm font-extrabold"
              style={{ background: getAvatarGradient(m.name) }}
            >
              {(m.name || '?').charAt(0)}
            </div>
            <span className={cn(
              'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white',
              m.is_online ? 'bg-emerald-400' : 'bg-slate-300'
            )} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">{m.name}</div>
            <div className="text-[11px] text-slate-400 truncate">{m.username}</div>
          </div>
        </div>
      </td>

      {/* Role Badge */}
      <td className="text-center py-3.5">
        <span className={cn(
          'text-[11px] font-bold px-2.5 py-0.5 rounded-full border inline-block',
          isSales
            ? 'bg-blue-50 text-blue-700 border-blue-200'
            : 'bg-violet-50 text-violet-600 border-violet-200'
        )}>
          {ROLE_LABEL[m.role] || m.role}
        </span>
      </td>

      {/* Online Status */}
      <td className="text-center py-3.5">
        <span className={cn(
          'inline-flex items-center gap-1 text-xs font-semibold',
          m.is_online ? 'text-emerald-600' : 'text-slate-400'
        )}>
          <span className={cn(
            'w-1.5 h-1.5 rounded-full',
            m.is_online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-slate-300'
          )} />
          {m.is_online ? '在线' : '离线'}
        </span>
      </td>

      {/* Total Orders */}
      <td className="text-center py-3.5 text-base font-extrabold text-slate-800">{m.total_orders}</td>

      {/* Designing */}
      <td className="text-center py-3.5">
        {m.designing_orders > 0 ? (
          <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-0.5 rounded-full">{m.designing_orders}</span>
        ) : (
          <span className="text-slate-300">0</span>
        )}
      </td>

      {/* Completed */}
      <td className="text-center py-3.5 text-emerald-600 font-semibold">{m.completed_orders}</td>

      {/* Refund Rate */}
      <td className="text-center py-3.5 px-3">
        <RefundBar value={m.refund_rate || 0} />
      </td>

      {/* Month Orders */}
      <td className="text-center py-3.5 font-bold text-slate-800">{m.month_orders}</td>

      {/* Month Revenue */}
      <td className="text-center py-3.5 font-bold text-slate-800 tabular-nums">
        ¥{fmtYuan(m.month_revenue)}
      </td>

      {/* Commission */}
      <td className="text-center py-3.5 font-semibold text-violet-600 tabular-nums">
        ¥{fmtYuan(m.total_commission)}
      </td>
    </tr>
  );
}

function RefundBar({ value }) {
  const isWarn = value > 15;
  const barColor = isWarn ? 'bg-red-400' : 'bg-amber-400';
  const textColor = isWarn ? 'text-red-500' : 'text-amber-500';

  return (
    <div className="flex items-center gap-1.5 min-w-[72px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', barColor)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className={cn('text-xs font-bold min-w-[38px] text-right inline-flex items-center justify-end gap-0.5', textColor)}>
        {isWarn && (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        )}
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-slate-300">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">暂无客服数据</h3>
      <p className="text-sm text-slate-400">当前没有谈单或跟单客服的绩效记录</p>
    </div>
  );
}
