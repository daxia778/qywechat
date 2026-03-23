import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useDebounce } from '../hooks/useDebounce';
import { listPayments, createPayment, matchPayment, getPaymentSummary, syncWecom } from '../api/payments';
import { formatTime, formatCurrency } from '../utils/formatters';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/ui/PageHeader';
import { useAuth } from '../hooks/useAuth';

const SOURCE_MAP = {
  pdd: '拼多多',
  wecom: '企业微信',
  manual: '人工录入',
};

const SOURCE_STYLE = {
  pdd: 'bg-red-50 text-red-600 border-red-200',
  wecom: 'bg-blue-50 text-blue-600 border-blue-200',
  manual: 'bg-amber-50 text-amber-600 border-amber-200',
};

export default function PaymentsPage() {
  const { toast } = useToast();
  const { role } = useAuth();
  
  // URL Params
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Data State
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState({ total_amount: 0, by_source: {} });
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const pageSize = 20;

  // Filter State
  const [filterOrderId, setFilterOrderId] = useState(searchParams.get('order_id') || '');
  const [filterSource, setFilterSource] = useState(searchParams.get('source') || '');
  const [filterStartTime, setFilterStartTime] = useState(searchParams.get('start_time') || '');
  const [filterEndTime, setFilterEndTime] = useState(searchParams.get('end_time') || '');
  
  const debouncedOrderId = useDebounce(filterOrderId, 500);

  // Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [form, setForm] = useState({ order_id: '', amount: '', source: 'manual', remark: '', paid_at: '' });
  const [matchOrderId, setMatchOrderId] = useState('');

  const fetchSummary = useCallback(async () => {
    if (role !== 'admin') return; // Only admin can fetch summary
    setSummaryLoading(true);
    try {
      const res = await getPaymentSummary();
      setSummary(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setSummaryLoading(false);
    }
  }, [role]);

  const fetchPayments = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const params = {
        page: currentPage + 1,
        page_size: pageSize,
      };
      if (debouncedOrderId) params.order_id = debouncedOrderId;
      if (filterSource) params.source = filterSource;
      if (filterStartTime) params.start_time = filterStartTime;
      if (filterEndTime) params.end_time = filterEndTime;
      
      const res = await listPayments(params);
      setPayments(res.data.data || []);
      setTotal(res.data.total || 0);
      if (manual) toast('收款流水已刷新', 'success');
    } catch (err) {
      if (manual) toast('获取报错: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedOrderId, filterSource, filterStartTime, filterEndTime, toast]);

  useEffect(() => {
    fetchPayments();
    fetchSummary();
  }, [fetchPayments, fetchSummary]);

  // Update URL params
  useEffect(() => {
    const params = {};
    if (debouncedOrderId) params.order_id = debouncedOrderId;
    if (filterSource) params.source = filterSource;
    if (filterStartTime) params.start_time = filterStartTime;
    if (filterEndTime) params.end_time = filterEndTime;
    setSearchParams(params, { replace: true });
    setCurrentPage(0); // Reset page on filter change
  }, [debouncedOrderId, filterSource, filterStartTime, filterEndTime, setSearchParams]);

  const handleSyncWecom = async () => {
    setSyncing(true);
    try {
      await syncWecom();
      toast('企微收款同步成功', 'success');
      fetchPayments(true);
      fetchSummary();
    } catch (err) {
      toast('企微同步失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.order_id || !form.amount) {
      return toast('请填写关联订单ID和金额', 'error');
    }
    setSubmitting(true);
    try {
      const amountInCents = Math.round(parseFloat(form.amount) * 100);
      const data = {
        order_id: parseInt(form.order_id, 10),
        amount: amountInCents,
        source: form.source,
        remark: form.remark,
        paid_at: form.paid_at ? form.paid_at.replace('T', ' ') : '',
      };
      await createPayment(data);
      toast('收款录入成功', 'success');
      setCreateModalVisible(false);
      setForm({ order_id: '', amount: '', source: 'manual', remark: '', paid_at: '' });
      fetchPayments();
      fetchSummary();
    } catch (err) {
      toast('录入失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMatchSubmit = async (e) => {
    e.preventDefault();
    if (!matchOrderId || !selectedPayment) return;
    setSubmitting(true);
    try {
      await matchPayment(selectedPayment.id, { order_id: parseInt(matchOrderId, 10) });
      toast('流水关联成功', 'success');
      setMatchModalVisible(false);
      setSelectedPayment(null);
      setMatchOrderId('');
      fetchPayments();
    } catch (err) {
      toast('关联失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openMatchModal = (payment) => {
    setSelectedPayment(payment);
    setMatchOrderId('');
    setMatchModalVisible(true);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <PageHeader title="收款流水" subtitle="系统自动同步企微及跨平台对账单">
        <div className="flex items-center gap-2">
          {role === 'admin' && (
            <button
              onClick={handleSyncWecom}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-brand-600 bg-brand-50 border border-brand-200 hover:bg-brand-100 transition-all duration-150 shadow-sm disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              <span>{syncing ? '同步中...' : '同步企微流水'}</span>
            </button>
          )}
          {(role === 'admin' || role === 'follow') && (
            <button
              onClick={() => setCreateModalVisible(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 shadow-sm active:scale-[0.98]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
              <span>手动录入</span>
            </button>
          )}
        </div>
      </PageHeader>

      {/* KPI Cards for Admin */}
      {role === 'admin' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center">
            <span className="text-xs lg:text-[13px] font-medium text-slate-500 mb-1 block">历史总收款 (元)</span>
            {summaryLoading && !summary.total_amount ? (
               <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
            ) : (
              <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{(summary.total_amount / 100).toFixed(2)}
              </h4>
            )}
          </div>
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-4 border-l-red-500">
             <span className="text-xs lg:text-[13px] font-medium text-slate-500 mb-1 block">拼多多来源 (元)</span>
             <h4 className="text-2xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{((summary.by_source?.pdd?.total || 0) / 100).toFixed(2)}
             </h4>
          </div>
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-4 border-l-blue-500">
             <span className="text-xs lg:text-[13px] font-medium text-slate-500 mb-1 block">企微来源 (元)</span>
             <h4 className="text-2xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{((summary.by_source?.wecom?.total || 0) / 100).toFixed(2)}
             </h4>
          </div>
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-4 border-l-amber-500">
             <span className="text-xs lg:text-[13px] font-medium text-slate-500 mb-1 block">人工录入 (元)</span>
             <h4 className="text-2xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{((summary.by_source?.manual?.total || 0) / 100).toFixed(2)}
             </h4>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px] relative">
            <input
              type="text"
              placeholder="搜索订单 ID..."
              value={filterOrderId}
              onChange={(e) => setFilterOrderId(e.target.value)}
              className="w-full px-4 py-1.5 pl-9 text-[13px] text-slate-800 bg-slate-50/50 border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-400"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <div className="w-[140px]">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            >
              <option value="">所有来源</option>
              <option value="pdd">拼多多</option>
              <option value="wecom">企业微信</option>
              <option value="manual">人工录入</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterStartTime}
              onChange={(e) => setFilterStartTime(e.target.value)}
              className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500"
            />
            <span className="text-slate-400 text-sm">-</span>
            <input
              type="date"
              value={filterEndTime}
              onChange={(e) => setFilterEndTime(e.target.value)}
              className="px-3 py-1.5 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500"
            />
          </div>
          <button
            onClick={() => {
              setFilterOrderId('');
              setFilterSource('');
              setFilterStartTime('');
              setFilterEndTime('');
            }}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            重置
          </button>
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto relative min-h-[400px]">
          {loading && payments.length === 0 && <LoadingSpinner />}
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-6 py-3.5 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">流水号 / 交易时间</th>
                <th className="text-left px-6 py-3.5 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">来源</th>
                <th className="text-right px-6 py-3.5 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">收款金额</th>
                <th className="text-left px-6 py-3.5 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">关联订单</th>
                <th className="text-left px-6 py-3.5 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">备注</th>
                <th className="text-right px-6 py-3.5 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">匹配时间 / 操作</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <p className="font-medium text-slate-600">暂无收款记录</p>
                    </div>
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors group">
                  <td className="px-6 py-3.5">
                    <div className="text-[13px] font-medium text-slate-700 font-mono" title={p.transaction_id}>
                      {p.transaction_id.length > 20 ? p.transaction_id.substring(0, 20) + '...' : p.transaction_id}
                    </div>
                    <div className="text-[12px] text-slate-400 mt-1 tabular-nums">{formatTime(p.paid_at)}</div>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${SOURCE_STYLE[p.source] || SOURCE_STYLE.manual}`}>
                      {SOURCE_MAP[p.source] || p.source}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <span className="text-[14px] font-bold text-slate-800 tabular-nums">
                      &yen;{formatCurrency(p.amount / 100)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    {p.order_id ? (
                      <div>
                        <span className="text-[13px] font-bold text-brand-600">ID: {p.order_id}</span>
                        {p.customer_id > 0 && (
                          <div className="text-[11px] text-slate-400 mt-1">顾客: {p.customer_id}</div>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-md border border-red-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                        未关联
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 max-w-[200px] truncate" title={p.remark}>
                    <span className="text-[12px] text-slate-600">{p.remark || '-'}</span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    {p.order_id ? (
                      <div className="text-[12px] text-slate-500 tabular-nums">
                        {p.matched_at ? formatTime(p.matched_at) : '已匹配'}
                      </div>
                    ) : (
                      <button
                        onClick={() => openMatchModal(p)}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-[12px] font-semibold text-brand-600 bg-brand-50 border border-brand-200 rounded-lg hover:bg-brand-100 transition-colors shadow-sm cursor-pointer"
                      >
                        手动关联
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-surface-container-low px-6 py-3 border-t border-slate-200 flex justify-between items-center">
          <span className="text-[13px] text-slate-500">共 <span className="font-bold text-slate-700">{total}</span> 条记录</span>
          <div className="flex items-center gap-1.5">
            <button
               onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
               disabled={currentPage === 0}
               className={`px-3 py-1 text-sm font-semibold rounded-xl border border-slate-200 shadow-sm transition-all duration-150 text-[12px] ${currentPage === 0 ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-50' : 'bg-white text-slate-700 hover:bg-slate-50 cursor-pointer active:scale-[0.98]'}`}
            >上一页</button>
            <span className="text-[13px] text-slate-500 px-3">{currentPage + 1} / {totalPages}</span>
            <button
               onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
               disabled={currentPage >= totalPages - 1}
               className={`px-3 py-1 text-sm font-semibold rounded-xl border border-slate-200 shadow-sm transition-all duration-150 text-[12px] ${currentPage >= totalPages - 1 ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-50' : 'bg-white text-slate-700 hover:bg-slate-50 cursor-pointer active:scale-[0.98]'}`}
            >下一页</button>
          </div>
        </div>
      </div>

      {/* Manual Create Modal */}
      {createModalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => !submitting && setCreateModalVisible(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-[16px] font-bold text-slate-800">手动录入收款</h3>
              <button disabled={submitting} onClick={() => setCreateModalVisible(false)} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-lg transition-colors cursor-pointer">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">关联订单 ID <span className="text-red-500">*</span></label>
                <input required type="number" min="1" value={form.order_id} onChange={e => setForm({...form, order_id: e.target.value})} placeholder="输入订单号，如: 1001" className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300" />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">收款金额 (元) <span className="text-red-500">*</span></label>
                <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} placeholder="例如: 99.00" className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-[13px] font-semibold text-slate-600 mb-1">来源</label>
                    <select required value={form.source} onChange={e => setForm({...form, source: e.target.value})} className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10">
                      <option value="manual">人工录入</option>
                      <option value="pdd">拼多多</option>
                      <option value="wecom">企业微信</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-[13px] font-semibold text-slate-600 mb-1">支付时间</label>
                    <input type="datetime-local" value={form.paid_at} onChange={e => setForm({...form, paid_at: e.target.value})} className="w-full px-3 py-2 text-[13px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" />
                 </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">备注说明</label>
                <textarea rows={2} value={form.remark} onChange={e => setForm({...form, remark: e.target.value})} placeholder="填写备注说明..." className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300 resize-none" />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" disabled={submitting} onClick={() => setCreateModalVisible(false)} className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">取消</button>
                <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-brand-500 text-white font-semibold rounded-xl hover:bg-brand-600 transition-colors shadow-sm border-none disabled:opacity-70 cursor-pointer">
                  {submitting ? '提交中...' : '确认录入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Match Order Modal */}
      {matchModalVisible && selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => !submitting && setMatchModalVisible(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-scale-in">
             <div className="px-6 py-4 border-b border-slate-100 bg-amber-50/50 flex justify-between items-center">
               <h3 className="text-[16px] font-bold text-amber-800">关联流水到订单</h3>
               <button disabled={submitting} onClick={() => setMatchModalVisible(false)} className="text-amber-500 hover:text-amber-700 bg-amber-100/50 p-1.5 rounded-lg transition-colors cursor-pointer">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
             </div>
             <form onSubmit={handleMatchSubmit} className="p-6">
                <div className="mb-5 p-3 bg-slate-50 rounded-lg border border-slate-100 text-[13px] text-slate-600">
                   <p className="mb-1"><strong>交易单号:</strong> <span className="font-mono">{selectedPayment.transaction_id}</span></p>
                   <p><strong>收款金额:</strong> &yen;{formatCurrency(selectedPayment.amount / 100)}</p>
                </div>
                <div className="mb-6">
                  <label className="block text-[13px] font-semibold text-slate-600 mb-2">目标订单 ID <span className="text-red-500">*</span></label>
                  <input required type="number" min="1" value={matchOrderId} onChange={e => setMatchOrderId(e.target.value)} placeholder="输入关联的订单号，如: 1001" className="w-full px-3 py-2.5 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300 transition-colors" />
                </div>
                <div className="flex gap-3">
                  <button type="button" disabled={submitting} onClick={() => setMatchModalVisible(false)} className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">取消</button>
                  <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-amber-500 text-white font-semibold rounded-xl hover:bg-amber-600 transition-colors shadow-sm border-none disabled:opacity-70 cursor-pointer">
                    {submitting ? '提交中...' : '确认关联'}
                  </button>
                </div>
             </form>
          </div>
        </div>
      )}

    </div>
  );
}
