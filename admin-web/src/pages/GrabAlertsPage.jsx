import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePolling } from '../hooks/usePolling';
import { getGrabAlerts } from '../api/admin';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatTime, formatRelativeTime } from '../utils/formatters';
import PageHeader from '../components/ui/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';

function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '-';
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-1">
      <span className="text-xs text-slate-500 tracking-wide">{label}</span>
      <span className={`text-2xl font-bold tracking-tight ${accent || 'text-slate-800'}`}>
        {value}
      </span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </div>
  );
}

function AlertCard({ alert }) {
  const variant = STATUS_BADGE_MAP[alert.status] || 'secondary';
  const badgeCls = BADGE_VARIANT_CLASSES[variant];
  const overdue = alert.overdue_minutes ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col gap-4 hover:shadow-md transition-shadow duration-200">
      {/* header */}
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/orders/${alert.order_id}`}
          className="text-sm font-semibold text-brand-500 hover:underline underline-offset-2 truncate"
        >
          #{alert.order_no || alert.order_id}
        </Link>
        <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${badgeCls}`}>
          {STATUS_MAP[alert.status] || alert.status}
        </span>
      </div>

      {/* overdue highlight */}
      <div className="rounded-lg bg-gradient-to-r from-red-50 to-orange-50 border border-red-100 px-3 py-2 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-red-500 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-semibold text-red-600">
          超时 {formatDuration(overdue)}
        </span>
      </div>

      {/* body */}
      {alert.subject && (
        <p className="text-sm text-slate-600 line-clamp-2">{alert.subject}</p>
      )}
      {alert.remark && !alert.subject && (
        <p className="text-sm text-slate-500 line-clamp-2">{alert.remark}</p>
      )}

      {/* footer */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-400" title={alert.created_at}>
          {formatRelativeTime(alert.created_at)}
        </span>
        <Link
          to={`/orders/${alert.order_id}`}
          className="text-xs font-medium text-brand-500 hover:text-brand-600 flex items-center gap-1 transition-colors"
        >
          查看详情
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-full bg-green-50 border border-green-200 flex items-center justify-center mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-7 h-7 text-green-500">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-slate-700 mb-1">暂无超时订单</h3>
      <p className="text-sm text-slate-400">一切正常，所有订单均已及时接单</p>
    </div>
  );
}

export default function GrabAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();
  const { lastMessage } = useWebSocket();

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await getGrabAlerts();
      setAlerts(res.data?.alerts || []);
    } catch (err) {
      addToast('加载告警数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // initial load
  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // polling every 30s
  usePolling(fetchAlerts, 30000);

  // websocket realtime
  useEffect(() => {
    if (lastMessage?.type === 'grab_alert') {
      fetchAlerts();
    }
  }, [lastMessage, fetchAlerts]);

  const avgOverdue = alerts.length
    ? Math.round(alerts.reduce((sum, a) => sum + (a.overdue_minutes || 0), 0) / alerts.length)
    : 0;

  return (
    <div className="space-y-6 relative">
      {loading && <LoadingSpinner />}

      <PageHeader title="抢单监控" subtitle="超时未接单订单告警">
        <button
          onClick={fetchAlerts}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          刷新
        </button>
      </PageHeader>

      {/* stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          label="当前告警"
          value={alerts.length}
          sub="超时未接单订单数"
          accent={alerts.length > 0 ? 'text-red-600' : 'text-green-600'}
        />
        <StatCard
          label="平均超时"
          value={alerts.length > 0 ? formatDuration(avgOverdue) : '-'}
          sub={alerts.length > 0 ? '等待接单时长' : '暂无数据'}
          accent={avgOverdue > 30 ? 'text-red-600' : avgOverdue > 10 ? 'text-amber-600' : 'text-slate-800'}
        />
      </div>

      {/* alert cards */}
      {!loading && alerts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {alerts.map((alert) => (
            <AlertCard key={alert.id || alert.order_id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
