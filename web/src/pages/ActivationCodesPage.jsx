import { useState, useCallback, useEffect, useMemo } from 'react';
import { useToast } from '../hooks/useToast';
import { listActivationCodes, pauseActivationCode as apiPause, unbindDevice as apiUnbind, regenerateActivationCode as apiRegenerate } from '../api/admin';
import { ROLE_MAP, ROLE_CLASS_MAP, ROLE_AVATAR_CLASS_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatDate, formatRelativeTime } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/ui/PageHeader';

const STATUS_FILTERS = [
  { value: '', label: '全部设备' },
  { value: 'bound', label: '已绑定' },
  { value: 'unbound', label: '未绑定' },
];

export default function ActivationCodesPage() {
  const { toast } = useToast();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', type: 'info', confirmText: '确认', onConfirm: null });
  const [codeModal, setCodeModal] = useState({ show: false, name: '', code: '' });

  const fetchData = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const res = await listActivationCodes(statusFilter || undefined);
      setEmployees(res.data.data || []);
      if (manual) toast('设备列表已刷新', 'success');
    } catch (err) {
      if (manual) toast('获取失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (!searchKeyword.trim()) return employees;
    const kw = searchKeyword.trim().toLowerCase();
    return employees.filter((e) =>
      (e.name && e.name.toLowerCase().includes(kw)) ||
      (e.wecom_userid && e.wecom_userid.toLowerCase().includes(kw)) ||
      (e.machine_id && e.machine_id.toLowerCase().includes(kw)) ||
      (e.mac_address && e.mac_address.toLowerCase().includes(kw))
    );
  }, [employees, searchKeyword]);

  // Stats
  const totalCount = employees.length;
  const boundCount = employees.filter((e) => e.machine_id).length;
  const unboundCount = totalCount - boundCount;
  const activeCount = employees.filter((e) => e.is_active).length;

  const showConfirm = (opts) => {
    setConfirmModal({ show: true, ...opts });
  };

  const handleToggleStatus = (emp) => {
    const actionLabel = emp.is_active ? '暂停' : '恢复';
    showConfirm({
      title: `${actionLabel}设备登录`,
      message: `确定要${actionLabel} ${emp.name} 的设备登录权限吗？`,
      type: emp.is_active ? 'danger' : 'info',
      confirmText: actionLabel,
      onConfirm: async () => {
        setConfirmModal((m) => ({ ...m, show: false }));
        try {
          await apiPause(emp.id);
          toast(`已${actionLabel} ${emp.name}`, 'success');
          fetchData();
        } catch (err) {
          toast('操作失败: ' + (err.displayMessage || err.message), 'error');
        }
      },
    });
  };

  const handleUnbind = (emp) => {
    showConfirm({
      title: '解绑设备',
      message: `确定要解绑 ${emp.name} 的设备吗？\n解绑后该员工需要使用新的激活码重新绑定设备才能登录。`,
      type: 'warning',
      confirmText: '确认解绑',
      onConfirm: async () => {
        setConfirmModal((m) => ({ ...m, show: false }));
        try {
          const res = await apiUnbind(emp.id);
          toast(res.data.message || '解绑成功', 'success');
          fetchData();
        } catch (err) {
          toast('解绑失败: ' + (err.displayMessage || err.message), 'error');
        }
      },
    });
  };

  const handleRegenerate = (emp) => {
    showConfirm({
      title: '重新生成激活码',
      message: `确定要为 ${emp.name} 重新生成激活码吗？\n旧设备绑定将同时解除，${emp.name} 需要用新激活码重新登录。`,
      type: 'warning',
      confirmText: '重新生成',
      onConfirm: async () => {
        setConfirmModal((m) => ({ ...m, show: false }));
        try {
          const res = await apiRegenerate(emp.id);
          setCodeModal({ show: true, name: emp.name, code: res.data.activation_code_plain });
          fetchData();
        } catch (err) {
          toast('操作失败: ' + (err.displayMessage || err.message), 'error');
        }
      },
    });
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <ConfirmModal
        visible={confirmModal.show}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmText={confirmModal.confirmText}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((m) => ({ ...m, show: false }))}
      />

      {/* 新激活码弹窗 */}
      {codeModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 flex flex-col items-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
              <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-800 font-[Outfit] mb-1">{codeModal.name} 的新激活码</h3>
              <p className="text-sm text-slate-500">请立即复制并告知员工，关闭后无法再次查看</p>
            </div>
            <div className="w-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl px-6 py-4 text-center">
              <span className="font-mono text-2xl font-bold tracking-[0.3em] text-slate-800 select-all">{codeModal.code}</span>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => {
                  const text = codeModal.code;
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板', 'success')).catch(() => {
                      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
                      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                      toast('已复制到剪贴板', 'success');
                    });
                  } else {
                    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                    toast('已复制到剪贴板', 'success');
                  }
                }}
                className="flex-1 h-10 bg-brand-500 text-white text-sm font-semibold rounded-xl hover:bg-brand-600 transition-colors cursor-pointer"
              >
                复制激活码
              </button>
              <button
                onClick={() => setCodeModal({ show: false, name: '', code: '' })}
                className="flex-1 h-10 bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                已记录，关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <PageHeader title="设备管理" subtitle="激活码与设备绑定状态管理">
        <button onClick={() => fetchData(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm" disabled={loading}>
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>{loading ? '同步中...' : '刷新'}</span>
        </button>
      </PageHeader>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ActivationStatCard label="总员工数" value={totalCount} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} color="brand" />
        <ActivationStatCard label="已绑定设备" value={boundCount} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>} color="success" />
        <ActivationStatCard label="未绑定" value={unboundCount} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>} color="warning" />
        <ActivationStatCard label="启用中" value={activeCount} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>} color="info" />
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">设备列表</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Status filter tabs */}
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-all duration-150 ${
                    statusFilter === f.value
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative w-56">
              <input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} type="text" placeholder="搜索员工/设备..." aria-label="搜索" className="w-full px-4 py-1.5 pl-9 text-[13px] text-slate-800 bg-white border border-slate-200 rounded-lg outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        </div>

        <div className="w-full overflow-x-auto min-h-[300px] relative">
          {loading && <LoadingSpinner />}
          <table>
            <thead>
              <tr>
                <th className="pl-6">员工</th>
                <th className="hidden md:table-cell">角色</th>
                <th>绑定状态</th>
                <th className="hidden lg:table-cell">设备指纹</th>
                <th className="hidden xl:table-cell">MAC 地址</th>
                <th className="hidden md:table-cell">最后登录</th>
                <th>启用状态</th>
                <th className="text-right pr-6">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      <p className="font-medium text-slate-600">暂无设备数据</p>
                      <p className="text-sm mt-0.5">请先在员工管理页面添加员工并分配激活码。</p>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((emp) => (
                <tr key={emp.id} className="group hover:bg-[#FAFBFC] transition-colors">
                  <td className="pl-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${ROLE_AVATAR_CLASS_MAP[emp.role] || 'bg-slate-500'}`}>
                        {(emp.name || '?').substring(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 text-[14px]">{emp.name}</div>
                        <div className="text-[12px] text-slate-500 mt-0.5">{emp.wecom_userid}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${BADGE_VARIANT_CLASSES[ROLE_CLASS_MAP[emp.role]] || BADGE_VARIANT_CLASSES.secondary}`}>
                      {ROLE_MAP[emp.role] || emp.role}
                    </span>
                  </td>
                  <td>
                    {emp.machine_id ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-bg text-green-900">
                        <span className="w-2 h-2 rounded-full bg-success" />
                        已绑定
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        未绑定
                      </span>
                    )}
                  </td>
                  <td className="hidden lg:table-cell font-mono text-[13px] text-slate-600">
                    <span title={emp.machine_id || ''}>{emp.machine_id ? emp.machine_id.substring(0, 16) + '...' : '-'}</span>
                  </td>
                  <td className="hidden xl:table-cell font-mono text-[13px] text-slate-600">
                    {emp.mac_address || '-'}
                  </td>
                  <td className="hidden md:table-cell">
                    {emp.last_login_at ? (
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${emp.is_online ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${emp.is_online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                            {emp.is_online ? '在线' : '离线'}
                          </span>
                          <span className="text-[13px] text-slate-800">{formatDate(emp.last_login_at)}</span>
                        </div>
                        <div className="text-[12px] text-slate-500 mt-0.5">{emp.last_login_ip || '-'}</div>
                        {emp.last_order_at && (
                          <div className="text-[11px] text-brand-500 mt-0.5 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            最后提单: {formatDate(emp.last_order_at)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-[13px]">从未登录</span>
                    )}
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${emp.is_active ? 'text-success' : 'text-slate-400'}`}>
                      <span className={`w-2 h-2 rounded-full ${emp.is_active ? 'bg-success' : 'bg-slate-300'}`} />
                      {emp.is_active ? '启用' : '已暂停'}
                    </span>
                  </td>
                  <td className="text-right pr-6">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleToggleStatus(emp)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150 cursor-pointer border ${
                          emp.is_active
                            ? 'text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100'
                            : 'text-success border-green-200 bg-green-50 hover:bg-green-100'
                        }`}
                        title={emp.is_active ? '暂停登录' : '恢复登录'}
                      >
                        {emp.is_active ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        )}
                        {emp.is_active ? '暂停' : '恢复'}
                      </button>
                      <button
                        onClick={() => handleUnbind(emp)}
                        disabled={!emp.machine_id}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150 cursor-pointer border ${
                          emp.machine_id
                            ? 'text-red-600 border-red-200 bg-red-50 hover:bg-red-100'
                            : 'text-slate-300 border-slate-100 bg-slate-50 cursor-not-allowed'
                        }`}
                        title={emp.machine_id ? '解绑设备' : '无设备可解绑'}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
                        解绑
                      </button>
                      <button
                        onClick={() => handleRegenerate(emp)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold rounded-lg transition-all duration-150 cursor-pointer border text-brand-600 border-brand-200 bg-brand-50 hover:bg-brand-100"
                        title="重新生成激活码（同时解绑旧设备）"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        重置码
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ActivationStatCard({ label, value, icon, color }) {
  const colorMap = {
    brand: 'bg-brand-50 text-brand-500',
    success: 'bg-success-bg text-green-700',
    warning: 'bg-warning-bg text-amber-700',
    info: 'bg-blue-50 text-blue-600',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colorMap[color] || colorMap.brand}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold font-[Outfit] text-slate-800 tabular-nums">{value}</div>
        <div className="text-[13px] text-slate-500 font-medium mt-0.5">{label}</div>
      </div>
    </div>
  );
}
