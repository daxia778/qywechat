import { useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useDebounce } from '../../hooks/useDebounce';
import { listPayments, createPayment, getPaymentSummary, matchPayment } from '../../api/payments';
import { getOrderDetail, listOrders } from '../../api/orders';
import { formatTime, formatCurrency } from '../../utils/formatters';
import { fmtYuan, STATUS_MAP, STATUS_COLORS } from '../../utils/constants';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/ui/PageHeader';
import { Wallet, Plus, RefreshCw, Search, X, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Link2 } from 'lucide-react';

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

function OrderSearchInput({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const debouncedQuery = useDebounce(query, 400);

  // 初始加载 + 搜索时刷新
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = { page: 1, page_size: 20 };
        if (debouncedQuery) params.keyword = debouncedQuery;
        const res = await listOrders(params);
        if (!cancelled) setOrders(res.data?.data || []);
      } catch {
        if (!cancelled) setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  useEffect(() => {
    if (!value) { setSelectedLabel(''); setQuery(''); }
  }, [value]);

  const handleSelect = (order) => {
    onChange(order.id);
    setSelectedLabel(`#${order.id} ${order.order_sn || ''} - ¥${formatCurrency((order.price || 0) / 100)}`);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 w-full px-3 py-2.5 text-[14px] bg-[#434FCF]/[0.04] border border-[#434FCF]/20 rounded-xl">
        <div className="w-5 h-5 rounded-md bg-[#434FCF] flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
        <span className="flex-1 text-slate-700 font-medium truncate">{selectedLabel || `订单 #${value}`}</span>
        <button type="button" onClick={() => { onChange(''); setSelectedLabel(''); }} className="text-slate-400 hover:text-red-500 shrink-0 cursor-pointer bg-transparent border-none p-0">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入订单号、客户或主题筛选..."
          className="w-full px-3 py-2 pl-9 text-[13px] bg-slate-50/60 border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 placeholder:text-slate-400"
        />
        <Search size={14} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        {loading && <RefreshCw size={14} className="text-[#434FCF] animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[220px] overflow-y-auto bg-white">
        {loading && orders.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-slate-400 text-center flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin text-[#434FCF]" /> 加载订单列表...
          </div>
        ) : orders.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-slate-400 text-center">
            {query ? '未找到匹配订单' : '暂无订单'}
          </div>
        ) : (
          orders.map((order) => {
            const sc = STATUS_COLORS[order.status] || {};
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => handleSelect(order)}
                className="w-full text-left px-3.5 py-2.5 hover:bg-[#434FCF]/[0.05] transition-colors cursor-pointer bg-transparent border-none border-b border-b-slate-100 last:border-b-0 group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-bold text-slate-700 shrink-0">#{order.id}</span>
                    <span className="text-[11px] font-mono text-slate-400 truncate">{order.order_sn}</span>
                  </div>
                  <span className="text-[13px] font-bold text-[#434FCF] font-['Outfit'] tabular-nums shrink-0">¥{formatCurrency((order.price || 0) / 100)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {order.customer_contact && <span className="text-[11px] text-slate-400 truncate max-w-[120px]">{order.customer_contact}</span>}
                  {order.customer_contact && order.topic && <span className="text-slate-200">·</span>}
                  {order.topic && <span className="text-[11px] text-slate-400 truncate max-w-[140px]">{order.topic}</span>}
                  <span
                    className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-md border shrink-0"
                    style={{ background: sc.bg || '#f1f5f9', color: sc.text || '#64748b', borderColor: sc.border || '#e2e8f0' }}
                  >
                    {STATUS_MAP[order.status] || order.status}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
      {!loading && orders.length > 0 && (
        <div className="text-[11px] text-slate-400 text-center">显示最近 {orders.length} 条订单，输入关键词可筛选</div>
      )}
    </div>
  );
}

export default function StaffPaymentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Data
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pageSize = 20;

  // Filters
  const [filterOrderId, setFilterOrderId] = useState(searchParams.get('order_id') || '');
  const [filterSource, setFilterSource] = useState(searchParams.get('source') || '');
  const [filterStartTime, setFilterStartTime] = useState(searchParams.get('start_time') || '');
  const [filterEndTime, setFilterEndTime] = useState(searchParams.get('end_time') || '');
  const debouncedOrderId = useDebounce(filterOrderId, 400);

  // Create modal
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ order_id: '', amount: '', source: 'manual', remark: '', paid_at: '' });

  // Match modal
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [matchPaymentItem, setMatchPaymentItem] = useState(null);
  const [matchOrderId, setMatchOrderId] = useState('');
  const [matching, setMatching] = useState(false);

  // Expand
  const [expandedId, setExpandedId] = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [expandLoading, setExpandLoading] = useState(false);

  // Derived
  const monthTotal = useMemo(() => {
    if (!summary) return '0.00';
    return formatCurrency((summary.total_amount || 0) / 100);
  }, [summary]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Fetch summary
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const now = new Date();
      const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const res = await getPaymentSummary({ start_time: startOfMonth });
      setSummary(res.data);
    } catch {
      // silently fail
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Fetch list
  const fetchPayments = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else if (currentPage === 0) setLoading(true);
    try {
      const params = { page: currentPage + 1, page_size: pageSize };
      if (debouncedOrderId) params.order_id = debouncedOrderId;
      if (filterSource) params.source = filterSource;
      if (filterStartTime) params.start_time = filterStartTime;
      if (filterEndTime) params.end_time = filterEndTime;
      const res = await listPayments(params);
      setPayments(res.data.data || []);
      setTotal(res.data.total || 0);
      if (manual) toast('数据已刷新', 'success');
    } catch (err) {
      if (manual) toast('刷新失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentPage, debouncedOrderId, filterSource, filterStartTime, filterEndTime, toast]);

  useEffect(() => {
    fetchPayments();
    fetchSummary();
  }, [fetchPayments, fetchSummary]);

  // Sync URL params
  useEffect(() => {
    const params = {};
    if (debouncedOrderId) params.order_id = debouncedOrderId;
    if (filterSource) params.source = filterSource;
    if (filterStartTime) params.start_time = filterStartTime;
    if (filterEndTime) params.end_time = filterEndTime;
    setSearchParams(params, { replace: true });
    setCurrentPage(0);
  }, [debouncedOrderId, filterSource, filterStartTime, filterEndTime, setSearchParams]);

  // Create payment
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

  // Match payment to order
  const handleMatch = async () => {
    if (!matchOrderId) return toast('请输入订单ID', 'error');
    setMatching(true);
    try {
      await matchPayment(matchPaymentItem.id, { order_id: parseInt(matchOrderId, 10) });
      toast('关联成功', 'success');
      setMatchModalVisible(false);
      setMatchPaymentItem(null);
      setMatchOrderId('');
      fetchPayments();
      fetchSummary();
    } catch (err) {
      toast('关联失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setMatching(false);
    }
  };

  // Expand order detail
  const toggleExpand = async (paymentId, orderId) => {
    if (expandedId === paymentId) {
      setExpandedId(null);
      setExpandedOrder(null);
      return;
    }
    setExpandedId(paymentId);
    setExpandedOrder(null);
    setExpandLoading(true);
    try {
      const res = await getOrderDetail(orderId);
      setExpandedOrder(res.data.order || res.data || {});
    } catch {
      setExpandedOrder(null);
      toast('获取订单详情失败', 'error');
    } finally {
      setExpandLoading(false);
    }
  };

  const resetFilters = () => {
    setFilterOrderId('');
    setFilterSource('');
    setFilterStartTime('');
    setFilterEndTime('');
  };

  const hasFilters = filterOrderId || filterSource || filterStartTime || filterEndTime;

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto page-enter">
      {/* Header */}
      <PageHeader title="收款流水" subtitle="查看收款记录与佣金明细">
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchPayments(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中' : '刷新'}
          </button>
          <button
            onClick={() => setCreateModalVisible(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-[#434FCF] hover:bg-[#3640b5] transition-all duration-150 shadow-sm active:scale-[0.98] cursor-pointer"
          >
            <Plus size={14} />
            手动录入
          </button>
        </div>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-5">
        {[
          {
            title: '本月收款总额',
            value: monthTotal,
            prefix: '\u00a5',
            gradient: 'from-emerald-500 to-teal-500',
            colorHex: '#10B981',
            icon: <Wallet size={20} className="text-white" />,
          },
          {
            title: '本月笔数',
            value: summary?.by_source
              ? Object.values(summary.by_source).reduce((s, v) => s + (v.count || 0), 0)
              : 0,
            suffix: '笔',
            gradient: 'from-blue-500 to-indigo-500',
            colorHex: '#3B82F6',
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            ),
          },
          {
            title: '人工录入',
            value: formatCurrency(((summary?.by_source?.manual?.total || 0)) / 100),
            prefix: '\u00a5',
            gradient: 'from-violet-500 to-purple-500',
            colorHex: '#8B5CF6',
            icon: (
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            ),
          },
        ].map((card) => (
          <div
            key={card.title}
            className="group relative bg-white border border-black/[0.06] rounded-2xl p-5 lg:p-6 flex flex-col gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1.5px_var(--c-ring),0_8px_24px_var(--c-glow)] overflow-hidden"
            style={{ '--c-ring': `${card.colorHex}30`, '--c-glow': `${card.colorHex}12` }}
          >
            <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${card.gradient} opacity-[0.06] pointer-events-none transition-opacity duration-300 group-hover:opacity-[0.10]`} />
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br ${card.gradient} text-white shadow-md`}
              style={{ boxShadow: `0 4px 12px ${card.colorHex}25` }}
            >
              {card.icon}
            </div>
            <div className="text-[13px] font-medium text-slate-500 tracking-[0.01em]">{card.title}</div>
            <div className="font-['Outfit',sans-serif] text-[28px] lg:text-[32px] font-bold text-slate-900 leading-[1] tracking-tight tabular-nums">
              {summaryLoading ? (
                <div className="h-8 w-24 bg-slate-100 rounded-lg animate-pulse" />
              ) : (
                <>
                  {card.prefix && <span>{card.prefix}</span>}
                  {card.value}
                  {card.suffix && <span className="text-sm font-semibold text-slate-400 ml-0.5">{card.suffix}</span>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Table Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="px-5 lg:px-6 py-4 border-b border-slate-200/80 flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[180px] max-w-[260px] relative">
            <input
              type="text"
              placeholder="搜索订单 ID..."
              value={filterOrderId}
              onChange={(e) => setFilterOrderId(e.target.value)}
              className="w-full h-[34px] px-4 pl-9 text-[13px] text-slate-800 bg-slate-50/60 border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 placeholder:text-slate-400 transition-colors"
            />
            <Search size={14} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
          <div className="w-[130px]">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="w-full h-[34px] px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 transition-colors cursor-pointer"
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
              className="h-[34px] px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 transition-colors"
            />
            <span className="text-slate-300 text-sm select-none">~</span>
            <input
              type="date"
              value={filterEndTime}
              onChange={(e) => setFilterEndTime(e.target.value)}
              className="h-[34px] px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 transition-colors"
            />
          </div>
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="h-[34px] px-3 text-[13px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              重置
            </button>
          )}
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto relative min-h-[300px]">
          {loading && payments.length === 0 && <LoadingSpinner />}
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col className="hidden lg:table-column" style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="text-left" style={{ paddingLeft: 24 }}>流水号 / 交易时间</th>
                <th className="text-center">来源</th>
                <th className="text-right">收款金额</th>
                <th className="text-center">关联订单</th>
                <th className="hidden lg:table-cell text-left">备注</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <Wallet size={48} strokeWidth={1.2} className="mb-3 text-slate-200" />
                      <p className="font-medium text-slate-600">暂无收款记录</p>
                      <p className="text-sm mt-0.5">当前筛选条件下没有匹配的流水</p>
                    </div>
                  </td>
                </tr>
              )}
              {payments.map((p) => {
                const isExpanded = expandedId === p.id;
                return (
                  <tr key={p.id} className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors group ${isExpanded ? 'bg-[#434FCF]/[0.03]' : ''}`}>
                    <td style={{ paddingLeft: 24 }}>
                      <div className="text-[13px] font-medium text-slate-700 font-mono truncate" title={p.transaction_id}>
                        {p.transaction_id.length > 20 ? p.transaction_id.substring(0, 20) + '...' : p.transaction_id}
                      </div>
                      <div className="text-[12px] text-slate-400 mt-0.5 tabular-nums">{formatTime(p.paid_at)}</div>
                    </td>
                    <td className="text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${SOURCE_STYLE[p.source] || SOURCE_STYLE.manual}`}>
                        {SOURCE_MAP[p.source] || p.source}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="text-[14px] font-bold text-slate-800 font-[Outfit] tabular-nums">
                        &yen;{formatCurrency(p.amount / 100)}
                      </span>
                    </td>
                    <td className="text-center">
                      {p.order_id ? (
                        <div>
                          <button
                            onClick={() => toggleExpand(p.id, p.order_id)}
                            className={`inline-flex items-center gap-1.5 text-[13px] font-bold transition-colors cursor-pointer bg-transparent border-none p-0 ${isExpanded ? 'text-[#3640b5]' : 'text-[#434FCF] hover:text-[#3640b5]'}`}
                          >
                            <ChevronDown
                              size={12}
                              className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            />
                            #{p.order_id}
                          </button>
                          {p.customer_id > 0 && (
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              顾客 #{p.customer_id}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-500 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                          未关联
                        </span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell truncate" title={p.remark}>
                      <span className="text-[12px] text-slate-500">{p.remark || '-'}</span>
                    </td>
                    <td className="text-center">
                      {p.order_id ? (
                        <div className="text-[12px] text-slate-400 tabular-nums">
                          {p.matched_at ? formatTime(p.matched_at) : '已匹配'}
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMatchPaymentItem(p); setMatchOrderId(''); setMatchModalVisible(true); }}
                          className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-[12px] font-semibold text-[#434FCF] bg-[#434FCF]/[0.06] border border-[#434FCF]/20 rounded-xl hover:bg-[#434FCF]/[0.12] transition-all shadow-sm cursor-pointer active:scale-[0.97]"
                        >
                          <Link2 size={11} />
                          手动关联
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Expanded order detail rows */}
          {payments.map((p) => {
            if (expandedId !== p.id || !p.order_id) return null;
            return (
              <div key={`exp-${p.id}`} className="px-6 lg:px-8 py-5 bg-[#434FCF]/[0.02] border-b border-slate-100 animate-fade-in-up">
                {expandLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                    <RefreshCw size={16} className="animate-spin text-[#434FCF]" />
                    <span className="text-sm font-medium">加载订单详情...</span>
                  </div>
                ) : expandedOrder ? (() => {
                  const sc = STATUS_COLORS[expandedOrder.status] || STATUS_COLORS.PENDING;
                  return (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-slate-700">订单详情</span>
                          <span className="text-[12px] text-slate-400 font-mono">{expandedOrder.order_sn}</span>
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                            style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                            {STATUS_MAP[expandedOrder.status] || expandedOrder.status}
                          </span>
                        </div>
                      </div>
                      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">订单金额</span>
                          <p className="text-[14px] font-bold text-slate-800 mt-0.5 tabular-nums">&yen;{formatCurrency((expandedOrder.price || 0) / 100)}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">客户</span>
                          <p className="text-[13px] font-semibold text-slate-700 mt-0.5 truncate">{expandedOrder.customer_contact || '-'}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">主题</span>
                          <p className="text-[13px] text-slate-700 mt-0.5 truncate" title={expandedOrder.topic}>{expandedOrder.topic || '-'}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">设计师</span>
                          <p className="text-[13px] text-slate-700 mt-0.5">{expandedOrder.freelance_designer_name || '待分配'}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">创建时间</span>
                          <p className="text-[13px] text-slate-600 mt-0.5 tabular-nums">{formatTime(expandedOrder.created_at)}</p>
                        </div>
                        {expandedOrder.deadline && (
                          <div>
                            <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">截止时间</span>
                            <p className="text-[13px] text-red-600 mt-0.5 tabular-nums">{formatTime(expandedOrder.deadline)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="text-center text-sm text-slate-400 py-6">订单详情加载失败</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="bg-surface-container-low px-6 py-3 border-t border-slate-200 flex justify-between items-center">
          <span className="text-[13px] text-slate-500">
            共 <span className="font-bold text-slate-700">{total}</span> 条记录
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className={`inline-flex items-center gap-1 px-3 py-1 text-[12px] font-semibold rounded-xl border border-slate-200 shadow-sm transition-all duration-150 ${currentPage === 0 ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-50' : 'bg-white text-slate-700 hover:bg-slate-50 cursor-pointer active:scale-[0.98]'}`}
            >
              <ChevronLeft size={12} />
              上一页
            </button>
            <span className="text-[13px] text-slate-500 px-3">{currentPage + 1} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              className={`inline-flex items-center gap-1 px-3 py-1 text-[12px] font-semibold rounded-xl border border-slate-200 shadow-sm transition-all duration-150 ${currentPage >= totalPages - 1 ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-50' : 'bg-white text-slate-700 hover:bg-slate-50 cursor-pointer active:scale-[0.98]'}`}
            >
              下一页
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Create Payment Modal - Portal to body to escape overflow-hidden parent */}
      {createModalVisible && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !submitting && setCreateModalVisible(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-[16px] font-bold text-slate-800">手动录入收款</h3>
              <button disabled={submitting} onClick={() => setCreateModalVisible(false)} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-lg transition-colors cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">关联订单 <span className="text-red-500">*</span></label>
                <OrderSearchInput value={form.order_id} onChange={(id) => setForm({...form, order_id: id})} placeholder="搜索订单号、客户、主题..." />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">收款金额 (元) <span className="text-red-500">*</span></label>
                <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} placeholder="例如: 99.00" className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 placeholder:text-slate-300" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-semibold text-slate-600 mb-1">来源</label>
                  <select required value={form.source} onChange={e => setForm({...form, source: e.target.value})} className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10">
                    <option value="manual">人工录入</option>
                    <option value="pdd">拼多多</option>
                    <option value="wecom">企业微信</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-slate-600 mb-1">支付时间</label>
                  <input type="datetime-local" value={form.paid_at} onChange={e => setForm({...form, paid_at: e.target.value})} className="w-full px-3 py-2 text-[13px] bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10" />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">备注说明</label>
                <textarea rows={2} value={form.remark} onChange={e => setForm({...form, remark: e.target.value})} placeholder="填写备注说明..." className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-xl outline-none focus:border-[#434FCF] focus:ring-2 focus:ring-[#434FCF]/10 placeholder:text-slate-300 resize-none" />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" disabled={submitting} onClick={() => setCreateModalVisible(false)} className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">取消</button>
                <button type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-[#434FCF] text-white font-semibold rounded-xl hover:bg-[#3640b5] transition-colors shadow-sm border-none disabled:opacity-70 cursor-pointer">
                  {submitting ? '提交中...' : '确认录入'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Match Order Modal - Portal to body */}
      {matchModalVisible && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !matching && setMatchModalVisible(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-[16px] font-bold text-slate-800">关联订单</h3>
              <button disabled={matching} onClick={() => setMatchModalVisible(false)} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-lg transition-colors cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <div className="text-[12px] text-slate-400 font-medium mb-1">流水号</div>
                <div className="text-[13px] font-mono text-slate-700 truncate">{matchPaymentItem?.transaction_id}</div>
                <div className="text-[12px] text-slate-400 mt-2 font-medium mb-1">金额</div>
                <div className="text-[16px] font-bold text-slate-800 font-[Outfit] tabular-nums">&yen;{formatCurrency((matchPaymentItem?.amount || 0) / 100)}</div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">关联订单 <span className="text-red-500">*</span></label>
                <OrderSearchInput value={matchOrderId} onChange={(id) => setMatchOrderId(id ? String(id) : '')} placeholder="搜索要关联的订单..." />
              </div>
              <div className="pt-1 flex gap-3">
                <button type="button" disabled={matching} onClick={() => setMatchModalVisible(false)} className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">取消</button>
                <button onClick={handleMatch} disabled={matching || !matchOrderId} className="flex-1 px-4 py-2.5 bg-[#434FCF] text-white font-semibold rounded-xl hover:bg-[#3640b5] transition-colors shadow-sm border-none disabled:opacity-70 cursor-pointer">
                  {matching ? '关联中...' : '确认关联'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
