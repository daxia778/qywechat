import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { useDebounce } from '../hooks/useDebounce';
import { listOrders, updateOrderStatus } from '../api/orders';
import { exportExcel } from '../api/admin';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES, ORDER_STATUSES } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import LoadingSpinner from '../components/LoadingSpinner';

export default function OrdersPage() {
  const { role, userId } = useAuth();
  const { toast } = useToast();
  const { on, off, connected } = useWebSocket();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const debouncedKeyword = useDebounce(searchKeyword, 400);
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [openMoreMenu, setOpenMoreMenu] = useState(null);
  const pageSize = 50;

  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));

  const [modal, setModal] = useState({
    show: false, title: '', message: '', type: 'info', detail: null,
    showInput: false, inputPlaceholder: '', confirmText: '确认',
  });
  const actionRef = useRef(null);
  const [previewImage, setPreviewImage] = useState(null);

  const showModal = (opts, action) => {
    actionRef.current = action;
    setModal({ show: true, showInput: false, detail: null, confirmText: '确认', ...opts });
  };

  const onModalConfirm = (inputValue) => {
    setModal((m) => ({ ...m, show: false }));
    actionRef.current?.(inputValue);
  };

  const fetchOrders = useCallback(async (manual = false, signal) => {
    if (manual) setLoading(true);
    try {
      const params = { limit: pageSize, offset: currentPage * pageSize };
      if (currentStatus) params.status = currentStatus;
      if (debouncedKeyword.trim()) params.keyword = debouncedKeyword.trim();
      const res = await listOrders(params, { signal });
      setOrders(res.data.data || []);
      setTotalOrders(res.data.total || 0);
      if (manual) toast('订单数据已刷新', 'success');
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      if (manual) toast('获取订单失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPage, currentStatus, debouncedKeyword, toast]);

  useEffect(() => {
    const controller = new AbortController();
    fetchOrders(false, controller.signal);
    return () => controller.abort();
  }, [fetchOrders]);

  // Reset to page 0 when debounced keyword changes
  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedKeyword]);

  usePolling(fetchOrders, connected ? 120000 : 60000);

  useEffect(() => {
    const handler = () => fetchOrders();
    on('order_updated', handler);
    return () => off('order_updated', handler);
  }, [on, off, fetchOrders]);

  // Close more menu on outside click
  useEffect(() => {
    const close = () => setOpenMoreMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const doUpdateStatus = async (order, newStatus, refundReason = '') => {
    try {
      await updateOrderStatus(order.id, { status: newStatus, refund_reason: refundReason });
      toast(`订单 ${order.order_sn} 状态已更新`, 'success');
      fetchOrders();
    } catch (err) {
      toast('更新失败: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const confirmComplete = (order) => {
    showModal({
      title: '完成订单', message: `确认已收到尾款并将订单 ${order.order_sn} 标记为完成？`,
      type: 'info', confirmText: '确认完成',
      detail: { '订单号': order.order_sn, '金额': `\u00A5${order.price ? (order.price / 100).toFixed(2) : '0.00'}` },
    }, () => doUpdateStatus(order, 'COMPLETED'));
  };

  const confirmClose = (order) => {
    showModal({
      title: '关闭订单', message: `确定要强制关闭订单 ${order.order_sn} 吗？此操作不可撤销。`,
      type: 'danger', confirmText: '关闭订单',
      detail: { '订单号': order.order_sn, '金额': `\u00A5${order.price ? (order.price / 100).toFixed(2) : '0.00'}`, '状态': STATUS_MAP[order.status] },
    }, () => doUpdateStatus(order, 'CLOSED'));
  };

  const handleRefund = (order) => {
    showModal({
      title: '退款 / 售后', message: `请填写订单 ${order.order_sn} 的退款原因：`,
      type: 'warning', showInput: true, inputPlaceholder: '退款原因（必填）', confirmText: '提交退款',
      detail: { '订单号': order.order_sn, '金额': `\u00A5${order.price ? (order.price / 100).toFixed(2) : '0.00'}` },
    }, (reason) => {
      if (!reason?.trim()) { toast('退款原因不能为空', 'warning'); return; }
      doUpdateStatus(order, 'REFUNDED', reason);
    });
  };

  const hasMoreActions = (order) => {
    if (['COMPLETED', 'REFUNDED', 'CLOSED'].includes(order.status)) return false;
    if (role === 'admin') return true;
    if (role === 'follow') return true;
    return false;
  };

  const handleExportExcel = () => {
    const today = new Date().toISOString().slice(0, 10);
    const params = { start_date: today.slice(0, 7) + '-01', end_date: today };
    exportExcel(params);
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <ConfirmModal
        visible={modal.show}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        detail={modal.detail}
        showInput={modal.showInput}
        inputPlaceholder={modal.inputPlaceholder}
        confirmText={modal.confirmText}
        onConfirm={onModalConfirm}
        onCancel={() => setModal((m) => ({ ...m, show: false }))}
      />

      {/* Image Lightbox */}
      {previewImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[90vw] max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreviewImage(null)} className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg text-slate-500 hover:text-slate-800 flex items-center justify-center z-10 text-lg leading-none cursor-pointer">&times;</button>
            <img src={previewImage} alt="订单截图" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain" />
          </div>
        </div>
      )}

      {/* Title */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-800 font-[Outfit] tracking-tight">订单大厅</h1>
          <p className="text-sm text-slate-500 mt-1">管理和跟踪所有订单</p>
        </div>
        <div className="flex items-center gap-2">
          {role === 'admin' && (
            <button onClick={handleExportExcel} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm" title="导出 Excel 报表">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="hidden sm:inline">导出Excel</span>
            </button>
          )}
          <button onClick={() => fetchOrders(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm" disabled={loading}>
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            <span>{loading ? '同步中...' : '刷新'}</span>
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden hover:border-[#434FCF]/20 transition-colors">
        {/* Tabs & Search */}
        <div className="px-6 border-b border-slate-200 bg-white flex justify-between items-end gap-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pt-3" role="tablist" aria-label="订单状态筛选">
            {ORDER_STATUSES.map((s) => (
              <button
                key={s.value}
                role="tab"
                aria-selected={currentStatus === s.value}
                onClick={() => { setCurrentStatus(s.value); setCurrentPage(0); }}
                className={`pb-3 px-3 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap bg-transparent cursor-pointer rounded-t-md ${
                  currentStatus === s.value
                    ? 'border-brand-500 text-brand-500'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {s.label}
                {s.value === 'PENDING' && currentStatus === 'PENDING' && totalOrders > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-warning-bg text-warning text-[10px] font-bold" title={`共 ${totalOrders} 条待处理订单`}>
                    {totalOrders}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="pb-3 shrink-0">
            <div className="relative w-52">
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                type="text"
                placeholder="搜索订单..."
                aria-label="搜索订单"
                className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 py-1.5 pl-9 text-[13px] rounded-lg"
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto relative min-h-[450px]">
          {loading && orders.length === 0 && <LoadingSpinner />}
          <table>
            <thead>
              <tr>
                <th className="pl-6">订单信息</th>
                <th>客户</th>
                <th>金额</th>
                <th>负责人</th>
                <th>状态</th>
                <th className="text-right pr-6">日期 / 操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && !loading && (
                <tr>
                  <td colSpan="6" className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                      <p className="font-medium text-slate-600">暂无订单</p>
                      <p className="text-sm mt-0.5">当前筛选条件下没有匹配的订单。</p>
                    </div>
                  </td>
                </tr>
              )}
              {orders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  role={role}
                  userId={userId}
                  openMoreMenu={openMoreMenu}
                  onSetMoreMenu={setOpenMoreMenu}
                  onUpdateStatus={doUpdateStatus}
                  onConfirmComplete={confirmComplete}
                  onHandleRefund={handleRefund}
                  onConfirmClose={confirmClose}
                  hasMoreActions={hasMoreActions(order)}
                  onPreviewImage={setPreviewImage}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-surface-container-low px-6 py-3.5 border-t border-outline-variant/20 flex justify-between items-center">
          <span className="text-[13px] font-medium text-slate-500">共 <span className="font-bold text-slate-700">{totalOrders}</span> 条</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { if (currentPage > 0) setCurrentPage(currentPage - 1); }} disabled={currentPage === 0} className={`inline-flex items-center justify-center gap-2 px-3 py-1 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm text-[12px] ${currentPage === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}>上一页</button>
            <span className="text-[13px] text-slate-500 font-medium px-3 tabular-nums">{currentPage + 1} / {totalPages}</span>
            <button onClick={() => { if (currentPage < totalPages - 1) setCurrentPage(currentPage + 1); }} disabled={currentPage >= totalPages - 1} className={`inline-flex items-center justify-center gap-2 px-3 py-1 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm text-[12px] ${currentPage >= totalPages - 1 ? 'opacity-40 cursor-not-allowed' : ''}`}>下一页</button>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-[12px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            自动刷新
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Memoized Order Row ──
const OrderRow = memo(function OrderRow({ order, role, userId, openMoreMenu, onSetMoreMenu, onUpdateStatus, onConfirmComplete, onHandleRefund, onConfirmClose, hasMoreActions, onPreviewImage }) {
  return (
    <tr className="group transition-colors hover:bg-[#FAFBFC]">
      <td className="pl-6">
        <div className="flex items-center gap-2.5">
          {order.screenshot_path ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPreviewImage(order.screenshot_path); }}
              className="w-9 h-9 rounded-lg border border-slate-200 overflow-hidden shrink-0 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer bg-slate-50"
              title="查看订单截图"
            >
              <img src={order.screenshot_path} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-lg border border-dashed border-slate-200 shrink-0 flex items-center justify-center text-slate-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
          )}
          <div>
            <Link to={`/orders/${order.id}`} className="font-semibold text-brand-500 hover:underline text-[13px] cursor-pointer">{order.order_sn}</Link>
            {order.topic && <div className="text-[12px] text-slate-500 mt-1 max-w-[160px] truncate" title={order.topic}>{order.topic}</div>}
          </div>
        </div>
      </td>
      <td className="text-[13px] text-slate-700 font-medium">
        {order.customer_contact ? (
          <Link to={`/customers?keyword=${encodeURIComponent(order.customer_contact)}`} className="text-brand-500 hover:underline cursor-pointer">{order.customer_contact}</Link>
        ) : '-'}
      </td>
      <td className="text-[14px] font-bold text-slate-800 tabular-nums">&yen;{order.price ? (order.price / 100).toFixed(2) : '0.00'}</td>
      <td className="text-[12px]">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-slate-500">
            <span className="w-12 text-slate-400">管家:</span>
            <span className="text-slate-700 font-medium bg-slate-50 px-1.5 py-0.5 rounded text-[11px]">{order.operator_id || '待分配'}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <span className="w-12 text-slate-400">设计:</span>
            <span className="text-slate-700 font-medium bg-slate-50 px-1.5 py-0.5 rounded text-[11px]">{order.designer_id || '待分配'}</span>
          </div>
        </div>
      </td>
      <td>
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[order.status]] || BADGE_VARIANT_CLASSES.secondary}`}>{STATUS_MAP[order.status] || order.status}</span>
      </td>
      <td className="text-right pr-6">
        <div className="text-[12px] text-slate-500 mb-2.5 font-medium tabular-nums">{formatTime(order.created_at)}</div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* sales: 确认需求 (GROUP_CREATED → CONFIRMED) */}
          {order.status === 'GROUP_CREATED' && (role === 'admin' || role === 'sales') && (
            <button onClick={() => onUpdateStatus(order, 'CONFIRMED')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[11px] active:scale-[0.98]">确认需求</button>
          )}
          {/* designer: 接手设计 (CONFIRMED → DESIGNING) */}
          {order.status === 'CONFIRMED' && (role === 'admin' || role === 'designer') && (
            <button onClick={() => onUpdateStatus(order, 'DESIGNING')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[11px] active:scale-[0.98]">接手设计</button>
          )}
          {/* designer: 标记交付 (DESIGNING → DELIVERED) */}
          {order.status === 'DESIGNING' && (role === 'admin' || (role === 'designer' && order.designer_id === userId)) && (
            <button onClick={() => onUpdateStatus(order, 'DELIVERED')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-success text-success hover:bg-success-bg text-[11px] bg-white active:scale-[0.98]">标记交付</button>
          )}
          {/* follow: 确认完成 (DELIVERED → COMPLETED) */}
          {order.status === 'DELIVERED' && (role === 'admin' || role === 'follow') && (
            <button onClick={() => onConfirmComplete(order)} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[11px] active:scale-[0.98]">标记完成</button>
          )}
          {/* follow: 需要修改 (DELIVERED → REVISION) */}
          {order.status === 'DELIVERED' && (role === 'admin' || role === 'follow') && (
            <button onClick={() => onUpdateStatus(order, 'REVISION')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-amber-400 text-amber-600 hover:bg-amber-50 text-[11px] bg-white active:scale-[0.98]">需要修改</button>
          )}
          {hasMoreActions && (
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); onSetMoreMenu(openMoreMenu === order.id ? null : order.id); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="更多操作">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" /></svg>
              </button>
              {openMoreMenu === order.id && (
                <div className="absolute right-0 top-8 w-40 bg-white rounded-xl shadow-xl border border-slate-200/80 z-50 overflow-hidden py-1" onClick={(e) => e.stopPropagation()}>
                  {/* follow: 标记售后 */}
                  {['DESIGNING','DELIVERED','COMPLETED'].includes(order.status) && (role === 'admin' || role === 'follow') && (
                    <button onClick={() => { onUpdateStatus(order, 'AFTER_SALE'); onSetMoreMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-orange-50 transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                      标记售后
                    </button>
                  )}
                  {/* follow: 退款 */}
                  {!['REFUNDED','CLOSED'].includes(order.status) && (role === 'admin' || role === 'follow') && (
                    <button onClick={() => { onHandleRefund(order); onSetMoreMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" /></svg>
                      退款
                    </button>
                  )}
                  {/* admin: 关闭订单 */}
                  {['PENDING','GROUP_CREATED','CONFIRMED','DESIGNING'].includes(order.status) && role === 'admin' && (
                    <button onClick={() => { onConfirmClose(order); onSetMoreMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      关闭订单
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
});
