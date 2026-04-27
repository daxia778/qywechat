import { useState, useEffect, useCallback } from 'react';
import { getRiskDashboard, getRiskAlerts, resolveRiskAlert, batchResolveAlerts, getRiskAuditLog, getStaffRiskStats, getAuditConfig, updateAuditConfig, getFollowStaff, sendTestBroadcast } from '../api/risk';
import { fmtYuan, formatTime } from '../utils/constants';
import { cn } from '../utils/cn';
import PageHeader from '../components/ui/PageHeader';

// ─── Heroicons Outline SVG icons (strokeWidth=1.5, no fill) ──────
const HIcon = ({ d, className = 'w-5 h-5', sw = 1.5 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={sw} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const P = {
  refresh:    'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.182-3.182',
  dollar:     'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  trendDown:  'M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898M18.75 3.75l-4.5 4.5m0-4.5h4.5v4.5',
  palette:    'M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.764m3.42 3.42a6.776 6.776 0 00-3.42-3.42',
  coins:      'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125',
  package:    'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
  message:    'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  clock:      'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  moon:       'M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z',
  shieldAlert:'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z',
  shieldCheck:'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  checkCircle:'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  user:       'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
  warning:    'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  radio:      'M3.75 7.5l16.5-4.125M12 6.75c-2.708 0-5.363.224-7.948.655C2.999 7.58 2.25 8.507 2.25 9.574v9.176A2.25 2.25 0 004.5 21h15a2.25 2.25 0 002.25-2.25V9.574c0-1.067-.75-1.994-1.802-2.169A47.865 47.865 0 0012 6.75zm-2.25 5.25a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0z',
  save:       'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z',
  settings:   'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

const BROADCAST_EVENT_TYPES = [
  { key: 'status_changed',      label: '状态变更',     iconKey: 'refresh',   desc: '订单状态变更时播报' },
  { key: 'amount_changed',      label: '金额修改',     iconKey: 'dollar',    desc: '订单金额修改时播报' },
  { key: 'refund_processed',    label: '退款操作',     iconKey: 'trendDown', desc: '订单退款时播报' },
  { key: 'designer_assigned',   label: '关联设计师',   iconKey: 'palette',   desc: '订单关联设计师时播报' },
  { key: 'designer_reassigned', label: '更换设计师',   iconKey: 'refresh',   desc: '订单更换设计师时播报' },
  { key: 'commission_adjusted', label: '佣金调整',     iconKey: 'coins',     desc: '设计师佣金调整时播报' },
  { key: 'order_assigned',      label: '新单分配',     iconKey: 'package',   desc: '新订单分配给跟单时播报' },
  { key: 'group_created',       label: '订单建群',     iconKey: 'message',   desc: '订单企微群创建时播报' },
];

const SEVERITY_CONFIG = {
  high:   { label: '高风险', bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border-red-200' },
  medium: { label: '中风险', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  low:    { label: '低风险', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-700 border-blue-200' },
};

const ALERT_TYPE_MAP = {
  price_drop:        { label: '金额异常下调', iconKey: 'trendDown' },
  high_refund:       { label: '高退款率',     iconKey: 'warning' },
  inactive_order:    { label: '订单无操作',   iconKey: 'clock' },
  abnormal_time:     { label: '异常时间操作', iconKey: 'moon' },
  frequent_reassign: { label: '频繁换设计师', iconKey: 'refresh' },
};

const EVENT_TYPE_MAP = {
  status_changed:      '状态变更',
  amount_changed:      '金额修改',
  designer_assigned:   '关联设计师',
  designer_reassigned: '更换设计师',
  commission_adjusted: '佣金调整',
  note_added:          '添加备注',
  pages_changed:       '页数修改',
  customer_matched:    '匹配客户',
};



function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function AlertTypeBadge({ type }) {
  const cfg = ALERT_TYPE_MAP[type] || { label: type, iconKey: 'warning' };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium bg-slate-100 text-slate-600">
      <HIcon d={P[cfg.iconKey] || P.warning} className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

export default function RiskCenterPage() {
  const [activeTab, setActiveTab] = useState('alerts');
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertTotal, setAlertTotal] = useState(0);
  const [auditLog, setAuditLog] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [staffStats, setStaffStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolveModalId, setResolveModalId] = useState(null);
  const [resolveRemark, setResolveRemark] = useState('');
  const [selectedAlerts, setSelectedAlerts] = useState([]);

  // Settings state
  const [auditConfig, setAuditConfig] = useState(null);
  const [followStaffList, setFollowStaffList] = useState([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [testSending, setTestSending] = useState(false);

  // Filters
  const [alertFilter, setAlertFilter] = useState({ type: '', severity: '', resolved: 'false' });
  const [auditStaffFilter, setAuditStaffFilter] = useState('');

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await getRiskDashboard();
      setStats(res.data);
    } catch (e) { console.error('Failed to fetch risk dashboard:', e); }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const params = { limit: 50, offset: 0 };
      if (alertFilter.type) params.type = alertFilter.type;
      if (alertFilter.severity) params.severity = alertFilter.severity;
      if (alertFilter.resolved) params.resolved = alertFilter.resolved;
      const res = await getRiskAlerts(params);
      setAlerts(res.data.data || []);
      setAlertTotal(res.data.total || 0);
    } catch (e) { console.error('Failed to fetch risk alerts:', e); }
  }, [alertFilter]);

  const fetchAuditLog = useCallback(async () => {
    try {
      const params = { limit: 50, offset: 0 };
      if (auditStaffFilter) params.staff = auditStaffFilter;
      const res = await getRiskAuditLog(params);
      setAuditLog(res.data.data || []);
      setAuditTotal(res.data.total || 0);
    } catch (e) { console.error('Failed to fetch audit log:', e); }
  }, [auditStaffFilter]);

  const fetchStaffStats = useCallback(async () => {
    try {
      const res = await getStaffRiskStats();
      setStaffStats(res.data.data || []);
    } catch (e) { console.error('Failed to fetch staff stats:', e); }
  }, []);

  const fetchAuditConfigData = useCallback(async () => {
    try {
      const [cfgRes, staffRes] = await Promise.all([getAuditConfig(), getFollowStaff()]);
      setAuditConfig(cfgRes.data);
      setFollowStaffList(staffRes.data.data || []);
    } catch (e) { console.error('Failed to fetch audit config:', e); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchDashboard(), fetchAlerts(), fetchAuditLog(), fetchStaffStats(), fetchAuditConfigData()])
      .finally(() => setLoading(false));
  }, [fetchDashboard, fetchAlerts, fetchAuditLog, fetchStaffStats, fetchAuditConfigData]);

  const handleSaveConfig = async (updates) => {
    setSavingConfig(true);
    try {
      await updateAuditConfig(updates);
      await fetchAuditConfigData();
    } catch (e) { console.error('Failed to save config:', e); }
    setSavingConfig(false);
  };

  const handleTestBroadcast = async () => {
    setTestSending(true);
    try {
      await sendTestBroadcast();
    } catch (e) { console.error('Failed to send test:', e); }
    setTestSending(false);
  };

  const handleResolve = async () => {
    if (!resolveModalId) return;
    try {
      await resolveRiskAlert(resolveModalId, resolveRemark);
      setResolveModalId(null);
      setResolveRemark('');
      fetchAlerts();
      fetchDashboard();
    } catch (e) { console.error('Failed to resolve alert:', e); }
  };

  const handleBatchResolve = async () => {
    if (selectedAlerts.length === 0) return;
    try {
      await batchResolveAlerts(selectedAlerts, '批量处理');
      setSelectedAlerts([]);
      fetchAlerts();
      fetchDashboard();
    } catch (e) { console.error('Failed to batch resolve:', e); }
  };

  const tabs = [
    { key: 'alerts', label: '风控告警', count: stats?.pending_alerts },
    { key: 'audit', label: '操作流水', count: auditTotal },
    { key: 'staff', label: '跟单画像', count: staffStats?.length },
    { key: 'settings', label: '播报设置', icon: <HIcon d={P.settings} className="w-3.5 h-3.5" /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-[#434FCF] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <PageHeader title="风控中心" subtitle="跟单客服行为审计与风险监控">
        {stats?.high_risk_alerts > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-xl animate-pulse">
            <HIcon d={P.shieldAlert} className="w-4 h-4 text-red-500" />
            <span className="text-[12px] font-semibold text-red-700">{stats.high_risk_alerts} 条高风险</span>
          </div>
        )}
      </PageHeader>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center">
          <span className="inline-flex items-center gap-1.5 text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 uppercase tracking-wider">
            <HIcon d={P.refresh} className="w-3.5 h-3.5" />今日跟单操作
          </span>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
            {stats?.today_follow_ops ?? 0}
          </h4>
        </div>
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-[3px] border-l-amber-400">
          <span className="inline-flex items-center gap-1.5 text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 uppercase tracking-wider">
            <HIcon d={P.shieldAlert} className="w-3.5 h-3.5" />待审核告警
          </span>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
            {stats?.pending_alerts ?? 0}
          </h4>
          {stats?.high_risk_alerts > 0 && (
            <span className="text-[11px] text-red-500 font-medium mt-1">含 {stats.high_risk_alerts} 条高风险</span>
          )}
        </div>
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-[3px] border-l-red-400">
          <span className="inline-flex items-center gap-1.5 text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 uppercase tracking-wider">
            <HIcon d={P.trendDown} className="w-3.5 h-3.5" />本周退款
          </span>
          <h4 className="text-xl lg:text-[24px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
            &yen;{fmtYuan(stats?.week_refund_amount ?? 0)}
          </h4>
        </div>
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-5 lg:p-6 flex flex-col justify-center border-l-[3px] border-l-emerald-400">
          <span className="inline-flex items-center gap-1.5 text-[11px] lg:text-[13px] font-semibold text-on-surface-variant/70 mb-1.5 uppercase tracking-wider">
            <HIcon d={P.checkCircle} className="w-3.5 h-3.5" />处理率
          </span>
          <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
            {stats?.total_alerts > 0 ? `${Math.round((stats.resolved_alerts / stats.total_alerts) * 100)}%` : '-'}
          </h4>
          <span className="text-[11px] text-slate-400 mt-1 tabular-nums">{stats?.resolved_alerts ?? 0}/{stats?.total_alerts ?? 0} 已处理</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface-container-lowest ghost-border rounded-2xl overflow-hidden">
        <div className="flex border-b border-slate-200">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-[13px] font-semibold transition-all border-b-2 ${
                activeTab === tab.key
                  ? 'text-[#434FCF] border-[#434FCF] bg-[#434FCF]/[0.03]'
                  : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.icon && <span className="opacity-70">{tab.icon}</span>}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab.key ? 'bg-[#434FCF] text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-5">
          {activeTab === 'alerts' && (
            <AlertsTab
              alerts={alerts}
              total={alertTotal}
              filter={alertFilter}
              onFilterChange={setAlertFilter}
              onResolve={(id) => { setResolveModalId(id); setResolveRemark(''); }}
              selectedAlerts={selectedAlerts}
              setSelectedAlerts={setSelectedAlerts}
              onBatchResolve={handleBatchResolve}
            />
          )}
          {activeTab === 'audit' && (
            <AuditLogTab
              data={auditLog}
              total={auditTotal}
              staffFilter={auditStaffFilter}
              onStaffFilterChange={setAuditStaffFilter}
              staffList={staffStats}
            />
          )}
          {activeTab === 'staff' && (
            <StaffProfileTab data={staffStats} />
          )}
          {activeTab === 'settings' && auditConfig && (
            <SettingsTab
              config={auditConfig}
              followStaffList={followStaffList}
              onSave={handleSaveConfig}
              onTestBroadcast={handleTestBroadcast}
              saving={savingConfig}
              testSending={testSending}
            />
          )}
        </div>
      </div>

      {/* Resolve Modal */}
      {resolveModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setResolveModalId(null)} />
          <div className="relative bg-white rounded-2xl border-2 border-slate-200 w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 pt-6 pb-2">
              <h3 className="text-lg font-bold text-slate-800">处理告警</h3>
            </div>
            <div className="px-6 py-3">
              <label className="text-[13px] font-medium text-slate-600 block mb-1.5">处理备注</label>
              <textarea
                value={resolveRemark}
                onChange={(e) => setResolveRemark(e.target.value)}
                placeholder="请输入处理说明（可选）"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#434FCF]/30 focus:border-[#434FCF] resize-none"
                rows={3}
              />
            </div>
            <div className="px-6 pb-6 pt-2 flex justify-end gap-3">
              <button onClick={() => setResolveModalId(null)} className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">取消</button>
              <button onClick={handleResolve} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl bg-[#434FCF] hover:bg-[#3641F5] transition-all">确认处理</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alerts Tab ───────────────────────────────
function AlertsTab({ alerts, total, filter, onFilterChange, onResolve, selectedAlerts, setSelectedAlerts, onBatchResolve }) {
  const toggleSelect = (id) => {
    setSelectedAlerts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    const unresolved = alerts.filter(a => !a.is_resolved).map(a => a.id);
    setSelectedAlerts(prev => prev.length === unresolved.length ? [] : unresolved);
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filter.severity}
          onChange={(e) => onFilterChange({ ...filter, severity: e.target.value })}
          className="px-3 py-2 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20 bg-white"
        >
          <option value="">全部严重度</option>
          <option value="high">高风险</option>
          <option value="medium">中风险</option>
          <option value="low">低风险</option>
        </select>
        <select
          value={filter.type}
          onChange={(e) => onFilterChange({ ...filter, type: e.target.value })}
          className="px-3 py-2 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20 bg-white"
        >
          <option value="">全部类型</option>
          {Object.entries(ALERT_TYPE_MAP).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select
          value={filter.resolved}
          onChange={(e) => onFilterChange({ ...filter, resolved: e.target.value })}
          className="px-3 py-2 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20 bg-white"
        >
          <option value="false">待处理</option>
          <option value="true">已处理</option>
          <option value="">全部</option>
        </select>

        <span className="text-[12px] text-slate-400 ml-auto">共 {total} 条</span>

        {selectedAlerts.length > 0 && (
          <button
            onClick={onBatchResolve}
            className="px-3 py-1.5 text-[12px] font-semibold text-white bg-[#434FCF] hover:bg-[#3641F5] rounded-lg transition-colors"
          >
            批量处理 ({selectedAlerts.length})
          </button>
        )}
      </div>

      {/* Alert List */}
      {alerts.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-emerald-50 flex items-center justify-center"><HIcon d={P.shieldCheck} className="w-7 h-7 text-emerald-500" /></div>
          <p className="text-[14px] font-medium text-slate-500">暂无风控告警</p>
          <p className="text-[12px] text-slate-400 mt-1">系统运行正常，没有检测到异常行为</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filter.resolved !== 'true' && alerts.some(a => !a.is_resolved) && (
            <label className="flex items-center gap-2 text-[12px] text-slate-500 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={selectedAlerts.length === alerts.filter(a => !a.is_resolved).length && selectedAlerts.length > 0}
                onChange={toggleSelectAll}
                className="rounded border-slate-300"
              />
              全选
            </label>
          )}
          {alerts.map(alert => {
            const sevCfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.low;
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
                  alert.is_resolved
                    ? 'bg-slate-50 border-slate-200 opacity-60'
                    : `${sevCfg.bg} ${sevCfg.border}`
                }`}
              >
                {!alert.is_resolved && (
                  <input
                    type="checkbox"
                    checked={selectedAlerts.includes(alert.id)}
                    onChange={() => toggleSelect(alert.id)}
                    className="mt-1 rounded border-slate-300 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <SeverityBadge severity={alert.severity} />
                    <AlertTypeBadge type={alert.alert_type} />
                    {alert.staff_name && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500"><HIcon d={P.user} className="w-3 h-3" /> {alert.staff_name}</span>
                    )}
                    <span className="text-[11px] text-slate-400 ml-auto whitespace-nowrap">{formatTime(alert.created_at)}</span>
                  </div>
                  <p className={`text-[13px] font-semibold ${alert.is_resolved ? 'text-slate-500' : sevCfg.text} leading-snug`}>
                    {alert.title}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">{alert.detail}</p>
                  {alert.is_resolved && (
                    <p className="inline-flex items-center gap-1 text-[11px] text-slate-400 mt-1">
                      <HIcon d={P.checkCircle} className="w-3 h-3 text-emerald-500" /> 已由 {alert.resolved_by} 于 {formatTime(alert.resolved_at)} 处理
                      {alert.resolve_remark && ` — ${alert.resolve_remark}`}
                    </p>
                  )}
                </div>
                {!alert.is_resolved && (
                  <button
                    onClick={() => onResolve(alert.id)}
                    className="shrink-0 px-3 py-1.5 text-[12px] font-semibold text-[#434FCF] bg-white border border-[#434FCF]/30 rounded-lg hover:bg-[#434FCF]/5 transition-colors"
                  >
                    处理
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Audit Log Tab ─────────────────────────────
function AuditLogTab({ data, total, staffFilter, onStaffFilterChange, staffList }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={staffFilter}
          onChange={(e) => onStaffFilterChange(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20 bg-white"
        >
          <option value="">全部跟单客服</option>
          {(staffList || []).map(s => (
            <option key={s.user_id} value={s.user_id}>{s.name}</option>
          ))}
        </select>
        <span className="text-[12px] text-slate-400 ml-auto">共 {total} 条</span>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[14px] text-slate-500">暂无操作记录</p>
        </div>
      ) : (
        <div className="space-y-1">
          {data.map((entry, i) => (
            <div key={entry.id || i} className="flex items-start gap-3 px-4 py-3 rounded-lg hover:bg-slate-50 transition-colors group">
              <div className="w-8 h-8 rounded-full bg-[#434FCF]/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[12px] font-bold text-[#434FCF]">
                  {(entry.operator_name || '?').charAt(0)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-slate-800">{entry.operator_name || entry.operator_id}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                    {EVENT_TYPE_MAP[entry.event_type] || entry.event_type}
                  </span>
                  {entry.order_sn && (
                    <span className="text-[11px] text-[#434FCF] font-mono">{entry.order_sn}</span>
                  )}
                </div>
                {entry.remark && (
                  <p className="text-[12px] text-slate-500 mt-0.5 truncate">{entry.remark}</p>
                )}
                {(entry.old_value || entry.new_value) && (
                  <p className="text-[12px] text-slate-400 mt-0.5">
                    {entry.old_value} → {entry.new_value}
                  </p>
                )}
              </div>
              <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">{formatTime(entry.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Staff Profile Tab ──────────────────────────
function StaffProfileTab({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[14px] text-slate-500">暂无跟单客服数据</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {data.map(staff => {
        const isHighRisk = staff.refund_rate > 20 || staff.unresolved_alerts > 0;
        return (
          <div
            key={staff.user_id}
            className={`rounded-xl border p-5 transition-all hover:shadow-md ${
              isHighRisk
                ? 'border-red-200 bg-gradient-to-br from-red-50/50 to-white'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0"
                style={{ background: isHighRisk ? 'linear-gradient(135deg, #EF4444, #F97316)' : 'linear-gradient(135deg, #2834b7, #434fcf)' }}
              >
                {staff.name.charAt(0)}
              </div>
              <div>
                <p className="text-[14px] font-bold text-slate-800">{staff.name}</p>
                <p className="text-[11px] text-slate-400">跟单客服</p>
              </div>
              {staff.unresolved_alerts > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold border border-red-200">
                  {staff.unresolved_alerts} 条告警
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-[11px] text-slate-400 mb-0.5">总操作</p>
                <p className="text-[16px] font-bold text-slate-700">{staff.total_ops}</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-[11px] text-slate-400 mb-0.5">本周操作</p>
                <p className="text-[16px] font-bold text-slate-700">{staff.week_ops}</p>
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-[11px] text-slate-400 mb-0.5">负责订单</p>
                <p className="text-[16px] font-bold text-slate-700">{staff.total_orders}</p>
              </div>
              <div className={`rounded-lg px-3 py-2 ${staff.refund_rate > 20 ? 'bg-red-50' : 'bg-slate-50'}`}>
                <p className="text-[11px] text-slate-400 mb-0.5">退款率</p>
                <p className={`text-[16px] font-bold ${staff.refund_rate > 20 ? 'text-red-600' : staff.refund_rate > 10 ? 'text-amber-600' : 'text-slate-700'}`}>
                  {staff.refund_rate?.toFixed(1) || '0.0'}%
                </p>
              </div>
            </div>

            {/* Risk bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-slate-400">风险指数</span>
                <span className={`text-[11px] font-semibold ${
                  staff.refund_rate > 20 ? 'text-red-500' : staff.refund_rate > 10 ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  {staff.refund_rate > 20 ? '需关注' : staff.refund_rate > 10 ? '正常偏高' : '正常'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    staff.refund_rate > 20 ? 'bg-red-500' : staff.refund_rate > 10 ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, (staff.refund_rate || 0) * 2)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────
function SettingsTab({ config, followStaffList, onSave, onTestBroadcast, saving, testSending }) {
  const cfg = config?.config || {};
  const enabledTypes = config?.enabled_event_types || [];
  const monitoredIDs = config?.monitored_staff_ids || [];

  // Local state for editing
  const [broadcastEnabled, setBroadcastEnabled] = useState(cfg.broadcast_enabled ?? true);
  const [selectedEvents, setSelectedEvents] = useState(enabledTypes.length > 0 ? enabledTypes : BROADCAST_EVENT_TYPES.map(e => e.key));
  const [allEventsMode, setAllEventsMode] = useState(enabledTypes.length === 0);
  const [selectedStaff, setSelectedStaff] = useState(monitoredIDs);
  const [allStaffMode, setAllStaffMode] = useState(monitoredIDs.length === 0);
  const [priceThreshold, setPriceThreshold] = useState(cfg.price_drop_threshold ?? 20);
  const [refundThreshold, setRefundThreshold] = useState(cfg.refund_rate_threshold ?? 20);
  const [abnormalTimeOn, setAbnormalTimeOn] = useState(cfg.abnormal_time_enabled ?? true);
  const [inactiveHours, setInactiveHours] = useState(cfg.inactive_order_hours ?? 48);
  const [reassignCount, setReassignCount] = useState(cfg.frequent_reassign_count ?? 2);
  const [dirty, setDirty] = useState(false);

  const markDirty = () => setDirty(true);

  const handleSave = () => {
    onSave({
      broadcast_enabled: broadcastEnabled,
      enabled_event_types: allEventsMode ? [] : selectedEvents,
      monitored_staff_ids: allStaffMode ? [] : selectedStaff,
      price_drop_threshold: priceThreshold,
      refund_rate_threshold: refundThreshold,
      abnormal_time_enabled: abnormalTimeOn,
      inactive_order_hours: inactiveHours,
      frequent_reassign_count: reassignCount,
    });
    setDirty(false);
  };

  const toggleEvent = (key) => {
    setSelectedEvents(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    markDirty();
  };

  const toggleStaff = (uid) => {
    setSelectedStaff(prev => prev.includes(uid) ? prev.filter(k => k !== uid) : [...prev, uid]);
    markDirty();
  };

  return (
    <div className="space-y-6 max-w-[900px]">
      {/* Status Banner */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${
        config?.audit_ready
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <span className={`w-3 h-3 rounded-full ${config?.audit_ready ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
        <div className="flex-1">
          <p className={`text-[13px] font-semibold ${config?.audit_ready ? 'text-emerald-700' : 'text-amber-700'}`}>
            {config?.audit_ready ? '监控群已就绪' : '监控群未配置'}
          </p>
          {config?.audit_chat_id && (
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">ChatID: {config.audit_chat_id}</p>
          )}
        </div>
        <button
          onClick={onTestBroadcast}
          disabled={!config?.audit_ready || testSending}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          {testSending ? '发送中...' : <><HIcon d={P.radio} className="w-3.5 h-3.5" /> 发送测试</>}
        </button>
      </div>

      {/* Master Toggle */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-bold text-slate-800">播报总开关</p>
            <p className="text-[12px] text-slate-500 mt-0.5">关闭后所有操作不再推送到监控群</p>
          </div>
          <button
            onClick={() => { setBroadcastEnabled(!broadcastEnabled); markDirty(); }}
            className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${broadcastEnabled ? 'bg-[#434FCF]' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform duration-300 ${broadcastEnabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Event Types */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[15px] font-bold text-slate-800">播报事件类型</p>
            <p className="text-[12px] text-slate-500 mt-0.5">选择哪些操作类型需要推送到监控群</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={allEventsMode}
              onChange={(e) => { setAllEventsMode(e.target.checked); markDirty(); }}
              className="rounded border-slate-300"
            />
            全部启用
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {BROADCAST_EVENT_TYPES.map(evt => {
            const isOn = allEventsMode || selectedEvents.includes(evt.key);
            return (
              <label
                key={evt.key}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  allEventsMode
                    ? 'bg-[#434FCF]/[0.03] border-[#434FCF]/20 opacity-60'
                    : isOn
                    ? 'bg-[#434FCF]/[0.03] border-[#434FCF]/30 hover:border-[#434FCF]/50'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggleEvent(evt.key)}
                  disabled={allEventsMode}
                  className="rounded border-slate-300 text-[#434FCF]"
                />
                <HIcon d={P[evt.iconKey]} className="w-5 h-5 text-[#434FCF]" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-700">{evt.label}</p>
                  <p className="text-[11px] text-slate-400">{evt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Monitored Staff */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[15px] font-bold text-slate-800">监控对象</p>
            <p className="text-[12px] text-slate-500 mt-0.5">选择需要监控的跟单客服，仅被选中的员工操作会被播报</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={allStaffMode}
              onChange={(e) => { setAllStaffMode(e.target.checked); markDirty(); }}
              className="rounded border-slate-300"
            />
            监控全部
          </label>
        </div>
        {followStaffList.length === 0 ? (
          <p className="text-[13px] text-slate-400 text-center py-6">暂无跟单客服</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {followStaffList.map(staff => {
              const isSelected = allStaffMode || selectedStaff.includes(staff.user_id);
              return (
                <label
                  key={staff.user_id}
                  className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    allStaffMode
                      ? 'bg-[#434FCF]/[0.03] border-[#434FCF]/20 opacity-60'
                      : isSelected
                      ? 'bg-[#434FCF]/[0.05] border-[#434FCF]/30'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleStaff(staff.user_id)}
                    disabled={allStaffMode}
                    className="rounded border-slate-300 text-[#434FCF]"
                  />
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ background: 'linear-gradient(135deg, #2834b7, #434fcf)' }}
                  >
                    {staff.name.charAt(0)}
                  </div>
                  <span className="text-[13px] font-medium text-slate-700 truncate">{staff.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Risk Thresholds */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-[15px] font-bold text-slate-800 mb-4">风控阈值</p>

        <div className="space-y-5">
          {/* Price Drop */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[13px] font-semibold text-slate-700">金额降幅告警</p>
                <p className="text-[11px] text-slate-400">订单金额下调超过此比例触发告警</p>
              </div>
              <span className="text-[14px] font-bold text-[#434FCF] tabular-nums">{priceThreshold}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              value={priceThreshold}
              onChange={(e) => { setPriceThreshold(Number(e.target.value)); markDirty(); }}
              className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-[#434FCF]"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>5%</span><span>50%</span>
            </div>
          </div>

          {/* Refund Rate */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[13px] font-semibold text-slate-700">退款率告警</p>
                <p className="text-[11px] text-slate-400">跟单客服7天退款率超过此比例触发告警</p>
              </div>
              <span className="text-[14px] font-bold text-[#434FCF] tabular-nums">{refundThreshold}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              value={refundThreshold}
              onChange={(e) => { setRefundThreshold(Number(e.target.value)); markDirty(); }}
              className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-[#434FCF]"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>5%</span><span>50%</span>
            </div>
          </div>

          {/* Abnormal Time */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-[13px] font-semibold text-slate-700">异常时间检测</p>
              <p className="text-[11px] text-slate-400">凌晨 0:00-6:00 的敏感操作告警</p>
            </div>
            <button
              onClick={() => { setAbnormalTimeOn(!abnormalTimeOn); markDirty(); }}
              className={`relative w-10 h-6 rounded-full transition-colors duration-300 ${abnormalTimeOn ? 'bg-[#434FCF]' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ${abnormalTimeOn ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Inactive Order Hours */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-[13px] font-semibold text-slate-700">死单检测时间</p>
              <p className="text-[11px] text-slate-400">订单无操作超过此时长标记为死单</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="12"
                max="168"
                value={inactiveHours}
                onChange={(e) => { setInactiveHours(Number(e.target.value)); markDirty(); }}
                className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-[13px] text-center focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20"
              />
              <span className="text-[12px] text-slate-500">小时</span>
            </div>
          </div>

          {/* Frequent Reassign */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-[13px] font-semibold text-slate-700">频繁换设计师阈值</p>
              <p className="text-[11px] text-slate-400">同一订单换设计师达到此次数告警</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="10"
                value={reassignCount}
                onChange={(e) => { setReassignCount(Number(e.target.value)); markDirty(); }}
                className="w-16 px-2 py-1 rounded-lg border border-slate-200 text-[13px] text-center focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20"
              />
              <span className="text-[12px] text-slate-500">次</span>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 text-[14px] font-bold text-white bg-[#434FCF] hover:bg-[#3641F5] rounded-xl shadow-lg shadow-[#434FCF]/30 transition-all disabled:opacity-50"
          >
            {saving ? '保存中...' : <><HIcon d={P.save} className="w-4 h-4" /> 保存配置</>}
          </button>
        </div>
      )}
    </div>
  );
}
