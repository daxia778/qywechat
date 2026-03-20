import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { getDashboard, getProfitSummary } from '../api/admin';
import MetricCard from '../components/MetricCard';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

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

  usePolling(fetchDashboardData, connected ? 60000 : 30000);

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
      {/* KPI Cards (New 4-Card Design) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6">
        <MetricCard
          title="总订单"
          value={stats.total_orders || 0}
          currentRateVal={stats.today_order_count || 0}
          prevValue={stats.yesterday_order_count || 0}
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1792 1792" height={16} width={16} fill="currentColor">
              <path d="M1362 1185q0 153-99.5 263.5t-258.5 136.5v175q0 14-9 23t-23 9h-135q-13 0-22.5-9.5t-9.5-22.5v-175q-66-9-127.5-31t-101.5-44.5-74-48-46.5-37.5-17.5-18q-17-21-2-41l103-135q7-10 23-12 15-2 24 9l2 2q113 99 243 125 37 8 74 8 81 0 142.5-43t61.5-122q0-28-15-53t-33.5-42-58.5-37.5-66-32-80-32.5q-39-16-61.5-25t-61.5-26.5-62.5-31-56.5-35.5-53.5-42.5-43.5-49-35.5-58-21-66.5-8.5-78q0-138 98-242t255-134v-180q0-13 9.5-22.5t22.5-9.5h135q14 0 23 9t9 23v176q57 6 110.5 23t87 33.5 63.5 37.5 39 29 15 14q17 18 5 38l-81 146q-8 15-23 16-14 3-27-7-3-3-14.5-12t-39-26.5-58.5-32-74.5-26-85.5-11.5q-95 0-155 43t-60 111q0 26 8.5 48t29.5 41.5 39.5 33 56 31 60.5 27 70 27.5q53 20 81 31.5t76 35 75.5 42.5 62 50 53 63.5 31.5 76.5 13 94z"></path>
            </svg>
          }
          progress={stats.today_order_count > 0 ? (stats.today_order_count / ((stats.today_order_count + stats.yesterday_order_count) || 1)) * 100 : 0}
          colorHex="#434FCF"
        />
        <MetricCard
          title="待处理"
          value={stats.pending_orders || 0}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" height={18} width={18} strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          }
          progress={stats.total_orders > 0 ? (stats.pending_orders / stats.total_orders) * 100 : 0}
          colorHex="#F59E0B"
        />
        <MetricCard
          title="今日营收"
          value={(stats.today_revenue || 0) / 100}
          currentRateVal={stats.today_revenue || 0}
          prevValue={stats.yesterday_revenue || 0}
          isCurrency={true}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" height={18} width={18} strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          }
          progress={stats.today_revenue > 0 ? (stats.today_revenue / ((stats.today_revenue + stats.yesterday_revenue) || 1)) * 100 : 0}
          colorHex="#10B981"
        />
        <MetricCard
          title="异常事项"
          value={stats.grab_alert_count || 0}
          currentRateVal={stats.grab_alert_count || 0}
          prevValue={stats.yesterday_grab_alerts || 0}
          invertTrend={true}
          icon={
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" height={18} width={18} strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          }
          progress={Math.min((stats.grab_alert_count || 0) * 20, 100)}
          colorHex="#EF4444"
        />
      </div>

      {/* Monthly Chart + Team Load */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 lg:gap-6">
        <div className="bg-white border-2 border-slate-200 rounded-2xl brave-shadow xl:col-span-2 flex flex-col min-h-0">
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

        <div className="bg-white border-2 border-slate-200 rounded-2xl xl:col-span-1 flex flex-col min-h-0 hover:border-brand-200 transition-colors">
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
        <div className="bg-white border-2 border-slate-200 rounded-2xl hover:border-brand-200 transition-colors">
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
              <thead>
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
                  <tr key={d.wecom_userid || i} className="hover:bg-brand-25">
                    <td className="py-3.5 px-4 text-[13px] text-slate-700 border-b border-slate-100 pl-6">
                      {i === 0 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-brand-500 text-sm font-bold border-2 border-brand-200">1</span>
                        : i === 1 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-brand-500/70 text-sm font-bold border-2 border-brand-100">2</span>
                        : i === 2 ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-brand-500/50 text-sm font-bold border-2 border-brand-100">3</span>
                        : <span className="text-sm text-slate-400 pl-2">#{i + 1}</span>}
                    </td>
                    <td className="py-3.5 px-4 text-[13px] border-b border-slate-100 font-semibold text-slate-800">{d.name}</td>
                    <td className="py-3.5 px-4 text-[13px] text-slate-700 border-b border-slate-100"><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-bg text-green-900">{d.completed_count}</span></td>
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
