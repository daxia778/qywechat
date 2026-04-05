import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { getGrabAlerts, getGrabAlertStats, dismissGrabAlert, batchDismissGrabAlerts } from '../api/admin';
import { STATUS_MAP } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import RefreshButton from '../components/ui/RefreshButton';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import { Bell, AlertTriangle, CalendarDays, BarChart3, Clock, Paintbrush, CheckCircle2, RotateCcw, ChevronLeft, ChevronRight, ShieldCheck, CircleAlert, Inbox } from 'lucide-react';

function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '-';
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}天${rh}小时` : `${d}天`;
}

function formatPrice(fen) {
  if (!fen && fen !== 0) return '-';
  return `${(fen / 100).toFixed(2)}`;
}

const ALERT_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'grab', label: '抢单超时' },
  { value: 'designing', label: '设计超时' },
];

const DISMISSED_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'false', label: '未处理' },
  { value: 'true', label: '已处理' },
];

function StatCard({ label, value, sub, accent, icon, gradient, loading }) {
  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white p-5 flex items-start gap-4 hover:shadow-lg hover:shadow-slate-200/50 hover:-translate-y-0.5 transition-all duration-300 ease-out">
      {icon && (
        <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${gradient || 'bg-gradient-to-br from-slate-100 to-slate-50'} shadow-sm`}>
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
        {loading ? (
          <div className="h-8 w-16 rounded-lg bg-slate-100 animate-pulse mt-0.5" />
        ) : (
          <span className={`text-[28px] font-extrabold tracking-tight tabular-nums leading-tight ${accent || 'text-slate-800'}`}>
            {value}
          </span>
        )}
        {sub && <span className="text-[11px] text-slate-400 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

function AlertTypeTag({ type }) {
  if (type === 'grab') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gradient-to-r from-red-50 to-rose-50 text-red-600 border border-red-100/80 shadow-sm shadow-red-100/50">
        <Clock className="w-3 h-3" />
        抢单超时
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gradient-to-r from-orange-50 to-amber-50 text-orange-600 border border-orange-100/80 shadow-sm shadow-orange-100/50">
      <Paintbrush className="w-3 h-3" />
      设计超时
    </span>
  );
}

function AlertRow({ alert, expanded, onToggle, onDismiss, selected, onSelect, dismissing }) {
  const overdue = alert.overdue_minutes ?? alert.timeout_minutes ?? 0;
  const isDismissed = alert.alert_dismissed;

  return (
    <>
      <tr
        className={`group cursor-pointer transition-all duration-200 ${expanded ? 'bg-brand-50/30' : 'hover:bg-slate-50/80'} ${isDismissed ? 'opacity-50' : ''} ${selected ? 'bg-brand-50/40' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3.5 w-[4%]">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onSelect(); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded-md border-slate-300 text-brand-500 focus:ring-brand-500/30 focus:ring-offset-0 cursor-pointer transition-colors"
          />
        </td>
        <td className="px-4 py-3.5 w-[14%]">
          <Link
            to={`/orders/${alert.order_id}`}
            className="text-sm font-semibold text-brand-500 hover:text-brand-600 hover:underline underline-offset-2 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            #{alert.order_sn || alert.order_id}
          </Link>
        </td>
        <td className="px-4 py-3.5 w-[12%]">
          <AlertTypeTag type={alert.alert_type} />
        </td>
        <td className="px-4 py-3.5 w-[14%]">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${overdue > 60 ? 'bg-red-500 animate-pulse' : overdue > 30 ? 'bg-orange-400' : 'bg-amber-400'}`} />
            <span className={`text-sm font-semibold tabular-nums ${overdue > 60 ? 'text-red-600' : overdue > 30 ? 'text-orange-600' : 'text-amber-600'}`}>
              {formatDuration(overdue)}
            </span>
          </div>
        </td>
        <td className="px-4 py-3.5 w-[12%] text-sm text-slate-600 truncate">
          {alert.designer_name || alert.designer_id || '-'}
        </td>
        <td className="px-4 py-3.5 w-[10%] text-sm text-slate-600 tabular-nums">
          {alert.price ? `${formatPrice(alert.price)}` : '-'}
        </td>
        <td className="px-4 py-3.5 w-[14%] text-sm text-slate-500 truncate" title={alert.topic}>
          {alert.topic || '-'}
        </td>
        <td className="px-4 py-3.5 w-[10%]">
          {isDismissed ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200/80">
              <CheckCircle2 className="w-3 h-3" />
              已处理
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gradient-to-r from-red-50 to-rose-50 text-red-600 border border-red-100/80">
              <AlertTriangle className="w-3 h-3" />
              未处理
            </span>
          )}
        </td>
        <td className="px-4 py-3.5 w-[10%]">
          <div className="flex items-center gap-2">
            {!isDismissed && (
              <button
                onClick={(e) => { e.stopPropagation(); onDismiss(alert.order_id); }}
                disabled={dismissing}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-brand-600 active:scale-95 transition-all disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                处理
              </button>
            )}
            <Link
              to={`/orders/${alert.order_id}`}
              className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              详情
            </Link>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gradient-to-b from-slate-50/80 to-white animate-in fade-in slide-in-from-top-1 duration-200">
          <td colSpan={9} className="px-4 py-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm ml-8">
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">订单状态</span>
                <span className="block font-medium text-slate-700">{STATUS_MAP[alert.status] || alert.status}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">设计师</span>
                <span className="block font-medium text-slate-700">{alert.designer_name || alert.designer_id || '-'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">谈单客服</span>
                <span className="block font-medium text-slate-700">{alert.operator_id || '-'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">跟单客服</span>
                <span className="block font-medium text-slate-700">{alert.follow_operator_id || '-'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">金额</span>
                <span className="block font-medium text-slate-700">{alert.price ? `${formatPrice(alert.price)} 元` : '-'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">主题</span>
                <span className="block font-medium text-slate-700">{alert.topic || '-'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">分配时间</span>
                <span className="block font-medium text-slate-700">{alert.assigned_at ? formatTime(alert.assigned_at) : '-'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">超时时长</span>
                <span className={`block font-semibold ${(alert.overdue_minutes ?? 0) > 60 ? 'text-red-600' : 'text-orange-600'}`}>
                  {formatDuration(alert.overdue_minutes ?? alert.timeout_minutes ?? 0)}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function GrabAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [alertType, setAlertType] = useState('');
  const [dismissed, setDismissed] = useState('false');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { toast } = useToast();
  const { on, off } = useWebSocket();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fetchAlerts = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const params = { page, page_size: pageSize };
      if (alertType) params.alert_type = alertType;
      if (dismissed) params.dismissed = dismissed;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const res = await getGrabAlerts(params);
      setAlerts(res.data?.data || []);
      setTotal(res.data?.total || 0);
    } catch {
      if (isManual) toast('加载告警数据失败', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize, alertType, dismissed, startDate, endDate, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getGrabAlertStats();
      setStats(res.data || null);
    } catch {
      // 静默失败
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    fetchStats();
  }, [fetchAlerts, fetchStats]);

  usePolling(() => { fetchAlerts(); fetchStats(); }, 30000);

  useEffect(() => {
    const handler = () => { fetchAlerts(); fetchStats(); };
    on('grab_alert', handler);
    on('designing_timeout_alert', handler);
    return () => { off('grab_alert', handler); off('designing_timeout_alert', handler); };
  }, [on, off, fetchAlerts, fetchStats]);

  // 筛选变化时重置分页
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    setExpandedId(null);
  }, [alertType, dismissed, startDate, endDate]);

  const handleDismiss = useCallback(async (orderId) => {
    setDismissing(true);
    try {
      await dismissGrabAlert(orderId);
      toast('已标记为已处理', 'success');
      fetchAlerts();
      fetchStats();
    } catch {
      toast('操作失败', 'error');
    } finally {
      setDismissing(false);
    }
  }, [fetchAlerts, fetchStats, toast]);

  const handleBatchDismiss = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setDismissing(true);
    try {
      await batchDismissGrabAlerts(Array.from(selectedIds));
      toast(`已批量标记 ${selectedIds.size} 条告警`, 'success');
      setSelectedIds(new Set());
      fetchAlerts();
      fetchStats();
    } catch {
      toast('批量操作失败', 'error');
    } finally {
      setDismissing(false);
    }
  }, [selectedIds, fetchAlerts, fetchStats, toast]);

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const undismissedIds = alerts.filter((a) => !a.alert_dismissed).map((a) => a.order_id);
    if (undismissedIds.length === 0) return;
    setSelectedIds((prev) => {
      const allSelected = undismissedIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(undismissedIds);
    });
  }, [alerts]);

  const undismissedOnPage = useMemo(() => alerts.filter((a) => !a.alert_dismissed), [alerts]);
  const allSelected = undismissedOnPage.length > 0 && undismissedOnPage.every((a) => selectedIds.has(a.order_id));

  const handleClearFilters = useCallback(() => {
    setAlertType('');
    setDismissed('false');
    setStartDate('');
    setEndDate('');
  }, []);

  return (
    <div className="space-y-6 relative">
      {loading && <LoadingSpinner />}

      <PageHeader title="抢单监控" subtitle="超时未接单 / 设计超时告警">
        <RefreshButton onClick={() => fetchAlerts(true)} loading={refreshing} />
      </PageHeader>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="告警总数"
          value={stats?.total ?? '-'}
          sub="抢单超时 + 设计超时"
          accent={stats?.total > 0 ? 'text-red-600' : 'text-emerald-600'}
          loading={!stats}
          gradient="bg-gradient-to-br from-red-100 to-rose-50"
          icon={<Bell className="w-5 h-5 text-red-500" />}
        />
        <StatCard
          label="未处理"
          value={stats?.undismissed ?? '-'}
          sub="需要关注"
          accent={stats?.undismissed > 0 ? 'text-orange-600' : 'text-emerald-600'}
          loading={!stats}
          gradient="bg-gradient-to-br from-orange-100 to-amber-50"
          icon={<CircleAlert className="w-5 h-5 text-orange-500" />}
        />
        <StatCard
          label="今日新增"
          value={stats?.today ?? '-'}
          sub="今日产生的告警"
          accent="text-slate-800"
          loading={!stats}
          gradient="bg-gradient-to-br from-brand-100 to-indigo-50"
          icon={<CalendarDays className="w-5 h-5 text-brand-500" />}
        />
        <StatCard
          label="本周累计"
          value={stats?.week ?? '-'}
          sub="本周告警趋势"
          accent="text-slate-800"
          loading={!stats}
          gradient="bg-gradient-to-br from-slate-100 to-gray-50"
          icon={<BarChart3 className="w-5 h-5 text-slate-500" />}
        />
      </div>

      {/* 筛选栏 */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={alertType}
            onChange={(e) => setAlertType(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200 cursor-pointer appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {ALERT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={dismissed}
            onChange={(e) => setDismissed(e.target.value)}
            className="h-9 px-3 pr-8 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200 cursor-pointer appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            {DISMISSED_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 px-3 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200"
              placeholder="开始日期"
            />
            <span className="text-slate-300 text-sm font-light">~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 px-3 text-sm rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200"
              placeholder="结束日期"
            />
          </div>

          {(alertType || dismissed !== 'false' || startDate || endDate) && (
            <button
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all duration-200 active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              重置
            </button>
          )}
        </div>
      </div>

      {/* 告警表格 */}
      {!loading && alerts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white">
          <div className="flex flex-col items-center justify-center py-24 px-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-green-50 flex items-center justify-center mb-5 shadow-sm">
              <ShieldCheck className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-base font-semibold text-slate-700 mb-1">暂无超时告警</h3>
            <p className="text-sm text-slate-400">一切正常，所有订单均已及时处理</p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-slate-50/40">
                  <th className="px-4 py-3.5 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded-md border-slate-300 text-brand-500 focus:ring-brand-500/30 focus:ring-offset-0 cursor-pointer transition-colors"
                    />
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">订单号</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">告警类型</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">超时时长</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">设计师</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">金额</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">主题</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">状态</th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {alerts.map((alert) => (
                  <AlertRow
                    key={`${alert.alert_type}-${alert.order_id}`}
                    alert={alert}
                    expanded={expandedId === alert.order_id}
                    onToggle={() => setExpandedId(expandedId === alert.order_id ? null : alert.order_id)}
                    onDismiss={handleDismiss}
                    selected={selectedIds.has(alert.order_id)}
                    onSelect={() => toggleSelect(alert.order_id)}
                    dismissing={dismissing}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100 bg-gradient-to-r from-slate-50/50 to-white">
            <span className="text-[13px] text-slate-400 font-medium">
              共 <span className="text-slate-600 tabular-nums">{total}</span> 条告警
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { if (page > 1) setPage(page - 1); }}
                disabled={page <= 1}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm ${page <= 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[13px] text-slate-500 font-medium px-3 tabular-nums select-none">{page} / {totalPages}</span>
              <button
                onClick={() => { if (page < totalPages) setPage(page + 1); }}
                disabled={page >= totalPages}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm ${page >= totalPages ? 'opacity-30 cursor-not-allowed' : ''}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部浮动批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-4 px-6 py-3 rounded-2xl bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-xl shadow-brand-500/25 border border-brand-400/20 backdrop-blur-sm">
            <span className="text-sm font-medium">
              已选择 <span className="font-bold tabular-nums">{selectedIds.size}</span> 条告警
            </span>
            <div className="w-px h-5 bg-white/20" />
            <button
              onClick={handleBatchDismiss}
              disabled={dismissing}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-white/15 hover:bg-white/25 rounded-xl transition-all duration-200 active:scale-95 disabled:opacity-50 border border-white/10"
            >
              <CheckCircle2 className="w-4 h-4" />
              {dismissing ? '处理中...' : '批量标记已处理'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-all duration-200 active:scale-95"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
