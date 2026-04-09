import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from './useDebounce';
import { usePolling } from './usePolling';
import { listOrders } from '../api/orders';

export function useOrderFilters({ toast, on, off, connected }) {
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(() => searchParams.get('status') || '');
  const [searchKeyword, setSearchKeyword] = useState(() => searchParams.get('keyword') || '');
  const debouncedKeyword = useDebounce(searchKeyword, 400);
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));

  const fetchOrders = useCallback(async (manual = false, signal) => {
    if (manual) setLoading(true);
    try {
      const params = { limit: pageSize, offset: currentPage * pageSize };
      if (currentStatus) params.status = currentStatus; // 支持逗号分隔多状态，如 "DESIGNING,REVISION,AFTER_SALE"
      if (debouncedKeyword.trim()) params.keyword = debouncedKeyword.trim();
      const res = await listOrders(params, { signal });
      setOrders(res.data.data || []);
      setTotalOrders(res.data.total || 0);
      if (manual) toast('订单数据已刷新', 'success');
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      if (manual) toast('获取订单失败: ' + (err.displayMessage || err.message), 'error');
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

  return {
    orders,
    loading,
    currentStatus,
    setCurrentStatus,
    searchKeyword,
    setSearchKeyword,
    totalOrders,
    currentPage,
    setCurrentPage,
    pageSize,
    totalPages,
    fetchOrders,
  };
}
