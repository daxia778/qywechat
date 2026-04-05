import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { listOrders } from '../api/orders';
import { matchPayment } from '../api/payments';
import { useToast } from '../hooks/useToast';
import { useDebounce } from '../hooks/useDebounce';
import { formatCurrency, formatTime } from '../utils/formatters';
import { STATUS_MAP, STATUS_COLORS } from '../utils/constants';

const SOURCE_LABEL = { pdd: '拼多多', wecom: '企业微信', manual: '人工录入' };
const SOURCE_ICON_CLASS = { pdd: 'text-red-500', wecom: 'text-blue-500', manual: 'text-amber-500' };

/* ── 订单详情卡片（展开后显示） ── */
function OrderDetailPanel({ order }) {
  const sc = STATUS_COLORS[order.status] || STATUS_COLORS.PENDING;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 animate-fade-in-up">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">订单号</span>
          <p className="text-[13px] font-semibold text-slate-700 font-mono mt-0.5">{order.order_sn}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">订单金额</span>
          <p className="text-[13px] font-bold text-slate-800 mt-0.5 tabular-nums">&yen;{formatCurrency((order.price || 0) / 100)}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">客户</span>
          <p className="text-[13px] font-semibold text-slate-700 mt-0.5">{order.customer_contact || '-'}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">主题</span>
          <p className="text-[13px] text-slate-700 mt-0.5 truncate" title={order.topic}>{order.topic || '-'}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">页数</span>
          <p className="text-[13px] text-slate-700 mt-0.5">{order.pages ? `${order.pages} 页` : '-'}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">状态</span>
          <p className="mt-0.5">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
              style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
              {STATUS_MAP[order.status] || order.status}
            </span>
          </p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">设计师</span>
          <p className="text-[13px] text-slate-700 mt-0.5">{order.freelance_designer_name || '待分配'}</p>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">创建时间</span>
          <p className="text-[13px] text-slate-600 mt-0.5 tabular-nums">{formatTime(order.created_at)}</p>
        </div>
        {order.deadline && (
          <div>
            <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">截止时间</span>
            <p className="text-[13px] text-red-600 mt-0.5 tabular-nums">{formatTime(order.deadline)}</p>
          </div>
        )}
        {order.remark && (
          <div className="col-span-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">备注</span>
            <p className="text-[12px] text-slate-600 mt-0.5 bg-slate-50 rounded-lg p-2.5 whitespace-pre-wrap border border-slate-100">{order.remark}</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Link
          to={`/orders/${order.id}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-600 hover:text-brand-700 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          查看完整订单详情
        </Link>
      </div>
    </div>
  );
}

export default function PaymentMatchModal({ visible, payment, onClose, onMatched }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(null);
  const [search, setSearch] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualId, setManualId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const modalRef = useRef(null);
  const searchRef = useRef(null);
  const previousActiveElement = useRef(null);
  const generatedId = useId();
  const titleId = `payment-match-title-${generatedId}`;

  const debouncedSearch = useDebounce(search, 400);

  const fetchOrders = useCallback(async (keyword = '') => {
    setLoading(true);
    try {
      const params = { limit: 30, offset: 0 };
      if (keyword.trim()) params.keyword = keyword.trim();
      const res = await listOrders(params);
      setOrders(res.data?.data || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      toast('获取订单列表失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (visible) {
      fetchOrders(debouncedSearch);
    }
  }, [visible, debouncedSearch, fetchOrders]);

  useEffect(() => {
    if (!visible) return;
    setSearch('');
    setManualMode(false);
    setManualId('');
    setExpandedId(null);
    previousActiveElement.current = document.activeElement;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;

    const timer = setTimeout(() => searchRef.current?.focus(), 80);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      if (previousActiveElement.current?.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  const handleMatch = async (order) => {
    if (!payment?.id) return;
    setMatching(order.id);
    try {
      await matchPayment(payment.id, { order_id: order.id });
      toast(`流水已成功关联到订单 ${order.order_sn}`, 'success');
      onMatched?.();
      onClose();
    } catch (err) {
      toast('关联失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setMatching(null);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualId || !payment?.id) return;
    setSubmitting(true);
    try {
      await matchPayment(payment.id, { order_id: parseInt(manualId, 10) });
      toast('流水关联成功', 'success');
      onMatched?.();
      onClose();
    } catch (err) {
      toast('关联失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleExpand = (orderId) => {
    setExpandedId((prev) => (prev === orderId ? null : orderId));
  };

  if (!visible || !payment) return null;

  const statusColor = (status) => STATUS_COLORS[status] || STATUS_COLORS.PENDING;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={modalRef}
      tabIndex={-1}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div>
                <h3 id={titleId} className="text-lg font-bold text-slate-800">关联流水到订单</h3>
                <p className="text-sm text-slate-500 mt-0.5">点击订单卡片展开详情，确认后点击关联</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="关闭"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Payment info card */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 mb-4">
            <div className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">流水信息</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] text-slate-400 mb-0.5">交易单号</div>
                <div className="text-[13px] font-mono font-semibold text-slate-700 truncate" title={payment.transaction_id}>
                  {payment.transaction_id}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-0.5">收款金额</div>
                <div className="text-[15px] font-bold text-slate-800 tabular-nums">
                  &yen;{formatCurrency(payment.amount / 100)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-0.5">来源</div>
                <div className={`text-[13px] font-semibold ${SOURCE_ICON_CLASS[payment.source] || 'text-slate-600'}`}>
                  {SOURCE_LABEL[payment.source] || payment.source}
                </div>
              </div>
            </div>
          </div>

          {/* Search / mode toggle */}
          <div className="flex items-center gap-2">
            {!manualMode ? (
              <div className="relative flex-1">
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  type="text"
                  placeholder="搜索订单号 / 客户联系方式 / 主题..."
                  aria-label="搜索订单"
                  className="w-full px-4 py-2.5 pl-10 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 focus:bg-white"
                />
                <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            ) : (
              <form onSubmit={handleManualSubmit} className="flex-1 flex items-center gap-2">
                <input
                  ref={searchRef}
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  type="number"
                  min="1"
                  required
                  placeholder="输入订单 ID，如: 1001"
                  className="flex-1 px-4 py-2.5 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={submitting || !manualId}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-all duration-150 shadow-sm border-none disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  {submitting ? '提交中...' : '确认关联'}
                </button>
              </form>
            )}
            <button
              onClick={() => {
                setManualMode(!manualMode);
                setManualId('');
                setTimeout(() => searchRef.current?.focus(), 50);
              }}
              className="px-3 py-2.5 text-[12px] font-semibold text-slate-500 hover:text-brand-600 hover:bg-brand-50 border border-slate-200 rounded-xl transition-all duration-150 cursor-pointer whitespace-nowrap"
              title={manualMode ? '切换到搜索模式' : '切换到手动输入ID'}
            >
              {manualMode ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  搜索
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  ID
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Order list */}
        {!manualMode && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5 min-h-[200px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <svg className="w-8 h-8 animate-spin text-brand-400 mb-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm font-medium">加载订单中...</span>
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="font-medium text-slate-500">未找到订单</p>
                <p className="text-sm mt-1">{search.trim() ? '尝试其他关键词，或切换到手动输入 ID' : '暂无可关联的订单'}</p>
              </div>
            ) : (
              orders.map((order) => {
                const sc = statusColor(order.status);
                const isMatching = matching === order.id;
                const isExpanded = expandedId === order.id;
                const amountMatch = payment.amount === order.price;
                return (
                  <div
                    key={order.id}
                    className={`group bg-white border rounded-xl transition-all duration-200 ${
                      isExpanded
                        ? 'border-brand-300 shadow-md ring-1 ring-brand-100'
                        : 'border-slate-200 hover:border-brand-300 hover:shadow-md'
                    }`}
                  >
                    {/* 主行：点击展开/折叠 */}
                    <div
                      className="p-4 cursor-pointer select-none"
                      onClick={() => toggleExpand(order.id)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            {/* 展开/折叠指示器 */}
                            <svg
                              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="font-bold text-brand-500 text-[14px]">{order.order_sn}</span>
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                              style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                              {STATUS_MAP[order.status] || order.status}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">ID: {order.id}</span>
                            {amountMatch && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-600 border border-green-200">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                金额一致
                              </span>
                            )}
                          </div>
                          {order.topic && (
                            <div className="text-sm text-slate-600 mb-1.5 truncate" title={order.topic}>{order.topic}</div>
                          )}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            {order.customer_contact && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                {order.customer_contact}
                              </span>
                            )}
                            {order.created_at && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {formatTime(order.created_at)}
                              </span>
                            )}
                            {order.pages > 0 && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                                {order.pages} 页
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <div className="text-lg font-bold text-slate-800 tabular-nums">&yen;{formatCurrency((order.price || 0) / 100)}</div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMatch(order); }}
                            disabled={isMatching}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-all duration-150 cursor-pointer border-none shadow-sm active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {isMatching ? (
                              <>
                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                关联中...
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                关联
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 展开的详情面板 */}
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <OrderDetailPanel order={order} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Manual mode placeholder */}
        {manualMode && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-slate-400">
            <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <p className="font-medium text-slate-500 mb-1">手动输入模式</p>
            <p className="text-sm text-center">在上方输入框中填写目标订单 ID，然后点击确认关联</p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 shrink-0 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {!manualMode && orders.length > 0 ? `找到 ${total} 条订单${search.trim() ? ` (关键词: "${search.trim()}")` : ''} · 点击卡片展开详情` : ''}
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
