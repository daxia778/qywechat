import { useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from '../hooks/useToast';
import { listEmployees, getExternalContacts, executeTransfer, getTransferRecords, checkTransferStatus, listTransferRules, createTransferRule, updateTransferRule, deleteTransferRule } from '../api/admin';
import { ROLE_MAP, formatTime } from '../utils/constants';
import ConfirmModal from '../components/ConfirmModal';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import LoadingSpinner from '../components/LoadingSpinner';

const TRANSFER_STATUS_MAP = {
  pending: { label: '等待中', variant: 'warning' },
  waiting: { label: '处理中', variant: 'primary' },
  success: { label: '已完成', variant: 'success' },
  failed: { label: '已失败', variant: 'danger' },
};

export default function CustomerTransferPage() {
  const { toast } = useToast();

  // Employee list
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Step 1: handover user
  const [handoverUserId, setHandoverUserId] = useState('');

  // Step 2: external contacts
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());

  // Step 3: takeover user
  const [takeoverUserId, setTakeoverUserId] = useState('');

  // Step 4: transfer message
  const [transferMsg, setTransferMsg] = useState('');

  // Submitting
  const [submitting, setSubmitting] = useState(false);

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', type: 'info', confirmText: '确认' });
  const confirmActionRef = useRef(null);

  // Records
  const [records, setRecords] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const PAGE_SIZE = 10;

  // Auto-transfer rules
  const [rules, setRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [ruleModal, setRuleModal] = useState({ show: false, editing: null });
  const [ruleForm, setRuleForm] = useState({ name: '', handover_user_id: '', takeover_user_id: '', trigger_days: 30, transfer_msg: '' });
  const [savingRule, setSavingRule] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState(null);

  // Filter employees: only sales/follow roles
  const transferableEmployees = employees.filter((e) => e.role === 'sales' || e.role === 'follow');
  const takeoverOptions = transferableEmployees.filter((e) => e.wecom_userid !== handoverUserId);

  // Fetch employees
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoadingEmployees(true);
      try {
        const res = await listEmployees({ signal: controller.signal });
        setEmployees(res.data.data || []);
      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') return;
        console.error('Failed to fetch employees:', err);
      } finally {
        setLoadingEmployees(false);
      }
    })();
    return () => controller.abort();
  }, []);

  // Fetch external contacts when handover user changes
  useEffect(() => {
    if (!handoverUserId) {
      setContacts([]);
      setSelectedContactIds(new Set());
      return;
    }
    const controller = new AbortController();
    (async () => {
      setLoadingContacts(true);
      setSelectedContactIds(new Set());
      try {
        const res = await getExternalContacts(handoverUserId);
        setContacts(res.data.data || []);
      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') return;
        toast('获取外部联系人失败: ' + (err.displayMessage || err.message), 'error');
        setContacts([]);
      } finally {
        setLoadingContacts(false);
      }
    })();
    return () => controller.abort();
  }, [handoverUserId, toast]);

  // Fetch records
  const fetchRecords = useCallback(async (page = 1) => {
    setLoadingRecords(true);
    try {
      const res = await getTransferRecords({ page, page_size: PAGE_SIZE });
      setRecords(res.data.data || []);
      setRecordsTotal(res.data.total || 0);
      setRecordsPage(page);
    } catch (err) {
      toast('获取转移记录失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setLoadingRecords(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRecords(1);
  }, [fetchRecords]);

  // Fetch rules
  const fetchRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const res = await listTransferRules();
      setRules(res.data.data?.data || []);
    } catch (err) {
      toast('获取自动转接规则失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setLoadingRules(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Rule modal helpers
  const openRuleModal = (rule = null) => {
    if (rule) {
      setRuleForm({
        name: rule.name || '',
        handover_user_id: rule.handover_user_id || '',
        takeover_user_id: rule.takeover_user_id || '',
        trigger_days: rule.trigger_days || 30,
        transfer_msg: rule.transfer_msg || '',
      });
      setRuleModal({ show: true, editing: rule });
    } else {
      setRuleForm({ name: '', handover_user_id: '', takeover_user_id: '', trigger_days: 30, transfer_msg: '' });
      setRuleModal({ show: true, editing: null });
    }
  };

  const handleSaveRule = async () => {
    if (!ruleForm.name.trim()) return toast('请输入规则名称', 'error');
    if (!ruleForm.takeover_user_id) return toast('请选择接手人', 'error');
    if (ruleForm.handover_user_id && ruleForm.handover_user_id === ruleForm.takeover_user_id) {
      return toast('原跟进人和接手人不能是同一人', 'error');
    }

    setSavingRule(true);
    try {
      if (ruleModal.editing) {
        await updateTransferRule(ruleModal.editing.id, ruleForm);
        toast('规则已更新', 'success');
      } else {
        await createTransferRule(ruleForm);
        toast('规则已创建', 'success');
      }
      setRuleModal({ show: false, editing: null });
      fetchRules();
    } catch (err) {
      toast('保存规则失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setSavingRule(false);
    }
  };

  const handleToggleRule = async (rule) => {
    setTogglingRuleId(rule.id);
    try {
      await updateTransferRule(rule.id, { is_active: !rule.is_active });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: !r.is_active } : r));
    } catch (err) {
      toast('切换状态失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setTogglingRuleId(null);
    }
  };

  const handleDeleteRule = (rule) => {
    showConfirm({
      title: '删除规则',
      message: `确定删除规则「${rule.name}」吗？此操作不可撤销。`,
      type: 'danger',
      confirmText: '确认删除',
    }, async () => {
      try {
        await deleteTransferRule(rule.id);
        toast('规则已删除', 'success');
        fetchRules();
      } catch (err) {
        toast('删除失败: ' + (err.displayMessage || err.message), 'error');
      }
    });
  };

  // Contact selection
  const toggleContact = (id) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllContacts = () => {
    if (selectedContactIds.size === contacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(contacts.map((c) => c.external_userid)));
    }
  };

  // Confirm modal helpers
  const showConfirm = (opts, action) => {
    confirmActionRef.current = action;
    setConfirmModal({ show: true, ...opts });
  };

  const onConfirmAction = () => {
    setConfirmModal((m) => ({ ...m, show: false }));
    confirmActionRef.current?.();
  };

  // Submit transfer
  const handleSubmit = () => {
    if (!handoverUserId) return toast('请选择原跟进人', 'error');
    if (selectedContactIds.size === 0) return toast('请选择要转移的客户', 'error');
    if (!takeoverUserId) return toast('请选择接手人', 'error');

    const handoverName = transferableEmployees.find((e) => e.wecom_userid === handoverUserId)?.name || handoverUserId;
    const takeoverName = takeoverOptions.find((e) => e.wecom_userid === takeoverUserId)?.name || takeoverUserId;

    showConfirm({
      title: '确认客户转接',
      message: `将 ${handoverName} 的 ${selectedContactIds.size} 位客户转接给 ${takeoverName}，确定执行吗？`,
      type: 'warning',
      confirmText: '确认转接',
    }, async () => {
      setSubmitting(true);
      try {
        const res = await executeTransfer({
          handover_user_id: handoverUserId,
          takeover_user_id: takeoverUserId,
          external_user_ids: [...selectedContactIds],
          transfer_msg: transferMsg || undefined,
        });
        toast(res.data.message || '转接任务已提交', 'success');
        // Reset form
        setHandoverUserId('');
        setTakeoverUserId('');
        setSelectedContactIds(new Set());
        setTransferMsg('');
        setContacts([]);
        // Refresh records
        fetchRecords(1);
      } catch (err) {
        toast('转接失败: ' + (err.displayMessage || err.message), 'error');
      } finally {
        setSubmitting(false);
      }
    });
  };

  // Refresh status
  const handleRefreshStatus = async () => {
    setRefreshingStatus(true);
    try {
      // Find unique handover/takeover pairs from current records
      const pairs = new Set();
      records.forEach((r) => {
        if (r.status === 'pending' || r.status === 'waiting') {
          pairs.add(JSON.stringify({ handover_user_id: r.handover_userid, takeover_user_id: r.takeover_userid }));
        }
      });
      for (const pairStr of pairs) {
        await checkTransferStatus(JSON.parse(pairStr));
      }
      await fetchRecords(recordsPage);
      toast('状态已刷新', 'success');
    } catch (err) {
      toast('刷新状态失败: ' + (err.displayMessage || err.message), 'error');
    } finally {
      setRefreshingStatus(false);
    }
  };

  const totalPages = Math.ceil(recordsTotal / PAGE_SIZE);

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

      <PageHeader title="客户转接" subtitle="在职继承 - 将客户从一位员工转移给另一位" />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Left: Transfer Form */}
        <Card>
          <CardHeader title="发起转移">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
              <span>选择员工和客户</span>
            </div>
          </CardHeader>
          <div className="p-5 lg:p-7 space-y-6">

            {/* Step 1: Handover User */}
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <StepBadge n={1} />
                选择原跟进人
              </label>
              <div className="relative">
                <select
                  value={handoverUserId}
                  onChange={(e) => {
                    setHandoverUserId(e.target.value);
                    setTakeoverUserId('');
                  }}
                  disabled={loadingEmployees}
                  className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 appearance-none font-medium disabled:opacity-50"
                >
                  <option value="">-- 请选择 --</option>
                  {transferableEmployees.map((emp) => (
                    <option key={emp.wecom_userid} value={emp.wecom_userid}>
                      {emp.name} ({ROLE_MAP[emp.role] || emp.role})
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </div>

            {/* Step 2: Contact List */}
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <StepBadge n={2} />
                选择要转移的客户
                {contacts.length > 0 && (
                  <span className="text-xs font-normal text-slate-400 ml-1">
                    (共 {contacts.length} 位，已选 {selectedContactIds.size} 位)
                  </span>
                )}
              </label>

              {!handoverUserId ? (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-8 text-center text-sm text-slate-400">
                  请先选择原跟进人
                </div>
              ) : loadingContacts ? (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-8 flex justify-center">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-8 text-center text-sm text-slate-400">
                  该员工暂无外部联系人
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  {/* Select all header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                    <input
                      type="checkbox"
                      checked={selectedContactIds.size === contacts.length && contacts.length > 0}
                      onChange={toggleAllContacts}
                      className="w-4 h-4 rounded border-2 border-[#c6c5d6] checked:bg-[#434fcf] checked:border-[#434fcf] cursor-pointer accent-[#434fcf] transition-colors"
                    />
                    <span className="text-xs font-semibold text-slate-500">全选</span>
                  </div>
                  {/* Contact list with scroll */}
                  <div className="max-h-[280px] overflow-y-auto divide-y divide-slate-100">
                    {contacts.map((c) => (
                      <label
                        key={c.external_userid}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedContactIds.has(c.external_userid)}
                          onChange={() => toggleContact(c.external_userid)}
                          className="w-4 h-4 rounded border-2 border-[#c6c5d6] checked:bg-[#434fcf] checked:border-[#434fcf] cursor-pointer accent-[#434fcf] transition-colors shrink-0"
                        />
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-violet-500 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                          {(c.name || '?').substring(0, 1)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{c.name || '未知客户'}</div>
                          {c.corp_name && (
                            <div className="text-xs text-slate-400 truncate">{c.corp_name}</div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Step 3: Takeover User */}
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <StepBadge n={3} />
                选择接手人
              </label>
              <div className="relative">
                <select
                  value={takeoverUserId}
                  onChange={(e) => setTakeoverUserId(e.target.value)}
                  disabled={!handoverUserId}
                  className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 appearance-none font-medium disabled:opacity-50"
                >
                  <option value="">-- 请选择 --</option>
                  {takeoverOptions.map((emp) => (
                    <option key={emp.wecom_userid} value={emp.wecom_userid}>
                      {emp.name} ({ROLE_MAP[emp.role] || emp.role})
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </div>

            {/* Step 4: Transfer Message */}
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <StepBadge n={4} />
                转移提示语
                <span className="text-xs font-normal text-slate-400">(选填)</span>
              </label>
              <textarea
                value={transferMsg}
                onChange={(e) => setTransferMsg(e.target.value)}
                placeholder="您好，您的服务将由新同事接手"
                rows={2}
                className="w-full px-4 py-2.5 text-sm text-slate-800 bg-white border border-slate-200 rounded-xl outline-none transition-all duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 resize-none placeholder:text-slate-400"
              />
            </div>

            {/* Submit */}
            <div className="pt-2">
              <Button
                variant="primary"
                className="w-full"
                disabled={submitting || !handoverUserId || selectedContactIds.size === 0 || !takeoverUserId}
                onClick={handleSubmit}
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
                    确认转接 ({selectedContactIds.size} 位客户)
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>

        {/* Right: Transfer Records */}
        <Card>
          <CardHeader title="转移记录">
            <Button
              variant="secondary"
              size="sm"
              disabled={refreshingStatus}
              onClick={handleRefreshStatus}
            >
              <svg className={`w-3.5 h-3.5 ${refreshingStatus ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              刷新状态
            </Button>
          </CardHeader>

          <div className="relative min-h-[300px]">
            {loadingRecords && <LoadingSpinner />}

            {!loadingRecords && records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="font-medium text-slate-500">暂无转移记录</p>
                <p className="text-sm mt-0.5">转接客户后，记录将显示在这里</p>
              </div>
            ) : (
              <>
                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <colgroup>
                      <col style={{ width: '25%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '17%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="text-left pl-5">时间</th>
                        <th className="text-left">原跟进人</th>
                        <th className="text-left">接手人</th>
                        <th className="text-left">客户名称</th>
                        <th className="text-left">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r, i) => {
                        const statusInfo = TRANSFER_STATUS_MAP[r.status] || TRANSFER_STATUS_MAP.pending;
                        return (
                          <tr key={r.id || i} className="hover:bg-[#FAFBFC] transition-colors">
                            <td className="pl-5 text-[13px] text-slate-600">{formatTime(r.created_at)}</td>
                            <td className="text-[13px] text-slate-800 font-medium">{r.handover_name || r.handover_userid || '-'}</td>
                            <td className="text-[13px] text-slate-800 font-medium">{r.takeover_name || r.takeover_userid || '-'}</td>
                            <td className="text-[13px] text-slate-600 truncate max-w-[160px]">{r.customer_name || r.external_userid || '-'}</td>
                            <td>
                              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                    <span className="text-xs text-slate-400">
                      共 {recordsTotal} 条
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => fetchRecords(recordsPage - 1)}
                        disabled={recordsPage <= 1}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <span className="text-xs text-slate-500 px-2">
                        {recordsPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => fetchRecords(recordsPage + 1)}
                        disabled={recordsPage >= totalPages}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StepBadge({ n }) {
  return (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-brand-500 text-white text-[11px] font-bold shrink-0">
      {n}
    </span>
  );
}

function SelectChevron() {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
