import { useState, useCallback, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { usePolling } from '../hooks/usePolling';
import { getTeamWorkload } from '../api/admin';

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

  const fetchTeam = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const res = await getTeamWorkload();
      setTeam(res.data.data || []);
      if (manual) toast('团队负载已刷新', 'success');
    } catch (err) {
      if (manual) toast('获取失败: ' + err.message, 'error');
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
          <h1 className="text-[26px] font-extrabold text-slate-800 font-[Outfit] tracking-tight">团队监控</h1>
          <p className="text-sm text-slate-500 mt-1">设计师负载与状态概览</p>
        </div>
        <button onClick={() => fetchTeam(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm" disabled={loading}>
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>{loading ? '同步中...' : '刷新'}</span>
        </button>
      </div>

      {team.length === 0 && !loading ? (
        <div className="bg-white border-2 border-slate-200 rounded-2xl p-20 flex flex-col items-center justify-center text-slate-400">
          <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-5">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
          </div>
          <p className="font-semibold text-slate-700 text-lg mb-1">暂无活跃成员</p>
          <p className="text-[14px] text-slate-500 max-w-sm text-center">当前没有可分配任务的活跃设计师成员。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {team.map((member) => (
            <div key={member.userid} className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden flex flex-col hover:border-brand-100 transition-colors">
              <div className="p-6 flex items-start justify-between border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-500/20 to-brand-200/30 border-2 border-brand-200 flex items-center justify-center text-brand-500 font-bold text-[15px] shrink-0">
                    {member.name?.substring(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-[15px]">{member.name}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5 truncate max-w-[120px]" title={member.userid}>{member.userid}</div>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide self-start ${member.status === 'idle' ? 'bg-success-bg text-green-900' : 'bg-warning-bg text-amber-800'}`}>
                  <span className={`w-2 h-2 rounded-full ${member.status === 'idle' ? 'bg-success' : 'bg-warning animate-pulse'}`} />
                  {member.status === 'idle' ? '空闲' : '忙碌'}
                </span>
              </div>
              <div className="px-6 py-6 bg-[#FAFBFC] grow flex flex-col justify-center">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider">活跃订单</span>
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
                    <span className="text-[12px] font-medium text-slate-500">异常抢单率</span>
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
