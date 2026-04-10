import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { listEmployees, createEmployee, updateEmployee, toggleEmployee, unbindDevice as apiUnbind, pauseActivationCode as apiPause, batchToggleEmployees, batchDeleteEmployees, resetPassword as apiResetPassword, listWecomMembers } from '../api/admin';
import { ROLE_MAP, ROLE_CLASS_MAP, ROLE_AVATAR_CLASS_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatDate } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import LoadingSpinner from '../components/LoadingSpinner';
import PageHeader from '../components/ui/PageHeader';

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

export default function EmployeesPage() {
  const { toast } = useToast();
  const { role: currentUserRole } = useAuth();
  const isAdmin = currentUserRole === 'admin';
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [form, setForm] = useState({ name: '', role: 'sales' });

  // 企微联系人选择相关 state
  const [addMode, setAddMode] = useState('wecom'); // 'wecom' | 'manual'
  const [wecomKeyword, setWecomKeyword] = useState('');
  const [wecomMembers, setWecomMembers] = useState([]);
  const [wecomLoading, setWecomLoading] = useState(false);
  const [selectedWecomMember, setSelectedWecomMember] = useState(null);
  const [showWecomDropdown, setShowWecomDropdown] = useState(false);
  const wecomSearchRef = useRef(null);
  const wecomDropdownRef = useRef(null);
  const [credentialModal, setCredentialModal] = useState({ show: false, username: '', password: '', notice: '' });
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

  const fetchEmployees = useCallback(async (signal) => {
    setLoading(true);
    try {
      const res = await listEmployees({ signal });
      setEmployees(res.data.data || []);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      console.error('Failed to fetch employees:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchEmployees(controller.signal);
    return () => controller.abort();
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
      } catch (err) { toast('操作失败: ' + (err.displayMessage || err.message), 'error'); }
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
      } catch (err) { toast('解绑失败: ' + (err.displayMessage || err.message), 'error'); }
    });
  };

  const copyCode = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('已复制到剪贴板', 'success');
    } catch (err) { toast('复制失败: ' + err.message, 'error'); }
  };

  const handleResetPassword = (emp) => {
    showConfirm({
      title: '重置密码',
      message: `确定要重置 ${emp.name} 的登录密码吗？重置后将生成新的随机密码。`,
      type: 'warning', confirmText: '重置密码',
    }, async () => {
      try {
        const res = await apiResetPassword(emp.id);
        const { password, notice } = res.data;
        setCredentialModal({ show: true, username: emp.username || emp.wecom_userid, password, notice: notice || '' });
      } catch (err) { toast('重置密码失败: ' + (err.displayMessage || err.message), 'error'); }
    });
  };

  // 企微联系人搜索（防抖）
  useEffect(() => {
    if (addMode !== 'wecom' || !showAddModal) return;
    const timer = setTimeout(async () => {
      setWecomLoading(true);
      try {
        const res = await listWecomMembers(wecomKeyword || '');
        setWecomMembers(res.data?.data || []);
      } catch (err) {
        console.error('Failed to fetch wecom members:', err);
      } finally {
        setWecomLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [wecomKeyword, addMode, showAddModal]);

  // 关闭企微下拉
  useEffect(() => {
    const handler = (e) => {
      if (wecomDropdownRef.current && !wecomDropdownRef.current.contains(e.target) &&
          wecomSearchRef.current && !wecomSearchRef.current.contains(e.target)) {
        setShowWecomDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectWecomMember = (member) => {
    setSelectedWecomMember(member);
    setForm((f) => ({ ...f, name: member.name }));
    setShowWecomDropdown(false);
    setWecomKeyword(member.name);
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    if (!form.name) return;
    setAdding(true);
    try {
      const payload = { name: form.name, role: form.role };
      if (addMode === 'wecom' && selectedWecomMember) {
        payload.wecom_userid = selectedWecomMember.userid;
      }
      const res = await createEmployee(payload);
      setShowAddModal(false);
      const { username, password, notice } = res.data;
      setCredentialModal({ show: true, username: username || '', password: password || '', notice: notice || '' });
      setForm({ name: '', role: 'sales' });
      setSelectedWecomMember(null);
      setWecomKeyword('');
      fetchEmployees();
    } catch (err) { toast('添加失败: ' + (err.displayMessage || err.message), 'error'); }
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
      } catch (err) { toast('批量操作失败: ' + (err.displayMessage || err.message), 'error'); }
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
      } catch (err) { toast('批量操作失败: ' + (err.displayMessage || err.message), 'error'); }
    });
  };

  // Base salary update
  const handleUpdateBaseSalary = async (empId, salaryYuan) => {
    const salaryFen = Math.round(salaryYuan * 100);
    try {
      await updateEmployee(empId, { base_salary: salaryFen });
      toast('底薪已更新', 'success');
      fetchEmployees();
    } catch (err) {
      toast('更新底薪失败: ' + (err.displayMessage || err.message), 'error');
    }
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

      {/* Credential Modal (V2: shows username + password) */}
      {credentialModal.show && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setCredentialModal({ show: false, username: '', password: '', notice: '' })}
          role="dialog"
          aria-modal="true"
          aria-labelledby="credential-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setCredentialModal({ show: false, username: '', password: '', notice: '' }); }}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-success-bg shrink-0">
                  <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 id="credential-modal-title" className="text-lg font-bold text-slate-800">操作成功</h3>
              </div>
            </div>
            <div className="px-6 py-3">
              {credentialModal.notice && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">{credentialModal.notice}</p>
              )}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">用户名</span>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-bold font-mono text-slate-800">{credentialModal.username}</code>
                    <button onClick={() => copyCode(credentialModal.username)} className="text-[11px] text-brand-500 hover:text-brand-600 font-semibold">复制</button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">密码</span>
                  <div className="flex items-center gap-2">
                    <code className="text-lg font-bold font-mono text-slate-800 tracking-wider">{credentialModal.password}</code>
                    <button onClick={() => copyCode(credentialModal.password)} className="text-[11px] text-brand-500 hover:text-brand-600 font-semibold">复制</button>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 pt-2 flex justify-between">
              <button onClick={() => copyCode(`用户名: ${credentialModal.username}\n密码: ${credentialModal.password}`)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm">一键复制全部</button>
              <button onClick={() => setCredentialModal({ show: false, username: '', password: '', notice: '' })} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm">关闭</button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Title */}
      <PageHeader title="员工管理" subtitle="团队成员与权限管理">
        <button onClick={() => { setForm({ name: '', role: 'sales' }); setShowAddModal(true); }} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
          <span>添加员工</span>
        </button>
      </PageHeader>

      {/* Table */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        <div className="px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </div>
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] font-[Outfit]">员工目录</h2>
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
            <thead>
              <tr>
                {/* Feature D: Checkbox column (admin only) */}
                {isAdmin && (
                  <th className="pl-4 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-2 border-[#c6c5d6] checked:bg-[#434fcf] checked:border-[#434fcf] cursor-pointer accent-[#434fcf] transition-colors"
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
                <th className="hidden lg:table-cell">账号</th>
                <th className="hidden xl:table-cell">设备指纹</th>
                <th className="hidden md:table-cell">最后活跃</th>
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
                  onResetPassword={() => handleResetPassword(emp)}
                  onUpdateBaseSalary={handleUpdateBaseSalary}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 font-[Outfit]">添加成员</h3>
              <button onClick={() => { setShowAddModal(false); setSelectedWecomMember(null); setWecomKeyword(''); }} className="text-slate-400 hover:text-slate-600 bg-transparent py-1 px-1 -mr-2 rounded hover:bg-slate-200 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={submitAdd} className="p-6">
              {/* 添加方式切换 */}
              <div className="mb-5">
                <label className="block text-sm font-semibold text-slate-700 mb-2">添加方式</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setAddMode('wecom'); setSelectedWecomMember(null); setForm(f => ({ ...f, name: '' })); }}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-150 ${
                      addMode === 'wecom' ? 'bg-brand-50 border-brand-300 text-brand-600 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}>企微通讯录选择</button>
                  <button type="button" onClick={() => { setAddMode('manual'); setSelectedWecomMember(null); setForm(f => ({ ...f, name: '' })); }}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-150 ${
                      addMode === 'manual' ? 'bg-brand-50 border-brand-300 text-brand-600 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}>手动输入</button>
                </div>
              </div>

              {/* 企微选择模式 */}
              {addMode === 'wecom' && (
                <div className="mb-5">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">选择企微联系人</label>
                  <div className="relative">
                    <div className="relative" ref={wecomSearchRef}>
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input
                        value={wecomKeyword}
                        onChange={(e) => { setWecomKeyword(e.target.value); setSelectedWecomMember(null); setShowWecomDropdown(true); }}
                        onFocus={() => setShowWecomDropdown(true)}
                        type="text"
                        className="w-full pl-10 pr-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                        placeholder="搜索姓名或企微ID..."
                        autoComplete="off"
                      />
                    </div>
                    {showWecomDropdown && (
                      <div ref={wecomDropdownRef} className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                        {wecomLoading ? (
                          <div className="px-4 py-6 text-center text-sm text-slate-400">
                            <div className="inline-block w-4 h-4 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin mr-2" />搜索中...
                          </div>
                        ) : wecomMembers.length === 0 ? (
                          <div className="px-4 py-6 text-center text-sm text-slate-400">暂无企微通讯录数据</div>
                        ) : (
                          wecomMembers.map((m) => (
                            <button
                              key={m.userid}
                              type="button"
                              disabled={m.is_employee}
                              onClick={() => handleSelectWecomMember(m)}
                              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-b border-slate-50 last:border-b-0 ${
                                m.is_employee
                                  ? 'bg-slate-50 cursor-not-allowed opacity-50'
                                  : selectedWecomMember?.userid === m.userid
                                  ? 'bg-brand-50'
                                  : 'hover:bg-slate-50 cursor-pointer'
                              }`}
                            >
                              {m.avatar ? (
                                <img src={m.avatar} alt={m.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: getAvatarColor(m.name) }}>
                                  {(m.name || '?').slice(0, 1)}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-800 truncate">{m.name}</div>
                                <div className="text-xs text-slate-400 truncate">
                                  {m.position || m.userid}
                                  {m.mobile && ` · ${m.mobile}`}
                                </div>
                              </div>
                              {m.is_employee && (
                                <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">已添加</span>
                              )}
                              {selectedWecomMember?.userid === m.userid && !m.is_employee && (
                                <svg className="w-5 h-5 text-brand-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {selectedWecomMember && (
                    <div className="mt-2 flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
                      <svg className="w-4 h-4 text-brand-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                      <span className="text-sm font-medium text-brand-700">已选择: {selectedWecomMember.name}</span>
                      <span className="text-xs text-brand-400">({selectedWecomMember.userid})</span>
                    </div>
                  )}
                </div>
              )}

              {/* 手动输入模式 */}
              {addMode === 'manual' && (
                <div className="mb-5">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">姓名</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} type="text" className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10" placeholder="员工真实姓名" required />
                </div>
              )}

              <div className="mb-5">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">系统角色</label>
                <div className="relative">
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 appearance-none bg-white font-medium" required>
                    <option value="sales">谈单客服</option>
                    <option value="follow">跟单客服</option>
                    <option value="admin">管理员</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  {addMode === 'wecom' ? '将使用企微UserID作为登录账号，系统自动生成随机密码' : '系统将自动生成登录账号和随机密码'}
                </p>
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button type="button" onClick={() => { setShowAddModal(false); setSelectedWecomMember(null); setWecomKeyword(''); }} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm">取消</button>
                <button type="submit" className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm" disabled={adding || (addMode === 'wecom' && !selectedWecomMember)}>
                  {adding ? '保存中...' : '创建员工'}
                </button>
              </div>
            </form>
          </div>
        </div>
      , document.body)}
    </div>
  );
}

const SortIcon = memo(function SortIcon({ field, sortField, sortDir }) {
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
});

// Extracted row component for clarity
const ROW_BADGE_CLASSES = {
  success: 'bg-success-bg text-green-900',
  warning: 'bg-warning-bg text-amber-800',
  danger: 'bg-danger-bg text-red-800',
  primary: 'bg-brand-50 text-brand-500',
  secondary: 'bg-slate-100 text-slate-500',
};

const EmployeeRow = memo(function EmployeeRow({ emp, isAdmin, isExpanded, isSelected, onToggleExpand, onToggleSelect, onToggleStatus, onUnbind, onResetPassword, onUpdateBaseSalary }) {
  const totalCols = isAdmin ? 9 : 8;
  const [editingSalary, setEditingSalary] = useState(false);
  const [salaryInput, setSalaryInput] = useState('');
  const salaryInputRef = useRef(null);

  return (
    <>
      <tr
        className={`group transition-colors cursor-pointer ${isExpanded ? 'bg-surface-container-low' : 'hover:bg-[#FAFBFC]'}`}
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
              className="w-4 h-4 rounded border-2 border-[#c6c5d6] checked:bg-[#434fcf] checked:border-[#434fcf] cursor-pointer accent-[#434fcf] transition-colors"
            />
          </td>
        )}
        <td className={isAdmin ? 'pl-2' : 'pl-6'}>
          <div className="flex items-center gap-3">
            <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
                style={{ background: getAvatarColor(emp.name || emp.wecom_userid || '') }}
              >
                {(emp.name || emp.wecom_userid || '?').substring(0, 2)}
              </div>
            <div>
              <div className="font-semibold text-slate-800">{emp.name}</div>
              <div className="text-[13px] text-slate-500 mt-0.5">{emp.wecom_userid}</div>
            </div>
            {/* Expand indicator */}
            <svg className={`w-4 h-4 text-slate-300 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </div>
        </td>
        <td><span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${ROW_BADGE_CLASSES[ROLE_CLASS_MAP[emp.role]] || ROW_BADGE_CLASSES.secondary}`}>{ROLE_MAP[emp.role] || emp.role}</span></td>
        <td className="hidden lg:table-cell">
          {emp.username ? (
            <code className="text-[13px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">{emp.username}</code>
          ) : (
            <span className="text-slate-400">-</span>
          )}
        </td>
        <td className="hidden xl:table-cell font-mono text-[13px] text-slate-600">
          <span title={emp.machine_id}>{emp.machine_id ? emp.machine_id.substring(0, 16) + '...' : '未绑定'}</span>
        </td>
        <td className="hidden md:table-cell">
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
            <button onClick={onResetPassword} className="p-1.5 rounded transition-colors text-brand-500 hover:text-brand-600 hover:bg-brand-50 cursor-pointer" title="重置密码">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            </button>
            <button onClick={onUnbind} disabled={!emp.machine_id} className={`p-1.5 rounded transition-colors ${emp.machine_id ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50 cursor-pointer' : 'text-slate-300'}`} title="解绑设备">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
            </button>
          </div>
        </td>
      </tr>
      {/* Feature B: Expanded detail row */}
      {isExpanded && (
        <tr className="bg-surface-container-low">
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
                {/* 底薪 (inline edit) */}
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 text-slate-400 shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] text-slate-400 font-medium mb-0.5">底薪</div>
                    {editingSalary ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={salaryInputRef}
                          type="number"
                          min="0"
                          step="0.01"
                          value={salaryInput}
                          onChange={(e) => setSalaryInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = parseFloat(salaryInput);
                              if (!isNaN(val) && val >= 0) {
                                onUpdateBaseSalary(emp.id, val);
                                setEditingSalary(false);
                              }
                            } else if (e.key === 'Escape') {
                              setEditingSalary(false);
                            }
                          }}
                          className="w-24 px-2 py-1 text-[13px] border border-brand-300 rounded-lg outline-none focus:ring-2 focus:ring-brand-500/20"
                          autoFocus
                        />
                        <span className="text-[12px] text-slate-400">元</span>
                        <button
                          onClick={() => {
                            const val = parseFloat(salaryInput);
                            if (!isNaN(val) && val >= 0) {
                              onUpdateBaseSalary(emp.id, val);
                              setEditingSalary(false);
                            }
                          }}
                          className="text-[11px] text-brand-500 hover:text-brand-600 font-semibold"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditingSalary(false)}
                          className="text-[11px] text-slate-400 hover:text-slate-600 font-semibold"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] text-slate-700 font-medium">
                          {emp.base_salary ? (emp.base_salary / 100).toFixed(2) + ' 元' : '未设置'}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSalaryInput(emp.base_salary ? (emp.base_salary / 100).toFixed(2) : '');
                              setEditingSalary(true);
                            }}
                            className="text-[11px] text-brand-500 hover:text-brand-600 font-semibold"
                          >
                            编辑
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
});

const DetailItem = memo(function DetailItem({ label, value, mono, icon }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 text-slate-400 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[12px] text-slate-400 font-medium mb-0.5">{label}</div>
        <div className={`text-[13px] text-slate-700 break-all ${mono ? 'font-mono' : ''}`}>{value}</div>
      </div>
    </div>
  );
});
