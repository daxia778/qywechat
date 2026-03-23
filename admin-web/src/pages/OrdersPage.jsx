import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { useOrderFilters } from '../hooks/useOrderFilters';
import { useOrderActions } from '../hooks/useOrderActions';
import { getOrderDetail, getOrderTimeline } from '../api/orders';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES, ORDER_STATUSES } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/ui/PageHeader';
import ExportDialog from '../components/ExportDialog';

const EVENT_TYPE_MAP = {
  status_changed: (e) => STATUS_MAP[e.to_status] || e.to_status,
  amount_changed: () => '金额变更',
  pages_changed: () => '页数变更',
  designer_reassigned: () => '设计师转派',
  customer_matched: () => '关联客户',
};

const EVENT_BADGE_MAP = {
  amount_changed: 'warning',
  pages_changed: 'warning',
  designer_reassigned: 'secondary',
  customer_matched: 'primary',
};

function getTimelineEventLabel(event) {
  const fn = EVENT_TYPE_MAP[event.event_type];
  if (fn) return fn(event);
  if (event.to_status) return STATUS_MAP[event.to_status] || event.to_status;
  return event.event_type || '未知事件';
}

function getTimelineEventBadge(event) {
  if (EVENT_BADGE_MAP[event.event_type]) return EVENT_BADGE_MAP[event.event_type];
  return STATUS_BADGE_MAP[event.to_status] || 'secondary';
}

export default function OrdersPage() {
  const { role, userId } = useAuth();
  const { toast } = useToast();
  const { on, off, connected } = useWebSocket();

  const [openMoreMenu, setOpenMoreMenu] = useState(null);
  const [exportDialogVisible, setExportDialogVisible] = useState(false);

  const [modal, setModal] = useState({
    show: false, title: '', message: '', type: 'info', detail: null,
    showInput: false, inputPlaceholder: '', confirmText: '确认',
  });
  const actionRef = useRef(null);
  const [previewImage, setPreviewImage] = useState(null);

  // ── Image Lightbox zoom/pan state ──
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomTranslate, setZoomTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const zoomImageRef = useRef(null);

  const resetZoom = useCallback(() => {
    setZoomScale(1);
    setZoomTranslate({ x: 0, y: 0 });
    setIsDragging(false);
    setHasDragged(false);
  }, []);

  const openPreview = useCallback((src) => {
    setPreviewImage(src);
    resetZoom();
  }, [resetZoom]);

  const handleLightboxWheel = useCallback((e) => {
    e.preventDefault();
    const img = zoomImageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -1 : 1;
    const factor = 1 + delta * 0.15;
    setZoomScale((prev) => {
      const next = Math.min(Math.max(prev * factor, 0.5), 8);
      const imgX = mouseX / prev;
      const imgY = mouseY / prev;
      setZoomTranslate((t) => ({
        x: e.clientX - imgX * next - (rect.left - t.x),
        y: e.clientY - imgY * next - (rect.top - t.y),
      }));
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
    setHasDragged(false);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: 0, ty: 0 };
    setZoomTranslate((t) => {
      dragStart.current.tx = t.x;
      dragStart.current.ty = t.y;
      return t;
    });
    const onMove = (me) => {
      const dx = me.clientX - dragStart.current.x;
      const dy = me.clientY - dragStart.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setHasDragged(true);
      setZoomTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Drawer state ──
  const [drawerOrder, setDrawerOrder] = useState(null);
  const [drawerData, setDrawerData] = useState({ order: {}, timeline: [], people: {}, profit: {} });
  const [drawerLoading, setDrawerLoading] = useState(false);

  const openDrawer = async (order) => {
    setDrawerOrder(order);
    setDrawerLoading(true);
    try {
      const [detailRes, timelineRes] = await Promise.all([
        getOrderDetail(order.id),
        getOrderTimeline(order.id),
      ]);
      setDrawerData({
        order: detailRes.data.order || {},
        timeline: timelineRes.data.data || [],
        people: detailRes.data.people || {},
        profit: detailRes.data.profit || {},
      });
    } catch (err) {
      toast('加载详情失败', 'error');
    } finally {
      setDrawerLoading(false);
    }
  };

  const showModal = (opts, action) => {
    actionRef.current = action;
    setModal({ show: true, showInput: false, detail: null, confirmText: '确认', ...opts });
  };

  const onModalConfirm = (inputValue) => {
    setModal((m) => ({ ...m, show: false }));
    actionRef.current?.(inputValue);
  };

  // ── Extracted hooks (Fix #3) ──
  const {
    orders, loading, currentStatus, setCurrentStatus,
    searchKeyword, setSearchKeyword, totalOrders,
    currentPage, setCurrentPage, totalPages, fetchOrders,
  } = useOrderFilters({ toast, on, off, connected });

  const {
    selectedIds, setSelectedIds, batchLoading,
    reassignModal, setReassignModal, designers,
    selectedDesigner, setSelectedDesigner, reassignLoading,
    doUpdateStatus, confirmComplete, confirmClose, handleRefund,
    openReassignModal, doReassign, toggleSelect, toggleSelectAll,
    doBatchUpdate,
  } = useOrderActions({ toast, fetchOrders, showModal });

  // Clear selection when orders change (page switch, filter, refresh)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [orders, setSelectedIds]);

  // Close more menu on outside click
  useEffect(() => {
    const close = () => setOpenMoreMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const hasMoreActions = (order) => {
    if (['COMPLETED', 'REFUNDED', 'CLOSED'].includes(order.status)) return false;
    if (role === 'admin') return true;
    if (role === 'follow') return true;
    return false;
  };

  const handleExportExcel = () => setExportDialogVisible(true);

  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));

  // Fix #4: Wrap batchActions in useMemo
  const batchActions = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    const actions = [];
    const canComplete = selectedOrders.every((o) => ['DELIVERED', 'AFTER_SALE'].includes(o.status));
    if (canComplete && ['admin', 'sales', 'follow'].includes(role)) {
      actions.push({ status: 'COMPLETED', label: '批量完成', type: 'primary' });
    }
    const canClose = selectedOrders.every((o) => ['PENDING', 'GROUP_CREATED', 'CONFIRMED', 'DESIGNING', 'REVISION', 'AFTER_SALE'].includes(o.status));
    if (canClose && role === 'admin') {
      actions.push({ status: 'CLOSED', label: '批量关闭', type: 'danger' });
    }
    return actions;
  }, [selectedOrders, role]);

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
      <ExportDialog
        visible={exportDialogVisible}
        onClose={() => setExportDialogVisible(false)}
      />

      {/* Reassign Modal */}
      {reassignModal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setReassignModal({ show: false, order: null })} role="dialog" aria-modal="true" aria-label="转派订单" onKeyDown={(e) => { if (e.key === 'Escape') setReassignModal({ show: false, order: null }); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80">
              <h3 className="text-base font-bold text-slate-800">转派订单</h3>
              <p className="text-[13px] text-slate-500 mt-0.5">将订单 {reassignModal.order?.order_sn} 转派给其他设计师</p>
            </div>
            <div className="px-6 py-5">
              <div className="mb-4 p-3 bg-slate-50 rounded-xl text-[13px] space-y-1.5">
                <div className="flex justify-between"><span className="text-slate-500">当前设计师</span><span className="font-semibold text-slate-700">{reassignModal.order?.designer_id || '未分配'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">订单金额</span><span className="font-semibold text-slate-700">&yen;{reassignModal.order?.price ? (reassignModal.order.price / 100).toFixed(2) : '0.00'}</span></div>
              </div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-2">选择目标设计师</label>
              {designers.length === 0 ? (
                <p className="text-[13px] text-slate-400 py-4 text-center">暂无可用设计师</p>
              ) : (
                <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                  {designers.map((d) => (
                    <label
                      key={d.wecom_userid}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedDesigner === d.wecom_userid
                          ? 'border-brand-500 bg-brand-500/5 ring-1 ring-brand-500/20'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="reassign_designer"
                        value={d.wecom_userid}
                        checked={selectedDesigner === d.wecom_userid}
                        onChange={() => setSelectedDesigner(d.wecom_userid)}
                        className="accent-[#434FCF]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-slate-800">{d.name}</div>
                        <div className="text-[11px] text-slate-400">{d.wecom_userid}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${d.status === 'idle' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className="text-[11px] text-slate-500">{d.status === 'idle' ? '空闲' : `${d.active_order_count}单`}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex justify-end gap-2.5">
              <button
                onClick={() => setReassignModal({ show: false, order: null })}
                className="px-4 py-2 text-[13px] font-semibold rounded-xl text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={doReassign}
                disabled={!selectedDesigner || reassignLoading}
                className={`px-5 py-2 text-[13px] font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all cursor-pointer border-none shadow-sm ${
                  (!selectedDesigner || reassignLoading) ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {reassignLoading ? '转派中...' : '确认转派'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox (Portal to body with zoom/pan) */}
      {previewImage && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 backdrop-blur-[5px]"
          style={{ cursor: zoomScale > 1 ? 'grab' : 'zoom-out' }}
          onClick={() => { if (!hasDragged) setPreviewImage(null); setHasDragged(false); }}
          onWheel={handleLightboxWheel}
          role="dialog" aria-modal="true" aria-label="图片预览"
          onKeyDown={(e) => { if (e.key === 'Escape') setPreviewImage(null); }}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              ref={zoomImageRef}
              src={previewImage}
              alt="订单截图预览"
              className="max-h-[90vh] rounded-lg shadow-2xl object-contain select-none"
              style={{
                transform: `translate(${zoomTranslate.x}px, ${zoomTranslate.y}px) scale(${zoomScale})`,
                transformOrigin: '0 0',
                cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
                transition: isDragging ? 'none' : 'transform 0.15s ease-out',
                WebkitUserDrag: 'none',
              }}
              draggable={false}
              onMouseDown={handleDragStart}
            />
            {/* Zoom indicator */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3.5 py-1 rounded-full text-[13px] font-medium pointer-events-none backdrop-blur-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(zoomScale * 100)}%
            </div>
            {/* Close button */}
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition-colors cursor-pointer bg-transparent border-none"
              aria-label="关闭图片预览"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {/* Hint */}
            {zoomScale === 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 text-white/80 px-4 py-1.5 rounded-full text-xs pointer-events-none whitespace-nowrap backdrop-blur-sm">
                滚轮缩放 · 拖拽移动
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Title */}
      <PageHeader title="订单大厅" subtitle="管理和跟踪所有订单">
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
      </PageHeader>

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

        {/* Batch Action Toolbar */}
        {selectedIds.size > 0 && (
          <div className="px-6 py-3 bg-brand-500/5 border-b border-brand-500/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold text-brand-500">
                已选中 {selectedIds.size} 个订单
              </span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-[12px] text-slate-500 hover:text-slate-700 underline cursor-pointer bg-transparent border-none"
              >
                取消选择
              </button>
            </div>
            <div className="flex items-center gap-2">
              {batchActions.length === 0 && (
                <span className="text-[12px] text-slate-400">选中订单的状态不一致，无可用批量操作</span>
              )}
              {batchActions.map((action) => (
                <button
                  key={action.status}
                  onClick={() => doBatchUpdate(action.status, action.label, selectedOrders)}
                  disabled={batchLoading}
                  className={`inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold rounded-xl transition-all duration-150 cursor-pointer shadow-sm active:scale-[0.98] ${
                    action.type === 'danger'
                      ? 'text-white bg-red-500 hover:bg-red-600 border-none'
                      : 'text-white bg-brand-500 hover:bg-brand-600 border-none'
                  } ${batchLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {batchLoading ? '处理中...' : action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        <div className="w-full overflow-x-auto relative min-h-[450px]">
          {loading && orders.length === 0 && <LoadingSpinner />}
          <table>
            <thead>
              <tr>
                <th className="w-10 pl-4 pr-0">
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selectedIds.size === orders.length}
                    onChange={() => toggleSelectAll(orders)}
                    className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20 cursor-pointer accent-[#434FCF]"
                    title="全选/取消全选"
                  />
                </th>
                <th className="pl-2">订单信息</th>
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
                  <td colSpan="7" className="py-20 text-center">
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
                  selected={selectedIds.has(order.id)}
                  onToggleSelect={toggleSelect}
                  openMoreMenu={openMoreMenu}
                  onSetMoreMenu={setOpenMoreMenu}
                  onUpdateStatus={doUpdateStatus}
                  onConfirmComplete={confirmComplete}
                  onHandleRefund={handleRefund}
                  onConfirmClose={confirmClose}
                  hasMoreActions={hasMoreActions(order)}
                  onPreviewImage={openPreview}
                  onReassign={openReassignModal}
                  onOpenDrawer={openDrawer}
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

      {/* ── Order Detail Modal (Portal to body) ── */}
      {drawerOrder && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={() => setDrawerOrder(null)} role="dialog" aria-modal="true" aria-label="订单详情" onKeyDown={(e) => { if (e.key === 'Escape') setDrawerOrder(null); }}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[8px]" aria-hidden="true" />
          {/* Modal Panel */}
          <div
            className="relative w-[95vw] max-w-[960px] h-[90vh] max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50/80 to-white shrink-0">
              <div className="flex items-center gap-3">
                {/* 订单截图缩略图 - 优先用列表数据，再用详情数据 */}
                {(drawerOrder.screenshot_path || drawerData.order.screenshot_path) && (
                  <button
                    onClick={() => openPreview(drawerData.order.screenshot_path || drawerOrder.screenshot_path)}
                    className="w-10 h-10 rounded-lg border border-slate-200 overflow-hidden shrink-0 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer bg-slate-50"
                  >
                    <img src={drawerOrder.screenshot_path || drawerData.order.screenshot_path} alt="" className="w-full h-full object-cover" />
                  </button>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-800">订单详情</h3>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[drawerOrder.status]] || BADGE_VARIANT_CLASSES.secondary}`}>
                      {STATUS_MAP[drawerOrder.status] || drawerOrder.status}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 mt-0.5 font-mono">{drawerOrder.order_sn}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link to={`/orders/${drawerOrder.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors border border-brand-200">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  完整详情
                </Link>
                <button onClick={() => setDrawerOrder(null)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" aria-label="关闭订单详情">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden">
              {drawerLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-8 h-8 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="flex h-full">
                  {/* ── Left: 截图 + 图片 ── */}
                  <div className="w-[45%] border-r border-slate-100 overflow-y-auto p-5 space-y-4 bg-slate-50/30">
                    {/* 主截图 - 优先用列表行数据，再用详情API数据 */}
                    {(drawerOrder.screenshot_path || drawerData.order.screenshot_path) ? (
                      <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">订单截图</h4>
                        <img
                          src={drawerData.order.screenshot_path || drawerOrder.screenshot_path}
                          alt="订单截图"
                          className="w-full rounded-xl border border-slate-200 object-contain max-h-[360px] bg-white cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
                          onClick={() => openPreview(drawerData.order.screenshot_path || drawerOrder.screenshot_path)}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-300">
                        <svg className="w-16 h-16 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <p className="text-sm text-slate-400">暂无订单截图</p>
                      </div>
                    )}

                    {/* 附件图片 */}
                    {drawerData.order.attachment_urls && (() => {
                      try {
                        const urls = JSON.parse(drawerData.order.attachment_urls);
                        if (urls && urls.length > 0) {
                          return (
                            <div>
                              <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">备注图片 ({urls.length})</h4>
                              <div className="grid grid-cols-2 gap-2">
                                {urls.map((url, i) => (
                                  <img
                                    key={i}
                                    src={url}
                                    alt={`附件${i + 1}`}
                                    className="w-full aspect-square object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-80 transition-opacity bg-white shadow-sm"
                                    onClick={() => openPreview(url)}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        }
                      } catch { /* ignore parse error */ }
                      return null;
                    })()}
                  </div>

                  {/* ── Right: 订单信息 + 利润 + 时间线 ── */}
                  <div className="w-[55%] overflow-y-auto p-5 space-y-5">
                    {/* 金额卡片 */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl p-4 text-white shadow-sm">
                        <span className="text-[11px] font-medium opacity-80">订单金额</span>
                        <p className="text-2xl font-bold font-[Outfit] tabular-nums mt-0.5">&yen;{((drawerData.order.price || 0) / 100).toFixed(2)}</p>
                      </div>
                      {role === 'admin' && drawerData.profit.total_price > 0 && (
                        <div className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-4 text-white shadow-sm">
                          <span className="text-[11px] font-medium opacity-80">净利润</span>
                          <p className="text-2xl font-bold font-[Outfit] tabular-nums mt-0.5">&yen;{(drawerData.profit.net_profit / 100).toFixed(2)}</p>
                        </div>
                      )}
                    </div>

                    {/* 订单信息 */}
                    <div>
                      <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">订单信息</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        <InfoItem label="客户" value={drawerData.order.customer_contact || '-'} />
                        <InfoItem label="主题" value={drawerData.order.topic || '-'} />
                        <InfoItem label="页数" value={drawerData.order.pages || '-'} />
                        <InfoItem label="截止时间" value={drawerData.order.deadline ? formatTime(drawerData.order.deadline) : '无'} />
                        <InfoItem label="管家" value={drawerData.people.operator_name || drawerData.order.operator_id || '-'} />
                        <InfoItem label="设计师" value={drawerData.people.designer_name || drawerData.order.designer_id || '待分配'} />
                      </div>
                    </div>

                    {/* 备注 */}
                    {drawerData.order.remark && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">特殊备注</h4>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3.5 border border-slate-100 leading-relaxed">{drawerData.order.remark}</p>
                      </div>
                    )}

                    {/* 退款原因 */}
                    {drawerData.order.refund_reason && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-2">退款原因</h4>
                        <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3.5 border border-red-100">{drawerData.order.refund_reason}</p>
                      </div>
                    )}

                    {/* 利润明细 (admin only) */}
                    {role === 'admin' && drawerData.profit.total_price > 0 && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">利润明细</h4>
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                            <span className="text-[12px] text-slate-500">实付金额</span>
                            <span className="text-[14px] font-bold text-slate-800 tabular-nums">&yen;{(drawerData.profit.total_price / 100).toFixed(2)}</span>
                          </div>
                          {drawerData.profit.platform_fee_rate > 0 && (
                            <div className="flex justify-between items-center px-3 py-1.5 text-[12px]">
                              <span className="text-slate-400">平台费 ({drawerData.profit.platform_fee_rate}%)</span>
                              <span className="text-slate-600 tabular-nums">-&yen;{(drawerData.profit.platform_fee / 100).toFixed(2)}</span>
                            </div>
                          )}
                          {drawerData.profit.designer_rate > 0 && (
                            <div className="flex justify-between items-center px-3 py-1.5 text-[12px]">
                              <span className="text-slate-400">设计师 ({drawerData.profit.designer_rate}%)</span>
                              <span className="text-slate-600 tabular-nums">-&yen;{(drawerData.profit.designer_commission / 100).toFixed(2)}</span>
                            </div>
                          )}
                          {drawerData.profit.sales_rate > 0 && (
                            <div className="flex justify-between items-center px-3 py-1.5 text-[12px]">
                              <span className="text-slate-400">销售 ({drawerData.profit.sales_rate}%)</span>
                              <span className="text-slate-600 tabular-nums">-&yen;{(drawerData.profit.sales_commission / 100).toFixed(2)}</span>
                            </div>
                          )}
                          {drawerData.profit.follow_rate > 0 && (
                            <div className="flex justify-between items-center px-3 py-1.5 text-[12px]">
                              <span className="text-slate-400">跟单 ({drawerData.profit.follow_rate}%)</span>
                              <span className="text-slate-600 tabular-nums">-&yen;{(drawerData.profit.follow_commission / 100).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 时间线 */}
                    {drawerData.timeline.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">状态时间线</h4>
                        <div className="relative pl-5">
                          <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-brand-500/20 via-slate-200 to-slate-100" />
                          {drawerData.timeline.map((event, i) => {
                            const eventLabel = getTimelineEventLabel(event);
                            const eventBadge = getTimelineEventBadge(event);
                            return (
                            <div key={i} className="relative mb-3.5 last:mb-0">
                              <div className={`absolute -left-5 top-0.5 w-[14px] h-[14px] rounded-full border-2 flex items-center justify-center ${
                                i === drawerData.timeline.length - 1
                                  ? 'border-brand-500 bg-brand-500'
                                  : 'border-slate-300 bg-white'
                              }`}>
                                {i === drawerData.timeline.length - 1 && <div className="w-1 h-1 rounded-full bg-white" />}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${BADGE_VARIANT_CLASSES[eventBadge] || BADGE_VARIANT_CLASSES.secondary}`}>
                                    {eventLabel}
                                  </span>
                                  <span className="text-[11px] text-slate-400 tabular-nums">{formatTime(event.created_at)}</span>
                                </div>
                                {event.operator_name && <p className="text-[11px] text-slate-500 mt-0.5">操作人: {event.operator_name}</p>}
                                {event.remark && <p className="text-[11px] text-slate-400 mt-0.5">{event.remark}</p>}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Memoized Order Row ──
const OrderRow = memo(function OrderRow({ order, role, userId, selected, onToggleSelect, openMoreMenu, onSetMoreMenu, onUpdateStatus, onConfirmComplete, onHandleRefund, onConfirmClose, hasMoreActions, onPreviewImage, onReassign, onOpenDrawer }) {
  return (
    <tr className={`group transition-colors cursor-pointer ${selected ? 'bg-brand-500/5' : 'hover:bg-[#FAFBFC]'}`} onClick={() => onOpenDrawer(order)}>
      <td className="w-10 pl-4 pr-0" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(order.id)}
          className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20 cursor-pointer accent-[#434FCF]"
        />
      </td>
      <td className="pl-2">
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
            <Link to={`/orders/${order.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand-500 hover:underline text-[13px] cursor-pointer">{order.order_sn}</Link>
            {order.topic && <div className="text-[12px] text-slate-500 mt-1 max-w-[160px] truncate" title={order.topic}>{order.topic}</div>}
          </div>
        </div>
      </td>
      <td className="text-[13px] text-slate-700 font-medium" onClick={(e) => e.stopPropagation()}>
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
      <td className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
        <div className="text-[12px] text-slate-500 mb-2.5 font-medium tabular-nums">{formatTime(order.created_at)}</div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* sales: 确认需求 (GROUP_CREATED -> CONFIRMED) */}
          {order.status === 'GROUP_CREATED' && (role === 'admin' || role === 'sales') && (
            <button onClick={() => onUpdateStatus(order, 'CONFIRMED')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[11px] active:scale-[0.98]">确认需求</button>
          )}
          {/* designer: 接手设计 (CONFIRMED -> DESIGNING) */}
          {order.status === 'CONFIRMED' && (role === 'admin' || role === 'designer') && (
            <button onClick={() => onUpdateStatus(order, 'DESIGNING')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[11px] active:scale-[0.98]">接手设计</button>
          )}
          {/* designer: 标记交付 (DESIGNING -> DELIVERED) */}
          {order.status === 'DESIGNING' && (role === 'admin' || (role === 'designer' && order.designer_id === userId)) && (
            <button onClick={() => onUpdateStatus(order, 'DELIVERED')} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-success text-success hover:bg-success-bg text-[11px] bg-white active:scale-[0.98]">标记交付</button>
          )}
          {/* follow: 确认完成 (DELIVERED -> COMPLETED) */}
          {order.status === 'DELIVERED' && (role === 'admin' || role === 'follow') && (
            <button onClick={() => onConfirmComplete(order)} className="inline-flex items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[11px] active:scale-[0.98]">标记完成</button>
          )}
          {/* follow: 需要修改 (DELIVERED -> REVISION) */}
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
                  {/* Fix #2: Refund permission - only admin and sales, NOT follow */}
                  {!['REFUNDED','CLOSED'].includes(order.status) && (role === 'admin' || role === 'sales') && (
                    <button onClick={() => { onHandleRefund(order); onSetMoreMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" /></svg>
                      退款
                    </button>
                  )}
                  {/* admin: 转派设计师 */}
                  {['GROUP_CREATED','CONFIRMED','DESIGNING','DELIVERED','REVISION','AFTER_SALE'].includes(order.status) && order.designer_id && role === 'admin' && (
                    <button onClick={() => { onReassign(order); onSetMoreMenu(null); }} className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                      转派设计师
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

// ── Info Item (Drawer helper) ──
function InfoItem({ label, value, bold, span2 }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <p className={`text-sm mt-0.5 ${bold ? 'font-bold text-slate-800' : 'text-slate-700'} truncate`} title={typeof value === 'string' ? value : ''}>{value}</p>
    </div>
  );
}
