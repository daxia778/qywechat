import { useState, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { listDesignerRoster, createDesigner } from '../api/orders';
import client from '../api/client';
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
  const [editingDesigner, setEditingDesigner] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', wechat_id: '', mobile: '', specialty: '' });
  const [saving, setSaving] = useState(false);

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

  const handleOpenEdit = (d) => {
    setEditingDesigner(d);
    setEditForm({ name: d.name || '', wechat_id: d.wechat_id || '', mobile: d.mobile || '', specialty: d.specialty || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingDesigner) return;
    if (!editForm.name.trim()) { toast('名字不能为空', 'error'); return; }
    setSaving(true);
    try {
      await client.put(`/orders/designers/${editingDesigner.id}`, editForm);
      toast('设计师信息已更新', 'success');
      setEditingDesigner(null);
      fetchRoster();
    } catch (err) {
      toast('更新失败: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setSaving(false);
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
                <col style={{ width: '30%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="pl-6 text-left">设计师</th>
                  <SortHeader label="接单数" field="total_orders" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="退款数" field="refund_orders" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
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
                    onEdit={() => handleOpenEdit(d)}
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

      {/* Edit Designer Modal */}
      {editingDesigner && createPortal(
        <EditDesignerModal
          form={editForm}
          setForm={setEditForm}
          saving={saving}
          onClose={() => setEditingDesigner(null)}
          onSave={handleSaveEdit}
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

/* ── Designer Row ── */

const DesignerRow = memo(function DesignerRow({ d, onEdit }) {
  return (
    <tr className="group transition-colors hover:bg-[#FAFBFC]">
      {/* Designer name + avatar + contact */}
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
            <div className="text-[11px] text-slate-400 truncate">
              {d.wechat_id ? `微信: ${d.wechat_id}` : d.mobile ? `手机: ${d.mobile}` : '--'}
            </div>
          </div>
        </div>
      </td>

      {/* Total orders */}
      <td className="text-center font-extrabold text-slate-900 text-base font-[Outfit]">{d.total_orders}</td>

      {/* Refund orders (count) */}
      <td className="text-center">
        {(d.refund_orders ?? 0) > 0 ? (
          <span className="inline-flex items-center justify-center bg-red-50 text-red-600 text-xs font-bold px-2.5 py-0.5 rounded-full">{d.refund_orders}</span>
        ) : (
          <span className="text-slate-300">0</span>
        )}
      </td>

      {/* Revenue */}
      <td className="text-center font-bold text-slate-900 tabular-nums">{fmtYuan(d.total_revenue)}</td>

      {/* Commission */}
      <td className="text-center font-semibold text-brand-500 tabular-nums">{fmtYuan(d.total_commission)}</td>

      {/* Edit button */}
      <td className="text-center">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-50 transition-all duration-150 bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-100"
          title="编辑"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        </button>
      </td>
    </tr>
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

/* ── Edit Designer Modal ── */

function EditDesignerModal({ form, setForm, saving, onClose, onSave }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-designer-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <h3 id="edit-designer-title" className="text-lg font-bold text-slate-800 font-[Outfit]">编辑设计师</h3>
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
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm disabled:opacity-60"
          >
            {saving && (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
            )}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
