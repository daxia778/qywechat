import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { getDashboard, getProfitSummary } from '../api/admin';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export default function DashboardPage() {
  const { toast } = useToast();
  const { on, off } = useWebSocket();
  const [loading, setLoading] = useState(false);
  const [rankingExpanded, setRankingExpanded] = useState(false);
  const [profitData, setProfitData] = useState({ net_profit: 0, total_revenue: 0, order_count: 0 });
  const [stats, setStats] = useState({
    total_orders: 0, pending_orders: 0, designing_orders: 0,
    today_revenue: 0, today_order_count: 0,
    active_designers: 0, idle_designers: 0,
    designer_rankings: [], monthly_data: [],
    week_revenue: 0, last_week_revenue: 0, avg_completion_hours: 0,
  });

  const barChartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  const utilizationRate = useMemo(() => {
    const total = stats.active_designers + stats.idle_designers;
    if (total === 0) return 0;
    return Math.round((stats.active_designers / total) * 100);
  }, [stats.active_designers, stats.idle_designers]);

  const weekTrend = useMemo(() => {
    if (!stats.last_week_revenue || stats.last_week_revenue === 0) return 0;
    return ((stats.week_revenue - stats.last_week_revenue) / stats.last_week_revenue) * 100;
  }, [stats.week_revenue, stats.last_week_revenue]);

  const profitMargin = useMemo(() => {
    if (!profitData.total_revenue || profitData.total_revenue === 0) return 0;
    return ((profitData.net_profit / profitData.total_revenue) * 100).toFixed(1);
  }, [profitData.net_profit, profitData.total_revenue]);

  const displayedRankings = useMemo(() => {
    if (!stats.designer_rankings) return [];
    return rankingExpanded ? stats.designer_rankings : stats.designer_rankings.slice(0, 3);
  }, [stats.designer_rankings, rankingExpanded]);

  const initBarChart = useCallback(() => {
    if (!barChartRef.current || chartInstanceRef.current) return;
    chartInstanceRef.current = echarts.init(barChartRef.current);
  }, []);

  const updateBarChart = useCallback((monthlyData) => {
    if (!chartInstanceRef.current) return;
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const data = monthlyData?.length === 12 ? monthlyData : months.map(() => 0);

    chartInstanceRef.current.setOption({
      tooltip: {
        trigger: 'axis', backgroundColor: '#fff', padding: [10, 14],
        textStyle: { color: '#1E293B', fontSize: 13, fontFamily: 'Inter' },
        borderColor: '#E2E8F0', borderWidth: 1,
        extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 10px;',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(70,95,255,0.04)' } },
      },
      grid: { top: 20, right: 16, bottom: 24, left: 16, containLabel: true },
      xAxis: {
        type: 'category', data: months,
        axisLine: { lineStyle: { color: '#E2E8F0' } },
        axisLabel: { color: '#64748B', fontSize: 12, margin: 12, fontFamily: 'Inter' },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#F1F5F9', type: 'dashed' } },
        axisLabel: { color: '#94A3B8', fontSize: 12, fontFamily: 'Inter' },
        axisLine: { show: false }, axisTick: { show: false },
      },
      series: [{
        type: 'bar', data, barWidth: '14',
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#465FFF' }, { offset: 1, color: '#6366F1' },
          ]),
          borderRadius: [6, 6, 0, 0],
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#3641F5' }, { offset: 1, color: '#4F46E5' },
            ]),
          },
        },
      }],
    });
  }, []);

  const fetchDashboardData = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const [res, profitRes] = await Promise.all([
        getDashboard(),
        getProfitSummary().catch(() => null),
      ]);
      setStats(res.data);
      initBarChart();
      updateBarChart(res.data.monthly_data);
      if (profitRes?.data?.summary) {
        setProfitData({
          net_profit: profitRes.data.summary.total_net_profit || 0,
          total_revenue: profitRes.data.summary.total_revenue || 0,
          order_count: profitRes.data.order_count || 0,
        });
      }
      if (manual) toast('仪表盘已刷新', 'success');
    } catch (err) {
      if (manual) toast('获取失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, initBarChart, updateBarChart]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  usePolling(fetchDashboardData, 30000);

  useEffect(() => {
    const handler = () => fetchDashboardData();
    on('order_updated', handler);
    return () => off('order_updated', handler);
  }, [on, off, fetchDashboardData]);

  // 监听 window resize + 侧边栏展开/收起导致的容器尺寸变化
  useEffect(() => {
    const resize = () => chartInstanceRef.current?.resize();
    window.addEventListener('resize', resize);

    // 使用 ResizeObserver 监听图表容器本身的尺寸变化（侧边栏不触发 window.resize）
    let ro;
    if (barChartRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => chartInstanceRef.current?.resize());
      ro.observe(barChartRef.current);
    }

    return () => {
      window.removeEventListener('resize', resize);
      ro?.disconnect();
      chartInstanceRef.current?.dispose();
    };
  }, []);

  return (
    <div className="flex flex-col gap-7 w-full max-w-[1400px] mx-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 lg:gap-5">
        {/* Total Orders */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow p-5 lg:p-6 group hover:border-brand-100 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors bg-brand-50 group-hover:bg-brand-100">
              <svg className="w-5 h-5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            </div>
            {weekTrend >= 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" transform="rotate(180 10 10)" /></svg>
                {weekTrend.toFixed(1)}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                {weekTrend.toFixed(1)}%
              </span>
            )}
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">{stats.total_orders}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">总订单</span>
        </div>
        {/* Pending */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow p-5 lg:p-6 group hover:border-amber-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors bg-amber-50 group-hover:bg-amber-100">
              <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            {stats.pending_orders > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">待处理</span>}
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">{stats.pending_orders}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">待处理</span>
        </div>
        {/* Designing */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow p-5 lg:p-6 group hover:border-purple-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors bg-purple-50 group-hover:bg-purple-100">
              <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" /></svg>
            </div>
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">{stats.designing_orders}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">设计中</span>
        </div>
        {/* Revenue */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow p-5 lg:p-6 group hover:border-emerald-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors bg-emerald-50 group-hover:bg-emerald-100">
              <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" transform="rotate(180 10 10)" /></svg>
              今日 {stats.today_order_count} 单
            </span>
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">&yen;{stats.today_revenue}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">今日营收</span>
        </div>
        {/* Net Profit */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow p-5 lg:p-6 group hover:border-green-200 transition-all duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-colors bg-green-50 group-hover:bg-green-100">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
            </div>
            {profitData.net_profit > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" transform="rotate(180 10 10)" /></svg>
                利润率 {profitMargin}%
              </span>
            ) : (
              <span className="text-xs text-slate-400">利润率 {profitMargin}%</span>
            )}
          </div>
          <h4 className="text-2xl lg:text-[28px] font-bold text-green-700 font-[Outfit] tabular-nums leading-tight">&yen;{(profitData.net_profit / 100).toFixed(2)}</h4>
          <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">本月净利润</span>
        </div>
      </div>

      {/* Monthly Chart + Team Load */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 lg:gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow xl:col-span-2 flex flex-col min-h-0">
          <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">月度销量</h2>
              <p className="text-sm text-slate-500 mt-0.5">过去一年的订单趋势</p>
            </div>
            <button onClick={() => fetchDashboardData(true)} className="inline-flex items-center justify-center gap-1.5 font-semibold border cursor-pointer transition-all whitespace-nowrap leading-snug active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 text-xs rounded-lg" disabled={loading}>
              <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              <span>{loading ? '刷新中...' : '刷新'}</span>
            </button>
          </div>
          <div className="p-5 lg:p-6 flex-1 min-h-[340px] lg:min-h-[380px]" ref={barChartRef} />
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow xl:col-span-1 flex flex-col min-h-0">
          <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">团队负载</h2>
              <p className="text-sm text-slate-500 mt-0.5">实时运营容量</p>
            </div>
            <span className="flex h-2.5 w-2.5 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>
          <div className="p-5 lg:p-6 flex flex-col gap-4 flex-1">
            <div className="flex items-center p-3.5 rounded-xl border border-slate-100 bg-gradient-to-r from-brand-25 to-white hover:border-brand-100 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm mr-3.5">
                <span className="text-lg font-bold text-brand-500 tabular-nums">{stats.active_designers}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">活跃成员</div>
                <div className="text-xs text-slate-500 mt-0.5">正在处理订单中</div>
              </div>
            </div>
            <div className="flex items-center p-3.5 rounded-xl border border-slate-100 bg-gradient-to-r from-emerald-50/60 to-white hover:border-emerald-200 transition-colors">
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
      </div>

      {/* Designer Rankings */}
      {stats.designer_rankings?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)] transition-shadow">
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
            <table className="w-full border-separate border-spacing-0 text-left">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="py-3.5 px-4 font-semibold text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200 whitespace-nowrap pl-6">排名</th>
                  <th className="py-3.5 px-4 font-semibold text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200 whitespace-nowrap">姓名</th>
                  <th className="py-3.5 px-4 font-semibold text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200 whitespace-nowrap">已完成</th>
                  <th className="py-3.5 px-4 font-semibold text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200 whitespace-nowrap">进行中</th>
                  <th className="py-3.5 px-4 font-semibold text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200 whitespace-nowrap text-right pr-6">平均耗时</th>
                </tr>
              </thead>
              <tbody>
                {displayedRankings.map((d, i) => (
                  <tr key={d.wecom_userid || i} className="hover:bg-[#FAFBFC]">
                    <td className="py-3.5 px-4 text-[13px] text-slate-700 border-b border-slate-100 pl-6">
                      {i === 0 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-50 text-amber-500 text-sm font-bold">1</span>
                        : i === 1 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-sm font-bold">2</span>
                        : i === 2 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-50 text-orange-400 text-sm font-bold">3</span>
                        : <span className="text-sm text-slate-400 pl-2">#{i + 1}</span>}
                    </td>
                    <td className="py-3.5 px-4 text-[13px] border-b border-slate-100 font-semibold text-slate-800">{d.name}</td>
                    <td className="py-3.5 px-4 text-[13px] text-slate-700 border-b border-slate-100"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#DAF8E6] text-green-900">{d.completed_count}</span></td>
                    <td className="py-3.5 px-4 text-[13px] text-slate-700 border-b border-slate-100"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-500">{d.active_count}</span></td>
                    <td className="py-3.5 px-4 border-b border-slate-100 text-right pr-6 text-sm text-slate-600 tabular-nums">{d.avg_hours ? d.avg_hours.toFixed(1) + 'h' : '-'}</td>
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
