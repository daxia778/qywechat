import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { getMyStats } from '../../api/orders';
import { PIPELINE_STAGES, STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES, ROLE_LABELS, fmtYuan } from '../../utils/constants';
import { formatTime } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/ui/PageHeader';
import { Inbox, Pencil, CheckCircle, Star, DollarSign, PlusCircle, Zap, RefreshCw, ArrowRight, ChevronRight } from 'lucide-react';

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
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? '刷新中' : '刷新'}
        </button>
      </PageHeader>

      {/* ── 指标区 ── */}
      {user?.role === 'follow' ? (
        /* ── 跟单客服：2×2 大卡片 ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 lg:gap-6 mt-7 mb-7">
          {[
            {
              title: '待处理', value: stats?.pending_orders || 0, suffix: '单',
              icon: <Inbox size={20} className="text-white" />,
              gradient: 'from-amber-500 to-orange-400', colorHex: '#F59E0B',
              click: '/s/orders?status=PENDING',
              subtitle: (stats?.after_sale_orders ? `含售后 ${stats.after_sale_orders} 单` : null),
            },
            {
              title: '设计中', value: stats?.designing_orders || 0, suffix: '单',
              icon: <Pencil size={20} className="text-white" />,
              gradient: 'from-blue-500 to-indigo-500', colorHex: '#3B82F6',
              click: '/s/orders?status=DESIGNING,REVISION,AFTER_SALE',
              subtitle: (stats?.revision_orders ? `修改中 ${stats.revision_orders} 单` : null),
            },
            {
              title: '已完成', value: stats?.completed_orders || 0, suffix: '单',
              icon: <CheckCircle size={20} className="text-white" />,
              gradient: 'from-emerald-500 to-teal-500', colorHex: '#10B981',
              click: '/s/orders?status=COMPLETED',
              subtitle: `累计交付 ${stats?.delivered_orders || 0} 单`,
            },
            {
              title: '本月佣金', value: monthCommission, isCurrency: true,
              icon: <DollarSign size={20} className="text-white" />,
              gradient: 'from-violet-500 to-purple-500', colorHex: '#8B5CF6',
              subtitle: `累计 ¥${totalCommission} · 跟单提成`,
            },
          ].map((card) => (
            <div
              key={card.title}
              onClick={card.click ? () => navigate(card.click) : undefined}
              className={`group relative bg-white border border-black/[0.06] rounded-2xl p-5 lg:p-6 flex flex-col gap-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1.5px_var(--c-ring),0_8px_24px_var(--c-glow)] overflow-hidden ${card.click ? 'cursor-pointer' : ''}`}
              style={{ '--c-ring': `${card.colorHex}30`, '--c-glow': `${card.colorHex}12` }}
            >
              {/* 装饰背景圆 */}
              <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${card.gradient} opacity-[0.06] pointer-events-none transition-opacity duration-300 group-hover:opacity-[0.10]`} />

              {/* 图标 */}
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br ${card.gradient} text-white shadow-md`}
                style={{ boxShadow: `0 4px 12px ${card.colorHex}25` }}
              >
                {card.icon}
              </div>

              {/* 标题 */}
              <div className="text-[13px] font-medium text-slate-500 tracking-[0.01em]">{card.title}</div>

              {/* 大数字 */}
              <div className="font-['Outfit',sans-serif] text-[28px] lg:text-[32px] font-bold text-slate-900 leading-[1] tracking-tight tabular-nums">
                {card.isCurrency ? (
                  <span>¥{card.value}</span>
                ) : (
                  <>
                    <AnimatedNumber value={card.value} />
                    {card.suffix && <span className="text-sm font-semibold text-slate-400 ml-0.5">{card.suffix}</span>}
                  </>
                )}
              </div>

              {/* 副标题 */}
              {card.subtitle && (
                <div className="text-[12px] text-slate-400 truncate">{card.subtitle}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* ── 其他角色：原始小卡片布局 ── */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 mt-7 mb-7">
          {[
            ...PIPELINE_STAGES.map((stage) => ({
              label: stage.label, value: getPipelineCount(stage), type: 'pipeline',
              gradient: stage.key === 'pending' ? 'from-amber-500 to-orange-500' : stage.key === 'designing' ? 'from-blue-500 to-indigo-500' : 'from-emerald-500 to-teal-500',
              shadow: stage.key === 'pending' ? 'shadow-amber-500/25' : stage.key === 'designing' ? 'shadow-blue-500/25' : 'shadow-emerald-500/25',
              icon: stage.key === 'pending' ? <Inbox size={18} className="text-white" /> : stage.key === 'designing' ? <Pencil size={18} className="text-white" /> : <CheckCircle size={18} className="text-white" />,
              click: `/s/orders?status=${stage.status[0]}`,
              suffix: '单',
            })),
            {
              label: '累计完成', value: kpiValues.completed, type: 'number',
              gradient: 'from-emerald-500 to-green-600', shadow: 'shadow-emerald-500/25',
              icon: <Star size={18} className="text-white" />,
              click: '/s/orders?status=COMPLETED',
            },
            {
              label: '本月佣金', value: monthCommission, type: 'currency',
              gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/25',
              icon: <DollarSign size={18} className="text-white" />,
              extra: `累计 ¥${totalCommission}`,
            },
            {
              label: '今日新增', value: kpiValues.today, type: 'number',
              gradient: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/25',
              icon: <PlusCircle size={18} className="text-white" />,
            },
            {
              label: '进行中', value: kpiValues.active, type: 'number',
              gradient: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/25',
              icon: <Zap size={18} className="text-white" />,
              click: '/s/orders?status=DESIGNING',
            },
          ].map((card) => (
            <div
              key={card.label}
              onClick={card.click ? () => navigate(card.click) : undefined}
              className={`relative bg-white rounded-2xl p-4 flex items-center gap-3.5 border border-slate-200/60 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${card.click ? 'cursor-pointer' : ''}`}
            >
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${card.gradient} shadow-md ${card.shadow} flex items-center justify-center shrink-0`}>
                {card.icon}
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
                <ChevronRight size={16} className="text-slate-300 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}

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
              <ArrowRight size={12} className="inline-block ml-1 -mt-px" />
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
                  <ChevronRight size={14} className="text-slate-300 shrink-0" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 空状态 ── */}
      {!stats?.recent_orders?.length && (
        <div className="bg-surface-container-lowest ghost-border rounded-2xl flex flex-col items-center justify-center py-16 px-5">
          <Inbox size={48} strokeWidth={1.2} className="text-slate-200 mb-4" />
          <div className="text-sm text-slate-400 font-medium">暂无订单数据</div>
          <p className="text-xs text-slate-300 mt-1">新订单将会出现在这里</p>
        </div>
      )}
    </div>
  )
}
