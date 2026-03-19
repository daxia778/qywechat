import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { listEmployees, createEmployee, toggleEmployee, unbindDevice as apiUnbind, pauseActivationCode as apiPause, batchToggleEmployees, batchDeleteEmployees } from '../api/admin';
import { ROLE_MAP, ROLE_CLASS_MAP, ROLE_AVATAR_CLASS_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatDate } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import LoadingSpinner from '../components/LoadingSpinner';

export default function EmployeesPage() {
  const { toast } = useToast();
  const { role: currentUserRole } = useAuth();
  const isAdmin = currentUserRole === 'admin';
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [form, setForm] = useState({ wecom_userid: '', name: '', role: 'operator', username: '', password: '' });
  const [codeModal, setCodeModal] = useState({ show: false, code: '' });
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', type: 'info', confirmText: '确认' });

  // Feature B: Expanded row
  const [expandedRowId, setExpandedRowId] = useState(null);

  // Feature C: Sort controls
  const [sortField, setSortField] = useState(null); // 'name' | 'role' | 'status'
  const [sortDir, setSortDir] = useState('asc');

  // Feature D: Batch operations
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const batchMenuRef = useRef(null);

  // Close batch menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (batchMenuRef.current && !batchMenuRef.current.contains(e.target)) {
        setShowBatchMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredAndSortedEmployees = useMemo(() => {
    let list = employees;
    // Filter
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      list = list.filter((emp) =>
        (emp.name && emp.name.toLowerCase().includes(kw)) ||
        (emp.wecom_userid && emp.wecom_userid.toLowerCase().includes(kw))
      );
    }
    // Sort
    if (sortField) {
      list = [...list].sort((a, b) => {
        let aVal, bVal;
        if (sortField === 'name') {
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
        } else if (sortField === 'role') {
          aVal = ROLE_MAP[a.role] || a.role || '';
          bVal = ROLE_MAP[b.role] || b.role || '';
        } else if (sortField === 'status') {
          aVal = a.is_active ? 1 : 0;
          bVal = b.is_active ? 1 : 0;
        }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return list;
  }, [employees, searchKeyword, sortField, sortDir]);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listEmployees();
      setEmployees(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const confirmActionRef = useRef(null);

  const showConfirm = (opts, action) => {
    confirmActionRef.current = action;
    setConfirmModal({ show: true, ...opts });
  };

  const onConfirmAction = () => {
    setConfirmModal((m) => ({ ...m, show: false }));
    confirmActionRef.current?.();
  };

  // Feature A: Inline status toggle with confirmation (unified for all roles)
  const handleToggle = (emp) => {
    const actionLabel = emp.is_active ? '禁用' : '启用';
    showConfirm({
      title: `${actionLabel}员工`,
      message: `确定要${actionLabel}该员工吗？`,
      type: emp.is_active ? 'danger' : 'info',
      confirmText: actionLabel,
    }, async () => {
      try {
        if (emp.role === 'admin') {
          await toggleEmployee(emp.id);
        } else {
          await apiPause(emp.id);
        }
        toast(`已${actionLabel}`, 'success');
        fetchEmployees();
      } catch (err) { toast('操作失败: ' + (err.response?.data?.error || err.message), 'error'); }
    });
  };

  const handleUnbind = (emp) => {
    showConfirm({
      title: '解绑设备',
      message: `确定要解绑 ${emp.name} 的设备吗？解绑后需重新绑定才能登录。`,
      type: 'warning', confirmText: '解绑',
    }, async () => {
      try {
        const res = await apiUnbind(emp.id);
        toast(res.data.message || '解绑成功', 'success');
        fetchEmployees();
      } catch (err) { toast('解绑失败: ' + (err.response?.data?.error || err.message), 'error'); }
    });
  };

  const copyCode = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板', 'success'); }
    catch (err) { toast('复制失败: ' + err.message, 'error'); }
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    if (!form.wecom_userid || !form.name) return;
    if (form.role === 'admin' && (!form.username || !form.password)) {
      toast('管理员需要填写用户名和密码。', 'error');
      return;
    }
    setAdding(true);
    try {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const activationCode = form.role !== 'admin' ? Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('') : undefined;
      const res = await createEmployee({ ...form, activation_code: activationCode });
      setShowAddModal(false);
      if (form.role !== 'admin') {
        setCodeModal({ show: true, code: res.data.activation_code_plain });
      } else {
        toast(`管理员 ${form.name} 已添加`, 'success');
      }
      setForm({ wecom_userid: '', name: '', role: 'operator', username: '', password: '' });
      fetchEmployees();
    } catch (err) { toast('添加失败: ' + (err.response?.data?.error || err.message), 'error'); }
    finally { setAdding(false); }
  };

  // Feature C: Sort handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Feature D: Selection helpers
  const allVisibleIds = filteredAndSortedEmployees.map((e) => e.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id));
  const someSelected = allVisibleIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchDisable = () => {
    setShowBatchMenu(false);
    const count = selectedIds.size;
    showConfirm({
      title: '批量禁用',
      message: `确定要禁用选中的 ${count} 名员工吗？`,
      type: 'danger',
      confirmText: '批量禁用',
    }, async () => {
      try {
        await batchToggleEmployees([...selectedIds], false);
        toast(`已批量禁用 ${count} 名员工`, 'success');
        setSelectedIds(new Set());
        fetchEmployees();
      } catch (err) { toast('批量操作失败: ' + (err.response?.data?.error || err.message), 'error'); }
    });
  };

  const handleBatchDelete = () => {
    setShowBatchMenu(false);
    const count = selectedIds.size;
    showConfirm({
      title: '批量删除',
      message: `确定要删除选中的 ${count} 名员工吗？此操作不可撤销。`,
      type: 'danger',
      confirmText: '确认删除',
    }, async () => {
      try {
        await batchDeleteEmployees([...selectedIds]);
        toast(`已批量删除 ${count} 名员工`, 'success');
        setSelectedIds(new Set());
        fetchEmployees();
      } catch (err) { toast('批量操作失败: ' + (err.response?.data?.error || err.message), 'error'); }
    });
  };

  // Feature B: Toggle row expansion
  const toggleExpand = (id) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      <ConfirmModal
        visible={confirmModal.show}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmText={confirmModal.confirmText}
        onConfirm={onConfirmAction}
        onCancel={() => setConfirmModal((m) => ({ ...m, show: false }))}
      />

      {/* Activation Code Modal */}
      {codeModal.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={() => setCodeModal({ show: false, code: '' })}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-success-bg shrink-0">
                  <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="text-lg font-bold text-slate-800">员工添加成功</h3>
              </div>
            </div>
            <div className="px-6 py-3">
              <p className="text-sm text-slate-600 mb-3">请保存以下激活码，此码仅显示一次：</p>
              <div className="bg-slate-50 rounded-xl p-4 flex items-center justify-between border border-slate-100">
                <code className="text-2xl font-bold font-mono text-slate-800 tracking-[0.3em] tabular-nums">{codeModal.code}</code>
                <button onClick={() => copyCode(codeModal.code)} className="inline-flex items-center justify-center gap-2 py-1.5 px-3 text-[12px] font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm">复制</button>
              </div>
            </div>
            <div className="px-6 pb-6 pt-2 flex justify-end">
              <button onClick={() => setCodeModal({ show: false, code: '' })} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm">关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Title */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-800 font-[Outfit] tracking-tight">员工管理</h1>
          <p className="text-sm text-slate-500 mt-1">团队成员与权限管理</p>
        </div>
        <button onClick={() => { setForm({ wecom_userid: '', name: '', role: 'operator', username: '', password: '' }); setShowAddModal(true); }} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
          <span>添加员工</span>
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border-2 border-slate-200 rounded-2xl flex flex-col overflow-hidden">
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </div>
            <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">员工目录</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Feature D: Batch operations dropdown (admin only) */}
            {isAdmin && selectedIds.size > 0 && (
              <div className="relative" ref={batchMenuRef}>
                <button
                  onClick={() => setShowBatchMenu((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" /></svg>
                  批量操作
                  <span className="bg-white/20 text-white text-[11px] px-1.5 py-0.5 rounded-md font-bold ml-0.5">{selectedIds.size}</span>
                  <svg className={`w-3.5 h-3.5 transition-transform ${showBatchMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </button>
                {showBatchMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-30 animate-fade-in-up">
                    <button
                      onClick={handleBatchDisable}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                    >
                      <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                      批量禁用
                    </button>
                    <div className="border-t border-slate-100" />
                    <button
                      onClick={handleBatchDelete}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      批量删除
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="relative w-56">
              <input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} type="text" placeholder="搜索员工..." aria-label="搜索员工" className="w-full px-4 py-1.5 pl-9 text-[13px] text-slate-800 bg-white border border-slate-200 rounded-lg outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
        </div>

        <div className="w-full overflow-x-auto min-h-[400px] relative">
          {loading && <LoadingSpinner />}
          <table>
            <thead className="bg-slate-50">
              <tr>
                {/* Feature D: Checkbox column (admin only) */}
                {isAdmin && (
                  <th className="pl-4 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500 cursor-pointer"
                    />
                  </th>
                )}
                {/* Feature C: Sortable headers */}
                <th className={isAdmin ? 'pl-2' : 'pl-6'}>
                  <button onClick={() => handleSort('name')} className="inline-flex items-center gap-0.5 hover:text-brand-500 transition-colors font-semibold text-inherit cursor-pointer select-none bg-transparent border-none p-0">
                    员工
                    <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th>
                  <button onClick={() => handleSort('role')} className="inline-flex items-center gap-0.5 hover:text-brand-500 transition-colors font-semibold text-inherit cursor-pointer select-none bg-transparent border-none p-0">
                    角色
                    <SortIcon field="role" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th>激活码</th>
                <th>设备指纹</th>
                <th>最后活跃</th>
                <th>
                  <button onClick={() => handleSort('status')} className="inline-flex items-center gap-0.5 hover:text-brand-500 transition-colors font-semibold text-inherit cursor-pointer select-none bg-transparent border-none p-0">
                    状态
                    <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="text-right pr-6">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedEmployees.length === 0 && !loading && (
                <tr>
                  <td colSpan={isAdmin ? 9 : 8} className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <p className="font-medium text-slate-600">暂无员工数据</p>
                      <p className="text-sm mt-0.5">点击右上角按钮添加员工。</p>
                    </div>
                  </td>
                </tr>
              )}
              {filteredAndSortedEmployees.map((emp) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  isAdmin={isAdmin}
                  isExpanded={expandedRowId === emp.id}
                  isSelected={selectedIds.has(emp.id)}
                  onToggleExpand={() => toggleExpand(emp.id)}
                  onToggleSelect={() => toggleSelectOne(emp.id)}
                  onToggleStatus={() => handleToggle(emp)}
                  onUnbind={() => handleUnbind(emp)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 font-[Outfit]">添加成员</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 bg-transparent py-1 px-1 -mr-2 rounded hover:bg-slate-200 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={submitAdd} className="p-6">
              <div className="mb-5">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">企微 UserID</label>
                <input value={form.wecom_userid} onChange={(e) => setForm({ ...form, wecom_userid: e.target.value })} type="text" className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" placeholder="企微中的唯一标识" required />
              </div>
              <div className="mb-5">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">姓名</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} type="text" className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" placeholder="员工真实姓名" required />
              </div>
              <div className="mb-5">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">系统角色</label>
                <div className="relative">
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 appearance-none bg-white font-medium" required>
                    <option value="operator">客服管家</option>
                    <option value="designer">设计师</option>
                    <option value="admin">管理员</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
              </div>
              {form.role === 'admin' && (
                <>
                  <div className="mb-5">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">用户名</label>
                    <input value={form.username || ''} onChange={(e) => setForm({ ...form, username: e.target.value })} type="text" className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" placeholder="登录用户名" required />
                  </div>
                  <div className="mb-5">
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">初始密码</label>
                    <input value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" placeholder="初始登录密码" required autoComplete="new-password" />
                  </div>
                </>
              )}
              <div className="mt-8 flex justify-end gap-3">
                <button type="button" onClick={() => setShowAddModal(false)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm">取消</button>
                <button type="submit" className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm" disabled={adding}>
                  {adding ? '保存中...' : (form.role === 'admin' ? '创建管理员' : '生成激活码并保存')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SortIcon({ field, sortField, sortDir }) {
  const isActive = sortField === field;
  return (
    <span className={`inline-flex flex-col ml-1.5 -mb-0.5 ${isActive ? 'text-brand-500' : 'text-slate-300'}`}>
      <svg className={`w-3 h-3 -mb-1 ${isActive && sortDir === 'asc' ? 'text-brand-500' : ''}`} viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 2L10 7H2L6 2Z" />
      </svg>
      <svg className={`w-3 h-3 ${isActive && sortDir === 'desc' ? 'text-brand-500' : ''}`} viewBox="0 0 12 12" fill="currentColor">
        <path d="M6 10L2 5H10L6 10Z" />
      </svg>
    </span>
  );
}

// Extracted row component for clarity
function EmployeeRow({ emp, isAdmin, isExpanded, isSelected, onToggleExpand, onToggleSelect, onToggleStatus, onUnbind }) {
  const totalCols = isAdmin ? 9 : 8;
  const BADGE_VARIANT_CLASSES = {
    success: 'bg-success-bg text-green-900',
    warning: 'bg-warning-bg text-amber-800',
    danger: 'bg-danger-bg text-red-800',
    primary: 'bg-brand-50 text-brand-500',
    secondary: 'bg-slate-100 text-slate-500',
  };

  return (
    <>
      <tr
        className={`group transition-colors cursor-pointer ${isExpanded ? 'bg-[#F8FAFC]' : 'hover:bg-[#FAFBFC]'}`}
        onClick={(e) => {
          // Do not expand when clicking checkboxes, buttons, or interactive elements
          if (e.target.closest('button') || e.target.closest('input[type="checkbox"]')) return;
          onToggleExpand();
        }}
      >
        {/* Feature D: Checkbox */}
        {isAdmin && (
          <td className="pl-4 w-10" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500 cursor-pointer"
            />
          </td>
        )}
        <td className={isAdmin ? 'pl-2' : 'pl-6'}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${ROLE_AVATAR_CLASS_MAP[emp.role] || 'bg-slate-500'}`}>
              {(emp.name || emp.wecom_userid || '?').substring(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-slate-800">{emp.name}</div>
              <div className="text-[13px] text-slate-500 mt-0.5">{emp.wecom_userid}</div>
            </div>
            {/* Expand indicator */}
            <svg className={`w-4 h-4 text-slate-300 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </td>
        <td><span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${BADGE_VARIANT_CLASSES[ROLE_CLASS_MAP[emp.role]] || BADGE_VARIANT_CLASSES.secondary}`}>{ROLE_MAP[emp.role] || emp.role}</span></td>
        <td>
          {emp.role !== 'admin' ? (
            <code className="text-[13px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">******</code>
          ) : (
            <span className="text-slate-400">-</span>
          )}
        </td>
        <td className="font-mono text-[13px] text-slate-600">
          <span title={emp.machine_id}>{emp.machine_id ? emp.machine_id.substring(0, 16) + '...' : '未绑定'}</span>
        </td>
        <td>
          {emp.last_login_at ? (
            <div>
              <div className="text-slate-800">{formatDate(emp.last_login_at)}</div>
              <div className="text-[12px] text-slate-500 mt-0.5">{emp.last_login_ip}</div>
            </div>
          ) : (
            <span className="text-slate-400">从未登录</span>
          )}
        </td>
        {/* Feature A: Inline toggle switch with confirmation */}
        <td>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onToggleStatus}
              role="switch"
              aria-checked={emp.is_active}
              aria-label={`${emp.name} 状态切换`}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-500 ${emp.is_active ? 'bg-success' : 'bg-slate-300'}`}
              title={emp.is_active ? '点击禁用' : '点击启用'}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${emp.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className={`text-[13px] font-medium ${emp.is_active ? 'text-success' : 'text-slate-400'}`}>
              {emp.is_active ? '已启用' : '已禁用'}
            </span>
          </div>
        </td>
        <td className="text-right pr-6">
          <div className="flex items-center justify-end gap-2 text-slate-400" onClick={(e) => e.stopPropagation()}>
            <button onClick={onUnbind} disabled={!emp.machine_id} className={`p-1.5 rounded transition-colors ${emp.machine_id ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50 cursor-pointer' : 'text-slate-300'}`} title="解绑设备">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
            </button>
          </div>
        </td>
      </tr>
      {/* Feature B: Expanded detail row */}
      {isExpanded && (
        <tr className="bg-[#F8FAFC]">
          <td colSpan={totalCols} className="px-0 py-0">
            <div className="px-8 py-4 border-t border-slate-100 animate-fade-in-up">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <DetailItem
                  label="创建时间"
                  value={emp.created_at ? formatDate(emp.created_at) : '-'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                />
                <DetailItem
                  label="最后登录"
                  value={emp.last_login_at ? formatDate(emp.last_login_at) : '从未登录'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
                <DetailItem
                  label="登录IP"
                  value={emp.last_login_ip || '-'}
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>}
                />
                <DetailItem
                  label="设备指纹"
                  value={emp.machine_id || '未绑定'}
                  mono
                  icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                />
                {emp.user_agent && (
                  <div className="col-span-2 md:col-span-4">
                    <DetailItem
                      label="设备信息"
                      value={emp.user_agent}
                      icon={<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>}
                    />
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailItem({ label, value, mono, icon }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-slate-400 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[12px] text-slate-400 font-medium mb-0.5">{label}</div>
        <div className={`text-[13px] text-slate-700 break-all ${mono ? 'font-mono' : ''}`}>{value}</div>
      </div>
    </div>
  );
}
