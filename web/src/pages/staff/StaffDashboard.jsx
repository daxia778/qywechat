import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { getMyStats, grabOrder } from '../../api/orders'
import { PIPELINE_STAGES, STATUS_MAP, STATUS_COLORS, ROLE_LABELS, fmtYuan, formatTime } from '../../utils/constants'
import { Zap, RefreshCw, Clock, Loader2, TrendingUp, ArrowRight, Sparkles, Package, CircleDollarSign, Inbox, Palette, PackageCheck, CircleCheckBig, CalendarPlus, Wallet } from 'lucide-react'

/* ── Pipeline 图标映射 ── */
const PIPELINE_ICONS = {
  pending:   Inbox,
  designing: Palette,
  delivered: PackageCheck,
  completed: CircleCheckBig,
}

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

export default function StaffDashboard() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [grabbingId, setGrabbingId] = useState(null)

  const role = user?.role || 'designer'

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

  const handleGrab = async (orderId) => {
    setGrabbingId(orderId)
    try {
      await grabOrder(orderId)
      toast('抢单成功！', 'success')
      fetchStats()
    } catch (err) {
      toast('抢单失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setGrabbingId(null)
    }
  }

  const getPipelineCount = (stage) => {
    if (!stats) return 0
    const map = {
      pending: (stats.pending_orders || 0),
      designing: (stats.designing_orders || 0),
      delivered: (stats.delivered_orders || 0),
      completed: (stats.completed_orders || 0),
    }
    return map[stage.key] || 0
  }

  // 佣金格式化
  const monthCommission = useMemo(() => fmtYuan(stats?.month_commission), [stats])
  const totalCommission = useMemo(() => fmtYuan(stats?.total_commission), [stats])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '3px solid #E5E7EB', borderTopColor: '#434FCF',
          animation: 'spin 0.6s linear infinite',
        }} />
        <p style={{ color: '#94A3B8', fontSize: 14, fontWeight: 500 }}>加载中...</p>
      </div>
    )
  }

  return (
    <div className="page-enter">
      {/* ── 页面标题 ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{
            fontSize: 28, fontWeight: 800, color: '#111', letterSpacing: '-0.03em',
            fontFamily: "'Outfit', sans-serif", lineHeight: 1,
          }}>工作台</h1>
          <p style={{ fontSize: 13, color: '#999', marginTop: 6, fontWeight: 500 }}>
            {ROLE_LABELS[user?.role] || '员工'} · {user?.name}
          </p>
        </div>
        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', background: '#fff',
            border: '1px solid #E5E7EB', borderRadius: 8,
            cursor: 'pointer', fontSize: 13, fontWeight: 500,
            color: '#666', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#C4B5FD'; e.currentTarget.style.color = '#434FCF' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.color = '#666' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '刷新中' : '刷新'}
        </button>
      </div>

      {/* ── 抢单横幅（设计师专属）── */}
      {role === 'designer' && stats?.grab_queue?.length > 0 && (
        <div style={{
          background: '#111', borderRadius: 12, padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Zap size={18} style={{ color: '#FBBF24' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
              有 {stats.grab_queue.length} 张新单待接
            </span>
          </div>
          <button
            onClick={() => navigate('/s/orders?status=PENDING')}
            style={{
              background: '#fff', color: '#111', border: 'none',
              borderRadius: 6, padding: '7px 16px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            查看 →
          </button>
        </div>
      )}

      {/* ── Pipeline Kanban Dashboard (SaaS Style) ── */}
      <div style={{
        background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB',
        display: 'flex', marginBottom: 28, padding: '12px 0',
      }}>
        {PIPELINE_STAGES.map((stage, index) => {
          const count = getPipelineCount(stage)
          return (
            <div
              key={stage.key}
              style={{ flex: 1, borderRight: index !== PIPELINE_STAGES.length - 1 ? '1px solid #F3F4F6' : 'none', padding: '0 12px' }}
            >
              <div
                onClick={() => navigate(`/s/orders?status=${stage.status[0]}`)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  cursor: 'pointer', opacity: count > 0 ? 1 : 0.55,
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  padding: '16px 0',
                  borderRadius: 12,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.background = '#F9FAFB';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  const badge = e.currentTarget.querySelector('.stage-badge');
                  if (badge) {
                    badge.style.transform = 'scale(1.08)';
                    badge.style.boxShadow = `0 6px 16px ${stage.color}35`;
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.opacity = count > 0 ? '1' : '0.55';
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.transform = 'translateY(0)';
                  const badge = e.currentTarget.querySelector('.stage-badge');
                  if (badge) {
                    badge.style.transform = 'scale(1)';
                    badge.style.boxShadow = 'none';
                  }
                }}
              >
                <div
                  className="stage-badge"
                  style={{
                    width: 48, height: 48, borderRadius: '50%', background: stage.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 18, fontWeight: 800, fontFamily: "'Outfit', sans-serif",
                    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }}>
                  {count}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginTop: 12, letterSpacing: '0.02em' }}>
                  {stage.label}
                </div>
                <div style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 500, marginTop: 4 }}>
                  {count}张订单
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── KPI 2×2 Bento ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 14, marginBottom: 28,
      }}>
        {/* 累计完成 */}
        <div
          onClick={() => navigate('/s/orders?status=COMPLETED')}
          style={{
            background: '#F3F4F6', borderRadius: 16,
            padding: '24px 26px 22px',
            cursor: 'pointer', transition: 'background 0.15s',
            display: 'flex', flexDirection: 'column', minHeight: 140,
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#ECEDF0'}
          onMouseLeave={e => e.currentTarget.style.background = '#F3F4F6'}
        >
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10B981', marginBottom: 16 }} />
          <div style={{
            fontSize: 52, fontWeight: 900, color: '#111',
            fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.04em', lineHeight: 1,
            flex: 1, display: 'flex', alignItems: 'center',
          }}>
            <AnimatedNumber value={stats?.completed_orders || 0} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>累计完成</span>
          </div>
        </div>

        {/* 本月佣金 */}
        <div style={{
          background: '#F3F4F6', borderRadius: 16,
          padding: '24px 26px 22px',
          cursor: 'default',
          display: 'flex', flexDirection: 'column', minHeight: 140,
        }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#7C3AED', marginBottom: 16 }} />
          <div style={{
            fontSize: 52, fontWeight: 900, color: '#111',
            fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.04em', lineHeight: 1,
            flex: 1, display: 'flex', alignItems: 'center',
          }}>
            ¥{monthCommission}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>本月佣金</span>
            <span style={{ fontSize: 12, color: '#AAA', fontWeight: 500 }}>累计 ¥{totalCommission}</span>
          </div>
        </div>

        {/* 今日新增 */}
        <div style={{
          background: '#F3F4F6', borderRadius: 16,
          padding: '24px 26px 22px',
          cursor: 'default',
          display: 'flex', flexDirection: 'column', minHeight: 130,
        }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#F59E0B', marginBottom: 14 }} />
          <div style={{
            fontSize: 44, fontWeight: 900, color: '#111',
            fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.04em', lineHeight: 1,
            flex: 1, display: 'flex', alignItems: 'center',
          }}>
            <AnimatedNumber value={stats?.today_orders || 0} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>今日新增</span>
          </div>
        </div>

        {/* 进行中 */}
        <div
          onClick={() => navigate('/s/orders?status=DESIGNING')}
          style={{
            background: '#F3F4F6', borderRadius: 16,
            padding: '24px 26px 22px',
            cursor: 'pointer', transition: 'background 0.15s',
            display: 'flex', flexDirection: 'column', minHeight: 130,
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#ECEDF0'}
          onMouseLeave={e => e.currentTarget.style.background = '#F3F4F6'}
        >
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#3B82F6', marginBottom: 14 }} />
          <div style={{
            fontSize: 44, fontWeight: 900, color: '#111',
            fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.04em', lineHeight: 1,
            flex: 1, display: 'flex', alignItems: 'center',
          }}>
            <AnimatedNumber value={(stats?.designing_orders || 0) + (stats?.revision_orders || 0)} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>进行中</span>
          </div>
        </div>
      </div>

      {/* ── 可抢单列表（设计师专属）── */}
      {role === 'designer' && stats?.grab_queue?.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', fontFamily: "'Outfit', sans-serif" }}>
              可抢单 <span style={{ color: '#999', fontWeight: 500, fontSize: 13 }}>({stats.grab_queue.length})</span>
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1, background: '#E8E8EA', borderRadius: 12, overflow: 'hidden', border: '1px solid #E8E8EA' }}>
            {stats.grab_queue.map((order) => (
              <div key={order.id} style={{ background: '#fff', padding: '18px 22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111', fontFamily: "'Outfit', sans-serif", display: 'block' }}>
                      {order.order_sn || `#${order.id}`}
                    </span>
                    <span style={{ fontSize: 12, color: '#888', marginTop: 3, display: 'block' }}>
                      {order.topic || '未填写主题'}
                    </span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#111', fontFamily: "'Outfit', sans-serif" }}>
                    ¥{fmtYuan(order.price)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px solid #F0F0F0' }}>
                  <span style={{ fontSize: 12, color: '#999' }}>
                    {order.deadline ? formatTime(order.deadline) : '截止待定'}
                  </span>
                  <button
                    onClick={() => handleGrab(order.id)}
                    disabled={grabbingId === order.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: '#111', color: '#fff', border: 'none',
                      borderRadius: 6, padding: '7px 16px',
                      fontSize: 12, fontWeight: 600,
                      cursor: grabbingId === order.id ? 'not-allowed' : 'pointer',
                      opacity: grabbingId === order.id ? 0.5 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {grabbingId === order.id ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 抢单中</>
                    ) : (
                      <><Zap className="w-3.5 h-3.5" /> 抢单</>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 最近订单 ── */}
      {stats?.recent_orders?.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: 16, overflow: 'hidden',
          border: '1px solid #E8E8EA',
        }}>
          <div style={{
            padding: '16px 24px',
            borderBottom: '1px solid #F0F0F0',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111', fontFamily: "'Outfit', sans-serif" }}>
              最近订单
            </h2>
            <button
              onClick={() => navigate('/s/orders')}
              style={{
                fontSize: 12, fontWeight: 600, color: '#888',
                background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#111'}
              onMouseLeave={e => e.currentTarget.style.color = '#888'}
            >
              全部 →
            </button>
          </div>
          <div>
            {stats.recent_orders.map((order, i) => {
              const sc = STATUS_COLORS[order.status] || STATUS_COLORS.PENDING
              return (
                <div
                  key={order.id}
                  onClick={() => navigate(`/s/orders/${order.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 24px',
                    cursor: 'pointer',
                    borderBottom: i < stats.recent_orders.length - 1 ? '1px solid #F5F5F5' : 'none',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FAFAFA'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* 状态点 */}
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: sc.dot, flexShrink: 0,
                  }} />
                  {/* 内容 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#111', fontFamily: "'Outfit', sans-serif" }}>
                        {order.order_sn || `#${order.id}`}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: sc.text,
                        background: sc.bg, padding: '1px 8px', borderRadius: 4,
                      }}>
                        {STATUS_MAP[order.status] || order.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.topic || '未填写主题'}
                    </div>
                  </div>
                  {/* 金额 */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#111', fontFamily: "'Outfit', sans-serif" }}>
                      ¥{fmtYuan(order.price)}
                    </div>
                    <div style={{ fontSize: 11, color: '#CCC', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTime(order.created_at)}
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: '#D0D0D0', flexShrink: 0 }} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 无数据 ── */}
      {!stats?.recent_orders?.length && !stats?.grab_queue?.length && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '60px 20px', borderRadius: 16,
          border: '1px solid #E8E8EA',
        }}>
          <div style={{ fontSize: 14, color: '#BBB', fontWeight: 500 }}>暂无订单数据</div>
          <p style={{ fontSize: 12, color: '#DDD', marginTop: 4 }}>新订单将会出现在这里</p>
        </div>
      )}
    </div>
  )
}

