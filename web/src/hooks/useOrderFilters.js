import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from './useDebounce';
import { usePolling } from './usePolling';
import { useThrottledCallback } from './useThrottledCallback';
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

  // 轮询降频: WS 已处理实时更新，轮询仅作兜底
  // 有 WS 连接时 5min 一次，无连接时 2min 一次
  usePolling(fetchOrders, connected ? 300000 : 120000);

  // WS 事件节流: 2s 内多次 order_updated 只触发一次 fetch
  // 业务场景: 批量操作（连续改状态/改金额）不会打出 N 个请求
  const throttledFetchOrders = useThrottledCallback(fetchOrders, 2000);
  useEffect(() => {
    on('order_updated', throttledFetchOrders);
    return () => off('order_updated', throttledFetchOrders);
  }, [on, off, throttledFetchOrders]);

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

