import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { getOrderDetail, getOrderTimeline, updateOrderStatus, updateOrderAmount, searchDesigners, assignDesigner, adjustCommission } from '../api/orders';
import { getCustomerDetail } from '../api/customers';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';

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

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, userId } = useAuth();
  const { toast } = useToast();

  const [order, setOrder] = useState({});
  const [timeline, setTimeline] = useState([]);
  const [profit, setProfit] = useState({
    total_price: 0, platform_fee: 0, designer_commission: 0,
    sales_commission: 0, follow_commission: 0, net_profit: 0,
    platform_fee_rate: 0, designer_rate: 0, sales_rate: 0, follow_rate: 0,
  });
  const [people, setPeople] = useState({ operator_name: '', designer_name: '' });
  const [customer, setCustomer] = useState(null);
  const [modal, setModal] = useState({
    show: false, title: '', message: '', type: 'info', detail: null,
    showInput: false, inputPlaceholder: '', confirmText: '确认',
  });
  const actionRef = useRef(null);

  // 金额/页数修改状态
  const [showAmountEdit, setShowAmountEdit] = useState(false);
  const [editPrice, setEditPrice] = useState('');
  const [editPages, setEditPages] = useState('');
  const [editRemark, setEditRemark] = useState('');
  const [amountSubmitting, setAmountSubmitting] = useState(false);

  // Image lightbox state
  const [previewImage, setPreviewImage] = useState(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomTranslate, setZoomTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const zoomImgRef = useRef(null);

  // 关联设计师状态
  const [designerQuery, setDesignerQuery] = useState('');
  const [designerResults, setDesignerResults] = useState([]);
  const [designerSearching, setDesignerSearching] = useState(false);
  const [showDesignerDropdown, setShowDesignerDropdown] = useState(false);
  const [assigningDesigner, setAssigningDesigner] = useState(false);
  const [showNewDesignerForm, setShowNewDesignerForm] = useState(false);
  const [newDesignerName, setNewDesignerName] = useState('');
  const [newDesignerWechat, setNewDesignerWechat] = useState('');
  const [newDesignerPhone, setNewDesignerPhone] = useState('');
  const [newDesignerSpecialty, setNewDesignerSpecialty] = useState('');

  // 调整佣金状态
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [commissionRate, setCommissionRate] = useState('');
  const [commissionSubmitting, setCommissionSubmitting] = useState(false);

  const designerSearchRef = useRef(null);

  const openPreview = useCallback((src) => {
    setPreviewImage(src);
    setZoomScale(1);
    setZoomTranslate({ x: 0, y: 0 });
    setIsDragging(false);
    setHasDragged(false);
  }, []);

  const handleLightboxWheel = useCallback((e) => {
    e.preventDefault();
    const img = zoomImgRef.current;
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
    dragStartRef.current = { x: e.clientX, y: e.clientY, tx: 0, ty: 0 };
    setZoomTranslate((t) => {
      dragStartRef.current.tx = t.x;
      dragStartRef.current.ty = t.y;
      return t;
    });
    const onMove = (me) => {
      const dx = me.clientX - dragStartRef.current.x;
      const dy = me.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setHasDragged(true);
      setZoomTranslate({ x: dragStartRef.current.tx + dx, y: dragStartRef.current.ty + dy });
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // 设计师搜索防抖
  useEffect(() => {
    if (!designerQuery.trim()) {
      setDesignerResults([]);
      setShowDesignerDropdown(false);
      return;
    }
    setDesignerSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchDesigners(designerQuery.trim());
        const list = res.data.data || res.data.designers || [];
        setDesignerResults(list);
        setShowDesignerDropdown(true);
      } catch {
        setDesignerResults([]);
      } finally {
        setDesignerSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [designerQuery]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e) => {
      if (designerSearchRef.current && !designerSearchRef.current.contains(e.target)) {
        setShowDesignerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doAssignDesigner = async (designerId) => {
    setAssigningDesigner(true);
    try {
      await assignDesigner(id, { freelance_designer_id: designerId });
      toast('设计师关联成功', 'success');
      setDesignerQuery('');
      setShowDesignerDropdown(false);
      fetchDetail();
    } catch (err) {
      toast('关联失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setAssigningDesigner(false);
    }
  };

  const doCreateAndAssignDesigner = async () => {
    if (!newDesignerName.trim()) {
      toast('设计师名字不能为空', 'warning');
      return;
    }
    setAssigningDesigner(true);
    try {
      await assignDesigner(id, { designer_name: newDesignerName.trim(), wechat: newDesignerWechat, phone: newDesignerPhone, specialty: newDesignerSpecialty });
      toast('新建设计师并关联成功', 'success');
      setShowNewDesignerForm(false);
      setNewDesignerName('');
      setNewDesignerWechat('');
      setNewDesignerPhone('');
      setNewDesignerSpecialty('');
      setDesignerQuery('');
      fetchDetail();
    } catch (err) {
      toast('新建失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setAssigningDesigner(false);
    }
  };

  const doAdjustCommission = async () => {
    const val = parseFloat(commissionRate);
    if (isNaN(val) || val < 0 || val > 100) {
      toast('请输入 0-100 之间的数值', 'warning');
      return;
    }
    setCommissionSubmitting(true);
    try {
      await adjustCommission(id, { designer_commission_rate: val });
      toast('佣金比例调整成功', 'success');
      setShowCommissionModal(false);
      fetchDetail();
    } catch (err) {
      toast('调整失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setCommissionSubmitting(false);
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

  const fetchDetail = useCallback(async (signal) => {
    try {
      const [detailRes, timelineRes] = await Promise.all([
        getOrderDetail(id, { signal }),
        getOrderTimeline(id, { signal }),
      ]);
      setOrder(detailRes.data.order || {});
      setProfit((prev) => detailRes.data.profit || prev);
      setPeople((prev) => detailRes.data.people || prev);
      setTimeline(timelineRes.data.data || []);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      toast('加载订单详情失败: ' + err.message, 'error');
    }
  }, [id, toast]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDetail(controller.signal);
    return () => controller.abort();
  }, [fetchDetail]);

  // Fetch customer details when order has customer_id
  useEffect(() => {
    if (!order.customer_id) {
      setCustomer(null);
      return;
    }
    let cancelled = false;
    getCustomerDetail(order.customer_id)
      .then((res) => { if (!cancelled) setCustomer(res.data.customer || res.data.data || res.data); })
      .catch(() => { if (!cancelled) setCustomer(null); });
    return () => { cancelled = true; };
  }, [order.customer_id]);

  const doUpdateStatus = async (newStatus, refundReason = '') => {
    try {
      await updateOrderStatus(order.id, { status: newStatus, refund_reason: refundReason });
      toast(`订单 ${order.order_sn} 状态已更新`, 'success');
      fetchDetail();
    } catch (err) {
      toast('更新失败: ' + (err.displayMessage || err.message), 'error');
    }
  };

  const canOperate = (requiredRole) => {
    if (role === 'admin') return true;
    if (requiredRole === 'follow' && role === 'follow') return true;
    if (requiredRole === 'sales' && role === 'sales') return true;
    if (requiredRole === 'designer' && role === 'designer' && order.designer_id === userId) return true;
    // backward compat: operator maps to follow
    if (requiredRole === 'operator' && role === 'follow') return true;
    return false;
  };

  // 是否可修改金额/页数: designer(自己的单) 或 admin，且非终态
  const canEditAmount = () => {
    if (['COMPLETED', 'REFUNDED', 'CLOSED'].includes(order.status)) return false;
    if (role === 'admin') return true;
    if (role === 'designer' && order.designer_id === userId) return true;
    return false;
  };

  const openAmountEdit = () => {
    setEditPrice(((order.price ?? 0) / 100).toFixed(2));
    setEditPages(String(order.pages ?? 0));
    setEditRemark('');
    setShowAmountEdit(true);
  };

  const doUpdateAmount = async () => {
    const newPriceCents = Math.round(parseFloat(editPrice) * 100);
    const newPages = parseInt(editPages, 10);

    if (isNaN(newPriceCents) || newPriceCents <= 0) {
      toast('请输入有效的金额', 'warning');
      return;
    }
    if (isNaN(newPages) || newPages < 0) {
      toast('请输入有效的页数', 'warning');
      return;
    }
    if (newPriceCents === order.price && newPages === order.pages) {
      toast('金额和页数均未变化', 'warning');
      return;
    }

    setAmountSubmitting(true);
    try {
      const payload = { remark: editRemark };
      if (newPriceCents !== order.price) payload.price = newPriceCents;
      if (newPages !== order.pages) payload.pages = newPages;

      await updateOrderAmount(order.id, payload);
      toast('金额/页数修改成功', 'success');
      setShowAmountEdit(false);
      fetchDetail();
    } catch (err) {
      toast('修改失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setAmountSubmitting(false);
    }
  };

  return (
    <>
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <ConfirmModal
        visible={modal.show} title={modal.title} message={modal.message} type={modal.type}
        detail={modal.detail} showInput={modal.showInput} inputPlaceholder={modal.inputPlaceholder}
        confirmText={modal.confirmText} onConfirm={onModalConfirm}
        onCancel={() => setModal((m) => ({ ...m, show: false }))}
      />

      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/orders')} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors border border-slate-200">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-800 font-[Outfit] tracking-tight">订单详情</h1>
          <p className="text-[13px] text-slate-500 mt-0.5 font-mono">{order.order_sn}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {order.commission_adjusted && (
            <span className="inline-flex items-center gap-1 rounded-full font-semibold tracking-wide text-[12px] py-1 px-3 bg-amber-50 text-amber-700 border border-amber-200">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              佣金已调整
            </span>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full font-semibold tracking-wide text-[13px] py-1 px-3 ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[order.status]] || BADGE_VARIANT_CLASSES.secondary}`}>
            {STATUS_MAP[order.status] || order.status}
          </span>
        </div>
      </div>

      {/* Action Bar */}
      {order.status && !['REFUNDED', 'CLOSED'].includes(order.status) && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="px-6 py-4 flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-slate-500 mr-auto">操作:</span>
            {/* 标记完成 (进行中状态 → COMPLETED) */}
            {['DESIGNING', 'REVISION', 'AFTER_SALE'].includes(order.status) && canOperate('follow') && (
              <button onClick={() => showModal({
                title: '完成订单', message: `确认已收到尾款并将订单 ${order.order_sn} 标记为完成？`,
                type: 'info', confirmText: '确认完成',
                detail: { '订单号': order.order_sn, '金额': `¥${((order.price ?? 0) / 100).toFixed(2)}` },
              }, () => doUpdateStatus('COMPLETED'))} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-success text-success hover:bg-success-bg text-[12px] bg-white active:scale-[0.98]">标记完成</button>
            )}
            {/* 退款 (DESIGNING/REVISION/AFTER_SALE/COMPLETED → REFUNDED) */}
            {['DESIGNING', 'REVISION', 'AFTER_SALE', 'COMPLETED'].includes(order.status) && canOperate('follow') && (
              <button onClick={() => showModal({
                title: '退款', message: `请填写订单 ${order.order_sn} 的退款原因：`,
                type: 'warning', showInput: true, inputPlaceholder: '退款原因（必填）', confirmText: '提交退款',
              }, (reason) => {
                if (!reason?.trim()) { toast('退款原因不能为空', 'warning'); return; }
                doUpdateStatus('REFUNDED', reason);
              })} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-amber-400 text-amber-600 hover:bg-amber-50 text-[12px] bg-white active:scale-[0.98]">退款</button>
            )}
            {/* 调整佣金 (非终态时可用) */}
            {!['COMPLETED'].includes(order.status) && canOperate('follow') && (
              <button onClick={() => { setCommissionRate(String(profit.designer_rate || 0)); setShowCommissionModal(true); }} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-purple-400 text-purple-600 hover:bg-purple-50 text-[12px] bg-white active:scale-[0.98]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                调整佣金
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Left: Info + Profit */}
        <div className="xl:col-span-3 flex flex-col gap-6">
          {/* Basic Info */}
          <div className="bg-surface-container-lowest ghost-border rounded-xl">
            <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
                  <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">订单信息</h2>
              </div>
              {canEditAmount() && !showAmountEdit && (
                <button onClick={openAmountEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors border border-brand-200 cursor-pointer active:scale-[0.97]">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  修改金额/页数
                </button>
              )}
            </div>
            <div className="p-6 grid grid-cols-2 gap-y-5 gap-x-8">
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">订单号</span>
                <p className="text-sm font-semibold text-slate-800 mt-1 font-mono">{order.order_sn}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">客户</span>
                <p className="text-sm font-semibold text-slate-800 mt-1 flex items-center gap-1.5">
                  <span>{order.customer_contact || '-'}</span>
                  {order.customer_contact && (
                    <Link to={`/customers?keyword=${encodeURIComponent(order.customer_contact)}`} className="text-brand-500 hover:text-brand-600 transition-colors" title="查看顾客详情">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </Link>
                  )}
                </p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">主题</span>
                <p className="text-sm font-semibold text-slate-800 mt-1">{order.topic || '-'}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">页数</span>
                <p className="text-sm font-semibold text-slate-800 mt-1">{order.pages || '-'}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">操作员</span>
                <p className="text-sm font-semibold text-slate-800 mt-1">{people.operator_name || order.operator_id}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">设计师</span>
                <p className="text-sm font-semibold text-slate-800 mt-1 flex items-center gap-2">
                  {order.freelance_designer_name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      {order.freelance_designer_name}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">未关联设计师</span>
                  )}
                </p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">订单金额</span>
                <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">&yen;{((order.price ?? 0) / 100).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">创建时间</span>
                <p className="text-sm text-slate-700 mt-1 tabular-nums">{formatTime(order.created_at)}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">截止时间</span>
                <p className="text-sm text-slate-700 mt-1 tabular-nums">{order.deadline ? formatTime(order.deadline) : '无'}</p>
              </div>
              {order.order_time && (
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">下单时间</span>
                  <p className="text-sm text-slate-700 mt-1 tabular-nums">{order.order_time}</p>
                </div>
              )}
              {order.remark && (
                <div className="col-span-2">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">备注</span>
                  <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{order.remark}</p>
                </div>
              )}
              {order.refund_reason && (
                <div className="col-span-2">
                  <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">退款原因</span>
                  <p className="text-sm text-red-600 mt-1 bg-red-50 rounded-lg p-3">{order.refund_reason}</p>
                </div>
              )}
            </div>

            {/* 金额/页数修改表单 */}
            {showAmountEdit && (
              <div className="px-6 pb-6">
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    <h3 className="text-sm font-bold text-amber-800">修改金额 / 页数</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">金额 (元)</label>
                      <input
                        type="number" step="0.01" min="0.01"
                        value={editPrice} onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all tabular-nums"
                        placeholder="输入新金额"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">页数</label>
                      <input
                        type="number" step="1" min="0"
                        value={editPages} onChange={(e) => setEditPages(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all tabular-nums"
                        placeholder="输入新页数"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">修改原因</label>
                      <input
                        type="text"
                        value={editRemark} onChange={(e) => setEditRemark(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                        placeholder="如: 客户加页5页"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={doUpdateAmount} disabled={amountSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white bg-brand-500 hover:bg-brand-600 transition-all cursor-pointer border-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
                    >
                      {amountSubmitting ? '提交中...' : '确认修改'}
                    </button>
                    <button
                      onClick={() => setShowAmountEdit(false)} disabled={amountSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-slate-600 bg-white hover:bg-slate-50 transition-all cursor-pointer border border-slate-300 disabled:opacity-50 active:scale-[0.97]"
                    >
                      取消
                    </button>
                    <span className="text-[11px] text-slate-400 ml-auto">
                      当前: &yen;{((order.price ?? 0) / 100).toFixed(2)} / {order.pages ?? 0} 页
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 关联设计师区域 (admin/follow 可见) */}
          {canOperate('follow') && (
            <div className="bg-surface-container-lowest ghost-border rounded-xl">
              <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-50">
                  <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">关联设计师</h2>
                {order.freelance_designer_name && (
                  <span className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                    已关联: {order.freelance_designer_name}
                  </span>
                )}
              </div>
              <div className="p-6">
                <div ref={designerSearchRef} className="relative">
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">搜索花名册</label>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input
                      type="text"
                      value={designerQuery}
                      onChange={(e) => setDesignerQuery(e.target.value)}
                      onFocus={() => { if (designerResults.length > 0) setShowDesignerDropdown(true); }}
                      className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                      placeholder="输入设计师名字搜索..."
                      disabled={assigningDesigner}
                    />
                    {designerSearching && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* 搜索结果下拉 */}
                  {showDesignerDropdown && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {designerResults.length > 0 ? (
                        designerResults.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => doAssignDesigner(d.id)}
                            disabled={assigningDesigner}
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 border-b border-slate-100 last:border-b-0 cursor-pointer disabled:opacity-50"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{d.name}</p>
                              {d.specialty && <p className="text-xs text-slate-500 mt-0.5 truncate">{d.specialty}</p>}
                            </div>
                            <span className="text-xs text-slate-400 shrink-0 tabular-nums">{d.total_orders ?? 0} 单</span>
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-center">
                          <p className="text-sm text-slate-400 mb-3">未找到匹配的设计师</p>
                          <button
                            onClick={() => { setShowDesignerDropdown(false); setShowNewDesignerForm(true); setNewDesignerName(designerQuery); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-brand-600 bg-brand-50 hover:bg-brand-100 transition-colors border border-brand-200 cursor-pointer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            新建设计师
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 新建设计师表单 */}
                {showNewDesignerForm && (
                  <div className="mt-4 bg-violet-50/60 border border-violet-200 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                      <h3 className="text-sm font-bold text-violet-800">新建设计师</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">名字 <span className="text-red-400">*</span></label>
                        <input
                          type="text" value={newDesignerName} onChange={(e) => setNewDesignerName(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                          placeholder="设计师名字"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">微信号</label>
                        <input
                          type="text" value={newDesignerWechat} onChange={(e) => setNewDesignerWechat(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                          placeholder="选填"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">手机号</label>
                        <input
                          type="text" value={newDesignerPhone} onChange={(e) => setNewDesignerPhone(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                          placeholder="选填"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">擅长方向</label>
                        <input
                          type="text" value={newDesignerSpecialty} onChange={(e) => setNewDesignerSpecialty(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                          placeholder="如: PPT/海报/Logo"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-4">
                      <button
                        onClick={doCreateAndAssignDesigner} disabled={assigningDesigner}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white bg-brand-500 hover:bg-brand-600 transition-all cursor-pointer border-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
                      >
                        {assigningDesigner ? '提交中...' : '新建并关联'}
                      </button>
                      <button
                        onClick={() => setShowNewDesignerForm(false)} disabled={assigningDesigner}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-slate-600 bg-white hover:bg-slate-50 transition-all cursor-pointer border border-slate-300 disabled:opacity-50 active:scale-[0.97]"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Customer Info */}
          {customer && (
            <div className="bg-surface-container-lowest ghost-border rounded-xl">
              <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-50">
                    <svg className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  </div>
                  <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">顾客信息</h2>
                </div>
                {order.wecom_chat_id && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-bg text-green-900">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    已建群
                  </span>
                )}
              </div>
              <div className="p-6 grid grid-cols-2 gap-y-5 gap-x-8">
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">昵称</span>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{customer.nickname || '-'}</p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">微信号</span>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{customer.wechat_id || '-'}</p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">手机号</span>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{customer.mobile || '-'}</p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">历史订单数</span>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{customer.total_orders || 0}</p>
                </div>
              </div>
            </div>
          )}

          {/* Group Chat Indicator (when no customer but has chat) */}
          {!customer && order.wecom_chat_id && (
            <div className="bg-surface-container-lowest ghost-border rounded-xl px-6 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-success-bg">
                <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <span className="text-sm font-semibold text-slate-700">企微群聊已创建</span>
              <span className="text-xs text-slate-400 font-mono">{order.wecom_chat_id}</span>
            </div>
          )}

          {/* Profit (admin only) */}
          {role === 'admin' && <div className="bg-surface-container-lowest ghost-border rounded-xl">
            <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-success-bg">
                  <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">利润明细</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100 hover:border-slate-200 transition-colors overflow-hidden">
                  <p className="text-[11px] text-slate-500 mb-1 font-medium truncate">总价</p>
                  <p className="text-lg font-bold text-slate-800 font-[Outfit] tabular-nums truncate">&yen;{(profit.total_price / 100).toFixed(2)}</p>
                </div>
                <div className="bg-red-50/60 rounded-xl p-3 text-center border border-red-100 hover:border-red-200 transition-colors overflow-hidden">
                  <p className="text-[11px] text-slate-500 mb-1 font-medium truncate">平台费 ({profit.platform_fee_rate}%)</p>
                  <p className="text-lg font-bold text-red-600 font-[Outfit] tabular-nums truncate">&yen;{(profit.platform_fee / 100).toFixed(2)}</p>
                </div>
                <div className="bg-blue-50/60 rounded-xl p-3 text-center border border-blue-100 hover:border-blue-200 transition-colors overflow-hidden">
                  <p className="text-[11px] text-slate-500 mb-1 font-medium truncate">设计师 ({profit.designer_rate}%)</p>
                  <p className="text-lg font-bold text-blue-600 font-[Outfit] tabular-nums truncate">&yen;{(profit.designer_commission / 100).toFixed(2)}</p>
                </div>
                <div className="bg-purple-50/60 rounded-xl p-3 text-center border border-purple-100 hover:border-purple-200 transition-colors overflow-hidden">
                  <p className="text-[11px] text-slate-500 mb-1 font-medium truncate">谈单客服 ({profit.sales_rate}%)</p>
                  <p className="text-lg font-bold text-purple-600 font-[Outfit] tabular-nums truncate">&yen;{(profit.sales_commission / 100).toFixed(2)}</p>
                </div>
                <div className="bg-amber-50/60 rounded-xl p-3 text-center border border-amber-100 hover:border-amber-200 transition-colors overflow-hidden">
                  <p className="text-[11px] text-slate-500 mb-1 font-medium truncate">跟单客服 ({profit.follow_rate}%)</p>
                  <p className="text-lg font-bold text-amber-600 font-[Outfit] tabular-nums truncate">&yen;{(profit.follow_commission / 100).toFixed(2)}</p>
                </div>
                <div className="bg-green-50/60 rounded-xl p-3 text-center border border-green-100 hover:border-green-200 transition-colors overflow-hidden">
                  <p className="text-[11px] text-slate-500 mb-1 font-medium truncate">净利润</p>
                  <p className="text-lg font-bold text-green-600 font-[Outfit] tabular-nums truncate">&yen;{(profit.net_profit / 100).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>}
        </div>

        {/* Right: Timeline + Images */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          <div className="bg-surface-container-lowest ghost-border rounded-xl">
            <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
                  <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">状态时间线</h2>
              </div>
            </div>
            <div className="p-6">
              {timeline.length === 0 ? (
                <div className="text-center text-sm text-slate-400 py-10">
                  <svg className="w-10 h-10 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  暂无记录
                </div>
              ) : (
                <div className="relative pl-6">
                  <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-brand-500/20 via-slate-200 to-slate-100" />
                  {timeline.map((event, i) => {
                    const eventLabel = getTimelineEventLabel(event);
                    const eventBadge = getTimelineEventBadge(event);
                    return (
                    <div key={i} className="relative mb-6 last:mb-0">
                      <div className={`absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-all ${
                        i === timeline.length - 1
                          ? 'border-brand-500 bg-brand-500 shadow-sm shadow-brand-500/30'
                          : 'border-slate-300 bg-white'
                      }`}>
                        {i === timeline.length - 1 && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide text-[10px] ${BADGE_VARIANT_CLASSES[eventBadge] || BADGE_VARIANT_CLASSES.secondary}`}>{eventLabel}</span>
                          <span className="text-[11px] text-slate-400 tabular-nums">{formatTime(event.created_at)}</span>
                        </div>
                        {event.operator_name && <p className="text-xs text-slate-500 mt-1">操作人: {event.operator_name}</p>}
                        {event.remark && <p className="text-xs text-slate-500 mt-0.5 italic">{event.remark}</p>}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Screenshots & Attachments */}
          {(order.screenshot_path || order.attachment_urls) && (
            <div className="bg-surface-container-lowest ghost-border rounded-xl">
              <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-50">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">订单图片</h2>
              </div>
              <div className="p-6 space-y-5">
                {order.screenshot_path && (
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">订单截图</span>
                    <img
                      src={order.screenshot_path}
                      alt="订单截图"
                      className="max-w-full max-h-[400px] rounded-xl border border-slate-200 object-contain bg-white cursor-pointer hover:opacity-90 transition-opacity shadow-sm"
                      onClick={() => openPreview(order.screenshot_path)}
                    />
                  </div>
                )}
                {order.attachment_urls && (() => {
                  try {
                    const urls = JSON.parse(order.attachment_urls);
                    if (urls && urls.length > 0) {
                      return (
                        <div>
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">备注图片 ({urls.length})</span>
                          <div className="grid grid-cols-2 gap-3">
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
                  } catch { /* ignore */ }
                  return null;
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* Image Lightbox (Portal) */}
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
              ref={zoomImgRef}
              src={previewImage}
              alt="图片预览"
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
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white px-3.5 py-1 rounded-full text-[13px] font-medium pointer-events-none backdrop-blur-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(zoomScale * 100)}%
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition-colors cursor-pointer bg-transparent border-none"
              aria-label="关闭"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            {zoomScale === 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 text-white/80 px-4 py-1.5 rounded-full text-xs pointer-events-none whitespace-nowrap backdrop-blur-sm">
                滚轮缩放 · 拖拽移动
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 调整佣金 Modal (Portal) */}
      {showCommissionModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => setShowCommissionModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="font-bold text-slate-800 text-lg font-[Outfit]">调整佣金比例</h3>
              </div>
              <button onClick={() => setShowCommissionModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer bg-transparent border-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5">
              <div className="bg-slate-50 rounded-xl p-4 mb-5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">当前设计师佣金比例</p>
                <p className="text-2xl font-bold text-slate-800 font-[Outfit] tabular-nums">{profit.designer_rate || 0}%</p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1.5">新佣金比例 (%)</label>
                <input
                  type="number" step="1" min="0" max="100"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all tabular-nums"
                  placeholder="输入 0-100 之间的数值"
                  autoFocus
                />
                <p className="text-[11px] text-slate-400 mt-2">修改后将影响该订单的设计师佣金计算</p>
              </div>
            </div>
            <div className="px-6 pb-6 pt-2 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowCommissionModal(false)} disabled={commissionSubmitting}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer bg-transparent border-none disabled:opacity-50 active:scale-[0.97]"
              >
                取消
              </button>
              <button
                onClick={doAdjustCommission} disabled={commissionSubmitting}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-lg text-white bg-brand-500 hover:bg-brand-600 transition-all cursor-pointer border-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
              >
                {commissionSubmitting ? '提交中...' : '确认调整'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
