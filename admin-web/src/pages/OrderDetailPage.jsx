import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { getOrderDetail, getOrderTimeline, updateOrderStatus } from '../api/orders';
import { STATUS_MAP, STATUS_BADGE_MAP } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';

const BADGE_VARIANT_CLASSES = {
  success: 'bg-success-bg text-green-900',
  warning: 'bg-warning-bg text-amber-800',
  danger: 'bg-danger-bg text-red-800',
  primary: 'bg-brand-50 text-brand-500',
  secondary: 'bg-slate-100 text-slate-500',
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, userId } = useAuth();
  const { toast } = useToast();

  const [order, setOrder] = useState({});
  const [timeline, setTimeline] = useState([]);
  const [profit, setProfit] = useState({
    total_price: 0, platform_fee: 0, designer_commission: 0, net_profit: 0,
    platform_fee_rate: 0, designer_rate: 0,
  });
  const [people, setPeople] = useState({ operator_name: '', designer_name: '' });
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

  const fetchDetail = useCallback(async () => {
    try {
      const [detailRes, timelineRes] = await Promise.all([
        getOrderDetail(id),
        getOrderTimeline(id),
      ]);
      setOrder(detailRes.data.order || {});
      setProfit((prev) => detailRes.data.profit || prev);
      setPeople((prev) => detailRes.data.people || prev);
      setTimeline(timelineRes.data.data || []);
    } catch (err) {
      toast('加载订单详情失败: ' + err.message, 'error');
    }
  }, [id, toast]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const doUpdateStatus = async (newStatus, refundReason = '') => {
    try {
      await updateOrderStatus(order.id, { status: newStatus, refund_reason: refundReason });
      toast(`订单 ${order.order_sn} 状态已更新`, 'success');
      fetchDetail();
    } catch (err) {
      toast('更新失败: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const canOperate = (requiredRole) => {
    if (role === 'admin') return true;
    if (requiredRole === 'operator' && role === 'operator' && order.operator_id === userId) return true;
    if (requiredRole === 'designer' && role === 'designer' && order.designer_id === userId) return true;
    return false;
  };

  return (
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
        <span className={`ml-auto inline-flex items-center gap-1 rounded-full font-semibold tracking-wide text-[13px] py-1 px-3 ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[order.status]] || BADGE_VARIANT_CLASSES.secondary}`}>
          {STATUS_MAP[order.status] || order.status}
        </span>
      </div>

      {/* Action Bar */}
      {order.status && !['COMPLETED', 'REFUNDED', 'CLOSED'].includes(order.status) && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="px-6 py-4 flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-slate-500 mr-auto">操作:</span>
            {order.status === 'PENDING' && canOperate('operator') && (
              <button onClick={() => doUpdateStatus('GROUP_CREATED')} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[12px] active:scale-[0.98]">确认建群</button>
            )}
            {order.status === 'GROUP_CREATED' && !order.designer_id && canOperate('operator') && (
              <button onClick={() => doUpdateStatus('DESIGNING')} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[12px] active:scale-[0.98]">分配设计</button>
            )}
            {order.status === 'DESIGNING' && canOperate('designer') && (
              <button onClick={() => doUpdateStatus('DELIVERED')} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-success text-success hover:bg-success-bg text-[12px] bg-white active:scale-[0.98]">标记交付</button>
            )}
            {order.status === 'DELIVERED' && canOperate('operator') && (
              <button onClick={() => showModal({
                title: '完成订单', message: `确认已收到尾款并将订单 ${order.order_sn} 标记为完成？`,
                type: 'info', confirmText: '确认完成',
                detail: { '订单号': order.order_sn, '金额': `¥${((order.price ?? 0) / 100).toFixed(2)}` },
              }, () => doUpdateStatus('COMPLETED'))} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[12px] active:scale-[0.98]">标记完成</button>
            )}
            {canOperate('operator') && (
              <>
                <button onClick={() => showModal({
                  title: '退款 / 售后', message: `请填写订单 ${order.order_sn} 的退款原因：`,
                  type: 'warning', showInput: true, inputPlaceholder: '退款原因（必填）', confirmText: '提交退款',
                }, (reason) => {
                  if (!reason?.trim()) { toast('退款原因不能为空', 'warning'); return; }
                  doUpdateStatus('REFUNDED', reason);
                })} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-150 cursor-pointer border border-amber-400 text-amber-600 hover:bg-amber-50 text-[12px] bg-white active:scale-[0.98]">退款/售后</button>
                {role === 'admin' && ['PENDING','GROUP_CREATED','DESIGNING'].includes(order.status) && (
                  <button onClick={() => showModal({
                    title: '关闭订单', message: `确定要强制关闭订单 ${order.order_sn} 吗？此操作不可撤销。`,
                    type: 'danger', confirmText: '关闭订单',
                  }, () => doUpdateStatus('CLOSED'))} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-danger hover:bg-red-600 transition-all duration-150 cursor-pointer border-none shadow-sm text-[12px] active:scale-[0.98]">关闭订单</button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          {/* Basic Info */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
                  <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">订单信息</h2>
              </div>
            </div>
            <div className="p-6 grid grid-cols-2 gap-y-5 gap-x-8">
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">订单号</span>
                <p className="text-sm font-semibold text-slate-800 mt-1 font-mono">{order.order_sn}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">客户</span>
                <p className="text-sm font-semibold text-slate-800 mt-1">{order.customer_contact || '-'}</p>
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
                <p className="text-sm font-semibold text-slate-800 mt-1">{people.designer_name || order.designer_id || '待分配'}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">创建时间</span>
                <p className="text-sm text-slate-700 mt-1 tabular-nums">{formatTime(order.created_at)}</p>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">截止时间</span>
                <p className="text-sm text-slate-700 mt-1 tabular-nums">{order.deadline ? formatTime(order.deadline) : '无'}</p>
              </div>
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
          </div>

          {/* Profit */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-success-bg">
                  <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">利润明细</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100 hover:border-slate-200 transition-colors">
                  <p className="text-[11px] text-slate-500 mb-1.5 font-medium">总价</p>
                  <p className="text-xl font-bold text-slate-800 font-[Outfit] tabular-nums">&yen;{(profit.total_price / 100).toFixed(2)}</p>
                </div>
                <div className="bg-red-50/60 rounded-xl p-4 text-center border border-red-100 hover:border-red-200 transition-colors">
                  <p className="text-[11px] text-slate-500 mb-1.5 font-medium">平台费 ({profit.platform_fee_rate}%)</p>
                  <p className="text-xl font-bold text-red-600 font-[Outfit] tabular-nums">&yen;{(profit.platform_fee / 100).toFixed(2)}</p>
                </div>
                <div className="bg-blue-50/60 rounded-xl p-4 text-center border border-blue-100 hover:border-blue-200 transition-colors">
                  <p className="text-[11px] text-slate-500 mb-1.5 font-medium">设计师 ({profit.designer_rate}%)</p>
                  <p className="text-xl font-bold text-blue-600 font-[Outfit] tabular-nums">&yen;{(profit.designer_commission / 100).toFixed(2)}</p>
                </div>
                <div className="bg-green-50/60 rounded-xl p-4 text-center border border-green-100 hover:border-green-200 transition-colors">
                  <p className="text-[11px] text-slate-500 mb-1.5 font-medium">净利润</p>
                  <p className="text-xl font-bold text-green-600 font-[Outfit] tabular-nums">&yen;{(profit.net_profit / 100).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Timeline */}
        <div className="xl:col-span-1">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] h-full">
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
                  {timeline.map((event, i) => (
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
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide text-[10px] ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[event.to_status]] || BADGE_VARIANT_CLASSES.secondary}`}>{STATUS_MAP[event.to_status] || event.to_status}</span>
                          <span className="text-[11px] text-slate-400 tabular-nums">{formatTime(event.created_at)}</span>
                        </div>
                        {event.operator_name && <p className="text-xs text-slate-500 mt-1">操作人: {event.operator_name}</p>}
                        {event.remark && <p className="text-xs text-slate-500 mt-0.5 italic">{event.remark}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
