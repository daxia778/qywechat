import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { getMyStats } from '../../api/orders';
import { PIPELINE_STAGES, STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES, ROLE_LABELS, fmtYuan } from '../../utils/constants';
import { formatTime } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/ui/PageHeader';

/* ── 数字递增动画 Hook ── */
function useCountUp(target, duration = 1000) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!target) { setValue(0); return }
    let rafId
    const start = performance.now()
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafId)
  }, [target, duration])
  return value
}

/* ── 带动画的指标数字 ── */
function AnimatedNumber({ value, prefix = '', suffix = '', className = '' }) {
  const count = useCountUp(value, 900)
  return <span className={className}>{prefix}{count}{suffix}</span>
}

/* ── KPI 配置 ── */
const KPI_CARDS = [
  { key: 'completed',  label: '累计完成', dot: 'bg-emerald-500', clickStatus: 'COMPLETED' },
  { key: 'commission', label: '本月佣金', dot: 'bg-violet-500',  clickStatus: null },
  { key: 'today',      label: '今日新增', dot: 'bg-amber-500',   clickStatus: null },
  { key: 'active',     label: '进行中',   dot: 'bg-blue-500',    clickStatus: 'DESIGNING' },
]

export default function StaffDashboard() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchStats = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const res = await getMyStats()
      setStats(res.data)
    } catch (err) {
      if (manual) toast('加载失败: ' + err.message, 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(() => fetchStats(), 30000)
    return () => clearInterval(interval)
  }, [fetchStats])

  const getPipelineCount = (stage) => {
    if (!stats) return 0
    const map = {
      pending: (stats.pending_orders || 0),
      designing: (stats.designing_orders || 0),
      completed: (stats.completed_orders || 0),
    }
    return map[stage.key] || 0
  }

  const monthCommission = useMemo(() => fmtYuan(stats?.month_commission), [stats])
  const totalCommission = useMemo(() => fmtYuan(stats?.total_commission), [stats])

  /* ── 加载态 ── */
  if (loading) {
    return (
      <div className="relative min-h-[60vh]">
        <LoadingSpinner text="加载工作台..." />
      </div>
    )
  }

  /* ── KPI 数值提取 ── */
  const kpiValues = {
    completed:  stats?.completed_orders || 0,
    commission: monthCommission,
    today:      stats?.today_orders || 0,
    active:     (stats?.designing_orders || 0) + (stats?.revision_orders || 0),
  }

  return (
    <div className="page-enter">
      {/* ── PageHeader ── */}
      <PageHeader
        title="工作台"
        subtitle={`${ROLE_LABELS[user?.role] || '员工'} · ${user?.name}`}
      >
        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm disabled:opacity-50"
        >
          <svg
            className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
            xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
            strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.18" />
          </svg>
          {refreshing ? '刷新中' : '刷新'}
        </button>
      </PageHeader>

      {/* ── 统一指标区：Pipeline + KPI 合并 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 mt-7 mb-7">
        {[
          // Pipeline
          ...PIPELINE_STAGES.map((stage) => ({
            label: stage.label, value: getPipelineCount(stage), type: 'pipeline',
            gradient: stage.key === 'pending' ? 'from-amber-500 to-orange-500' : stage.key === 'designing' ? 'from-blue-500 to-indigo-500' : 'from-emerald-500 to-teal-500',
            shadow: stage.key === 'pending' ? 'shadow-amber-500/25' : stage.key === 'designing' ? 'shadow-blue-500/25' : 'shadow-emerald-500/25',
            icon: stage.key === 'pending' ? 'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z' : stage.key === 'designing' ? 'M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42' : 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
            click: `/s/orders?status=${stage.status[0]}`,
            suffix: '单',
          })),
          // KPI
          {
            label: '累计完成', value: kpiValues.completed, type: 'number',
            gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/25',
            icon: 'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z',
            click: '/s/orders?status=COMPLETED',
          },
          {
            label: '本月佣金', value: monthCommission, type: 'currency',
            gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/25',
            icon: 'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
            extra: `累计 ¥${totalCommission}`,
          },
          {
            label: '今日新增', value: kpiValues.today, type: 'number',
            gradient: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/25',
            icon: 'M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
          },
          {
            label: '进行中', value: kpiValues.active, type: 'number',
            gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/25',
            icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z',
            click: '/s/orders?status=DESIGNING',
          },
        ].map((card) => (
          <div
            key={card.label}
            onClick={card.click ? () => navigate(card.click) : undefined}
            className={`relative bg-white rounded-2xl p-4 flex items-center gap-3.5 border border-slate-200/60 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${card.click ? 'cursor-pointer' : ''}`}
          >
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${card.gradient} shadow-md ${card.shadow} flex items-center justify-center shrink-0`}>
              <svg className="w-[18px] h-[18px] text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-400 tracking-wide">{card.label}</span>
                {card.extra && <span className="text-[10px] text-slate-400 font-medium truncate">{card.extra}</span>}
              </div>
              <div className="text-xl font-[Outfit] font-black text-slate-900 tabular-nums leading-tight mt-0.5">
                {card.type === 'currency' ? (
                  <span>¥{card.value}</span>
                ) : (
                  <>
                    <AnimatedNumber value={card.value} />
                    {card.suffix && <span className="text-xs font-semibold text-slate-400 ml-0.5">{card.suffix}</span>}
                  </>
                )}
              </div>
            </div>
            {card.click && (
              <svg className="w-4 h-4 text-slate-300 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* ── 最近订单 ── */}
      {stats?.recent_orders?.length > 0 && (
        <div className="bg-surface-container-lowest ghost-border rounded-2xl overflow-hidden">
          {/* 头部 */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-slate-900 font-[Outfit]">
              最近订单
            </h2>
            <button
              onClick={() => navigate('/s/orders')}
              className="text-xs font-semibold text-slate-400 hover:text-slate-900 transition-colors duration-150 cursor-pointer bg-transparent border-none p-0"
            >
              全部
              <svg className="w-3 h-3 inline-block ml-1 -mt-px" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
          {/* 订单行 */}
          <div>
            {stats.recent_orders.map((order, i) => {
              const badgeVariant = STATUS_BADGE_MAP[order.status] || 'secondary'
              const badgeClass = BADGE_VARIANT_CLASSES[badgeVariant]
              return (
                <div
                  key={order.id}
                  onClick={() => navigate(`/s/orders/${order.id}`)}
                  className={`flex items-center gap-3.5 px-6 py-3.5 cursor-pointer transition-colors duration-150 hover:bg-slate-50 ${i < stats.recent_orders.length - 1 ? 'border-b border-slate-50' : ''}`}
                >
                  {/* 状态圆点 */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    badgeVariant === 'success' ? 'bg-emerald-500' :
                    badgeVariant === 'warning' ? 'bg-amber-500' :
                    badgeVariant === 'danger' ? 'bg-red-500' :
                    badgeVariant === 'primary' ? 'bg-[#434FCF]' :
                    'bg-slate-400'
                  }`} />
                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 font-[Outfit] tabular-nums">
                        {order.order_sn || `#${order.id}`}
                      </span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${badgeClass}`}>
                        {STATUS_MAP[order.status] || order.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {order.topic || '未填写主题'}
                    </div>
                  </div>
                  {/* 金额 + 时间 */}
                  <div className="text-right shrink-0">
                    <div className="text-[15px] font-extrabold text-slate-900 font-[Outfit] tabular-nums">
                      ¥{fmtYuan(order.price)}
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5 tabular-nums">
                      {formatTime(order.created_at)}
                    </div>
                  </div>
                  {/* 箭头 */}
                  <svg className="w-3.5 h-3.5 text-slate-300 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 空状态 ── */}
      {!stats?.recent_orders?.length && (
        <div className="bg-surface-container-lowest ghost-border rounded-2xl flex flex-col items-center justify-center py-16 px-5">
          <svg className="w-12 h-12 text-slate-200 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
          </svg>
          <div className="text-sm text-slate-400 font-medium">暂无订单数据</div>
          <p className="text-xs text-slate-300 mt-1">新订单将会出现在这里</p>
        </div>
      )}
    </div>
  )
}
