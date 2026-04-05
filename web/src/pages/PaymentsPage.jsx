import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useDebounce } from '../hooks/useDebounce';
import { listPayments, createPayment, getPaymentSummary, getPaymentReport, syncWecom } from '../api/payments';
import { getOrderDetail } from '../api/orders';
import { formatTime, formatCurrency } from '../utils/formatters';
import { STATUS_MAP, STATUS_COLORS } from '../utils/constants';
import LoadingSpinner from '../components/LoadingSpinner';
import PaymentMatchModal from '../components/PaymentMatchModal';
import PageHeader from '../components/ui/PageHeader';
import { useAuth } from '../hooks/useAuth';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const SOURCE_MAP = {
  pdd: '拼多多',
  wecom: '企业微信',
  manual: '人工录入',
};

const SOURCE_STYLE = {
  pdd: 'bg-red-50 text-red-600 border-red-200',
  wecom: 'bg-blue-50 text-blue-600 border-blue-200',
  manual: 'bg-amber-50 text-amber-600 border-amber-200',
};

export default function PaymentsPage() {
  const { toast } = useToast();
  const { role } = useAuth();

  // View mode: 'list' or 'report'
  const [viewMode, setViewMode] = useState('list');

  // URL Params
  const [searchParams, setSearchParams] = useSearchParams();

  // Data State
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState({ total_amount: 0, by_source: {} });
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const pageSize = 20;

  // Report State
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportGranularity, setReportGranularity] = useState('day');
  const [reportRange, setReportRange] = useState('30'); // '7', '30', 'custom'
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const reportChartRef = useRef(null);
  const reportChartInstanceRef = useRef(null);

  // Filter State
  const [filterOrderId, setFilterOrderId] = useState(searchParams.get('order_id') || '');
  const [filterSource, setFilterSource] = useState(searchParams.get('source') || '');
  const [filterStartTime, setFilterStartTime] = useState(searchParams.get('start_time') || '');
  const [filterEndTime, setFilterEndTime] = useState(searchParams.get('end_time') || '');
  
  const debouncedOrderId = useDebounce(filterOrderId, 500);

  // Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [form, setForm] = useState({ order_id: '', amount: '', source: 'manual', remark: '', paid_at: '' });

  // Expand State — 点击订单ID展开详情
  const [expandedPaymentId, setExpandedPaymentId] = useState(null);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [expandLoading, setExpandLoading] = useState(false);

  const toggleExpandOrder = async (paymentId, orderId) => {
    if (expandedPaymentId === paymentId) {
      setExpandedPaymentId(null);
      setExpandedOrder(null);
      return;
    }
    setExpandedPaymentId(paymentId);
    setExpandedOrder(null);
    setExpandLoading(true);
    try {
      const res = await getOrderDetail(orderId);
      setExpandedOrder(res.data.order || res.data || {});
    } catch {
      setExpandedOrder(null);
      toast('获取订单详情失败', 'error');
    } finally {
      setExpandLoading(false);
    }
  };

  const fetchSummary = useCallback(async () => {
    if (role !== 'admin') return; // Only admin can fetch summary
    setSummaryLoading(true);
    try {
      const res = await getPaymentSummary();
      setSummary(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setSummaryLoading(false);
    }
  }, [role]);

  const fetchPayments = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const params = {
        page: currentPage + 1,
        page_size: pageSize,
      };
      if (debouncedOrderId) params.order_id = debouncedOrderId;
      if (filterSource) params.source = filterSource;
      if (filterStartTime) params.start_time = filterStartTime;
      if (filterEndTime) params.end_time = filterEndTime;
      
      const res = await listPayments(params);
      setPayments(res.data.data || []);
      setTotal(res.data.total || 0);
      if (manual) toast('收款流水已刷新', 'success');
    } catch (err) {
      if (manual) toast('获取报错: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedOrderId, filterSource, filterStartTime, filterEndTime, toast]);

  useEffect(() => {
    fetchPayments();
    fetchSummary();
  }, [fetchPayments, fetchSummary]);

  // Update URL params
  useEffect(() => {
    const params = {};
    if (debouncedOrderId) params.order_id = debouncedOrderId;
    if (filterSource) params.source = filterSource;
    if (filterStartTime) params.start_time = filterStartTime;
    if (filterEndTime) params.end_time = filterEndTime;
    setSearchParams(params, { replace: true });
    setCurrentPage(0); // Reset page on filter change
  }, [debouncedOrderId, filterSource, filterStartTime, filterEndTime, setSearchParams]);

  const handleSyncWecom = async () => {
    setSyncing(true);
    try {
      await syncWecom();
      toast('企微收款同步成功', 'success');
      fetchPayments(true);
      fetchSummary();
    } catch (err) {
      toast('企微同步失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSyncing(false);
    }
  };

  // ── 报表数据获取 ──────────────────────────────
  const fetchReport = useCallback(async () => {
    if (role !== 'admin') return;
    setReportLoading(true);
    try {
      const params = { granularity: reportGranularity };
      if (reportRange === 'custom') {
        if (reportStartDate) params.start_time = reportStartDate;
        if (reportEndDate) params.end_time = reportEndDate;
      } else {
        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - parseInt(reportRange, 10));
        params.start_time = start.toISOString().split('T')[0];
        params.end_time = now.toISOString().split('T')[0];
      }
      const res = await getPaymentReport(params);
      setReportData(res.data);
    } catch (err) {
      toast('获取报表数据失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setReportLoading(false);
    }
  }, [role, reportGranularity, reportRange, reportStartDate, reportEndDate, toast]);

  useEffect(() => {
    if (viewMode === 'report') fetchReport();
  }, [viewMode, fetchReport]);

  // ── ECharts 渲染 ──────────────────────────────
  useEffect(() => {
    if (viewMode !== 'report' || !reportData?.rows || !reportChartRef.current) return;

    if (!reportChartInstanceRef.current) {
      reportChartInstanceRef.current = echarts.init(reportChartRef.current);
    }
    const chart = reportChartInstanceRef.current;

    const periods = reportData.rows.map((r) => r.period);
    const amounts = reportData.rows.map((r) => r.total_amount / 100);
    const counts = reportData.rows.map((r) => r.total_count);
    const matchedAmounts = reportData.rows.map((r) => r.matched_amount / 100);
    const unmatchedAmounts = reportData.rows.map((r) => (r.total_amount - r.matched_amount) / 100);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: '#fff',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        textStyle: { color: '#334155', fontSize: 13 },
        formatter: (params) => {
          let html = `<div style="font-weight:700;margin-bottom:6px">${params[0].axisValue}</div>`;
          params.forEach((p) => {
            const val = p.seriesName.includes('笔数') ? `${p.value} 笔` : `¥${p.value.toFixed(2)}`;
            html += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>${p.seriesName}: <b>${val}</b></div>`;
          });
          return html;
        },
      },
      legend: {
        data: ['收款总额', '已匹配', '未匹配', '笔数'],
        top: 0,
        textStyle: { fontSize: 12, color: '#64748b' },
      },
      grid: { left: 60, right: 60, top: 50, bottom: 30 },
      xAxis: {
        type: 'category',
        data: periods,
        axisLabel: { fontSize: 11, color: '#94a3b8' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '金额 (元)',
          nameTextStyle: { fontSize: 11, color: '#94a3b8' },
          axisLabel: { fontSize: 11, color: '#94a3b8', formatter: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v },
          splitLine: { lineStyle: { color: '#f1f5f9' } },
        },
        {
          type: 'value',
          name: '笔数',
          nameTextStyle: { fontSize: 11, color: '#94a3b8' },
          axisLabel: { fontSize: 11, color: '#94a3b8' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '收款总额',
          type: 'line',
          data: amounts,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: '#434FCF' },
          itemStyle: { color: '#434FCF' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(67,79,207,0.15)' }, { offset: 1, color: 'rgba(67,79,207,0.01)' }] } },
        },
        {
          name: '已匹配',
          type: 'bar',
          stack: 'amount',
          data: matchedAmounts,
          itemStyle: { color: '#10b981', borderRadius: [0, 0, 0, 0] },
          barMaxWidth: 24,
        },
        {
          name: '未匹配',
          type: 'bar',
          stack: 'amount',
          data: unmatchedAmounts,
          itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 24,
        },
        {
          name: '笔数',
          type: 'line',
          yAxisIndex: 1,
          data: counts,
          smooth: true,
          symbol: 'emptyCircle',
          symbolSize: 5,
          lineStyle: { width: 1.5, color: '#8b5cf6', type: 'dashed' },
          itemStyle: { color: '#8b5cf6' },
        },
      ],
    }, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [viewMode, reportData]);

  // cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (reportChartInstanceRef.current) {
        reportChartInstanceRef.current.dispose();
        reportChartInstanceRef.current = null;
      }
    };
  }, []);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!form.order_id || !form.amount) {
      return toast('请填写关联订单ID和金额', 'error');
    }
    setSubmitting(true);
    try {
      const amountInCents = Math.round(parseFloat(form.amount) * 100);
      const data = {
        order_id: parseInt(form.order_id, 10),
        amount: amountInCents,
        source: form.source,
        remark: form.remark,
        paid_at: form.paid_at ? form.paid_at.replace('T', ' ') : '',
      };
      await createPayment(data);
      toast('收款录入成功', 'success');
      setCreateModalVisible(false);
      setForm({ order_id: '', amount: '', source: 'manual', remark: '', paid_at: '' });
      fetchPayments();
      fetchSummary();
    } catch (err) {
      toast('录入失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openMatchModal = (payment) => {
    setSelectedPayment(payment);
    setMatchModalVisible(true);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <PageHeader title="收款流水" subtitle="系统自动同步企微及跨平台对账单">
        <div className="flex items-center gap-2">
          {/* 视图切换按钮 */}
          {role === 'admin' && (
            <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold rounded-lg transition-all duration-150 cursor-pointer border-none ${
                  viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                列表
              </button>
              <button
                onClick={() => setViewMode('report')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold rounded-lg transition-all duration-150 cursor-pointer border-none ${
                  viewMode === 'report' ? 'bg-white text-slate-800 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                报表
              </button>
            </div>
          )}
          {role === 'admin' && (
            <button
              onClick={handleSyncWecom}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-brand-600 bg-brand-50 border border-brand-200 hover:bg-brand-100 transition-all duration-150 shadow-sm disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              <span>{syncing ? '同步中...' : '同步企微流水'}</span>
            </button>
          )}
          {(role === 'admin' || role === 'follow') && (
            <button
              onClick={() => setCreateModalVisible(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 shadow-sm active:scale-[0.98]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
              <span>手动录入</span>
            </button>
          )}
        </div>
      </PageHeader>

      {/* KPI Cards for Admin */}
      {role === 'admin' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center">
            <span className="text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 block uppercase tracking-wider">历史总收款</span>
            {summaryLoading && !summary.total_amount ? (
               <div className="h-8 w-24 bg-slate-100 rounded-lg animate-pulse" />
            ) : (
              <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{(summary.total_amount / 100).toFixed(2)}
              </h4>
            )}
          </div>
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-[3px] border-l-red-400">
             <span className="text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 block uppercase tracking-wider">拼多多来源</span>
             <h4 className="text-xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{((summary.by_source?.pdd?.total || 0) / 100).toFixed(2)}
             </h4>
             {summary.by_source?.pdd?.count > 0 && (
               <span className="text-[11px] text-slate-400 mt-1 tabular-nums">{summary.by_source.pdd.count} 笔</span>
             )}
          </div>
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-[3px] border-l-blue-400">
             <span className="text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 block uppercase tracking-wider">企微来源</span>
             <h4 className="text-xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{((summary.by_source?.wecom?.total || 0) / 100).toFixed(2)}
             </h4>
             {summary.by_source?.wecom?.count > 0 && (
               <span className="text-[11px] text-slate-400 mt-1 tabular-nums">{summary.by_source.wecom.count} 笔</span>
             )}
          </div>
          <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-[3px] border-l-amber-400">
             <span className="text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 block uppercase tracking-wider">人工录入</span>
             <h4 className="text-xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
                &yen;{((summary.by_source?.manual?.total || 0) / 100).toFixed(2)}
             </h4>
             {summary.by_source?.manual?.count > 0 && (
               <span className="text-[11px] text-slate-400 mt-1 tabular-nums">{summary.by_source.manual.count} 笔</span>
             )}
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        {/* Filters */}
        <div className="px-6 py-4 border-b border-slate-200/80 flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px] max-w-[280px] relative">
            <input
              type="text"
              placeholder="搜索订单 ID..."
              value={filterOrderId}
              onChange={(e) => setFilterOrderId(e.target.value)}
              className="w-full h-[34px] px-4 pl-9 text-[13px] text-slate-800 bg-slate-50/60 border border-slate-200 rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-400 transition-colors"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <div className="w-[140px]">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="w-full h-[34px] px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-colors cursor-pointer"
            >
              <option value="">所有来源</option>
              <option value="pdd">拼多多</option>
              <option value="wecom">企业微信</option>
              <option value="manual">人工录入</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterStartTime}
              onChange={(e) => setFilterStartTime(e.target.value)}
              className="h-[34px] px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-colors"
            />
            <span className="text-slate-300 text-sm select-none">~</span>
            <input
              type="date"
              value={filterEndTime}
              onChange={(e) => setFilterEndTime(e.target.value)}
              className="h-[34px] px-3 text-[13px] text-slate-700 bg-white border border-slate-200 rounded-xl outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-colors"
            />
          </div>
          <button
            onClick={() => {
              setFilterOrderId('');
              setFilterSource('');
              setFilterStartTime('');
              setFilterEndTime('');
            }}
            className="h-[34px] px-3 text-[13px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            重置
          </button>
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto relative min-h-[400px]">
          {loading && payments.length === 0 && <LoadingSpinner />}
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col className="hidden lg:table-column" style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="text-left" style={{ paddingLeft: 24 }}>流水号 / 交易时间</th>
                <th className="text-center">来源</th>
                <th className="text-right">收款金额</th>
                <th className="text-center">关联订单</th>
                <th className="hidden lg:table-cell text-left">备注</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <p className="font-medium text-slate-600">暂无收款记录</p>
                      <p className="text-sm mt-0.5">当前筛选条件下没有匹配的流水。</p>
                    </div>
                  </td>
                </tr>
              )}
              {payments.map((p) => {
                const isExpanded = expandedPaymentId === p.id;
                return (
                <React.Fragment key={p.id}>
                <tr className={`border-b border-slate-50 hover:bg-slate-50/60 transition-colors group ${isExpanded ? 'bg-brand-50/30' : ''}`}>
                  <td style={{ paddingLeft: 24 }}>
                    <div className="text-[13px] font-medium text-slate-700 font-mono truncate" title={p.transaction_id}>
                      {p.transaction_id.length > 20 ? p.transaction_id.substring(0, 20) + '...' : p.transaction_id}
                    </div>
                    <div className="text-[12px] text-slate-400 mt-0.5 tabular-nums">{formatTime(p.paid_at)}</div>
                  </td>
                  <td className="text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${SOURCE_STYLE[p.source] || SOURCE_STYLE.manual}`}>
                      {SOURCE_MAP[p.source] || p.source}
                    </span>
                  </td>
                  <td className="text-right">
                    <span className="text-[14px] font-bold text-slate-800 font-[Outfit] tabular-nums">
                      &yen;{formatCurrency(p.amount / 100)}
                    </span>
                  </td>
                  <td className="text-center">
                    {p.order_id ? (
                      <div>
                        <button
                          onClick={() => toggleExpandOrder(p.id, p.order_id)}
                          className={`inline-flex items-center gap-1.5 text-[13px] font-bold transition-colors cursor-pointer bg-transparent border-none p-0 ${isExpanded ? 'text-brand-700' : 'text-brand-600 hover:text-brand-700'}`}
                        >
                          <svg
                            className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                          </svg>
                          #{p.order_id}
                        </button>
                        {p.customer_id > 0 && (
                          <div className="text-[11px] text-slate-400 mt-0.5">顾客 #{p.customer_id}</div>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-500 bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                        未关联
                      </span>
                    )}
                  </td>
                  <td className="hidden lg:table-cell truncate" title={p.remark}>
                    <span className="text-[12px] text-slate-500">{p.remark || '-'}</span>
                  </td>
                  <td className="text-center">
                    {p.order_id ? (
                      <div className="text-[12px] text-slate-400 tabular-nums">
                        {p.matched_at ? formatTime(p.matched_at) : '已匹配'}
                      </div>
                    ) : (
                      <button
                        onClick={() => openMatchModal(p)}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-[12px] font-semibold text-brand-600 bg-brand-50 border border-brand-200 rounded-xl hover:bg-brand-100 transition-all shadow-sm cursor-pointer active:scale-[0.97]"
                      >
                        手动关联
                      </button>
                    )}
                  </td>
                </tr>
                {/* 展开的订单详情行 */}
                {isExpanded && (
                  <tr className="bg-brand-50/20">
                    <td colSpan={6} style={{ padding: 0 }}>
                      <div className="px-8 py-5 animate-fade-in-up">
                        {expandLoading ? (
                          <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                            <svg className="w-5 h-5 animate-spin text-brand-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <span className="text-sm font-medium">加载订单详情...</span>
                          </div>
                        ) : expandedOrder ? (() => {
                          const sc = STATUS_COLORS[expandedOrder.status] || STATUS_COLORS.PENDING;
                          return (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                              {/* 订单详情头部 */}
                              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-brand-50">
                                    <svg className="w-3.5 h-3.5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  </div>
                                  <span className="text-[14px] font-bold text-slate-700">订单详情</span>
                                  <span className="text-[12px] text-slate-400 font-mono">{expandedOrder.order_sn}</span>
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                    style={{ background: sc.bg, color: sc.text, borderColor: sc.border }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                                    {STATUS_MAP[expandedOrder.status] || expandedOrder.status}
                                  </span>
                                </div>
                                <Link
                                  to={`/orders/${expandedOrder.id}`}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  查看完整详情
                                </Link>
                              </div>
                              {/* 订单详情内容 */}
                              <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
                                <div>
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">订单金额</span>
                                  <p className="text-[14px] font-bold text-slate-800 mt-0.5 tabular-nums">&yen;{formatCurrency((expandedOrder.price || 0) / 100)}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">客户</span>
                                  <p className="text-[13px] font-semibold text-slate-700 mt-0.5 truncate">{expandedOrder.customer_contact || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">主题</span>
                                  <p className="text-[13px] text-slate-700 mt-0.5 truncate" title={expandedOrder.topic}>{expandedOrder.topic || '-'}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">页数</span>
                                  <p className="text-[13px] text-slate-700 mt-0.5">{expandedOrder.pages ? `${expandedOrder.pages} 页` : '-'}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">设计师</span>
                                  <p className="text-[13px] text-slate-700 mt-0.5">{expandedOrder.freelance_designer_name || '待分配'}</p>
                                </div>
                                <div>
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">创建时间</span>
                                  <p className="text-[13px] text-slate-600 mt-0.5 tabular-nums">{formatTime(expandedOrder.created_at)}</p>
                                </div>
                                {expandedOrder.deadline && (
                                  <div>
                                    <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">截止时间</span>
                                    <p className="text-[13px] text-red-600 mt-0.5 tabular-nums">{formatTime(expandedOrder.deadline)}</p>
                                  </div>
                                )}
                                {expandedOrder.remark && (
                                  <div className="col-span-2 sm:col-span-4">
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">备注</span>
                                    <p className="text-[12px] text-slate-600 mt-0.5 bg-slate-50 rounded-lg p-2.5 whitespace-pre-wrap border border-slate-100">{expandedOrder.remark}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })() : (
                          <div className="text-center text-sm text-slate-400 py-6">订单详情加载失败</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-surface-container-low px-6 py-3 border-t border-slate-200 flex justify-between items-center">
          <span className="text-[13px] text-slate-500">共 <span className="font-bold text-slate-700">{total}</span> 条记录</span>
          <div className="flex items-center gap-1.5">
            <button
               onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
               disabled={currentPage === 0}
               className={`px-3 py-1 text-sm font-semibold rounded-xl border border-slate-200 shadow-sm transition-all duration-150 text-[12px] ${currentPage === 0 ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-50' : 'bg-white text-slate-700 hover:bg-slate-50 cursor-pointer active:scale-[0.98]'}`}
            >上一页</button>
            <span className="text-[13px] text-slate-500 px-3">{currentPage + 1} / {totalPages}</span>
            <button
               onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
               disabled={currentPage >= totalPages - 1}
               className={`px-3 py-1 text-sm font-semibold rounded-xl border border-slate-200 shadow-sm transition-all duration-150 text-[12px] ${currentPage >= totalPages - 1 ? 'bg-slate-50 text-slate-400 cursor-not-allowed opacity-50' : 'bg-white text-slate-700 hover:bg-slate-50 cursor-pointer active:scale-[0.98]'}`}
            >下一页</button>
          </div>
        </div>
      </div>

      {/* Manual Create Modal */}
      {createModalVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => !submitting && setCreateModalVisible(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <h3 className="text-[16px] font-bold text-slate-800">手动录入收款</h3>
              <button disabled={submitting} onClick={() => setCreateModalVisible(false)} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-lg transition-colors cursor-pointer">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">关联订单 ID <span className="text-red-500">*</span></label>
                <input required type="number" min="1" value={form.order_id} onChange={e => setForm({...form, order_id: e.target.value})} placeholder="输入订单号，如: 1001" className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300" />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">收款金额 (元) <span className="text-red-500">*</span></label>
                <input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} placeholder="例如: 99.00" className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-[13px] font-semibold text-slate-600 mb-1">来源</label>
                    <select required value={form.source} onChange={e => setForm({...form, source: e.target.value})} className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10">
                      <option value="manual">人工录入</option>
                      <option value="pdd">拼多多</option>
                      <option value="wecom">企业微信</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-[13px] font-semibold text-slate-600 mb-1">支付时间</label>
                    <input type="datetime-local" value={form.paid_at} onChange={e => setForm({...form, paid_at: e.target.value})} className="w-full px-3 py-2 text-[13px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" />
                 </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-600 mb-1">备注说明</label>
                <textarea rows={2} value={form.remark} onChange={e => setForm({...form, remark: e.target.value})} placeholder="填写备注说明..." className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-slate-300 resize-none" />
              </div>
              <div className="pt-2 flex gap-3">
                <button type="button" disabled={submitting} onClick={() => setCreateModalVisible(false)} className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors shadow-sm cursor-pointer">取消</button>
                <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-brand-500 text-white font-semibold rounded-xl hover:bg-brand-600 transition-colors shadow-sm border-none disabled:opacity-70 cursor-pointer">
                  {submitting ? '提交中...' : '确认录入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Match Order Modal */}
      <PaymentMatchModal
        visible={matchModalVisible}
        payment={selectedPayment}
        onClose={() => setMatchModalVisible(false)}
        onMatched={() => { fetchPayments(); fetchSummary(); }}
      />

    </div>
  );
}
