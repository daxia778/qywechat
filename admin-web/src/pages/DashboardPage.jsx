import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { getDashboard, getProfitSummary } from '../api/admin';
import MetricCard from '../components/MetricCard';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

/** 分 -> 元，千分位格式化 */
const fmtYuan = (fen) => {
  const yuan = (fen || 0) / 100;
  return yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function DashboardPage() {
  const { toast } = useToast();
  const { on, off, connected } = useWebSocket();
  const [loading, setLoading] = useState(false);
  const [rankingExpanded, setRankingExpanded] = useState(false);
  const [profitData, setProfitData] = useState({ net_profit: 0, total_revenue: 0, order_count: 0 });
  const [stats, setStats] = useState({
    total_orders: 0, pending_orders: 0, designing_orders: 0,
    today_revenue: 0, today_order_count: 0,
    active_designers: 0, idle_designers: 0,
    designer_rankings: [], monthly_data: [],
    week_revenue: 0, last_week_revenue: 0, avg_completion_hours: 0,
    // Phase 5 fields
    total_payment_amount: 0, pdd_payment_amount: 0, wecom_payment_amount: 0,
    manual_payment_amount: 0, total_payment_count: 0,
    after_sale_count: 0, revision_count: 0, confirmed_count: 0,
    today_payment_amount: 0, yesterday_payment_amount: 0,
  });

  const barChartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const pieChartRef = useRef(null);
  const pieInstanceRef = useRef(null);

  const utilizationRate = useMemo(() => {
    const total = stats.active_designers + stats.idle_designers;
    if (total === 0) return 0;
    return Math.round((stats.active_designers / total) * 100);
  }, [stats.active_designers, stats.idle_designers]);

  const pendingTotal = useMemo(() => {
    return (stats.confirmed_count || 0) + (stats.after_sale_count || 0) + (stats.revision_count || 0);
  }, [stats.confirmed_count, stats.after_sale_count, stats.revision_count]);

  // Sparkline data derived from monthly_data (last 8 months)
  const orderSparkData = useMemo(() => {
    if (!stats.monthly_data?.length) return null;
    return stats.monthly_data.slice(-8);
  }, [stats.monthly_data]);

  const revenueSparkData = useMemo(() => {
    if (!stats.monthly_data?.length) return null;
    // use monthly order counts as proxy trend for revenue sparkline
    return stats.monthly_data.slice(-8);
  }, [stats.monthly_data]);

  const displayedRankings = useMemo(() => {
    if (!stats.designer_rankings) return [];
    return rankingExpanded ? stats.designer_rankings : stats.designer_rankings.slice(0, 3);
  }, [stats.designer_rankings, rankingExpanded]);

  const initBarChart = useCallback(() => {
    if (!barChartRef.current) return;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
    }
    chartInstanceRef.current = echarts.init(barChartRef.current);
  }, []);

  const updateBarChart = useCallback((monthlyData) => {
    if (!chartInstanceRef.current) return;
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const data = monthlyData?.length === 12 ? monthlyData : months.map(() => 0);

    chartInstanceRef.current.setOption({
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', padding: [10, 14],
        textStyle: { color: '#1C1C28', fontSize: 13, fontFamily: 'Inter' },
        borderColor: '#E5E7EB', borderWidth: 2,
        extraCssText: 'border-radius: 12px;',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(67,79,207,0.04)' } },
      },
      grid: { top: 20, right: 16, bottom: 24, left: 16, containLabel: true },
      xAxis: {
        type: 'category', data: months,
        axisLine: { lineStyle: { color: '#E5E7EB' } },
        axisLabel: { color: '#64748B', fontSize: 12, margin: 12, fontFamily: 'Inter' },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#F5F3FF', type: 'dashed' } },
        axisLabel: { color: '#94A3B8', fontSize: 12, fontFamily: 'Inter' },
        axisLine: { show: false }, axisTick: { show: false },
      },
      series: [{
        type: 'bar', data, barWidth: '14',
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#434FCF' }, { offset: 1, color: '#8B5CF6' },
          ]),
          borderRadius: [6, 6, 0, 0],
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#3B3FBF' }, { offset: 1, color: '#7C3AED' },
            ]),
          },
        },
      }],
    });
  }, []);

  const initPieChart = useCallback(() => {
    if (!pieChartRef.current) return;
    if (pieInstanceRef.current) {
      pieInstanceRef.current.dispose();
    }
    pieInstanceRef.current = echarts.init(pieChartRef.current);
  }, []);

  const updatePieChart = useCallback((st) => {
    if (!pieInstanceRef.current) return;
    const pdd = (st.pdd_payment_amount || 0) / 100;
    const wecom = (st.wecom_payment_amount || 0) / 100;
    const manual = (st.manual_payment_amount || 0) / 100;
    const hasData = pdd + wecom + manual > 0;

    pieInstanceRef.current.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: '#fff',
        borderColor: '#E5E7EB',
        borderWidth: 2,
        padding: [10, 14],
        textStyle: { color: '#1C1C28', fontSize: 13, fontFamily: 'Inter' },
        extraCssText: 'border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);',
        formatter: (params) =>
          `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${params.color};margin-right:6px;"></span>${params.name}<br/><b style="font-size:15px;font-family:Outfit">¥${params.value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b><span style="margin-left:8px;color:#94A3B8">${params.percent}%</span>`,
      },
      legend: {
        orient: 'horizontal',
        bottom: 8,
        left: 'center',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 20,
        textStyle: { fontSize: 12, color: '#475569', fontFamily: 'Inter', rich: { val: { fontWeight: 'bold', color: '#1E293B', padding: [0, 0, 0, 4] } } },
        formatter: (name) => {
          const map = { '拼多多': pdd, '企微收款': wecom, '手动录入': manual };
          return `${name}  {val|¥${(map[name] || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}}`;
        },
      },
      series: [{
        type: 'pie',
        radius: ['44%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: false,
        padAngle: 3,
        itemStyle: { borderRadius: 6 },
        label: {
          show: false,
        },
        emphasis: {
          label: { show: false },
          itemStyle: { shadowBlur: 12, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.12)' },
        },
        data: hasData ? [
          { value: pdd, name: '拼多多', itemStyle: { color: '#10B981' } },
          { value: wecom, name: '企微收款', itemStyle: { color: '#6366F1' } },
          { value: manual, name: '手动录入', itemStyle: { color: '#F59E0B' } },
        ] : [
          { value: 1, name: '暂无数据', itemStyle: { color: '#E5E7EB' }, label: { show: true, position: 'center', formatter: '暂无数据', fontSize: 14, color: '#94A3B8', fontFamily: 'Inter' } },
        ],
      }],
    });
  }, []);

  const fetchDashboardData = useCallback(async (manual = false, signal) => {
    if (manual) setLoading(true);
    try {
      const [res, profitRes] = await Promise.all([
        getDashboard({ signal }),
        getProfitSummary(undefined, { signal }).catch(() => null),
      ]);
      setStats(res.data);
      initBarChart();
      updateBarChart(res.data.monthly_data);
      initPieChart();
      updatePieChart(res.data);
      if (profitRes?.data?.summary) {
        setProfitData({
          net_profit: profitRes.data.summary.total_net_profit || 0,
          total_revenue: profitRes.data.summary.total_revenue || 0,
          order_count: profitRes.data.order_count || 0,
        });
      }
      if (manual) toast('仪表盘已刷新', 'success');
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      if (manual) toast('获取失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, initBarChart, updateBarChart, initPieChart, updatePieChart]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboardData(false, controller.signal);
    return () => controller.abort();
  }, [fetchDashboardData]);

  usePolling(fetchDashboardData, connected ? 60000 : 30000);

  useEffect(() => {
    const handler = () => fetchDashboardData();
    on('order_updated', handler);
    return () => off('order_updated', handler);
  }, [on, off, fetchDashboardData]);

  // resize observer for both charts
  useEffect(() => {
    const resize = () => {
      chartInstanceRef.current?.resize();
      pieInstanceRef.current?.resize();
    };
    window.addEventListener('resize', resize);

    let ro;
    const targets = [barChartRef.current, pieChartRef.current].filter(Boolean);
    if (targets.length > 0 && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      targets.forEach((t) => ro.observe(t));
    }

    return () => {
      window.removeEventListener('resize', resize);
      ro?.disconnect();
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
      pieInstanceRef.current?.dispose();
      pieInstanceRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8 w-full max-w-[1400px] mx-auto">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="headline text-[28px] font-bold text-[#1d1d1f]">数据总览</h1>
          <p className="text-sm text-[#454654] mt-1">实时运营数据看板</p>
        </div>
        <div className="flex gap-2.5 items-center">
          <button onClick={() => fetchDashboardData(true)} className="flex items-center gap-1.5 bg-[#f3f4f5] border border-[#e1e3e4] rounded-lg px-3.5 py-2 text-sm font-medium text-[#454654] cursor-pointer hover:bg-[#e7e8e9] transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:16}}>calendar_today</span> 本月
          </button>
        </div>
      </div>

      {/* KPI Cards -- Row 1: 4 primary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6">
        <MetricCard
          title="总订单"
          value={stats.total_orders || 0}
          currentRateVal={stats.today_order_count || 0}
          prevValue={stats.yesterday_order_count || 0}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={22} height={22} strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          }
          colorHex="#434FCF"
        />
        <MetricCard
          title="待处理"
          value={stats.pending_orders || 0}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={22} height={22} strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          colorHex="#F59E0B"
        />
        <MetricCard
          title="今日营收"
          value={(stats.today_revenue || 0) / 100}
          currentRateVal={stats.today_revenue || 0}
          prevValue={stats.yesterday_revenue || 0}
          isCurrency={true}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={22} height={22} strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          }
          colorHex="#10B981"
        />
        <MetricCard
          title="异常事项"
          value={stats.grab_alert_count || 0}
          currentRateVal={stats.grab_alert_count || 0}
          prevValue={stats.yesterday_grab_alerts || 0}
          invertTrend={true}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={22} height={22} strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          }
          colorHex="#EF4444"
        />
      </div>

      {/* KPI Cards -- Row 2: Payment + Pending Work */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
        <MetricCard
          title="总收款金额"
          formattedValue={`¥${fmtYuan(stats.total_payment_amount)}`}
          value={(stats.total_payment_amount || 0) / 100}
          currentRateVal={stats.today_payment_amount || 0}
          prevValue={stats.yesterday_payment_amount || 0}
          isCurrency={true}
          subtitle={`拼多多 ¥${fmtYuan(stats.pdd_payment_amount)} · 企微 ¥${fmtYuan(stats.wecom_payment_amount)} · 手动 ¥${fmtYuan(stats.manual_payment_amount)}`}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={22} height={22} strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          }
          colorHex="#059669"
        />
        <MetricCard
          title="待处理订单"
          value={pendingTotal}
          subtitle={`确认 ${stats.confirmed_count || 0} · 售后 ${stats.after_sale_count || 0} · 修改 ${stats.revision_count || 0}`}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={22} height={22} strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
          }
          colorHex="#EA580C"
        />
      </div>

      {/* Monthly Chart + Payment Source Pie */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
          <div className="xl:col-span-2 flex flex-col min-h-0 bg-white ghost-border rounded-2xl overflow-hidden shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="px-7 lg:px-8 py-6 flex items-center justify-between">
            <div>
              <h2 style={{fontFamily:"'Outfit',sans-serif", fontSize:18, fontWeight:600, color:'#1d1d1f'}}>月度销量</h2>
              <p className="text-[13px] text-[#6e6e73] mt-0.5">过去一年的订单趋势</p>
            </div>
            <button onClick={() => fetchDashboardData(true)} className="inline-flex items-center justify-center gap-1.5 font-semibold border cursor-pointer transition-all whitespace-nowrap leading-snug active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 text-xs rounded-lg" disabled={loading}>
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              <span>{loading ? '刷新中...' : '刷新'}</span>
            </button>
          </div>
          <div className="p-6 lg:p-8 flex-1 min-h-[360px] lg:min-h-[420px]" ref={barChartRef} />
        </div>

        {/* Payment Source Pie Chart */}
        <div className="bg-surface-container-lowest ghost-border rounded-2xl xl:col-span-1 flex flex-col min-h-0 hover:border-[#434FCF]/25 transition-colors shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <div className="px-7 lg:px-8 py-6 flex items-center justify-between">
            <div>
              <h2 style={{fontFamily:"'Outfit',sans-serif", fontSize:18, fontWeight:600, color:'#1d1d1f'}}>收款来源</h2>
              <p className="text-[13px] text-[#6e6e73] mt-0.5">各渠道收款分布</p>
            </div>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md tabular-nums">
              共 {stats.total_payment_count || 0} 笔
            </span>
          </div>
          <div className="p-6 lg:p-8 flex-1 min-h-[360px]" ref={pieChartRef} />
        </div>
      </div>

      {/* Team Load + Order Status Distribution */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
        <div className="bg-surface-container-lowest ghost-border rounded-2xl xl:col-span-1 flex flex-col min-h-0 hover:border-[#434FCF]/25 transition-colors shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          <div className="px-5 lg:px-7 py-5 border-b border-[#e1e3e4] flex items-center justify-between">
            <div>
              <h2 style={{fontFamily:"'Outfit',sans-serif", fontSize:18, fontWeight:600, color:'#1d1d1f'}}>团队负载</h2>
              <p className="text-[13px] text-[#6e6e73] mt-0.5">实时运营容量</p>
            </div>
            <span className="flex h-2.5 w-2.5 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>
          <div className="p-5 lg:p-6 flex flex-col gap-4 flex-1">
            <div className="flex items-center p-4 rounded-2xl border border-slate-100 bg-gradient-to-r from-brand-25 to-white hover:border-[#434FCF]/25 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm mr-3.5">
                <span className="text-lg font-bold text-brand-500 tabular-nums">{stats.active_designers}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">活跃成员</div>
                <div className="text-xs text-slate-500 mt-0.5">正在处理订单中</div>
              </div>
            </div>
            <div className="flex items-center p-4 rounded-2xl border border-slate-100 bg-gradient-to-r from-emerald-50/60 to-white hover:border-[#434FCF]/25 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm mr-3.5">
                <span className="text-lg font-bold text-emerald-500 tabular-nums">{stats.idle_designers}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">空闲 / 可用</div>
                <div className="text-xs text-slate-500 mt-0.5">可接受新任务分配</div>
              </div>
            </div>
            <div className="mt-auto pt-2">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-slate-600">总体利用率</span>
                <span className="font-bold text-slate-800 tabular-nums">{utilizationRate}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-brand-500 to-indigo-400 h-2 rounded-full transition-all duration-700 ease-out" style={{ width: `${utilizationRate}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Order Status Distribution */}
        <div className="bg-surface-container-lowest ghost-border rounded-2xl xl:col-span-2 flex flex-col min-h-0 hover:border-[#434FCF]/25 transition-colors shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
          <div className="px-5 lg:px-7 py-5 border-b border-[#e1e3e4]">
            <h2 style={{fontFamily:"'Outfit',sans-serif", fontSize:18, fontWeight:600, color:'#1d1d1f'}}>订单状态分布</h2>
            <p className="text-[13px] text-[#6e6e73] mt-0.5">当前各状态订单数量概览</p>
          </div>
          <div className="p-5 lg:p-6 flex-1">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {[
                { label: '待接单', key: 'pending_orders', color: '#F59E0B', bg: 'from-amber-50 to-white', border: 'border-amber-100 hover:border-[#434FCF]/25' },
                { label: '已确认', key: 'confirmed_count', color: '#6366F1', bg: 'from-indigo-50/60 to-white', border: 'border-indigo-100 hover:border-[#434FCF]/25' },
                { label: '设计中', key: 'designing_orders', color: '#3B82F6', bg: 'from-blue-50/60 to-white', border: 'border-blue-100 hover:border-[#434FCF]/25' },
                { label: '已完成', key: 'completed_orders', color: '#10B981', bg: 'from-emerald-50/60 to-white', border: 'border-emerald-100 hover:border-[#434FCF]/25' },
                { label: '修改中', key: 'revision_count', color: '#8B5CF6', bg: 'from-violet-50/60 to-white', border: 'border-violet-100 hover:border-[#434FCF]/25' },
                { label: '售后中', key: 'after_sale_count', color: '#EF4444', bg: 'from-red-50/60 to-white', border: 'border-red-100 hover:border-[#434FCF]/25' },
              ].map((item) => (
                <div
                  key={item.key}
                  className={`flex items-center p-4 lg:p-5 rounded-xl border bg-gradient-to-r ${item.bg} ${item.border} transition-colors`}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mr-3"
                    style={{ backgroundColor: item.color + '14' }}
                  >
                    <span className="text-base font-bold tabular-nums" style={{ color: item.color }}>
                      {stats[item.key] || 0}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-700">{item.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Designer Rankings */}
      {stats.designer_rankings?.length > 0 && (
        <div className="bg-surface-container-lowest ghost-border rounded-xl hover:border-[#434FCF]/25 transition-colors overflow-hidden">
          <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">设计师排行</h2>
              <p className="text-sm text-slate-500 mt-0.5">绩效排行榜</p>
            </div>
            <div className="flex items-center gap-3">
              {stats.avg_completion_hours > 0 && (
                <span className="text-sm text-slate-500 hidden sm:inline">
                  平均完成: <span className="font-bold text-slate-700">{stats.avg_completion_hours.toFixed(1)}h</span>
                </span>
              )}
              <button onClick={() => setRankingExpanded(!rankingExpanded)} className="text-xs text-brand-500 hover:underline font-semibold bg-brand-50 px-2.5 py-1 rounded-md transition-colors hover:bg-brand-100">
                {rankingExpanded ? '收起' : '展开全部'}
              </button>
            </div>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full border-separate border-spacing-y-2 text-left px-2">
              <thead>
                <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <th className="pb-3 pl-8">排名</th>
                  <th className="pb-3 px-4">姓名</th>
                  <th className="pb-3 px-4">已完成</th>
                  <th className="pb-3 px-4">进行中</th>
                  <th className="pb-3 text-right pr-8">平均耗时</th>
                </tr>
              </thead>
              <tbody>
                {displayedRankings.map((d, i) => (
                  <tr key={d.wecom_userid || i} className="bg-surface group hover:bg-surface-container-high transition-colors">
                    <td className="py-4 pl-8 rounded-l-lg font-bold text-sm">
                      {i === 0 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#434FCF]/10 text-[#434FCF] text-sm border-2 border-[#434FCF]/20">1</span>
                        : i === 1 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#434FCF]/5 text-[#434FCF] text-sm border-2 border-[#434FCF]/10">2</span>
                        : i === 2 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-50 text-slate-500 text-sm border-2 border-slate-100">3</span>
                        : <span className="text-sm text-slate-400 pl-2">#{i + 1}</span>}
                    </td>
                    <td className="py-4 px-4 text-sm font-bold text-slate-800">{d.name}</td>
                    <td className="py-4 px-4 text-sm"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700">{d.completed_count}</span></td>
                    <td className="py-4 px-4 text-sm"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-600">{d.active_count}</span></td>
                    <td className="py-4 pr-8 rounded-r-lg text-right font-bold text-sm tabular-nums">{d.avg_hours ? d.avg_hours.toFixed(1) + 'h' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
