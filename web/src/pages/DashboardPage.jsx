import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Package, Clock, TrendingUp, Wallet, Pen, CheckCircle, CalendarPlus, Check, FileEdit, DollarSign, RefreshCw } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { useThrottledCallback } from '../hooks/useThrottledCallback';
import { getDashboard, getProfitSummary } from '../api/admin';
import { getMyStats } from '../api/orders';
import apiCache from '../utils/apiCache';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES, ROLE_MAP } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import MetricCard from '../components/MetricCard';
import PageHeader from '../components/ui/PageHeader';
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
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { on, off, connected } = useWebSocket();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rankingExpanded, setRankingExpanded] = useState(false);
  const [profitData, setProfitData] = useState({ net_profit: 0, total_revenue: 0, order_count: 0 });
  // 非管理员个人统计
  const [myStats, setMyStats] = useState(null);
  const [stats, setStats] = useState({
    total_orders: 0, pending_orders: 0, designing_orders: 0,
    today_revenue: 0, today_order_count: 0,
    designer_rankings: [], monthly_data: [],
    week_revenue: 0, last_week_revenue: 0, avg_completion_hours: 0,
    // Phase 5 fields
    total_payment_amount: 0, pdd_payment_amount: 0, wecom_payment_amount: 0,
    manual_payment_amount: 0, total_payment_count: 0,
    after_sale_count: 0, revision_count: 0, confirmed_count: 0,
    today_payment_amount: 0, yesterday_payment_amount: 0,
    week_payment_amount: 0, last_week_payment_amount: 0,
    yesterday_avg_completion_hours: 0,
  });

  const barChartRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const pieChartRef = useRef(null);
  const pieInstanceRef = useRef(null);


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
    const manual = (st.manual_payment_amount || 0) / 100;
    const hasData = pdd + manual > 0;

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
          const map = { '拼多多': pdd, '手动录入': manual };
          return `${name}  {val|¥${(map[name] || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}}`;
        },
      },
      series: [{
        type: 'pie',
        radius: ['44%', '68%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: false,
        padAngle: 3,
        minAngle: 8,
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
      if (!isAdmin) {
        // 非管理员：调用个人统计 API
        const res = await getMyStats({ signal });
        setMyStats(res.data);
        if (manual) toast('数据已刷新', 'success');
        return;
      }
      // 管理员：Dashboard 实时数据 + 利润摘要（5分钟缓存）
      const [res, profitRes] = await Promise.all([
        getDashboard({ signal }),
        // 利润摘要变化频率低，用 5 分钟缓存 + stale-while-revalidate
        // 手动刷新时绕过缓存
        manual
          ? getProfitSummary(undefined, { signal }).catch(() => null)
          : apiCache.get(
              'profit_summary',
              (s) => getProfitSummary(undefined, { signal: s }).catch(() => null),
              { ttl: 300000, staleWhileRevalidate: true, signal }
            ),
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
      if (manual) {
        // 手动刷新时清除利润缓存，确保下次拿最新数据
        apiCache.invalidate('profit_summary');
        toast('仪表盘已刷新', 'success');
      }
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      if (manual) toast('获取失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, isAdmin, initBarChart, updateBarChart, initPieChart, updatePieChart]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboardData(false, controller.signal);
    return () => controller.abort();
  }, [fetchDashboardData]);

  // 轮询降频: WS 有连接时 5min，无连接时 2min（兜底）
  usePolling(fetchDashboardData, connected ? 300000 : 120000);

  // WS 事件节流: 3s 内多次 order_updated 只刷新一次
  const throttledDashboardRefresh = useThrottledCallback(fetchDashboardData, 3000);
  useEffect(() => {
    on('order_updated', throttledDashboardRefresh);
    return () => off('order_updated', throttledDashboardRefresh);
  }, [on, off, throttledDashboardRefresh]);

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
      <PageHeader title={isAdmin ? "数据总览" : "我的工作台"} subtitle={isAdmin ? "实时运营数据看板" : `${ROLE_MAP[role] || role} · 个人数据概览`} className="mb-1">
        <button onClick={() => fetchDashboardData(true)} disabled={loading} className="flex items-center gap-1.5 bg-[#f3f4f5] border border-[#e1e3e4] rounded-lg px-3.5 py-2 text-sm font-medium text-[#454654] cursor-pointer hover:bg-[#e7e8e9] transition-colors disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? '刷新中...' : '刷新数据'}</span>
        </button>
      </PageHeader>

      {/* ═══ Non-Admin Dashboard ═══ */}
      {!isAdmin && myStats && (
        <>
          {/* ── Follow Role: 2×2 Big Cards ── */}
          {role === 'follow' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 lg:gap-6">
              <FollowBigCard
                title="待处理"
                value={myStats.pending_orders || 0}
                suffix="单"
                icon={<Clock size={24} />}
                colorHex="#F59E0B"
                gradient="from-amber-500 to-orange-400"
                subtitle={myStats.after_sale_orders ? `含售后 ${myStats.after_sale_orders} 单` : null}
              />
              <FollowBigCard
                title="设计中"
                value={myStats.designing_orders || 0}
                suffix="单"
                icon={<Pen size={24} />}
                colorHex="#3B82F6"
                gradient="from-blue-500 to-indigo-500"
                subtitle={myStats.revision_orders ? `修改中 ${myStats.revision_orders} 单` : null}
              />
              <FollowBigCard
                title="已完成"
                value={myStats.completed_orders || 0}
                suffix="单"
                icon={<CheckCircle size={24} />}
                colorHex="#10B981"
                gradient="from-emerald-500 to-teal-500"
                subtitle={`累计交付 ${myStats.delivered_orders || 0} 单`}
              />
              <FollowBigCard
                title="本月佣金"
                value={(myStats.month_commission || 0) / 100}
                isCurrency
                icon={<DollarSign size={24} />}
                colorHex="#8B5CF6"
                gradient="from-violet-500 to-purple-500"
                subtitle={`累计 ¥${fmtYuan(myStats.total_commission)} · 跟单提成`}
              />
            </div>
          ) : (
            <>
              {/* Other roles: original layout */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
                <MetricCard
                  title="我的订单"
                  value={myStats.total_orders || 0}
                  icon={<Package size={18} />}
                  colorHex="#434FCF"
                />
                <MetricCard
                  title="待处理"
                  value={myStats.pending_orders || 0}
                  icon={<Clock size={18} />}
                  colorHex="#F59E0B"
                />
                <MetricCard
                  title="设计中"
                  value={myStats.designing_orders || 0}
                  icon={<Pen size={18} />}
                  colorHex="#3B82F6"
                />
                <MetricCard
                  title="已完成"
                  value={myStats.completed_orders || 0}
                  icon={<CheckCircle size={18} />}
                  colorHex="#10B981"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
                <MetricCard title="今日新增" value={myStats.today_orders || 0} icon={<CalendarPlus size={18} />} colorHex="#8B5CF6" />
                <MetricCard title="已交付" value={myStats.delivered_orders || 0} icon={<Check size={18} />} colorHex="#059669" />
                <MetricCard
                  title="我的佣金"
                  value={(myStats.month_commission || 0) / 100}
                  isCurrency={true}
                  subtitle={`累计 ¥${fmtYuan(myStats.total_commission)} · ${role === 'designer' ? '设计' : role === 'sales' ? '谈单' : '跟单'}提成`}
                  icon={<DollarSign size={18} />}
                  colorHex="#EA580C"
                />
              </div>
            </>
          )}

          {/* Designer Grab Queue */}
          {role === 'designer' && myStats.grab_queue?.length > 0 && (
            <div className="bg-gradient-to-br from-indigo-50/50 to-white border border-indigo-100/60 rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(67,79,207,0.06)] relative">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <svg viewBox="0 0 24 24" width="120" height="120" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-5H8.5L13 7v5h2.5L11 16.5z"/></svg>
              </div>
              <div className="px-5 lg:px-7 py-4 flex items-center justify-between border-b border-indigo-50 relative z-10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-800 font-[Outfit] tracking-wide">可抢单队列</h2>
                    <p className="text-xs text-slate-500 mt-0.5">有新订单待接手</p>
                  </div>
                </div>
                <span className="bg-brand-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">{myStats.grab_queue.length}</span>
              </div>
              <div className="p-4 lg:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 relative z-10">
                {myStats.grab_queue.map(order => (
                  <div key={order.id} className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm hover:shadow-md hover:border-brand-200 transition-all group flex flex-col h-full">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-sm font-bold text-slate-800 font-mono block">{order.order_sn || `#${order.id}`}</span>
                        <div className="text-xs text-slate-500 mt-1 line-clamp-1">{order.topic || '未填写主题'}</div>
                      </div>
                      <span className="text-brand-600 font-bold tabular-nums bg-brand-50 px-2 py-1 rounded text-sm">¥{fmtYuan(order.price)}</span>
                    </div>
                    <div className="mt-auto pt-3 flex justify-between items-center border-t border-slate-50">
                      <div className="flex flex-col">
                        <span className="text-[11px] text-slate-400 uppercase tracking-wider">截止时间</span>
                        <span className="text-xs font-semibold text-slate-700">{order.deadline ? formatTime(order.deadline) : '待定'}</span>
                      </div>
                      <Link to={`/orders?keyword=${order.order_sn}`} className="bg-brand-50 text-brand-600 hover:bg-brand-500 hover:text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm">
                        去接单
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Orders */}
          {myStats.recent_orders?.length > 0 && (
            <div className="bg-surface-container-lowest ghost-border rounded-2xl overflow-hidden shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
              <div className="px-5 lg:px-7 py-5 border-b border-[#e1e3e4] flex items-center justify-between">
                <div>
                  <h2 style={{fontFamily:"'Outfit',sans-serif", fontSize:18, fontWeight:600, color:'#1d1d1f'}}>最近订单</h2>
                  <p className="text-[13px] text-[#6e6e73] mt-0.5">最新 5 条订单动态</p>
                </div>
                <Link to="/orders" className="text-xs text-brand-500 hover:underline font-semibold bg-brand-50 px-2.5 py-1 rounded-md transition-colors hover:bg-brand-100">
                  查看全部
                </Link>
              </div>
              <div className="w-full overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left px-6 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">订单号</th>
                      <th className="text-left px-6 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">主题</th>
                      <th className="text-right px-6 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">金额</th>
                      <th className="text-left px-6 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider">状态</th>
                      <th className="text-right px-6 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myStats.recent_orders.map((order) => (
                      <tr key={order.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-3.5">
                          <Link to={`/orders?keyword=${order.order_sn}`} className="text-[13px] font-bold text-brand-600 hover:underline font-mono">
                            {order.order_sn || `#${order.id}`}
                          </Link>
                        </td>
                        <td className="px-6 py-3.5 hidden sm:table-cell">
                          <span className="text-[13px] text-slate-700 truncate block max-w-[200px]">{order.topic || '-'}</span>
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <span className="text-[14px] font-bold text-slate-800 tabular-nums">¥{fmtYuan(order.price)}</span>
                        </td>
                        <td className="px-6 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[order.status]] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                            {STATUS_MAP[order.status] || order.status}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-right hidden md:table-cell">
                          <span className="text-[12px] text-slate-500 tabular-nums">{formatTime(order.created_at)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ Admin Dashboard ═══ */}
      {isAdmin && (
        <>
          {/* KPI Cards -- 4 primary overview cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6">
            <MetricCard
              title="总收款"
              formattedValue={`¥${fmtYuan(stats.total_payment_amount)}`}
              value={(stats.total_payment_amount || 0) / 100}
              currentRateVal={stats.week_payment_amount || 0}
              prevValue={stats.last_week_payment_amount || 0}
              isCurrency={true}
              subtitle="周环比"
              icon={<Wallet size={18} />}
              colorHex="#059669"
            />
            <MetricCard
              title="总订单"
              value={stats.total_orders || 0}
              currentRateVal={stats.week_order_count || 0}
              prevValue={stats.last_week_order_count || 0}
              subtitle="周环比"
              icon={<Package size={18} />}
              colorHex="#434FCF"
            />
            <MetricCard
              title="今日营收"
              value={(stats.today_revenue || 0) / 100}
              currentRateVal={stats.today_revenue || 0}
              prevValue={stats.yesterday_revenue || 0}
              isCurrency={true}
              subtitle="日环比"
              icon={<TrendingUp size={18} />}
              colorHex="#10B981"
            />
            <MetricCard
              title="平均完工时长"
              formattedValue={`${(stats.avg_completion_hours || 0).toFixed(1)}h`}
              value={stats.avg_completion_hours || 0}
              currentRateVal={stats.avg_completion_hours || 0}
              prevValue={stats.yesterday_avg_completion_hours || 0}
              invertTrend={true}
              subtitle="较昨日"
              icon={<Clock size={18} />}
              colorHex="#F59E0B"
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
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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

          {/* Order Status Distribution */}
          <div className="grid grid-cols-1 gap-6 lg:gap-8">
            <div className="bg-surface-container-lowest ghost-border rounded-2xl flex flex-col min-h-0 hover:border-[#434FCF]/25 transition-colors shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
              <div className="px-5 lg:px-7 py-5 border-b border-[#e1e3e4]">
                <h2 style={{fontFamily:"'Outfit',sans-serif", fontSize:18, fontWeight:600, color:'#1d1d1f'}}>订单状态分布</h2>
                <p className="text-[13px] text-[#6e6e73] mt-0.5">当前各状态订单数量概览</p>
              </div>
              <div className="p-5 lg:p-6 flex-1">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {[
                    { label: '待处理', value: (stats.pending_orders || 0) + (stats.confirmed_count || 0), color: '#F59E0B', bg: 'from-amber-50 to-white', border: 'border-amber-100', statusFilter: 'PENDING' },
                    { label: '设计中', value: (stats.designing_orders || 0) + (stats.revision_count || 0), color: '#3B82F6', bg: 'from-blue-50/60 to-white', border: 'border-blue-100', statusFilter: 'DESIGNING,REVISION,AFTER_SALE' },
                    { label: '已完成', value: stats.completed_orders || 0, color: '#10B981', bg: 'from-emerald-50/60 to-white', border: 'border-emerald-100', statusFilter: 'COMPLETED' },
                    { label: '售后订单', value: stats.after_sale_count || 0, color: '#EF4444', bg: 'from-red-50/60 to-white', border: 'border-red-100', statusFilter: 'AFTER_SALE' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      onClick={() => navigate(`/orders?status=${item.statusFilter}`)}
                      className={`flex items-center p-4 lg:p-5 rounded-xl border bg-gradient-to-r ${item.bg} ${item.border} cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-[1.02] hover:border-[#434FCF]/30 active:scale-[0.98]`}
                    >
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mr-3"
                        style={{ backgroundColor: item.color + '14' }}
                      >
                        <span className="text-base font-bold tabular-nums" style={{ color: item.color }}>
                          {item.value}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-700">{item.label}</div>
                      </div>
                      <svg className="w-4 h-4 text-slate-300 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
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
        </>
      )}
    </div>
  );
}

/** 跟单客服专用大卡片 */
function FollowBigCard({ title, value, suffix, icon, colorHex, gradient, isCurrency, subtitle }) {
  const displayVal = isCurrency
    ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;

  return (
    <div
      className="group relative bg-white border border-black/[0.06] rounded-2xl p-6 lg:p-8 flex flex-col gap-4 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] transition-all duration-200 cursor-default hover:-translate-y-0.5 hover:shadow-[0_0_0_1.5px_var(--c-ring),0_8px_24px_var(--c-glow)] overflow-hidden"
      style={{ '--c-ring': `${colorHex}30`, '--c-glow': `${colorHex}12` }}
    >
      {/* 装饰背景圆 */}
      <div
        className={`absolute -top-8 -right-8 w-32 h-32 rounded-full bg-gradient-to-br ${gradient} opacity-[0.06] pointer-events-none transition-opacity duration-300 group-hover:opacity-[0.10]`}
      />

      {/* 图标 */}
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br ${gradient} text-white shadow-md`}
        style={{ boxShadow: `0 4px 12px ${colorHex}25` }}
      >
        {icon}
      </div>

      {/* 标题 */}
      <div className="text-sm font-medium text-slate-500 tracking-[0.01em]">{title}</div>

      {/* 大数字 */}
      <div className="font-['Outfit',sans-serif] text-[36px] lg:text-[42px] font-bold text-slate-900 leading-[1] tracking-tight tabular-nums">
        {displayVal}
        {suffix && <span className="text-lg lg:text-xl font-semibold text-slate-400 ml-1">{suffix}</span>}
      </div>

      {/* 副标题 */}
      {subtitle && (
        <div className="text-[13px] text-slate-400 truncate">{subtitle}</div>
      )}
    </div>
  );
}
