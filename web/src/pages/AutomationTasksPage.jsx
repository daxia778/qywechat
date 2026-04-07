import { useState, useCallback, useEffect, memo } from 'react';
import { RefreshCw, RotateCcw, XCircle, Wifi, WifiOff, Clock, CheckCircle2, AlertCircle, Loader2, Phone } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { listAutomationTasks, retryAutomationTask, cancelAutomationTask, getAutomationStats, getAgentStatus } from '../api/automation';
import { useToast } from '../hooks/useToast';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatTime } from '../utils/constants';

const STATUS_CONFIG = {
  pending:   { label: '待执行', color: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  running:   { label: '执行中', color: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-400' },
  success:   { label: '成功',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-400' },
  failed:    { label: '失败',   color: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-400' },
  cancelled: { label: '已取消', color: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

const TASK_TYPE_MAP = {
  add_friend: '添加好友',
  create_group: '自动建群',
  invite_to_group: '邀请入群',
};

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待执行' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

const StatusBadge = memo(({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
});

const StatCard = memo(({ icon: Icon, label, value, color }) => (
  <div className="bg-surface-container-lowest ghost-border rounded-xl p-4 flex items-center gap-3.5">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
      <Icon className="w-5 h-5 text-white" />
    </div>
    <div>
      <div className="text-2xl font-semibold font-['Outfit',sans-serif] tabular-nums tracking-tight text-slate-800">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  </div>
));

const TaskRow = memo(({ task, onRetry, onCancel }) => (
  <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
    <td className="px-5 py-3.5 text-sm text-slate-600">#{task.id}</td>
    <td className="px-5 py-3.5">
      <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
        <Phone className="w-3.5 h-3.5 text-slate-400" />
        {task.phone || '-'}
      </span>
    </td>
    <td className="px-5 py-3.5 text-sm text-slate-600">{task.order_sn || '-'}</td>
    <td className="px-5 py-3.5 text-sm text-slate-500">
      {TASK_TYPE_MAP[task.task_type] || task.task_type}
    </td>
    <td className="px-5 py-3.5"><StatusBadge status={task.status} /></td>
    <td className="px-5 py-3.5 text-sm text-slate-500 tabular-nums">{task.retry_count}/{task.max_retry}</td>
    <td className="px-5 py-3.5 text-xs text-slate-400">{formatTime(task.created_at)}</td>
    <td className="px-5 py-3.5 text-xs text-slate-400">{task.executed_at ? formatTime(task.executed_at) : '-'}</td>
    <td className="px-5 py-3.5">
      <div className="flex items-center gap-1.5">
        {task.status === 'failed' && (
          <button onClick={() => onRetry(task.id)} className="text-brand-500 hover:text-brand-600 p-1 rounded-lg hover:bg-brand-50 transition-colors" title="重试">
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        {task.status === 'pending' && (
          <button onClick={() => onCancel(task.id)} className="text-red-400 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors" title="取消">
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    </td>
  </tr>
));

export default function AutomationTasksPage() {
  const { toast } = useToast();
  const { subscribe } = useWebSocket();

  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [agent, setAgent] = useState(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20 };
      if (statusFilter) params.status = statusFilter;
      const res = await listAutomationTasks(params);
      setTasks(res.data?.data?.data || []);
      setTotal(res.data?.data?.total || 0);
    } catch (err) {
      toast(err.displayMessage || '加载任务列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, agentRes] = await Promise.all([getAutomationStats(), getAgentStatus()]);
      setStats(statsRes.data?.data);
      setAgent(agentRes.data?.data);
    } catch {}
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { fetchStats(); }, []);

  // WebSocket 实时更新
  useEffect(() => {
    const unsub1 = subscribe('automation_task_created', () => { fetchTasks(); fetchStats(); });
    const unsub2 = subscribe('automation_task_updated', () => { fetchTasks(); fetchStats(); });
    return () => { unsub1(); unsub2(); };
  }, [subscribe, fetchTasks, fetchStats]);

  const handleRetry = async (id) => {
    try {
      await retryAutomationTask(id);
      toast('已重新入队', 'success');
      fetchTasks();
      fetchStats();
    } catch (err) {
      toast(err.displayMessage || '操作失败', 'error');
    }
  };

  const handleCancel = async (id) => {
    try {
      await cancelAutomationTask(id);
      toast('已取消', 'success');
      fetchTasks();
      fetchStats();
    } catch (err) {
      toast(err.displayMessage || '操作失败', 'error');
    }
  };

  const totalPages = Math.ceil(total / 20);
  const todayStats = stats?.today || {};

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <PageHeader title="自动化任务" subtitle="企微好友添加 & 建群任务队列">
        <button onClick={() => { fetchTasks(); fetchStats(); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </PageHeader>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Clock} label="待执行" value={todayStats.pending || 0} color="bg-amber-500" />
        <StatCard icon={Loader2} label="执行中" value={todayStats.running || 0} color="bg-blue-500" />
        <StatCard icon={CheckCircle2} label="今日成功" value={todayStats.success || 0} color="bg-emerald-500" />
        <StatCard icon={AlertCircle} label="今日失败" value={todayStats.failed || 0} color="bg-red-500" />
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-4 flex items-center gap-3.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${agent?.online ? 'bg-emerald-500' : 'bg-slate-400'}`}>
            {agent?.online ? <Wifi className="w-5 h-5 text-white" /> : <WifiOff className="w-5 h-5 text-white" />}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">{agent?.online ? 'Agent 在线' : 'Agent 离线'}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {agent?.online ? `${agent.platform || ''} v${agent.version || ''}` : '未连接'}
            </div>
          </div>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        {/* 筛选条 */}
        <div className="px-5 lg:px-7 py-4 border-b border-slate-200 flex items-center gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1); }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                statusFilter === f.value
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto text-xs text-slate-400">
            共 {total} 条 · 累计 {stats?.total_tasks || 0} 条
          </div>
        </div>

        {/* 表格 */}
        <div className="w-full overflow-x-auto min-h-[300px] relative">
          {loading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
              <RefreshCw className="w-6 h-6 text-brand-500 animate-spin" />
            </div>
          )}
          <table className="w-full">
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50/80">
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">手机号</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">订单号</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">类型</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">状态</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">重试</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">创建时间</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">执行时间</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && !loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center text-sm text-slate-400">
                    暂无任务记录
                  </td>
                </tr>
              ) : (
                tasks.map(task => (
                  <TaskRow key={task.id} task={task} onRetry={handleRetry} onCancel={handleCancel} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="px-5 lg:px-7 py-3.5 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-400">第 {page} / {totalPages} 页</div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
