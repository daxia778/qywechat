import { useState, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { listDesignerRoster, createDesigner } from '../api/orders';
import { fmtYuan } from '../utils/constants';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/ui/PageHeader';

const AVATAR_COLORS = [
  'linear-gradient(135deg,#434fcf,#7c3aed)',
  'linear-gradient(135deg,#059669,#10b981)',
  'linear-gradient(135deg,#d97706,#f59e0b)',
  'linear-gradient(135deg,#dc2626,#f87171)',
  'linear-gradient(135deg,#0891b2,#38bdf8)',
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
];
const getAvatarColor = (id) => {
  const idx = (id || 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
};

export default function DesignersRosterPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [designers, setDesigners] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState('total_orders');
  const [sortDir, setSortDir] = useState('desc');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', wechat_id: '', mobile: '', specialty: '' });
  const [expandedId, setExpandedId] = useState(null);

  const fetchRoster = useCallback(async () => {
    try {
      const res = await listDesignerRoster({ keyword: keyword.trim() });
      const data = res.data;
      setDesigners(data.designers || []);
      setSummary(data.summary || {});
    } catch (err) {
      toast('加载花名册失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [keyword, toast]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(fetchRoster, 300);
    return () => clearTimeout(timer);
  }, [fetchRoster]);

  const sorted = [...designers].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast('设计师名字不能为空', 'error'); return; }
    setCreating(true);
    try {
      await createDesigner(form);
      toast('设计师创建成功', 'success');
      setShowCreate(false);
      setForm({ name: '', wechat_id: '', mobile: '', specialty: '' });
      fetchRoster();
    } catch (err) {
      toast('创建失败: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setCreating(false);
    }
  };

  const avgCompletion = designers.length > 0
    ? (designers.reduce((s, d) => s + (d.completion_rate || 0), 0) / designers.length).toFixed(1) + '%'
    : '--';

  const totalOrders = designers.reduce((s, d) => s + (d.total_orders || 0), 0);

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      {/* Header */}
      <PageHeader title="设计师花名册" subtitle="管理兼职设计师信息，追踪接单与绩效数据">
        {(user?.role === 'admin' || user?.role === 'follow') && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            新建设计师
          </button>
        )}
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="设计师总数"
          value={summary.total_designers ?? 0}
          color="#434FCF"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
        <KpiCard
          label="本月活跃"
          value={summary.active_this_month ?? 0}
          color="#10B981"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
        />
        <KpiCard
          label="平均完成率"
          value={avgCompletion}
          color="#F59E0B"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
        />
        <KpiCard
          label="总订单量"
          value={totalOrders}
          color="#3B82F6"
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg>}
        />
      </div>

      {/* Table Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        {/* Table Header Bar */}
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] font-[Outfit]">设计师目录</h2>
          </div>
          <div className="relative w-64">
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索设计师名字..."
              className="w-full pl-9 pr-3 py-1.5 text-[13px] text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
          </div>
        </div>

        {/* Table Content */}
        <div className="w-full overflow-x-auto min-h-[300px] relative">
          {loading && <LoadingSpinner />}

          {!loading && sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              <p className="font-medium text-slate-600">暂无设计师数据</p>
              <p className="text-sm mt-0.5">点击右上角按钮新建设计师</p>
            </div>
          ) : (
            <table className="w-full" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '25%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="pl-6 text-left">设计师</th>
                  <SortHeader label="接单数" field="total_orders" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="进行中" field="designing_orders" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="退款率" field="refund_rate" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="累计金额" field="total_revenue" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="累计佣金" field="total_commission" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map(d => (
                  <DesignerRow
                    key={d.id}
                    d={d}
                    isExpanded={expandedId === d.id}
                    onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Designer Modal */}
      {showCreate && createPortal(
        <CreateDesignerModal
          form={form}
          setForm={setForm}
          creating={creating}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />,
        document.body
      )}
    </div>
  );
}

/* ── KPI Card ── */

function KpiCard({ icon, label, value, color }) {
  return (
    <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 flex items-center gap-4">
      <div
        className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
        style={{ background: `${color}15`, color }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</div>
        <div className="text-[22px] font-extrabold text-slate-900 tabular-nums font-[Outfit]">{value}</div>
      </div>
    </div>
  );
}

/* ── Sort Header ── */

const SortHeader = memo(function SortHeader({ label, field, sortKey, sortDir, onToggle }) {
  const isActive = sortKey === field;
  return (
    <th className="text-center">
      <button
        onClick={() => onToggle(field)}
        className="inline-flex items-center gap-0.5 hover:text-brand-500 transition-colors font-semibold text-inherit cursor-pointer select-none bg-transparent border-none p-0"
      >
        {label}
        <span className={`inline-flex flex-col ml-1 -mb-0.5 ${isActive ? 'text-brand-500' : 'text-slate-300'}`}>
          <svg className={`w-3 h-3 -mb-1 ${isActive && sortDir === 'asc' ? 'text-brand-500' : ''}`} viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 2L10 7H2L6 2Z" />
          </svg>
          <svg className={`w-3 h-3 ${isActive && sortDir === 'desc' ? 'text-brand-500' : ''}`} viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 10L2 5H10L6 10Z" />
          </svg>
        </span>
      </button>
    </th>
  );
});

/* ── Rate Bar ── */

function RateBar({ value, color }) {
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(value, 100)}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums min-w-[38px] text-right" style={{ color }}>
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

/* ── Designer Row ── */

const DesignerRow = memo(function DesignerRow({ d, isExpanded, onToggle }) {
  const refundColor = d.refund_rate > 15 ? '#EF4444' : '#F59E0B';

  return (
    <>
      <tr
        className={`group transition-colors cursor-pointer ${isExpanded ? 'bg-surface-container-low' : 'hover:bg-[#FAFBFC]'}`}
        onClick={onToggle}
      >
        {/* Designer name + avatar */}
        <td className="pl-6">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white text-sm font-extrabold shrink-0"
              style={{ background: getAvatarColor(d.id) }}
            >
              {d.name?.charAt(0) || '?'}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-slate-900 text-sm truncate">{d.name}</div>
              {d.wechat_id && <div className="text-[11px] text-slate-400 truncate">微信: {d.wechat_id}</div>}
            </div>
          </div>
        </td>

        {/* Total orders */}
        <td className="text-center font-extrabold text-slate-900 text-base font-[Outfit]">{d.total_orders}</td>

        {/* Designing orders */}
        <td className="text-center">
          {d.designing_orders > 0 ? (
            <span className="inline-flex items-center justify-center bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-0.5 rounded-full">{d.designing_orders}</span>
          ) : (
            <span className="text-slate-300">0</span>
          )}
        </td>

        {/* Refund rate */}
        <td>
          <RateBar value={d.refund_rate ?? 0} color={refundColor} />
        </td>

        {/* Revenue */}
        <td className="text-center font-bold text-slate-900 tabular-nums">{fmtYuan(d.total_revenue)}</td>

        {/* Commission */}
        <td className="text-center font-semibold text-brand-500 tabular-nums">{fmtYuan(d.total_commission)}</td>

        {/* Expand arrow */}
        <td className="text-center">
          <svg
            className={`w-4 h-4 text-slate-300 mx-auto transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr className="bg-surface-container-low">
          <td colSpan={7} className="px-0 py-0">
            <div className="px-8 py-4 border-t border-slate-100 animate-fade-in-up">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DetailItem
                  label="微信号"
                  value={d.wechat_id || '--'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>}
                />
                <DetailItem
                  label="手机号"
                  value={d.mobile || '--'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
                />
                <DetailItem
                  label="擅长方向"
                  value={d.specialty || '--'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>}
                />
                <DetailItem
                  label="完成率"
                  value={d.completion_rate != null ? d.completion_rate.toFixed(1) + '%' : '--'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

/* ── Detail Item ── */

const DetailItem = memo(function DetailItem({ label, value, icon }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-slate-400 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[12px] text-slate-400 font-medium mb-0.5">{label}</div>
        <div className="text-[13px] text-slate-700 break-all">{value}</div>
      </div>
    </div>
  );
});

/* ── Create Designer Modal (portaled to body) ── */

function CreateDesignerModal({ form, setForm, creating, onClose, onCreate }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-designer-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <h3 id="create-designer-title" className="text-lg font-bold text-slate-800 font-[Outfit]">新建设计师</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent p-1 -mr-1 rounded hover:bg-slate-200 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Form Body */}
        <div className="px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="名字" required>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="设计师名字"
                className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </FormField>
            <FormField label="微信号">
              <input
                type="text"
                value={form.wechat_id}
                onChange={e => setForm(f => ({ ...f, wechat_id: e.target.value }))}
                placeholder="选填"
                className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </FormField>
            <FormField label="手机号">
              <input
                type="text"
                value={form.mobile}
                onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))}
                placeholder="选填"
                className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </FormField>
            <FormField label="擅长方向">
              <input
                type="text"
                value={form.specialty}
                onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
                placeholder="如: PPT / 海报 / Logo"
                className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
              />
            </FormField>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm"
          >
            取消
          </button>
          <button
            onClick={onCreate}
            disabled={creating}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm disabled:opacity-60"
          >
            {creating && (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
            )}
            {creating ? '创建中...' : '确认创建'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Form Field ── */

function FormField({ label, required, children }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 mb-1.5">
        {label}
        {required && <span className="text-red-500">*</span>}
      </div>
      {children}
    </div>
  );
}
