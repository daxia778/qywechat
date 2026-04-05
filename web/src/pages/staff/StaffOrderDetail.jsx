import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { getOrderDetail, getOrderTimeline, updateOrderStatus, searchDesigners, assignDesigner, adjustCommission, addOrderNote } from '../../api/orders'
import { STATUS_MAP, STATUS_COLORS, fmtYuan, formatTime } from '../../utils/constants'
import { ArrowLeft, Loader2, Clock, FileText, Layers, Zap, User, Calendar, Hash, MessageSquare, AlertTriangle, Search, Plus, DollarSign } from 'lucide-react'

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
  const role = user?.role || 'follow'

  const [order, setOrder] = useState({})
  const [people, setPeople] = useState({})
  const [profit, setProfit] = useState({})
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  const [showRefund, setShowRefund] = useState(false)
  const [refundReason, setRefundReason] = useState('')

  // ── 花名册搜索状态 ──
  const [designerQuery, setDesignerQuery] = useState('')
  const [designerResults, setDesignerResults] = useState([])
  const [designerSearching, setDesignerSearching] = useState(false)
  const [showDesignerDropdown, setShowDesignerDropdown] = useState(false)
  const [assigningDesigner, setAssigningDesigner] = useState(false)
  const [showNewDesignerForm, setShowNewDesignerForm] = useState(false)
  const [newDesignerName, setNewDesignerName] = useState('')
  const [newDesignerWechat, setNewDesignerWechat] = useState('')
  const [newDesignerPhone, setNewDesignerPhone] = useState('')
  const [newDesignerSpecialty, setNewDesignerSpecialty] = useState('')
  const designerSearchRef = useRef(null)

  // ── 佣金调整状态 ──
  const [showCommissionModal, setShowCommissionModal] = useState(false)
  const [commissionRate, setCommissionRate] = useState('')
  const [commissionSubmitting, setCommissionSubmitting] = useState(false)

  // ── 换人确认状态 ──
  const [showReassignConfirm, setShowReassignConfirm] = useState(false)
  const [pendingDesignerId, setPendingDesignerId] = useState(null)

  // ── 添加备注状态 ──
  const [noteText, setNoteText] = useState('')
  const [noteSubmitting, setNoteSubmitting] = useState(false)

  const fetchDetail = useCallback(async () => {
    try {
      const [detailRes, timelineRes] = await Promise.all([
        getOrderDetail(id),
        getOrderTimeline(id),
      ])
      setOrder(detailRes.data.order || detailRes.data || {})
      setPeople(detailRes.data.people || {})
      setProfit(detailRes.data.profit || {})
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

  // ── 花名册搜索防抖 ──
  useEffect(() => {
    if (!designerQuery.trim()) {
      setDesignerResults([])
      setShowDesignerDropdown(false)
      return
    }
    setDesignerSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchDesigners(designerQuery.trim())
        const list = res.data.data || res.data.designers || []
        setDesignerResults(list)
        setShowDesignerDropdown(true)
      } catch {
        setDesignerResults([])
      } finally {
        setDesignerSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [designerQuery])

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e) => {
      if (designerSearchRef.current && !designerSearchRef.current.contains(e.target)) {
        setShowDesignerDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const doAssignDesigner = async (designerId) => {
    // 如果已有设计师，弹出换人确认
    if (order.freelance_designer_name) {
      setPendingDesignerId(designerId)
      setShowReassignConfirm(true)
      return
    }
    await executeAssignDesigner(designerId)
  }

  const executeAssignDesigner = async (designerId) => {
    setAssigningDesigner(true)
    try {
      await assignDesigner(id, { freelance_designer_id: designerId })
      toast('设计师关联成功', 'success')
      setDesignerQuery('')
      setShowDesignerDropdown(false)
      fetchDetail()
    } catch (err) {
      toast('关联失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setAssigningDesigner(false)
    }
  }

  const confirmReassign = async () => {
    setShowReassignConfirm(false)
    if (pendingDesignerId) {
      await executeAssignDesigner(pendingDesignerId)
      setPendingDesignerId(null)
    }
  }

  const doCreateAndAssignDesigner = async () => {
    if (!newDesignerName.trim()) {
      toast('设计师名字不能为空', 'error')
      return
    }
    setAssigningDesigner(true)
    try {
      await assignDesigner(id, {
        designer_name: newDesignerName.trim(),
        wechat: newDesignerWechat,
        phone: newDesignerPhone,
        specialty: newDesignerSpecialty,
      })
      toast('新建设计师并关联成功', 'success')
      setShowNewDesignerForm(false)
      setNewDesignerName('')
      setNewDesignerWechat('')
      setNewDesignerPhone('')
      setNewDesignerSpecialty('')
      setDesignerQuery('')
      fetchDetail()
    } catch (err) {
      toast('新建失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setAssigningDesigner(false)
    }
  }

  const doAdjustCommission = async () => {
    const val = parseFloat(commissionRate)
    if (isNaN(val) || val < 0 || val > 100) {
      toast('请输入 0-100 之间的数值', 'error')
      return
    }
    setCommissionSubmitting(true)
    try {
      await adjustCommission(id, { designer_commission_rate: val })
      toast('佣金比例调整成功', 'success')
      setShowCommissionModal(false)
      fetchDetail()
    } catch (err) {
      toast('调整失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setCommissionSubmitting(false)
    }
  }

  const doSubmitNote = async () => {
    if (!noteText.trim()) {
      toast('请输入备注内容', 'error')
      return
    }
    setNoteSubmitting(true)
    try {
      await addOrderNote(id, noteText.trim())
      toast('备注添加成功', 'success')
      setNoteText('')
      fetchDetail()
    } catch (err) {
      toast('添加备注失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setNoteSubmitting(false)
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

  // v2.1 简化操作按钮: 已完成(进行中状态) + 退款(进行中+已完成)
  const actions = []
  const isInProgress = ['DESIGNING', 'REVISION', 'AFTER_SALE'].includes(order.status)
  if (role === 'follow' || role === 'admin') {
    if (isInProgress) {
      actions.push({ label: '已完成', status: 'COMPLETED', cls: 'action-btn-success', icon: '✨' })
    }
    if (isInProgress || order.status === 'COMPLETED') {
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
                  value={order.freelance_designer_name || people.designer_name || '待分配'}
                  valueStyle={!(order.freelance_designer_name || people.designer_name) ? { color: '#CBD5E1', fontStyle: 'italic' } : {}}
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

        {/* ── 添加备注 (follow/admin 可见) ── */}
        {(role === 'follow' || role === 'admin') && !['REFUNDED', 'CLOSED'].includes(order.status) && (
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
                background: 'linear-gradient(135deg, #FEF3C7, #FFFBEB)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <MessageSquare className="w-4 h-4" style={{ color: '#F59E0B' }} />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>添加备注</span>
            </div>
            <div style={{ padding: 24 }}>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="输入备注内容..."
                disabled={noteSubmitting}
                rows={3}
                style={{
                  width: '100%', padding: '12px 16px', fontSize: 14,
                  border: '2px solid #E5E7EB', borderRadius: 14,
                  outline: 'none', transition: 'border-color 0.2s',
                  resize: 'vertical', minHeight: 80, lineHeight: 1.6,
                  fontFamily: 'inherit',
                }}
                onFocus={e => e.target.style.borderColor = '#C4B5FD'}
                onBlur={e => e.target.style.borderColor = '#E5E7EB'}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  onClick={doSubmitNote}
                  disabled={noteSubmitting || !noteText.trim()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px',
                    fontSize: 13, fontWeight: 700, color: '#fff', background: '#434FCF',
                    border: 'none', borderRadius: 10, cursor: 'pointer',
                    opacity: (noteSubmitting || !noteText.trim()) ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {noteSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {noteSubmitting ? '提交中...' : '添加备注'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 花名册 - 关联设计师 (follow/admin 可见) ── */}
        {(role === 'follow' || role === 'admin') && !isTerminal && (
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
                <User className="w-4 h-4" style={{ color: '#8B5CF6' }} />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>关联设计师</span>
              {order.freelance_designer_name && (
                <span style={{
                  marginLeft: 'auto', fontSize: 12, fontWeight: 600,
                  background: '#DBEAFE', color: '#1E40AF', padding: '3px 12px',
                  borderRadius: 999, border: '1px solid #BFDBFE',
                }}>✓ 已关联: {order.freelance_designer_name}</span>
              )}
            </div>
            <div style={{ padding: 24 }}>
              {/* 搜索框 */}
              <div ref={designerSearchRef} style={{ position: 'relative' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  搜索花名册
                </div>
                <div style={{ position: 'relative' }}>
                  <Search className="w-4 h-4" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                  <input
                    type="text"
                    value={designerQuery}
                    onChange={(e) => setDesignerQuery(e.target.value)}
                    onFocus={() => { if (designerResults.length > 0) setShowDesignerDropdown(true) }}
                    placeholder="输入设计师名字搜索..."
                    disabled={assigningDesigner}
                    style={{
                      width: '100%', paddingLeft: 40, paddingRight: 12, padding: '10px 12px 10px 40px',
                      fontSize: 14, border: '2px solid #E5E7EB', borderRadius: 14,
                      outline: 'none', transition: 'border-color 0.2s',
                    }}
                    onFocusCapture={e => e.target.style.borderColor = '#C4B5FD'}
                    onBlurCapture={e => e.target.style.borderColor = '#E5E7EB'}
                  />
                  {designerSearching && (
                    <Loader2 className="w-4 h-4 animate-spin" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#434FCF' }} />
                  )}
                </div>

                {/* 搜索结果下拉 */}
                {showDesignerDropdown && (
                  <div style={{
                    position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0, marginTop: 6,
                    background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
                  }}>
                    {designerResults.length > 0 ? (
                      designerResults.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => doAssignDesigner(d.id)}
                          disabled={assigningDesigner}
                          style={{
                            width: '100%', textAlign: 'left', padding: '14px 18px',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                            borderBottom: '1px solid #F5F5F5', cursor: 'pointer',
                            background: 'none', border: 'none', borderBottom: '1px solid #F5F5F5',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{d.name}</div>
                            {d.specialty && <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{d.specialty}</div>}
                          </div>
                          <span style={{ fontSize: 12, color: '#94A3B8', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{d.total_orders ?? 0} 单</span>
                        </button>
                      ))
                    ) : (
                      <div style={{ padding: 20, textAlign: 'center' }}>
                        <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>未找到匹配的设计师</div>
                        <button
                          onClick={() => { setShowDesignerDropdown(false); setShowNewDesignerForm(true); setNewDesignerName(designerQuery) }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 16px', fontSize: 13, fontWeight: 600,
                            color: '#434FCF', background: '#EDE9FE', border: '1px solid #DDD6FE',
                            borderRadius: 10, cursor: 'pointer', transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#DDD6FE'}
                          onMouseLeave={e => e.currentTarget.style.background = '#EDE9FE'}
                        >
                          <Plus className="w-3.5 h-3.5" /> 新建设计师
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 新建设计师表单 */}
              {showNewDesignerForm && (
                <div style={{
                  marginTop: 18, background: '#F5F3FF', border: '1px solid #DDD6FE',
                  borderRadius: 16, padding: 22,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <Plus className="w-4 h-4" style={{ color: '#7C3AED' }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#4C1D95' }}>新建设计师</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>名字 <span style={{ color: '#EF4444' }}>*</span></div>
                      <input type="text" value={newDesignerName} onChange={e => setNewDesignerName(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid #DDD6FE', borderRadius: 10, outline: 'none', background: '#fff' }}
                        placeholder="设计师名字"
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>微信号</div>
                      <input type="text" value={newDesignerWechat} onChange={e => setNewDesignerWechat(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid #DDD6FE', borderRadius: 10, outline: 'none', background: '#fff' }}
                        placeholder="选填"
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>手机号</div>
                      <input type="text" value={newDesignerPhone} onChange={e => setNewDesignerPhone(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid #DDD6FE', borderRadius: 10, outline: 'none', background: '#fff' }}
                        placeholder="选填"
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>擅长方向</div>
                      <input type="text" value={newDesignerSpecialty} onChange={e => setNewDesignerSpecialty(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1.5px solid #DDD6FE', borderRadius: 10, outline: 'none', background: '#fff' }}
                        placeholder="如: PPT/海报/Logo"
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button
                      onClick={doCreateAndAssignDesigner} disabled={assigningDesigner}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px',
                        fontSize: 13, fontWeight: 700, color: '#fff', background: '#434FCF',
                        border: 'none', borderRadius: 10, cursor: 'pointer',
                        opacity: assigningDesigner ? 0.6 : 1,
                      }}
                    >
                      {assigningDesigner ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {assigningDesigner ? '提交中...' : '新建并关联'}
                    </button>
                    <button
                      onClick={() => setShowNewDesignerForm(false)} disabled={assigningDesigner}
                      style={{
                        padding: '8px 16px', fontSize: 13, fontWeight: 600,
                        color: '#64748B', background: '#fff', border: '1.5px solid #E2E8F0',
                        borderRadius: 10, cursor: 'pointer',
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* 调整佣金按钮 */}
              {order.freelance_designer_name && !isTerminal && (
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => { setCommissionRate(String(profit.designer_rate || 0)); setShowCommissionModal(true) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px',
                      fontSize: 13, fontWeight: 700, color: '#7C3AED', background: '#F5F3FF',
                      border: '1.5px solid #DDD6FE', borderRadius: 10, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#EDE9FE'; e.currentTarget.style.borderColor = '#C4B5FD' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#F5F3FF'; e.currentTarget.style.borderColor = '#DDD6FE' }}
                  >
                    <DollarSign className="w-3.5 h-3.5" /> 调整佣金比例
                  </button>
                  {order.commission_adjusted && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle className="w-3.5 h-3.5" /> 佣金已调整
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

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

      {/* ── 佣金调整弹窗 ── */}
      {showCommissionModal && (
        <div className="confirm-overlay" onClick={() => setShowCommissionModal(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="confirm-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DollarSign className="w-5 h-5" style={{ color: '#7C3AED' }} />
              调整设计师佣金比例
            </div>
            <div className="confirm-message" style={{ marginBottom: 8 }}>
              当前设计师: <strong>{order.freelance_designer_name}</strong>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 6 }}>设计师佣金比例 (%)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" step="1" min="0" max="100"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  className="confirm-input"
                  style={{ flex: 1, marginBottom: 0 }}
                  placeholder="如: 30"
                  autoFocus
                />
                <span style={{ fontSize: 16, fontWeight: 700, color: '#64748B' }}>%</span>
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
                当前设计师比例: {profit.designer_rate || 0}% · 当前金额: ¥{fmtYuan(order.price)}
              </div>
            </div>
            <div className="confirm-actions">
              <button className="action-btn action-btn-outline" onClick={() => setShowCommissionModal(false)}>取消</button>
              <button
                className="action-btn action-btn-primary"
                onClick={doAdjustCommission}
                disabled={commissionSubmitting}
                style={{ background: '#7C3AED', borderColor: '#7C3AED' }}
              >
                {commissionSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {commissionSubmitting ? '提交中...' : '确认调整'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 换人确认弹窗 ── */}
      {showReassignConfirm && (
        <div className="confirm-overlay" onClick={() => { setShowReassignConfirm(false); setPendingDesignerId(null) }}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle className="w-5 h-5" style={{ color: '#F59E0B' }} />
              更换设计师确认
            </div>
            <div className="confirm-message">
              当前订单已关联设计师 <strong>{order.freelance_designer_name}</strong>，确定要更换吗？
            </div>
            <div className="confirm-actions">
              <button className="action-btn action-btn-outline" onClick={() => { setShowReassignConfirm(false); setPendingDesignerId(null) }}>取消</button>
              <button
                className="action-btn action-btn-primary"
                onClick={confirmReassign}
                disabled={assigningDesigner}
                style={{ background: '#F59E0B', borderColor: '#F59E0B' }}
              >
                {assigningDesigner ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {assigningDesigner ? '更换中...' : '确认更换'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
