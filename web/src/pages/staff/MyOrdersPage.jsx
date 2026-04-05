import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useOrderFilters } from '../../hooks/useOrderFilters';
import { useOrderActions } from '../../hooks/useOrderActions';
import { getOrderDetail, getOrderTimeline, adjustCommission, searchDesigners, assignDesigner } from '../../api/orders';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES, ORDER_TABS } from '../../utils/constants';
import { formatTime } from '../../utils/formatters';
import ConfirmModal from '../../components/ConfirmModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/ui/PageHeader';

const EVENT_TYPE_MAP = {
  status_changed: (e) => STATUS_MAP[e.to_status] || e.to_status,
  amount_changed: () => '金额变更',
  pages_changed: () => '页数变更',
  designer_reassigned: () => '设计师转派',
  designer_assigned: () => '关联设计师',
  commission_adjusted: () => '佣金调整',
  customer_matched: () => '关联客户',
};

const EVENT_BADGE_MAP = {
  amount_changed: 'warning',
  pages_changed: 'warning',
  designer_reassigned: 'secondary',
  designer_assigned: 'primary',
  commission_adjusted: 'warning',
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

export default function MyOrdersPage() {
  const { role, userId } = useAuth();
  const { toast } = useToast();
  const { on, off, connected } = useWebSocket();

  // ── Modal state ──
  const [modal, setModal] = useState({
    show: false, title: '', message: '', type: 'info', detail: null,
    showInput: false, inputPlaceholder: '', confirmText: '确认',
  });
  const actionRef = useRef(null);

  const showModal = (opts, action) => {
    actionRef.current = action;
    setModal({ show: true, showInput: false, detail: null, confirmText: '确认', ...opts });
  };

  const onModalConfirm = (inputValue) => {
    setModal((m) => ({ ...m, show: false }));
    actionRef.current?.(inputValue);
  };

  // ── Image Lightbox state ──
  const [previewImage, setPreviewImage] = useState(null);
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
  const [drawerData, setDrawerData] = useState({ order: {}, timeline: [], people: {} });
  const [drawerLoading, setDrawerLoading] = useState(false);

  // ── Commission adjustment state ──
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [commissionRate, setCommissionRate] = useState('');
  const [commissionSubmitting, setCommissionSubmitting] = useState(false);

  // ── Designer assignment modal state ──
  const [designerModal, setDesignerModal] = useState({ visible: false, order: null });
  const [designerList, setDesignerList] = useState([]);
  const [designerQuery, setDesignerQuery] = useState('');
  const [designerLoading, setDesignerLoading] = useState(false);
  const [assigningDesigner, setAssigningDesigner] = useState(false);
  const designerSearchTimer = useRef(null);

  const doAdjustCommission = async () => {
    const val = parseFloat(commissionRate);
    if (isNaN(val) || val < 0) {
      toast('请输入有效的佣金金额', 'warning');
      return;
    }
    if (!drawerOrder) return;
    setCommissionSubmitting(true);
    try {
      await adjustCommission(drawerOrder.id, { designer_commission: val });
      toast('佣金调整成功', 'success');
      setShowCommissionModal(false);
      const [detailRes, timelineRes] = await Promise.all([
        getOrderDetail(drawerOrder.id),
        getOrderTimeline(drawerOrder.id),
      ]);
      setDrawerData({
        order: detailRes.data.order || {},
        timeline: timelineRes.data.data || [],
        people: detailRes.data.people || {},
      });
      fetchOrders();
    } catch (err) {
      toast('调整失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setCommissionSubmitting(false);
    }
  };

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
      });
    } catch {
      toast('加载详情失败', 'error');
    } finally {
      setDrawerLoading(false);
    }
  };

  // ── URL 参数同步 ──
  const [searchParams] = useSearchParams();

  // ── Hooks ──
  const {
    orders, loading, currentStatus, setCurrentStatus,
    searchKeyword, setSearchKeyword, totalOrders,
    currentPage, setCurrentPage, totalPages, fetchOrders,
  } = useOrderFilters({ toast, on, off, connected });

  // 从 URL ?status= 同步到 hook（工作台跳转过来时用）
  useEffect(() => {
    const urlStatus = searchParams.get('status') || '';
    if (urlStatus !== currentStatus) {
      setCurrentStatus(urlStatus);
      setCurrentPage(0);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const {
    doUpdateStatus, confirmComplete, handleRefund,
  } = useOrderActions({ toast, fetchOrders, showModal });

  const openDesignerModal = useCallback(async (order) => {
    setDesignerModal({ visible: true, order });
    setDesignerQuery('');
    setDesignerLoading(true);
    try {
      const res = await searchDesigners('');
      setDesignerList(res.data?.data || []);
    } catch {
      setDesignerList([]);
    } finally {
      setDesignerLoading(false);
    }
  }, []);

  const handleDesignerSearch = useCallback((q) => {
    setDesignerQuery(q);
    if (designerSearchTimer.current) clearTimeout(designerSearchTimer.current);
    designerSearchTimer.current = setTimeout(async () => {
      setDesignerLoading(true);
      try {
        const res = await searchDesigners(q);
        setDesignerList(res.data?.data || []);
      } catch {
        setDesignerList([]);
      } finally {
        setDesignerLoading(false);
      }
    }, 300);
  }, []);

  const handleAssignDesigner = useCallback(async (designer) => {
    if (!designerModal.order || assigningDesigner) return;
    setAssigningDesigner(true);
    try {
      await assignDesigner(designerModal.order.id, { freelance_designer_id: designer.id });
      toast(`已分配设计师: ${designer.name}`, 'success');
      setDesignerModal({ visible: false, order: null });
      fetchOrders();
    } catch (err) {
      toast('分配失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setAssigningDesigner(false);
    }
  }, [designerModal.order, assigningDesigner, toast, fetchOrders]);

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1200px] mx-auto">
      {modal.show && createPortal(
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
        />,
        document.body
      )}

      {/* Commission Adjustment Modal */}
      {showCommissionModal && createPortal(
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowCommissionModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="font-bold text-slate-800 text-lg font-[Outfit]">调整佣金</h3>
              </div>
              <button onClick={() => setShowCommissionModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer bg-transparent border-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">设计师佣金金额 (元)</label>
                <input
                  type="number" step="1" min="0"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && commissionRate) { e.preventDefault(); doAdjustCommission(); } }}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all tabular-nums"
                  placeholder="输入佣金金额（整数元）"
                  autoFocus
                />
                <p className="text-[11px] text-slate-400 mt-2">修改后将直接设置该订单的设计师佣金</p>
              </div>
            </div>
            <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
              <button onClick={() => setShowCommissionModal(false)} disabled={commissionSubmitting} className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer bg-transparent border-none disabled:opacity-50">取消</button>
              <button onClick={doAdjustCommission} disabled={commissionSubmitting} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl bg-purple-500 hover:bg-purple-600 transition-all cursor-pointer border-none shadow-sm disabled:opacity-50 active:scale-[0.97]">
                {commissionSubmitting ? '调整中...' : '确认调整'}
              </button>
            </div>
          </div>
        </div>,
        document.body
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
        <button onClick={() => fetchOrders(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm" disabled={loading}>
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>{loading ? '同步中...' : '刷新'}</span>
        </button>
      </PageHeader>

      {/* Main Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden hover:border-[#434FCF]/20 transition-colors">
        {/* Tabs & Search */}
        <div className="px-6 border-b border-slate-200 bg-white flex justify-between items-center gap-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pt-3" role="tablist" aria-label="订单状态筛选">
            {ORDER_TABS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={currentStatus === s.key}
                onClick={() => { setCurrentStatus(s.key); setCurrentPage(0); }}
                className={`pb-3 px-3 text-[13px] font-semibold border-b-2 transition-all whitespace-nowrap bg-transparent cursor-pointer rounded-t-md ${
                  currentStatus === s.key
                    ? 'border-brand-500 text-brand-500'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {s.label}
                {s.key === 'PENDING' && currentStatus === 'PENDING' && totalOrders > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-warning-bg text-warning text-[10px] font-bold" title={`共 ${totalOrders} 条待处理订单`}>
                    {totalOrders}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="py-3 shrink-0">
            <div className="relative w-52">
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                type="text"
                placeholder="搜索订单..."
                aria-label="搜索订单"
                className="w-full pl-9 pr-3 py-1.5 text-[13px] text-slate-800 bg-slate-50 border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:bg-white focus:border-slate-300 focus:shadow-[0_0_0_3px_rgba(67,79,207,0.08)]"
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="w-full overflow-hidden relative min-h-[450px]">
          {loading && orders.length === 0 && <LoadingSpinner />}
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="text-left" style={{ paddingLeft: 36 }}>订单信息</th>
                <th className="text-center">客户</th>
                <th className="text-center">金额</th>
                <th className="text-center">负责人</th>
                <th className="text-center">状态</th>
                <th className="text-center">操作</th>
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
                  onUpdateStatus={doUpdateStatus}
                  onConfirmComplete={confirmComplete}
                  onHandleRefund={handleRefund}
                  onPreviewImage={openPreview}
                  onOpenDrawer={openDrawer}
                  onAssignDesigner={openDesignerModal}
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

      {/* ── Order Detail Drawer (Portal to body) ── */}
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
                <Link to={`/s/orders/${drawerOrder.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors border border-brand-200">
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
                  {/* Left: Screenshots + Images */}
                  <div className="w-[45%] border-r border-slate-100 overflow-y-auto p-5 space-y-4 bg-slate-50/30">
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

                    {/* Attachment images */}
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

                  {/* Right: Order info + Timeline */}
                  <div className="w-[55%] overflow-y-auto p-5 space-y-5">
                    {/* Amount card */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl p-4 text-white shadow-sm">
                        <span className="text-[11px] font-medium opacity-80">订单金额</span>
                        <p className="text-2xl font-bold font-[Outfit] tabular-nums mt-0.5">&yen;{(((drawerData.order.price || 0) + (drawerData.order.extra_price || 0)) / 100).toFixed(2)}</p>
                        {drawerData.order.extra_price > 0 && (
                          <div className="flex items-center gap-2 mt-1.5 text-[11px] opacity-80">
                            <span>首次: &yen;{((drawerData.order.price || 0) / 100).toFixed(2)}</span>
                            <span className="text-amber-200 font-semibold">+补款: &yen;{(drawerData.order.extra_price / 100).toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 佣金调整入口 (follow/admin, 非退款状态) */}
                    {(role === 'admin' || role === 'follow') && !['REFUNDED', 'CLOSED'].includes(drawerOrder?.status) && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => { setCommissionRate(''); setShowCommissionModal(true); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold rounded-xl border border-purple-200 text-purple-600 bg-white hover:bg-purple-50 hover:border-purple-300 transition-all cursor-pointer active:scale-[0.97]"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          调整佣金
                        </button>
                        {drawerData.order.commission_adjusted && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                            已调整
                          </span>
                        )}
                      </div>
                    )}

                    {/* Order info */}
                    <div>
                      <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">订单信息</h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        <InfoItem label="客户" value={drawerData.order.customer_contact || '-'} />
                        <InfoItem label="主题" value={drawerData.order.topic || '-'} />
                        <InfoItem label="页数" value={drawerData.order.pages || '-'} />
                        <InfoItem label="截止时间" value={drawerData.order.deadline ? formatTime(drawerData.order.deadline) : '无'} />
                        <InfoItem label="管家" value={drawerData.people.operator_name || drawerData.order.operator_id || '-'} />
                        <InfoItem label="设计师" value={drawerData.order.freelance_designer_name || drawerData.people.designer_name || drawerData.order.designer_id || '待分配'} />
                      </div>
                    </div>

                    {/* Remark */}
                    {drawerData.order.remark && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">特殊备注</h4>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3.5 border border-slate-100 leading-relaxed">{drawerData.order.remark}</p>
                      </div>
                    )}

                    {/* Refund reason */}
                    {drawerData.order.refund_reason && (
                      <div>
                        <h4 className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-2">退款原因</h4>
                        <p className="text-sm text-red-600 bg-red-50 rounded-xl p-3.5 border border-red-100">{drawerData.order.refund_reason}</p>
                      </div>
                    )}

                    {/* Timeline */}
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

      {/* ── Designer Assignment Modal (Portal to body) ── */}
      {designerModal.visible && createPortal(
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setDesignerModal({ visible: false, order: null })}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-scale-in" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 pt-6 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-50">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-lg font-[Outfit]">分配设计师</h3>
                  {designerModal.order && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {designerModal.order.order_sn} · <span className="font-semibold text-slate-500">&yen;{((designerModal.order.price || 0) / 100).toFixed(2)}</span>
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setDesignerModal({ visible: false, order: null })} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer bg-transparent border-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Search */}
            <div className="px-6 pb-3">
              <div className="relative">
                <input
                  type="text"
                  value={designerQuery}
                  onChange={(e) => handleDesignerSearch(e.target.value)}
                  placeholder="搜索设计师姓名..."
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none transition-all placeholder:text-slate-400 focus:bg-white focus:border-indigo-300 focus:shadow-[0_0_0_3px_rgba(67,79,207,0.08)]"
                  autoFocus
                />
                <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            </div>

            {/* Designer List */}
            <div className="px-6 pb-6 max-h-[340px] overflow-y-auto">
              {designerLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : designerList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <svg className="w-10 h-10 mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <p className="text-sm font-medium">未找到设计师</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {designerList.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => handleAssignDesigner(d)}
                      disabled={assigningDesigner}
                      className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-transparent hover:border-indigo-200 hover:bg-indigo-50/50 transition-all cursor-pointer bg-transparent text-left group disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                        {(d.name || '?')[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">{d.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {d.specialty || '设计师'}
                          {d.total_orders != null && <span className="ml-2 text-slate-300">·</span>}
                          {d.total_orders != null && <span className="ml-1">{d.total_orders} 单</span>}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  ))}
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
const OrderRow = memo(function OrderRow({ order, role, onUpdateStatus, onConfirmComplete, onHandleRefund, onPreviewImage, onOpenDrawer, onAssignDesigner }) {
  const isCommissionAdjusted = order.commission_adjusted;
  const canRefund = ['DESIGNING', 'REVISION', 'AFTER_SALE', 'COMPLETED'].includes(order.status) && (role === 'admin' || role === 'follow');

  return (
    <tr className={`group relative transition-colors cursor-pointer ${isCommissionAdjusted ? 'border-l-4 border-l-amber-400 bg-amber-100/70' : 'hover:bg-[#FAFBFC]'}`} onClick={() => onOpenDrawer(order)}>
      <td className="overflow-hidden">
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
          <div className="min-w-0 flex-1">
            <Link to={`/s/orders/${order.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-brand-500 hover:underline text-[13px] cursor-pointer block truncate" title={order.order_sn}>{order.order_sn}</Link>
            {order.topic && <div className="text-[12px] text-slate-500 mt-1 truncate" title={order.topic}>{order.topic}</div>}
          </div>
        </div>
      </td>
      <td className="text-center text-[13px] text-slate-700 font-medium overflow-hidden text-ellipsis">
        {order.customer_contact ? (
          <span className="block truncate">{order.customer_contact}</span>
        ) : '-'}
      </td>
      <td className="text-center text-[14px] font-bold text-slate-800 tabular-nums whitespace-nowrap">
        &yen;{((order.price + (order.extra_price || 0)) / 100).toFixed(2)}
        {order.extra_price > 0 && (
          <span className="ml-1 text-[10px] font-medium text-indigo-500 bg-indigo-50 px-1 py-0.5 rounded">+补</span>
        )}
        {order.commission_adjusted && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 ml-1 -mt-1" title="佣金已调整" />
        )}
      </td>
      <td className="text-[12px] text-center overflow-hidden">
        <div className="inline-flex flex-col gap-1 text-left">
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="text-slate-400 text-[11px]">谈单</span>
            <span className="text-slate-700 font-medium text-[11px] truncate">{order.operator_id || '待分配'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="text-slate-400 text-[11px]">跟单</span>
            <span className="text-slate-700 font-medium text-[11px] truncate">{order.follow_operator_id || '待分配'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <span className="text-slate-400 text-[11px]">设计</span>
            <span className="text-slate-700 font-medium text-[11px] truncate">{order.freelance_designer_name || order.designer_id || '待分配'}</span>
          </div>
        </div>
      </td>
      <td className="text-center">
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide whitespace-nowrap ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[order.status]] || BADGE_VARIANT_CLASSES.secondary}`}>{STATUS_MAP[order.status] || order.status}</span>
      </td>
      <td className="text-center relative" onClick={(e) => e.stopPropagation()}>
          {/* 下一步操作按钮（每个状态只显示一个） */}
          {(() => {
            const canOperate = role === 'admin' || role === 'follow';
            const btnBase = "inline-flex items-center justify-center w-[72px] py-1.5 text-[11px] font-semibold rounded-lg transition-all duration-150 cursor-pointer active:scale-[0.97]";
            if (!canOperate) return null;
            // 待处理类（含旧状态 GROUP_CREATED / CONFIRMED）→ 分配设计师（打开侧抽屉）
            if (['PENDING', 'GROUP_CREATED', 'CONFIRMED'].includes(order.status)) return <button onClick={() => onAssignDesigner(order)} className={`${btnBase} border border-purple-200 text-purple-600 hover:bg-purple-50 bg-white`}>分配设计师</button>;
            // 进行中类（含旧状态 DELIVERED）→ 完成
            if (['DESIGNING', 'REVISION', 'AFTER_SALE', 'DELIVERED'].includes(order.status)) return <button onClick={() => onConfirmComplete(order)} className={`${btnBase} border border-emerald-200 text-emerald-600 hover:bg-emerald-50 bg-white`}>完成</button>;
            // 已完成 → 退款（需确认+填写原因）
            if (order.status === 'COMPLETED') return <button onClick={() => onHandleRefund(order)} className={`${btnBase} border border-red-200 text-red-600 hover:bg-red-50 bg-white`}>退款</button>;
            // 终态（REFUNDED / CLOSED）→ 无操作
            return null;
          })()}
      </td>
    </tr>
  );
});

// ── Info Item (Drawer helper) ──
function InfoItem({ label, value }) {
  return (
    <div>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <p className="text-sm mt-0.5 text-slate-700 truncate" title={typeof value === 'string' ? value : ''}>{value}</p>
    </div>
  );
}
