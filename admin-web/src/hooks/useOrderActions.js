import { useState, useCallback } from 'react';
import { updateOrderStatus, batchUpdateOrderStatus, reassignOrder } from '../api/orders';
import { listEmployees } from '../api/admin';
import { STATUS_MAP } from '../utils/constants';

export function useOrderActions({ toast, fetchOrders, showModal }) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [reassignModal, setReassignModal] = useState({ show: false, order: null });
  const [designers, setDesigners] = useState([]);
  const [selectedDesigner, setSelectedDesigner] = useState('');
  const [reassignLoading, setReassignLoading] = useState(false);

  const doUpdateStatus = useCallback(async (order, newStatus, refundReason = '') => {
    try {
      await updateOrderStatus(order.id, { status: newStatus, refund_reason: refundReason });
      toast(`订单 ${order.order_sn} 状态已更新`, 'success');
      fetchOrders();
    } catch (err) {
      toast('更新失败: ' + (err.displayMessage || err.message), 'error');
    }
  }, [toast, fetchOrders]);

  const confirmComplete = useCallback((order) => {
    showModal({
      title: '完成订单', message: `确认已收到尾款并将订单 ${order.order_sn} 标记为完成？`,
      type: 'info', confirmText: '确认完成',
      detail: { '订单号': order.order_sn, '金额': `\u00A5${order.price ? (order.price / 100).toFixed(2) : '0.00'}` },
    }, () => doUpdateStatus(order, 'COMPLETED'));
  }, [showModal, doUpdateStatus]);

  const confirmClose = useCallback((order) => {
    showModal({
      title: '关闭订单', message: `确定要强制关闭订单 ${order.order_sn} 吗？此操作不可撤销。`,
      type: 'danger', confirmText: '关闭订单',
      detail: { '订单号': order.order_sn, '金额': `\u00A5${order.price ? (order.price / 100).toFixed(2) : '0.00'}`, '状态': STATUS_MAP[order.status] },
    }, () => doUpdateStatus(order, 'CLOSED'));
  }, [showModal, doUpdateStatus]);

  const handleRefund = useCallback((order) => {
    showModal({
      title: '退款 / 售后', message: `请填写订单 ${order.order_sn} 的退款原因：`,
      type: 'warning', showInput: true, inputPlaceholder: '退款原因（必填）', confirmText: '提交退款',
      detail: { '订单号': order.order_sn, '金额': `\u00A5${order.price ? (order.price / 100).toFixed(2) : '0.00'}` },
    }, (reason) => {
      if (!reason?.trim()) { toast('退款原因不能为空', 'warning'); return; }
      doUpdateStatus(order, 'REFUNDED', reason);
    });
  }, [showModal, doUpdateStatus, toast]);

  // ── Reassign ──
  const openReassignModal = useCallback(async (order) => {
    setReassignModal({ show: true, order });
    setSelectedDesigner('');
    try {
      const res = await listEmployees({ params: { role: 'designer' } });
      const list = (res.data.data || []).filter(
        (d) => d.is_active && d.wecom_userid !== order.designer_id
      );
      setDesigners(list);
    } catch {
      toast('获取设计师列表失败', 'error');
      setDesigners([]);
    }
  }, [toast]);

  const doReassign = useCallback(async () => {
    if (!selectedDesigner) {
      toast('请选择目标设计师', 'warning');
      return;
    }
    setReassignLoading(true);
    try {
      await reassignOrder(reassignModal.order.id, selectedDesigner);
      toast(`订单 ${reassignModal.order.order_sn} 已成功转派`, 'success');
      setReassignModal({ show: false, order: null });
      fetchOrders();
    } catch (err) {
      toast('转派失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setReassignLoading(false);
    }
  }, [selectedDesigner, reassignModal.order, toast, fetchOrders]);

  // ── Batch Selection ──
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((orders) => {
    if (selectedIds.size === orders.length && orders.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map((o) => o.id)));
    }
  }, [selectedIds.size]);

  const doBatchUpdate = useCallback((targetStatus, label, selectedOrders) => {
    showModal({
      title: label,
      message: `确定要将选中的 ${selectedOrders.length} 个订单${label.replace('批量', '')}吗？`,
      type: targetStatus === 'CLOSED' ? 'danger' : 'info',
      confirmText: label,
      detail: { '选中订单数': `${selectedOrders.length} 个`, '目标状态': STATUS_MAP[targetStatus] || targetStatus },
    }, async () => {
      setBatchLoading(true);
      try {
        const res = await batchUpdateOrderStatus({
          order_ids: Array.from(selectedIds),
          status: targetStatus,
        });
        const data = res.data;
        if (data.fail_count > 0) {
          const failedItems = (data.results || []).filter((r) => !r.success);
          const failMsg = failedItems.map((r) => `${r.order_sn || r.order_id}: ${r.error}`).join('; ');
          toast(`${data.message}. 失败: ${failMsg}`, 'warning');
        } else {
          toast(data.message, 'success');
        }
        setSelectedIds(new Set());
        fetchOrders();
      } catch (err) {
        toast('批量操作失败: ' + (err.displayMessage || err.message), 'error');
      } finally {
        setBatchLoading(false);
      }
    });
  }, [showModal, selectedIds, toast, fetchOrders]);

  return {
    selectedIds,
    setSelectedIds,
    batchLoading,
    reassignModal,
    setReassignModal,
    designers,
    selectedDesigner,
    setSelectedDesigner,
    reassignLoading,
    doUpdateStatus,
    confirmComplete,
    confirmClose,
    handleRefund,
    openReassignModal,
    doReassign,
    toggleSelect,
    toggleSelectAll,
    doBatchUpdate,
  };
}
