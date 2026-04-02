import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { listOrders, grabOrder, updateOrderStatus } from '../../api/orders'
import { ORDER_TABS, STATUS_MAP, STATUS_COLORS, fmtYuan, formatTime } from '../../utils/constants'
import { Search, Zap, Loader2, ChevronRight, AlertTriangle } from 'lucide-react'

export default function MyOrdersPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const role = user?.role || 'designer'
  const initialStatus = searchParams.get('status') || ''

  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(initialStatus)
  const [keyword, setKeyword] = useState('')
  const [actionLoading, setActionLoading] = useState({})

  // 分页
  const [page, setPage] = useState(1)
  const pageSize = 20

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }
      if (activeTab) params.status = activeTab
      if (keyword.trim()) params.keyword = keyword.trim()

      const res = await listOrders(params)
      setOrders(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (err) {
      toast('加载订单失败: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }, [activeTab, keyword, page, toast])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Tab 切换
  const handleTabChange = (key) => {
    setActiveTab(key)
    setPage(1)
    if (key) {
      setSearchParams({ status: key })
    } else {
      setSearchParams({})
    }
  }

  // 搜索
  const handleSearch = (e) => {
    e.preventDefault()
    setPage(1)
    fetchOrders()
  }

  // 抢单
  const handleGrab = async (orderId) => {
    setActionLoading(prev => ({ ...prev, [orderId]: 'grab' }))
    try {
      await grabOrder(orderId)
      toast('抢单成功！', 'success')
      fetchOrders()
    } catch (err) {
      toast('抢单失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setActionLoading(prev => ({ ...prev, [orderId]: null }))
    }
  }

  // 状态变更
  const handleStatusChange = async (orderId, newStatus, orderSn) => {
    setActionLoading(prev => ({ ...prev, [orderId]: newStatus }))
    try {
      await updateOrderStatus(orderId, { status: newStatus })
      toast(`订单 ${orderSn} 状态已更新`, 'success')
      fetchOrders()
    } catch (err) {
      toast('操作失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setActionLoading(prev => ({ ...prev, [orderId]: null }))
    }
  }

  // 确认弹窗（退款用）
  const [confirmModal, setConfirmModal] = useState(null)

  const handleRefund = (orderId, orderSn) => {
    setConfirmModal({
      orderId,
      orderSn,
      title: '退款确认',
      message: `确定要将订单 ${orderSn} 标记为退款吗？请输入退款原因：`,
      showInput: true,
    })
  }

  const doRefund = async (reason) => {
    if (!reason?.trim()) {
      toast('请输入退款原因', 'error')
      return
    }
    const { orderId, orderSn } = confirmModal
    setConfirmModal(null)
    setActionLoading(prev => ({ ...prev, [orderId]: 'REFUNDED' }))
    try {
      await updateOrderStatus(orderId, { status: 'REFUNDED', refund_reason: reason })
      toast(`订单 ${orderSn} 已退款`, 'success')
      fetchOrders()
    } catch (err) {
      toast('退款失败: ' + (err.response?.data?.error || err.message), 'error')
    } finally {
      setActionLoading(prev => ({ ...prev, [orderId]: null }))
    }
  }

  // 判断截止时间紧急度
  const getDeadlineClass = (deadline) => {
    if (!deadline) return ''
    const diff = new Date(deadline) - new Date()
    const hours = diff / (1000 * 60 * 60)
    if (hours < 0) return 'deadline-urgent'
    if (hours < 12) return 'deadline-soon'
    return ''
  }

  // 获取当前订单可做的操作按钮
  const getActions = (order) => {
    const actions = []
    const isLoading = actionLoading[order.id]
    const status = order.status

    if (role === 'designer') {
      if (status === 'CONFIRMED') {
        actions.push({
          label: '接手设计', cls: 'action-btn-primary', icon: '🎨',
          action: () => handleStatusChange(order.id, 'DESIGNING', order.order_sn),
          loading: isLoading === 'DESIGNING',
        })
      }
      if (status === 'DESIGNING' || status === 'REVISION') {
        actions.push({
          label: '标记交付', cls: 'action-btn-success', icon: '📦',
          action: () => handleStatusChange(order.id, 'DELIVERED', order.order_sn),
          loading: isLoading === 'DELIVERED',
        })
      }
    }

    if (role === 'sales') {
      if (status === 'GROUP_CREATED') {
        actions.push({
          label: '确认需求', cls: 'action-btn-primary', icon: '✅',
          action: () => handleStatusChange(order.id, 'CONFIRMED', order.order_sn),
          loading: isLoading === 'CONFIRMED',
        })
      }
    }

    if (role === 'follow') {
      if (status === 'DELIVERED') {
        actions.push({
          label: '确认完成', cls: 'action-btn-success', icon: '✨',
          action: () => handleStatusChange(order.id, 'COMPLETED', order.order_sn),
          loading: isLoading === 'COMPLETED',
        })
        actions.push({
          label: '需要修改', cls: 'action-btn-warning', icon: '🔄',
          action: () => handleStatusChange(order.id, 'REVISION', order.order_sn),
          loading: isLoading === 'REVISION',
        })
      }
      if (['DESIGNING', 'DELIVERED', 'COMPLETED'].includes(status)) {
        actions.push({
          label: '退款', cls: 'action-btn-danger', icon: '💸',
          action: () => handleRefund(order.id, order.order_sn),
          loading: isLoading === 'REFUNDED',
        })
      }
    }

    return actions
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── 页面标题 ── */}
      <div className="flex flex-row items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">我的订单</h1>
          <p className="text-slate-500 text-sm mt-1">共 {total} 条记录</p>
        </div>
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700"
        >
          <Zap className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* ── Tab 筛选 + 搜索 ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tab-bar" style={{ flex: 1, minWidth: 0 }}>
          {ORDER_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tab-item ${activeTab === tab.key ? 'tab-item-active' : ''}`}
              onClick={() => handleTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} style={{ position: 'relative', flexShrink: 0 }}>
          <Search className="w-4 h-4" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索订单号/客户/主题"
            className="search-input"
          />
        </form>
      </div>

      {/* ── 加载中 ── */}
      {loading && (
        <div className="empty-state" style={{ minHeight: '40vh' }}>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#434FCF' }} />
          <p className="empty-state-text" style={{ marginTop: 12 }}>加载中...</p>
        </div>
      )}

      {/* ── 空状态 ── */}
      {!loading && orders.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-text">
            {activeTab ? `暂无「${STATUS_MAP[activeTab]}」状态的订单` : '暂无订单'}
          </div>
        </div>
      )}

      {/* ── 订单卡片列表 ── */}
      {!loading && orders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {orders.map((order) => {
            const sc = STATUS_COLORS[order.status] || STATUS_COLORS.PENDING
            const actions = getActions(order)
            const deadlineClass = getDeadlineClass(order.deadline)

            return (
              <div key={order.id} className="order-card">
                {/* 头部：订单号 + 状态 */}
                <div className="order-card-header">
                  <div
                    style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
                    onClick={() => navigate(`/s/orders/${order.id}`)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className="order-card-sn">{order.order_sn || `#${order.id}`}</span>
                      <span className="order-status-badge" style={{
                        background: sc.bg, color: sc.text, borderColor: sc.border,
                      }}>
                        <span className="order-status-dot" style={{ background: sc.dot }} />
                        {STATUS_MAP[order.status] || order.status}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    className="w-5 h-5"
                    style={{ color: '#CBD5E1', cursor: 'pointer', flexShrink: 0 }}
                    onClick={() => navigate(`/s/orders/${order.id}`)}
                  />
                </div>

                {/* 信息栏 */}
                <div className="order-card-body">
                  <span>📋 {order.topic || '未填写主题'}</span>
                  {order.pages > 0 && <span>📄 {order.pages}页</span>}
                  {order.customer_contact && <span>👤 {order.customer_contact}</span>}
                  {order.deadline && (
                    <span className={deadlineClass}>
                      {deadlineClass === 'deadline-urgent' && <AlertTriangle className="w-3 h-3" />}
                      ⏰ {formatTime(order.deadline)}
                    </span>
                  )}
                </div>

                {/* 底部：金额 + 操作 */}
                <div className="order-card-footer">
                  <div>
                    <span className="order-card-price">¥{fmtYuan(order.price)}</span>
                    <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 8 }}>
                      {formatTime(order.created_at)}
                    </span>
                  </div>
                  {actions.length > 0 && (
                    <div className="order-card-actions">
                      {actions.map((act, i) => (
                        <button
                          key={i}
                          className={`action-btn ${act.cls}`}
                          onClick={(e) => { e.stopPropagation(); act.action() }}
                          disabled={act.loading}
                        >
                          {act.loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <span>{act.icon}</span>
                          )}
                          {act.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 分页 ── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
          <button
            className="action-btn action-btn-outline"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            上一页
          </button>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: 14, color: '#64748B', padding: '0 12px' }}>
            {page} / {totalPages}
          </span>
          <button
            className="action-btn action-btn-outline"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {/* ── 退款确认弹窗 ── */}
      {confirmModal && (
        <RefundModal
          {...confirmModal}
          onConfirm={doRefund}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  )
}

// 退款原因弹窗组件
function RefundModal({ title, message, onConfirm, onCancel }) {
  const [reason, setReason] = useState('')

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-message">{message}</div>
        <input
          type="text"
          className="confirm-input"
          placeholder="退款原因（必填）"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <div className="confirm-actions">
          <button className="action-btn action-btn-outline" onClick={onCancel}>取消</button>
          <button className="action-btn action-btn-danger" onClick={() => onConfirm(reason)}>
            确认退款
          </button>
        </div>
      </div>
    </div>
  )
}
