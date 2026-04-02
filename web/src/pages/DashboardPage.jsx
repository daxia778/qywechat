import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { getDashboard, getProfitSummary } from '../api/admin';
import { getMyStats } from '../api/orders';
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
  const [loading, setLoading] = useState(false);
  const [rankingExpanded, setRankingExpanded] = useState(false);
  const [profitData, setProfitData] = useState({ net_profit: 0, total_revenue: 0, order_count: 0 });
  // 非管理员个人统计
  const [myStats, setMyStats] = useState(null);
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
      if (!isAdmin) {
        // 非管理员：调用个人统计 API
        const res = await getMyStats({ signal });
        setMyStats(res.data);
        if (manual) toast('数据已刷新', 'success');
        return;
      }
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
  }, [toast, isAdmin, initBarChart, updateBarChart, initPieChart, updatePieChart]);

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
      <PageHeader title={isAdmin ? "数据总览" : "我的工作台"} subtitle={isAdmin ? "实时运营数据看板" : `${ROLE_MAP[role] || role} · 个人数据概览`} className="mb-1">
        <button onClick={() => fetchDashboardData(true)} disabled={loading} className="flex items-center gap-1.5 bg-[#f3f4f5] border border-[#e1e3e4] rounded-lg px-3.5 py-2 text-sm font-medium text-[#454654] cursor-pointer hover:bg-[#e7e8e9] transition-colors disabled:opacity-50">
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>{loading ? '刷新中...' : '刷新数据'}</span>
        </button>
      </PageHeader>

      {/* ═══ Non-Admin Dashboard ═══ */}
      {!isAdmin && myStats && (
        <>
          {/* Personal KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
            <MetricCard
              title="我的订单"
              value={myStats.total_orders || 0}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="3.5" rx="1.75" strokeLinejoin="round"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.5l.9 11.1A2 2 0 007.4 19.5h9.2a2 2 0 001.99-1.9l.9-11.1"/>
                  <path strokeLinecap="round" d="M9.5 11h5"/>
                  <path strokeLinecap="round" d="M10.5 14.5h3"/>
                </svg>
              }
              colorHex="#434FCF"
            />
            <MetricCard
              title="待处理"
              value={myStats.pending_orders || 0}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5.25l3.5 2"/>
                </svg>
              }
              colorHex="#F59E0B"
            />
            <MetricCard
              title="设计中"
              value={myStats.designing_orders || 0}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                </svg>
              }
              colorHex="#3B82F6"
            />
            <MetricCard
              title="已完成"
              value={myStats.completed_orders || 0}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              }
              colorHex="#10B981"
            />
          </div>

          {/* Revenue + Today Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5">
            {role === 'follow' ? (
              <>
                <MetricCard title="售后中" value={myStats.after_sale_orders || 0} icon={<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>} colorHex="#EF4444" />
                <MetricCard title="修改中" value={myStats.revision_orders || 0} icon={<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>} colorHex="#8B5CF6" />
              </>
            ) : (
              <>
                <MetricCard title="今日新增" value={myStats.today_orders || 0} icon={<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} colorHex="#8B5CF6" />
                <MetricCard title="已交付" value={myStats.delivered_orders || 0} icon={<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>} colorHex="#059669" />
              </>
            )}
            
            <MetricCard
              title="我的佣金"
              value={(myStats.month_commission || 0) / 100}
              isCurrency={true}
              subtitle={`累计 ¥${fmtYuan(myStats.total_commission)} · ${role === 'designer' ? '设计' : role === 'sales' ? '谈单' : '跟单'}提成`}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
              }
              colorHex="#EA580C"
            />
          </div>

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
          {/* KPI Cards -- Row 1: 4 primary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6">
            <MetricCard
              title="总订单"
              value={stats.total_orders || 0}
              currentRateVal={stats.today_order_count || 0}
              prevValue={stats.yesterday_order_count || 0}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="3.5" rx="1.75" strokeLinejoin="round"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.5l.9 11.1A2 2 0 007.4 19.5h9.2a2 2 0 001.99-1.9l.9-11.1"/>
                  <path strokeLinecap="round" d="M9.5 11h5"/>
                  <path strokeLinecap="round" d="M10.5 14.5h3"/>
                </svg>
              }
              colorHex="#434FCF"
            />
            <MetricCard
              title="待处理"
              value={stats.pending_orders || 0}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5.25l3.5 2"/>
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
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 17.5V15a1 1 0 011-1h2a1 1 0 011 1v2.5"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 17.5V11a1 1 0 011-1h2a1 1 0 011 1v6.5"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 17.5V7a1 1 0 011-1h2a1 1 0 011 1v10.5"/>
                  <path strokeLinecap="round" d="M3 17.5h18"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 11.5l3-3 3 2.5 4-5"/>
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
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <path strokeLinecap="round" d="M12 9v4.5"/>
                  <circle cx="12" cy="16.5" r="0.5" fill="currentColor" stroke="none"/>
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
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <rect x="2" y="6" width="20" height="13" rx="2" strokeLinejoin="round"/>
                  <path strokeLinecap="round" d="M2 10h20"/>
                  <circle cx="12" cy="15" r="2.5"/>
                  <path strokeLinecap="round" d="M6 10V7a6 6 0 0112 0v3"/>
                </svg>
              }
              colorHex="#059669"
            />
            <MetricCard
              title="待处理订单"
              value={pendingTotal}
              subtitle={`确认 ${stats.confirmed_count || 0} · 售后 ${stats.after_sale_count || 0} · 修改 ${stats.revision_count || 0}`}
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width={26} height={26} strokeWidth="1.5">
                  <rect x="5" y="3" width="14" height="18" rx="2" strokeLinejoin="round"/>
                  <path strokeLinecap="round" d="M9 7h6"/>
                  <path strokeLinecap="round" d="M9 11h6"/>
                  <path strokeLinecap="round" d="M9 15h4"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 3.5v-1a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v1"/>
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
        </>
      )}
    </div>
  );
}
