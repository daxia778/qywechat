import { useState, useCallback, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { usePolling } from '../hooks/usePolling';
import { getTeamWorkload } from '../api/admin';

const AVATAR_COLORS = [
  'linear-gradient(135deg,#434fcf,#7c3aed)',
  'linear-gradient(135deg,#059669,#10b981)',
  'linear-gradient(135deg,#d97706,#f59e0b)',
  'linear-gradient(135deg,#dc2626,#f87171)',
  'linear-gradient(135deg,#0891b2,#38bdf8)',
];
const getAvatarColor = (name = '') => {
  const code = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
};

const getLoadColorClass = (count, isText = false) => {
  if (count === 0) return isText ? 'text-slate-400' : 'bg-slate-400';
  if (count <= 3) return isText ? 'text-success' : 'bg-success';
  if (count <= 7) return isText ? 'text-warning' : 'bg-warning';
  return isText ? 'text-danger' : 'bg-danger';
};

export default function TeamPage() {
  const { toast } = useToast();
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTeam = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const res = await getTeamWorkload();
      setTeam(res.data.data || []);
      setError(null);
      if (manual) toast('团队负载已刷新', 'success');
    } catch (err) {
      if (manual) {
        toast('获取失败: ' + err.message, 'error');
      } else {
        setError('加载失败，请刷新重试');
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  usePolling(fetchTeam, 30000);

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[28px] font-bold text-[#1d1d1f] font-[Outfit] tracking-tight">团队监控</h1>
          <p className="text-[13px] text-[#6e6e73] mt-1">设计师负载与状态概览</p>
        </div>
        <button onClick={() => fetchTeam(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm" disabled={loading}>
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>{loading ? '同步中...' : '刷新'}</span>
        </button>
      </div>

      {error && (
        <div className="text-red-500 text-center py-4 bg-red-50 border border-red-200 rounded-xl text-sm font-medium">{error}</div>
      )}

      {team.length === 0 && !loading && !error ? (
        <div className="bg-surface-container-lowest ghost-border rounded-xl p-20 flex flex-col items-center justify-center text-slate-400">
          <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-5">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
          </div>
          <p className="font-semibold text-slate-700 text-lg mb-1">暂无活跃成员</p>
          <p className="text-[14px] text-slate-500 max-w-sm text-center">当前没有可分配任务的活跃设计师成员。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {team.map((member) => (
            <div key={member.wecom_userid} className="bg-surface-container-lowest ghost-border rounded-xl overflow-hidden flex flex-col hover:border-[#434FCF]/20 transition-colors">
              <div className="p-6 flex items-start justify-between border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="relative w-12 h-12 shrink-0">
                    <div
                      className="w-full h-full rounded-full flex items-center justify-center text-white text-[13px] font-semibold"
                      style={{ background: getAvatarColor(member.name) }}
                    >
                      {(member.name || '').substring(0, 2)}
                    </div>
                    <div className={`absolute inset-0 rounded-full border-2 ${
                      member.active_orders >= 10 ? 'border-red-400' :
                      member.status === 'idle' ? 'border-emerald-400' : 'border-amber-400'
                    }`} />
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold text-[#1d1d1f]">{member.name}</div>
                    <div className="text-[12px] text-[#8e8e93] mt-0.5 truncate max-w-[120px]" title={member.wecom_userid}>{member.wecom_userid}</div>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide self-start ${member.status === 'idle' ? 'bg-success-bg text-green-900' : 'bg-warning-bg text-amber-800'}`}>
                  <span className={`w-2 h-2 rounded-full ${member.status === 'idle' ? 'bg-success' : 'bg-warning animate-pulse'}`} />
                  {member.status === 'idle' ? '空闲' : '忙碌'}
                </span>
              </div>
              <div className="px-6 py-6 bg-[#FAFBFC] grow flex flex-col justify-center">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[12px] font-medium text-[#8e8e93] uppercase tracking-wider">活跃订单</span>
                  <span className={`text-2xl font-bold font-[Outfit] ${getLoadColorClass(member.active_orders, true)}`}>
                    {member.active_orders}
                    <span className="text-[14px] font-medium text-slate-400"> / 10</span>
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div className={`h-2 rounded-full transition-all duration-700 ease-out ${getLoadColorClass(member.active_orders)}`} style={{ width: `${Math.min((member.active_orders / 10) * 100, 100)}%` }} />
                </div>
                {member.grab_timeout_rate !== undefined && (
                  <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-200">
                    <span className="text-[12px] font-medium text-[#8e8e93]">异常抢单率</span>
                    <span className={`text-[13px] font-bold tabular-nums ${member.grab_timeout_rate > 20 ? 'text-red-600' : member.grab_timeout_rate === 0 ? 'text-green-600' : 'text-slate-700'}`}>
                      {(member.grab_timeout_rate || 0).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
