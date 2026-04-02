import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { getOrderDetail, getOrderTimeline, updateOrderStatus } from '../../api/orders'
import { STATUS_MAP, STATUS_COLORS, fmtYuan, formatTime } from '../../utils/constants'
import { ArrowLeft, Loader2, Clock, FileText, Layers, Zap, User, Calendar, Hash, MessageSquare, AlertTriangle } from 'lucide-react'

const EVENT_LABELS = {
  status_changed: (e) => STATUS_MAP[e.to_status] || e.to_status,
  amount_changed: () => '金额变更',
  pages_changed: () => '页数变更',
  designer_reassigned: () => '设计师转派',
  customer_matched: () => '关联客户',
}

function getEventLabel(event) {
  const fn = EVENT_LABELS[event.event_type]
  if (fn) return fn(event)
  if (event.to_status) return STATUS_MAP[event.to_status] || event.to_status
  return event.event_type || '未知事件'
}

/* ── 信息行组件 ── */
function InfoRow({ icon, label, value, valueStyle = {}, fullWidth = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14,
      padding: '14px 0',
      ...(fullWidth ? {} : {}),
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10,
        background: '#F8FAFC', border: '1px solid #F1F5F9',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 1,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
          {label}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1E293B', lineHeight: 1.4, ...valueStyle }}>
          {value || '-'}
        </div>
      </div>
    </div>
  )
}

export default function StaffOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const role = user?.role || 'designer'

  const [order, setOrder] = useState({})
  const [people, setPeople] = useState({})
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  const [showRefund, setShowRefund] = useState(false)
  const [refundReason, setRefundReason] = useState('')

  const fetchDetail = useCallback(async () => {
    try {
      const [detailRes, timelineRes] = await Promise.all([
        getOrderDetail(id),
        getOrderTimeline(id),
      ])
      setOrder(detailRes.data.order || detailRes.data || {})
      setPeople(detailRes.data.people || {})
      setTimeline(timelineRes.data.data || [])
    } catch (err) {
      toast('加载订单详情失败: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const handleStatusChange = async (newStatus) => {
    setActionLoading(newStatus)
    try {
      await updateOrderStatus(order.id, { status: newStatus })
      toast(`订单状态已更新为${STATUS_MAP[newStatus]}`, 'success')
      fetchDetail()
    } catch (err) {
      toast('操作失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      toast('请输入退款原因', 'error')
      return
    }
    setActionLoading('REFUNDED')
    setShowRefund(false)
    try {
      await updateOrderStatus(order.id, { status: 'REFUNDED', refund_reason: refundReason })
      toast('退款已提交', 'success')
      setRefundReason('')
      fetchDetail()
    } catch (err) {
      toast('退款失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setActionLoading(null)
    }
  }

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

  const sc = STATUS_COLORS[order.status] || STATUS_COLORS.PENDING
  const isTerminal = ['COMPLETED', 'REFUNDED', 'CLOSED'].includes(order.status)

  const actions = []
  if (!isTerminal) {
    if (role === 'designer') {
      if (order.status === 'CONFIRMED') {
        actions.push({ label: '接手设计', status: 'DESIGNING', cls: 'action-btn-primary', icon: '🎨' })
      }
      if (order.status === 'DESIGNING' || order.status === 'REVISION') {
        actions.push({ label: '标记交付', status: 'DELIVERED', cls: 'action-btn-success', icon: '📦' })
      }
    }
    if (role === 'sales') {
      if (order.status === 'GROUP_CREATED') {
        actions.push({ label: '确认需求', status: 'CONFIRMED', cls: 'action-btn-primary', icon: '✅' })
      }
    }
    if (role === 'follow') {
      if (order.status === 'DELIVERED') {
        actions.push({ label: '确认完成', status: 'COMPLETED', cls: 'action-btn-success', icon: '✨' })
        actions.push({ label: '需要修改', status: 'REVISION', cls: 'action-btn-warning', icon: '🔄' })
      }
      if (['DESIGNING', 'DELIVERED'].includes(order.status)) {
        actions.push({ label: '标记售后', status: 'AFTER_SALE', cls: 'action-btn-warning', icon: '🛠' })
      }
      actions.push({ label: '退款', cls: 'action-btn-danger', icon: '💸', isRefund: true })
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }} className="page-enter">
      {/* ── 顶部导航 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: '#fff', border: '2px solid #E5E7EB',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#C4B5FD'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          <ArrowLeft className="w-5 h-5" style={{ color: '#475569' }} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.02em' }}>
            订单详情
          </h1>
          <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 2, fontFamily: "'Outfit', monospace", fontWeight: 500 }}>
            {order.order_sn}
          </p>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: sc.bg, color: sc.text,
          border: `1.5px solid ${sc.border}`,
          fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 999,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc.dot, boxShadow: `0 0 6px ${sc.dot}60` }} />
          {STATUS_MAP[order.status] || order.status}
        </span>
      </div>

      {/* ── 操作栏 ── */}
      {actions.length > 0 && (
        <div style={{
          background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 16, padding: '16px 22px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8', marginRight: 'auto' }}>操作：</span>
          {actions.map((act, i) => (
            <button
              key={i}
              className={`action-btn ${act.cls}`}
              onClick={() => act.isRefund ? setShowRefund(true) : handleStatusChange(act.status)}
              disabled={actionLoading === act.status}
            >
              {actionLoading === act.status ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span>{act.icon}</span>
              )}
              {act.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── 金额突出卡片 ── */}
        <div style={{
          background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)',
          borderRadius: 20, padding: '26px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(30,27,75,0.3)',
        }}>
          <div style={{ position: 'absolute', right: -30, top: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
          <div style={{ position: 'absolute', right: 50, bottom: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>订单金额</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.02em', marginTop: 4 }}>
              ¥{fmtYuan(order.price)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, position: 'relative', zIndex: 1 }}>
            {order.pages > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>页数</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', fontFamily: "'Outfit', sans-serif", marginTop: 2 }}>{order.pages}</div>
              </div>
            )}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>状态</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#FDE68A', marginTop: 6 }}>
                {STATUS_MAP[order.status] || order.status}
              </div>
            </div>
          </div>
        </div>

        {/* ── 订单信息卡片 ── */}
        <div style={{
          background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 20, overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            padding: '18px 24px', borderBottom: '1px solid #F1F5F9',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'linear-gradient(135deg, #EDE9FE, #F5F3FF)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FileText className="w-4 h-4" style={{ color: '#434FCF' }} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>订单信息</span>
          </div>
          <div style={{ padding: '6px 24px 18px' }}>
            {/* 双列网格 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px',
            }}>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<Hash className="w-3.5 h-3.5" style={{ color: '#6366F1' }} />}
                  label="订单号"
                  value={order.order_sn}
                  valueStyle={{ fontFamily: "'Outfit', monospace", fontWeight: 700, letterSpacing: '0.01em' }}
                />
              </div>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<User className="w-3.5 h-3.5" style={{ color: '#3B82F6' }} />}
                  label="客户"
                  value={order.customer_contact}
                />
              </div>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<FileText className="w-3.5 h-3.5" style={{ color: '#8B5CF6' }} />}
                  label="主题"
                  value={order.topic}
                />
              </div>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<Layers className="w-3.5 h-3.5" style={{ color: '#F59E0B' }} />}
                  label="页数"
                  value={order.pages ? `${order.pages} 页` : null}
                />
              </div>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<User className="w-3.5 h-3.5" style={{ color: '#10B981' }} />}
                  label="操作员"
                  value={people.operator_name || order.operator_id}
                />
              </div>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<Zap className="w-3.5 h-3.5" style={{ color: '#EC4899' }} />}
                  label="设计师"
                  value={people.designer_name || order.designer_id || '待分配'}
                  valueStyle={!(people.designer_name || order.designer_id) ? { color: '#CBD5E1', fontStyle: 'italic' } : {}}
                />
              </div>
              <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                <InfoRow
                  icon={<Calendar className="w-3.5 h-3.5" style={{ color: '#6366F1' }} />}
                  label="创建时间"
                  value={formatTime(order.created_at)}
                  valueStyle={{ fontVariantNumeric: 'tabular-nums', fontFamily: "'Outfit', sans-serif" }}
                />
              </div>
              {order.deadline && (
                <div style={{ borderBottom: '1px solid #F8FAFC' }}>
                  <InfoRow
                    icon={<AlertTriangle className="w-3.5 h-3.5" style={{ color: '#EF4444' }} />}
                    label="截止时间"
                    value={formatTime(order.deadline)}
                    valueStyle={{ fontVariantNumeric: 'tabular-nums', fontFamily: "'Outfit', sans-serif", color: '#DC2626' }}
                  />
                </div>
              )}
            </div>

            {/* 备注 — 全宽 */}
            {order.remark && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  <MessageSquare className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6, color: '#94A3B8' }} />
                  备注
                </div>
                <div style={{
                  whiteSpace: 'pre-wrap', background: '#F8FAFC',
                  borderRadius: 12, padding: '14px 18px',
                  fontSize: 13, color: '#475569', lineHeight: 1.6,
                  border: '1px solid #F1F5F9',
                }}>
                  {order.remark}
                </div>
              </div>
            )}

            {/* 退款原因 */}
            {order.refund_reason && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  <AlertTriangle className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
                  退款原因
                </div>
                <div style={{
                  background: '#FEF2F2', borderRadius: 12, padding: '14px 18px',
                  fontSize: 13, color: '#DC2626', lineHeight: 1.6,
                  border: '1px solid #FECACA',
                }}>
                  {order.refund_reason}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 截图/附件 ── */}
        {(order.screenshot_path || order.attachment_urls) && (
          <div style={{
            background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 20, overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          }}>
            <div style={{
              padding: '18px 24px', borderBottom: '1px solid #F1F5F9',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: 'linear-gradient(135deg, #DBEAFE, #EFF6FF)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Layers className="w-4 h-4" style={{ color: '#3B82F6' }} />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>订单图片</span>
            </div>
            <div style={{ padding: 24 }}>
              {order.screenshot_path && (
                <div style={{ marginBottom: order.attachment_urls ? 16 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>订单截图</div>
                  <img
                    src={order.screenshot_path}
                    alt="订单截图"
                    style={{
                      maxWidth: '100%', maxHeight: 400, borderRadius: 14,
                      border: '1px solid #E2E8F0', objectFit: 'contain', background: '#FAFAFA',
                    }}
                  />
                </div>
              )}
              {order.attachment_urls && (() => {
                try {
                  const urls = JSON.parse(order.attachment_urls)
                  if (urls?.length > 0) {
                    return (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                          备注图片 ({urls.length})
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                          {urls.map((url, i) => (
                            <img
                              key={i} src={url} alt={`附件${i + 1}`}
                              style={{
                                width: '100%', aspectRatio: '1', objectFit: 'cover',
                                borderRadius: 12, border: '1px solid #E5E7EB', background: '#FAFAFA',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )
                  }
                } catch { /* ignore */ }
                return null
              })()}
            </div>
          </div>
        )}

        {/* ── 状态时间线 ── */}
        <div style={{
          background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 20, overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            padding: '18px 24px', borderBottom: '1px solid #F1F5F9',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'linear-gradient(135deg, #EDE9FE, #F5F3FF)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Clock className="w-4 h-4" style={{ color: '#434FCF' }} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>状态时间线</span>
          </div>
          <div style={{ padding: 24 }}>
            {timeline.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 36 }}>🕐</div>
                <div style={{ color: '#94A3B8', fontSize: 14, marginTop: 8 }}>暂无记录</div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                {timeline.map((event, i) => {
                  const label = getEventLabel(event)
                  const isLatest = i === timeline.length - 1
                  const evtColor = event.to_status ? (STATUS_COLORS[event.to_status]?.dot || '#94A3B8') : '#434FCF'

                  return (
                    <div key={i} style={{
                      display: 'flex', gap: 18, position: 'relative',
                      paddingBottom: i < timeline.length - 1 ? 28 : 0,
                    }}>
                      {/* 连接线 */}
                      {i < timeline.length - 1 && (
                        <div style={{
                          position: 'absolute', left: 7, top: 20, bottom: 0,
                          width: 2, background: '#E2E8F0', zIndex: 1,
                        }} />
                      )}
                      {/* 圆点 */}
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: isLatest ? `3px solid ${evtColor}` : `2px solid ${evtColor}40`,
                        background: isLatest ? evtColor : '#fff',
                        marginTop: 3, position: 'relative', zIndex: 2,
                        boxShadow: isLatest ? `0 0 8px ${evtColor}40` : 'none',
                      }} />
                      {/* 内容 */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 12, fontWeight: 600,
                            background: event.to_status ? STATUS_COLORS[event.to_status]?.bg : '#F5F3FF',
                            color: event.to_status ? STATUS_COLORS[event.to_status]?.text : '#434FCF',
                            border: `1px solid ${event.to_status ? STATUS_COLORS[event.to_status]?.border : '#DDD6FE'}`,
                            padding: '3px 10px', borderRadius: 999,
                          }}>
                            {label}
                          </span>
                          <span style={{ fontSize: 12, color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                            {formatTime(event.created_at)}
                          </span>
                        </div>
                        {event.operator_name && (
                          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 5 }}>
                            操作人: <span style={{ color: '#475569', fontWeight: 500 }}>{event.operator_name}</span>
                          </div>
                        )}
                        {event.remark && (
                          <div style={{
                            fontSize: 12, color: '#64748B', marginTop: 6,
                            background: '#F8FAFC', padding: '8px 12px', borderRadius: 8,
                            border: '1px solid #F1F5F9', lineHeight: 1.5,
                          }}>
                            {event.remark}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 退款弹窗 ── */}
      {showRefund && (
        <div className="confirm-overlay" onClick={() => setShowRefund(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">退款确认</div>
            <div className="confirm-message">
              确定要将订单 <strong>{order.order_sn}</strong> 标记为退款吗？
            </div>
            <input
              type="text"
              className="confirm-input"
              placeholder="退款原因（必填）"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              autoFocus
            />
            <div className="confirm-actions">
              <button className="action-btn action-btn-outline" onClick={() => setShowRefund(false)}>取消</button>
              <button
                className="action-btn action-btn-danger"
                onClick={handleRefund}
                disabled={actionLoading === 'REFUNDED'}
              >
                {actionLoading === 'REFUNDED' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                确认退款
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
