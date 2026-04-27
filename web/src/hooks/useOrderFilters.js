import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from './useDebounce';
import { usePolling } from './usePolling';
import { useThrottledCallback } from './useThrottledCallback';
import { listOrders } from '../api/orders';

/** 本地日期格式化 (避免 toISOString UTC 时区偏移) */
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 根据 preset key 计算日期范围 */
function computePresetDates(preset) {
  const now = new Date();
  const todayStr = toLocalDateStr(now);

  if (preset === 'today') {
    return { start: todayStr, end: todayStr };
  }
  if (preset === 'week') {
    const day = now.getDay() || 7; // Sunday → 7
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    return { start: toLocalDateStr(monday), end: todayStr };
  }
  if (preset === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toLocalDateStr(first), end: todayStr };
  }
  return { start: '', end: '' };
}

export function useOrderFilters({ toast, on, off, connected }) {
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentStatus, setCurrentStatus] = useState(() => searchParams.get('status') || '');
  const [searchKeyword, setSearchKeyword] = useState(() => searchParams.get('keyword') || '');
  const debouncedKeyword = useDebounce(searchKeyword, 400);
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  // 快捷日期预设 (独立 toggle)
  const [datePreset, setDatePreset] = useState(null); // 'today' | 'week' | 'month' | null

  // 手动日期选择 (日历)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 有效日期 — 快捷预设优先，否则用手动日期
  const effectiveDates = useMemo(() => {
    if (datePreset) return computePresetDates(datePreset);
    return { start: startDate, end: endDate };
  }, [datePreset, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));

  // 请求取消 — 防止竞态覆盖
  const abortRef = useRef(null);
  const fetchIdRef = useRef(0);

  const fetchOrders = useCallback(async (manual = false) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchIdRef.current;

    if (manual) setLoading(true);
    try {
      const params = { limit: pageSize, offset: currentPage * pageSize };
      if (currentStatus) params.status = currentStatus;
      if (debouncedKeyword.trim()) params.keyword = debouncedKeyword.trim();
      if (effectiveDates.start) params.start_date = effectiveDates.start;
      if (effectiveDates.end) params.end_date = effectiveDates.end;

      const res = await listOrders(params, { signal: controller.signal });
      if (fetchId !== fetchIdRef.current) return;

      setOrders(res.data.data || []);
      setTotalOrders(res.data.total || 0);
      if (manual) toast('订单数据已刷新', 'success');
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      if (fetchId !== fetchIdRef.current) return;
      if (manual) toast('获取订单失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false);
    }
  }, [currentPage, currentStatus, debouncedKeyword, effectiveDates.start, effectiveDates.end, toast]);

  // 筛选条件变化 → 立即 loading + 发起请求（给用户即时反馈）
  useEffect(() => {
    setLoading(true);
    fetchOrders();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchOrders]);

  // 筛选条件变化时重置分页
  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedKeyword, datePreset, startDate, endDate]);

  // 轮询兜底
  usePolling(fetchOrders, connected ? 30000 : 15000);

  // WS 事件节流
  const throttledFetchOrders = useThrottledCallback(fetchOrders, 1000);
  useEffect(() => {
    on('order_created', throttledFetchOrders);
    on('order_updated', throttledFetchOrders);
    return () => {
      off('order_created', throttledFetchOrders);
      off('order_updated', throttledFetchOrders);
    };
  }, [on, off, throttledFetchOrders]);

  // ── 快捷按钮 toggle（点击已选中的按钮 = 取消筛选）──
  const togglePreset = useCallback((preset) => {
    setDatePreset((prev) => prev === preset ? null : preset);
    // 清除手动日历
    setStartDate('');
    setEndDate('');
  }, []);

  // ── 手动日期设置（会清除快捷预设）──
  const handleSetStartDate = useCallback((v) => {
    setStartDate(v);
    setDatePreset(null);
    // 选了开始日期后，截止日期自动填为今天
    if (v && !endDate) {
      setEndDate(toLocalDateStr(new Date()));
    }
  }, [endDate]);

  const handleSetEndDate = useCallback((v) => {
    setEndDate(v);
    setDatePreset(null);
  }, []);

  // 清除所有日期筛选
  const clearDateFilter = useCallback(() => {
    setDatePreset(null);
    setStartDate('');
    setEndDate('');
  }, []);

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
    // 日期筛选
    datePreset,
    togglePreset,
    startDate,
    endDate,
    setStartDate: handleSetStartDate,
    setEndDate: handleSetEndDate,
    clearDateFilter,
  };
}
