import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getRevenueChart, getProfitBreakdown } from '../api/revenue';
import { exportExcel } from '../api/admin';
import ExportDialog from '../components/ExportDialog';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import PageHeader from '../components/ui/PageHeader';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

const ranges = [
  { label: '近 7 天', days: 7 },
  { label: '近 14 天', days: 14 },
  { label: '近 30 天', days: 30 },
];

/* ── helper: format short date ── */
const shortDate = (dateStr) => {
  const p = dateStr.split('-');
  return `${p[1]}/${p[2]}`;
};

/* ── Delta badge component ── */
function DeltaBadge({ value }) {
  if (value === null || value === undefined) return null;
  const isUp = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${
        isUp ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
      }`}
    >
      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {isUp
          ? <polyline points="6,9 6,3 3,5 6,3 9,5" />
          : <polyline points="6,3 6,9 3,7 6,9 9,7" />
        }
      </svg>
      {Math.abs(value).toFixed(1)}%
      <span className="text-[10px] font-normal opacity-70 ml-0.5">vs 上期</span>
    </span>
  );
}

/* ── today string for date picker max ── */
const _today = new Date();
const todayStr = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;

export default function RevenuePage() {
  const [days, setDays] = useState(7);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [summary, setSummary] = useState({ total_revenue: 0, total_orders: 0 });
  const [prevSummary, setPrevSummary] = useState({ total_revenue: 0, total_orders: 0 });
  const [currentData, setCurrentData] = useState([]);
  const [profitConfig, setProfitConfig] = useState(null);
  const [profitItems, setProfitItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exportDialogVisible, setExportDialogVisible] = useState(false);
  const startPickerRef = useRef(null);
  const endPickerRef = useRef(null);

  /* helper: format display date */
  const fmtShort = (d) => { if (!d) return ''; const p = d.split('-'); return `${p[1]}/${p[2]}`; };

  /* handler: when preset button clicked, clear custom dates */
  const handlePreset = (d) => { setDays(d); setCustomStart(''); setCustomEnd(''); };

  /* handler: when custom date changes, clear preset */
  const handleCustomStart = (v) => { setCustomStart(v); setDays(0); };
  const handleCustomEnd = (v) => { setCustomEnd(v); setDays(0); };
  const clearCustom = () => { setCustomStart(''); setCustomEnd(''); setDays(7); };

  /* compute effective days for API */
  const effectiveDays = useMemo(() => {
    if (days > 0) return days;
    if (customStart) {
      const end = customEnd || todayStr;
      const diff = Math.ceil((new Date(end) - new Date(customStart)) / 86400000) + 1;
      return Math.max(diff, 1);
    }
    return 7;
  }, [days, customStart, customEnd]);

  const isCustomMode = days === 0 && customStart;

  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const profitChartRef = useRef(null);
  const profitChartInstanceRef = useRef(null);

  /* ── C. date-range comparison deltas ── */
  const deltas = useMemo(() => {
    const rd =
      prevSummary.total_revenue > 0
        ? ((summary.total_revenue - prevSummary.total_revenue) / prevSummary.total_revenue) * 100
        : null;
    const od =
      prevSummary.total_orders > 0
        ? ((summary.total_orders - prevSummary.total_orders) / prevSummary.total_orders) * 100
        : null;
    return { revenue: rd, orders: od };
  }, [summary, prevSummary]);

  /* ── B. top 5 designers by revenue ── */
  const topDesigners = useMemo(() => {
    const agg = {};
    profitItems.forEach((item) => {
      const key = item.designer_id || '未分配';
      if (!agg[key]) agg[key] = { name: key, order_count: 0, total_revenue: 0 };
      agg[key].order_count += 1;
      agg[key].total_revenue += (item.total_price || 0) / 100;
    });
    return Object.values(agg)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, 5)
      .map((d) => ({
        ...d,
        avg_order_value: d.order_count > 0 ? d.total_revenue / d.order_count : 0,
      }));
  }, [profitItems]);

  /* ── HTML escape helper for tooltip ── */
  const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ── shared tooltip style ── */
  const tooltipStyle = {
    trigger: 'axis',
    backgroundColor: '#fff',
    padding: [8, 12],
    textStyle: { color: '#1E293B', fontSize: 13, fontFamily: 'Inter' },
    borderColor: '#E2E8F0',
    borderWidth: 1,
    extraCssText: 'box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-radius: 8px;',
  };

  /* ── main revenue chart ── */
  const updateChart = useCallback(
    (data) => {
      if (!chartInstanceRef.current) return;
      const dates = data.map((d) => shortDate(d.date));
      const revenueData = data.map((d) => +(d.revenue / 100).toFixed(2));
      const orderData = data.map((d) => d.order_count);

      chartInstanceRef.current.setOption({
        grid: { top: 40, right: 10, bottom: 90, left: 20, containLabel: true },
        tooltip: {
          ...tooltipStyle,
          axisPointer: { type: 'cross', crossStyle: { color: '#94A3B8' } },
        },
        legend: {
          data: ['每日营收 (\u00A5)', '订单量'],
          bottom: 36,
          icon: 'circle',
          itemGap: 24,
          textStyle: { color: '#64748B', fontFamily: 'Inter', fontSize: 12 },
        },
        dataZoom: [
          {
            type: 'slider',
            xAxisIndex: 0,
            bottom: 6,
            height: 24,
            borderColor: 'transparent',
            backgroundColor: '#F8FAFC',
            fillerColor: 'rgba(67,79,207,0.08)',
            handleIcon: 'path://M0,0 L2,0 L2,16 L0,16 Z',
            handleSize: '60%',
            handleStyle: {
              color: '#434FCF',
              borderColor: '#434FCF',
              borderWidth: 0,
              borderRadius: 2,
              shadowBlur: 3,
              shadowColor: 'rgba(67,79,207,0.25)',
              shadowOffsetY: 1,
            },
            moveHandleSize: 4,
            moveHandleStyle: { color: '#CBD5E1' },
            emphasis: {
              handleStyle: { borderColor: '#3641F5', shadowBlur: 6, shadowColor: 'rgba(67,79,207,0.35)' },
              moveHandleStyle: { color: '#94A3B8' },
            },
            textStyle: { color: '#94A3B8', fontSize: 11, fontFamily: 'Inter' },
            dataBackground: {
              lineStyle: { color: '#E2E8F0', width: 1 },
              areaStyle: { color: 'rgba(226,232,240,0.3)' },
            },
            selectedDataBackground: {
              lineStyle: { color: '#434FCF', width: 1, opacity: 0.4 },
              areaStyle: { color: 'rgba(67,79,207,0.06)' },
            },
            brushSelect: false,
          },
        ],
        xAxis: [
          {
            type: 'category',
            data: dates,
            axisPointer: { type: 'shadow' },
            axisLine: { lineStyle: { color: '#E2E8F0' } },
            axisLabel: { color: '#64748B', margin: 16, fontFamily: 'Inter' },
            axisTick: { show: false },
          },
        ],
        yAxis: [
          {
            type: 'value',
            name: '营收 (\u00A5)',
            min: 0,
            nameTextStyle: { color: '#94A3B8', padding: [0, 40, 0, 0], fontFamily: 'Inter' },
            axisLabel: { color: '#64748B', fontFamily: 'Inter' },
            splitLine: { lineStyle: { color: '#F1F5F9' } },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          {
            type: 'value',
            name: '订单量',
            min: 0,
            nameTextStyle: { color: '#94A3B8', padding: [0, 0, 0, 40], fontFamily: 'Inter' },
            axisLabel: { color: '#64748B', fontFamily: 'Inter' },
            splitLine: { show: false },
            axisLine: { show: false },
            axisTick: { show: false },
          },
        ],
        series: [
          {
            name: '每日营收 (\u00A5)',
            type: 'bar',
            data: revenueData,
            barGap: '20%',
            barWidth: '35%',
            itemStyle: { color: '#434FCF', borderRadius: [4, 4, 0, 0] },
          },
          {
            name: '订单量',
            type: 'bar',
            yAxisIndex: 1,
            data: orderData,
            barWidth: '35%',
            itemStyle: { color: '#38BDF8', borderRadius: [4, 4, 0, 0] },
          },
        ],
      });
    },
    [],
  );

  /* ── A. profit breakdown stacked bar chart ── */
  const updateProfitChart = useCallback(
    (data, config) => {
      if (!profitChartInstanceRef.current || !config) return;
      const dates = data.map((d) => shortDate(d.date));
      const pfRate = config.platform_fee_rate || 0;
      const dcRate = config.designer_commission_rate || 0;
      const scRate = config.sales_commission_rate || 0;
      const fcRate = config.follow_commission_rate || 0;

      const pfData = data.map((d) => +((d.revenue / 100 * pfRate) / 100).toFixed(2));
      const dcData = data.map((d) => +((d.revenue / 100 * dcRate) / 100).toFixed(2));
      const scData = data.map((d) => +((d.revenue / 100 * scRate) / 100).toFixed(2));
      const fcData = data.map((d) => +((d.revenue / 100 * fcRate) / 100).toFixed(2));
      const npData = data.map((d, i) => +(d.revenue / 100 - pfData[i] - dcData[i] - scData[i] - fcData[i]).toFixed(2));

      profitChartInstanceRef.current.setOption({
        grid: { top: 40, right: 10, bottom: 50, left: 20, containLabel: true },
        tooltip: {
          ...tooltipStyle,
          axisPointer: { type: 'shadow' },
          formatter(params) {
            let s = `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(params[0].axisValue)}</div>`;
            let total = 0;
            params.forEach((p) => {
              total += p.value;
              s += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">` +
                `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(p.color)}"></span>` +
                `<span style="flex:1">${escapeHtml(p.seriesName)}</span>` +
                `<span style="font-weight:600">\u00A5${p.value.toFixed(2)}</span></div>`;
            });
            s += `<div style="border-top:1px solid #E2E8F0;margin-top:4px;padding-top:4px;font-weight:700">` +
              `\u5408\u8BA1 \u00A5${total.toFixed(2)}</div>`;
            return s;
          },
        },
        legend: {
          data: ['平台手续费', '设计师佣金', '谈单客服佣金', '跟单客服佣金', '净利润'],
          bottom: 0,
          icon: 'circle',
          itemGap: 20,
          padding: [12, 0, 0, 0],
          textStyle: { color: '#64748B', fontFamily: 'Inter', fontSize: 12 },
        },
        xAxis: [
          {
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: '#E2E8F0' } },
            axisLabel: { color: '#64748B', margin: 16, fontFamily: 'Inter' },
            axisTick: { show: false },
          },
        ],
        yAxis: [
          {
            type: 'value',
            name: '金额 (\u00A5)',
            min: 0,
            nameTextStyle: { color: '#94A3B8', padding: [0, 40, 0, 0], fontFamily: 'Inter' },
            axisLabel: { color: '#64748B', fontFamily: 'Inter' },
            splitLine: { lineStyle: { color: '#F1F5F9' } },
            axisLine: { show: false },
            axisTick: { show: false },
          },
        ],
        series: [
          {
            name: '平台手续费',
            type: 'bar',
            stack: 'profit',
            data: pfData,
            itemStyle: { color: '#EF4444' },
            emphasis: { focus: 'series' },
          },
          {
            name: '设计师佣金',
            type: 'bar',
            stack: 'profit',
            data: dcData,
            itemStyle: { color: '#3B82F6' },
            emphasis: { focus: 'series' },
          },
          {
            name: '谈单客服佣金',
            type: 'bar',
            stack: 'profit',
            data: scData,
            itemStyle: { color: '#F59E0B' },
            emphasis: { focus: 'series' },
          },
          {
            name: '跟单客服佣金',
            type: 'bar',
            stack: 'profit',
            data: fcData,
            itemStyle: { color: '#8B5CF6' },
            emphasis: { focus: 'series' },
          },
          {
            name: '净利润',
            type: 'bar',
            stack: 'profit',
            data: npData,
            itemStyle: { color: '#10B981', borderRadius: [4, 4, 0, 0] },
            emphasis: { focus: 'series' },
          },
        ],
      });
    },
    [],
  );

  /* ── data fetching ── */
  const fetchData = useCallback(async (signal) => {
    setLoading(true);
    try {
      const apiDays = isCustomMode ? effectiveDays : effectiveDays * 2;
      const [chartRes, profitRes] = await Promise.all([
        getRevenueChart(apiDays, { signal }),
        getProfitBreakdown({}, { signal }).catch(() => ({ data: {} })),
      ]);

      let allData = chartRes.data.data || [];

      // For custom mode, filter by date range; no comparison period
      if (isCustomMode) {
        const endStr = customEnd || todayStr;
        allData = allData.filter(d => d.date >= customStart && d.date <= endStr);
      }

      const mid = isCustomMode ? 0 : Math.floor(allData.length / 2);
      const prev = allData.slice(0, mid);
      const curr = isCustomMode ? allData : allData.slice(mid);

      const curRev = curr.reduce((s, d) => s + d.revenue, 0) / 100;
      const curOrd = curr.reduce((s, d) => s + d.order_count, 0);
      setSummary({ total_revenue: curRev, total_orders: curOrd });

      const prevRev = prev.reduce((s, d) => s + d.revenue, 0) / 100;
      const prevOrd = prev.reduce((s, d) => s + d.order_count, 0);
      setPrevSummary({ total_revenue: prevRev, total_orders: prevOrd });

      setCurrentData(curr);

      const cfg = profitRes.data.config || null;
      setProfitConfig(cfg);
      setProfitItems(profitRes.data.items || []);

      updateChart(curr);
      updateProfitChart(curr, cfg);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      console.error('Failed to fetch revenue data:', err);
    } finally {
      setLoading(false);
    }
  }, [days, effectiveDays, isCustomMode, customStart, customEnd, updateChart, updateProfitChart]);

  /* ── chart initialization (separate from data fetching) ── */
  useEffect(() => {
    if (!chartInstanceRef.current && chartRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }
    if (!profitChartInstanceRef.current && profitChartRef.current) {
      profitChartInstanceRef.current = echarts.init(profitChartRef.current);
    }

    const handleResize = () => {
      chartInstanceRef.current?.resize();
      profitChartInstanceRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
      profitChartInstanceRef.current?.dispose();
      profitChartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  // ResizeObserver for sidebar toggle (doesn't trigger window.resize)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ros = [];
    if (chartRef.current) {
      const ro = new ResizeObserver(() => chartInstanceRef.current?.resize());
      ro.observe(chartRef.current);
      ros.push(ro);
    }
    if (profitChartRef.current) {
      const ro = new ResizeObserver(() => profitChartInstanceRef.current?.resize());
      ro.observe(profitChartRef.current);
      ros.push(ro);
    }
    return () => ros.forEach(r => r.disconnect());
  }, []);

  /* ── D. Excel export (multi-sheet) ── */
  const handleExport = useCallback(() => setExportDialogVisible(true), []);

  /* ── avg order value (derived KPI) ── */
  const avgOrderValue = summary.total_orders > 0 ? summary.total_revenue / summary.total_orders : 0;
  const prevAvg = prevSummary.total_orders > 0 ? prevSummary.total_revenue / prevSummary.total_orders : 0;
  const avgDelta = prevAvg > 0 ? ((avgOrderValue - prevAvg) / prevAvg) * 100 : null;

  /* ── net profit rate (derived KPI) ── */
  const totalDeductRate = (profitConfig?.platform_fee_rate || 0) + (profitConfig?.designer_commission_rate || 0) + (profitConfig?.sales_commission_rate || 0) + (profitConfig?.follow_commission_rate || 0);
  const netProfitRate = 100 - totalDeductRate;

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      {/* ── Header ── */}
      <PageHeader title="营收分析" subtitle="营收趋势与订单量明细">
        {/* D. Export button */}
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-lg
            bg-white text-slate-700 border border-slate-200 shadow-sm
            hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          导出报表
        </button>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {ranges.map((range) => (
              <button
                key={range.days}
                onClick={() => handlePreset(range.days)}
                className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-md transition-colors border-none cursor-pointer ${
                  days === range.days && !isCustomMode ? 'bg-white text-slate-800 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {/* 分隔线 */}
          <div className="w-px h-6 bg-slate-200" />

          {/* 自定义日期选择 */}
          <div className="flex items-center gap-1.5">
            <div
              onClick={() => startPickerRef.current?.showPicker?.()}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-lg border cursor-pointer transition-all hover:border-slate-300 ${
                customStart ? 'bg-white border-slate-300 text-slate-700 font-medium' : 'bg-white border-slate-200 text-slate-400'
              }`}
            >
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{customStart ? fmtShort(customStart) : '开始'}</span>
              <input ref={startPickerRef} type="date" value={customStart} max={todayStr}
                onChange={(e) => handleCustomStart(e.target.value)}
                onKeyDown={(e) => e.preventDefault()}
                className="absolute inset-0 opacity-0 cursor-pointer" tabIndex={-1} />
            </div>
            <span className="text-[11px] text-slate-300 select-none">→</span>
            <div
              onClick={() => endPickerRef.current?.showPicker?.()}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-lg border cursor-pointer transition-all hover:border-slate-300 ${
                customEnd ? 'bg-white border-slate-300 text-slate-700 font-medium' : 'bg-white border-slate-200 text-slate-400'
              }`}
            >
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{customEnd ? fmtShort(customEnd) : '结束'}</span>
              <input ref={endPickerRef} type="date" value={customEnd} min={customStart || undefined} max={todayStr}
                onChange={(e) => handleCustomEnd(e.target.value)}
                onKeyDown={(e) => e.preventDefault()}
                className="absolute inset-0 opacity-0 cursor-pointer" tabIndex={-1} />
            </div>
          </div>

          {isCustomMode && (
            <button onClick={clearCustom}
              className="px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer border-none bg-transparent flex items-center gap-0.5"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              清除
            </button>
          )}
        </div>
      </PageHeader>

      {/* ── KPI Cards with comparison deltas (C) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
        {/* total revenue */}
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 group hover:border-[#434FCF]/20 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-brand-50 group-hover:bg-brand-100 transition-colors">
              <svg className="w-5 h-5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <DeltaBadge value={deltas.revenue} />
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">&yen;{summary.total_revenue.toFixed(2)}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">区间总营收</span>
        </div>

        {/* total orders */}
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 group hover:border-[#434FCF]/20 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-amber-50 group-hover:bg-amber-100 transition-colors">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
            </div>
            <DeltaBadge value={deltas.orders} />
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">{summary.total_orders}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">区间总订单</span>
        </div>

        {/* avg order value */}
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 group hover:border-[#434FCF]/20 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-50 group-hover:bg-emerald-100 transition-colors">
              <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            </div>
            <DeltaBadge value={avgDelta} />
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">&yen;{avgOrderValue.toFixed(2)}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">平均客单价</span>
        </div>

        {/* net profit rate */}
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 group hover:border-[#434FCF]/20 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-purple-50 group-hover:bg-purple-100 transition-colors">
              <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">{profitConfig ? `${netProfitRate}%` : '--'}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">净利润率</span>
        </div>
      </div>

      {/* ── Revenue & Orders chart (existing) ── */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col">
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">营收与订单趋势</h2>
            <p className="text-sm text-slate-500 mt-0.5">每日营收与订单量明细</p>
          </div>
        </div>
        {loading && !chartInstanceRef.current && (
          <div className="flex items-center justify-center flex-1 p-6">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-brand-500" />
          </div>
        )}
        <div className="w-full p-5 lg:p-6 h-[440px]" ref={chartRef} style={{ display: loading && !chartInstanceRef.current ? 'none' : 'block' }} />
      </div>

      {/* ── A. Profit breakdown chart ── */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col">
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">利润构成分析</h2>
            <p className="text-sm text-slate-500 mt-0.5">各项成本与净利润每日明细</p>
          </div>
          {profitConfig && (
            <div className="flex items-center gap-3 text-[12px] text-slate-400 font-medium">
              <span>平台 {profitConfig.platform_fee_rate}%</span>
              <span className="text-slate-200">|</span>
              <span>设计师 {profitConfig.designer_commission_rate}%</span>
              <span className="text-slate-200">|</span>
              <span>谈单 {profitConfig.sales_commission_rate}%</span>
              <span className="text-slate-200">|</span>
              <span>跟单 {profitConfig.follow_commission_rate}%</span>
            </div>
          )}
        </div>
        {loading && !profitChartInstanceRef.current && (
          <div className="flex items-center justify-center flex-1 p-6">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-brand-500" />
          </div>
        )}
        <div className="w-full p-5 lg:p-6 h-[360px]" ref={profitChartRef} style={{ display: loading && !profitChartInstanceRef.current ? 'none' : 'block' }} />
      </div>

      {/* ── B. Top designers table ── */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl">
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200">
          <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">Top 设计师排行</h2>
          <p className="text-sm text-slate-500 mt-0.5">当月营收排名前 5 位的设计师</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '23%' }} />
              <col style={{ width: '23%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="text-center py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">#</th>
                <th className="text-left pl-2 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">设计师</th>
                <th className="text-center py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">订单量</th>
                <th className="text-center py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">总营收</th>
                <th className="text-center py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">客单价</th>
              </tr>
            </thead>
            <tbody>
              {topDesigners.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-400 text-[13px]">
                    暂无数据
                  </td>
                </tr>
              )}
              {topDesigners.map((d, idx) => (
                <tr key={d.name} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/60 transition-colors">
                  <td className="text-center py-3">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-700'
                          : idx === 1
                          ? 'bg-slate-200 text-slate-600'
                          : idx === 2
                          ? 'bg-orange-100 text-orange-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {idx + 1}
                    </span>
                  </td>
                  <td className="pl-2 py-3 font-medium text-slate-700">{d.name}</td>
                  <td className="text-center py-3 tabular-nums text-slate-600">{d.order_count}</td>
                  <td className="text-center py-3 tabular-nums font-semibold text-slate-800">&yen;{d.total_revenue.toFixed(2)}</td>
                  <td className="text-center py-3 tabular-nums text-slate-600">&yen;{d.avg_order_value.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ExportDialog
        visible={exportDialogVisible}
        onClose={() => setExportDialogVisible(false)}
      />
    </div>
  );
}
