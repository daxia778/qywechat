import { useState, useEffect, useCallback } from 'react';
import { createContactWay, listContactWays, listEmployees } from '../api/admin';
import { useToast } from '../hooks/useToast';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import EmptyState from '../components/EmptyState';
import { formatTime } from '../utils/constants';

export default function ContactWaysPage() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [selectedUserIDs, setSelectedUserIDs] = useState([]);
  const [state, setState] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listContactWays();
      setItems(res.data?.items || []);
    } catch (err) {
      toast(err.displayMessage || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await listEmployees();
      setEmployees(res.data?.data || res.data || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchList();
    fetchEmployees();
  }, [fetchList, fetchEmployees]);

  const handleCreate = async () => {
    if (selectedUserIDs.length === 0) {
      toast('请至少选择一名员工', 'warning');
      return;
    }
    try {
      setSubmitting(true);
      await createContactWay({ user_ids: selectedUserIDs, state });
      toast('联系我创建成功', 'success');
      setShowForm(false);
      setSelectedUserIDs([]);
      setState('');
      fetchList();
    } catch (err) {
      toast(err.displayMessage || '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUser = (uid) => {
    setSelectedUserIDs((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  };

  const copyToClipboard = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast('已复制到剪贴板', 'success');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="联系我管理" subtitle="创建和管理企微「联系我」二维码渠道">
        <Button onClick={() => setShowForm(!showForm)}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          新建联系我
        </Button>
      </PageHeader>

      {/* Create Form */}
      {showForm && (
        <Card>
          <CardHeader title="新建联系我" subtitle="选择接待员工，生成专属二维码" />
          <div className="p-5 lg:p-7 space-y-5">
            {/* State / Channel */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                渠道标识 (可选)
              </label>
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="如: 官网、公众号、海报..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#434FCF]/20 focus:border-[#434FCF] transition-all"
              />
              <p className="text-xs text-slate-400 mt-1">用于区分不同渠道来源，客户添加时会带上此标识</p>
            </div>

            {/* Employee Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                接待员工 <span className="text-red-500">*</span>
              </label>
              {employees.length === 0 ? (
                <p className="text-sm text-slate-400">暂无可选员工</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {employees
                    .filter((e) => e.is_active)
                    .map((emp) => {
                      const selected = selectedUserIDs.includes(emp.wecom_userid);
                      return (
                        <button
                          key={emp.wecom_userid}
                          type="button"
                          onClick={() => toggleUser(emp.wecom_userid)}
                          className={`px-3.5 py-2 rounded-xl text-sm font-medium border transition-all ${
                            selected
                              ? 'bg-[#434FCF] text-white border-[#434FCF] shadow-[0_2px_8px_rgba(67,79,207,0.25)]'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-[#434FCF]/40 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {selected && (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {emp.name}
                            <span className="text-xs opacity-60">
                              {emp.role === 'sales' ? '谈单' : emp.role === 'follow' ? '跟单' : '管理'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              {selectedUserIDs.length > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  已选 {selectedUserIDs.length} 人，客户会随机分配给其中一人
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleCreate} disabled={submitting || selectedUserIDs.length === 0}>
                {submitting ? '创建中...' : '创建'}
              </Button>
              <Button variant="secondary" onClick={() => { setShowForm(false); setSelectedUserIDs([]); setState(''); }}>
                取消
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* List */}
      <Card>
        <CardHeader title="已创建的联系我" subtitle={`共 ${items.length} 个渠道`} />
        <div className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full border-[3px] border-slate-200 border-t-[#434FCF] animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="暂无联系我渠道"
              description="点击上方「新建联系我」按钮创建二维码渠道"
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-5 px-5 lg:px-7 py-5 hover:bg-slate-50/50 transition-colors">
                  {/* QR Code */}
                  <div className="shrink-0">
                    {item.qr_code ? (
                      <a href={item.qr_code} target="_blank" rel="noopener noreferrer">
                        <img
                          src={item.qr_code}
                          alt="二维码"
                          className="w-20 h-20 rounded-xl border border-slate-200 object-contain bg-white p-1 hover:shadow-md transition-shadow"
                        />
                      </a>
                    ) : (
                      <div className="w-20 h-20 rounded-xl border border-dashed border-slate-200 flex items-center justify-center bg-slate-50">
                        <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800">
                        {item.state || '默认渠道'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-xs text-slate-500 font-mono">
                        {item.config_id}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        {(item.user_names || []).join(', ') || '-'}
                      </span>
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatTime(item.created_at)}
                      </span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      {item.qr_code && (
                        <button
                          onClick={() => copyToClipboard(item.qr_code, item.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[#434FCF] bg-[#434FCF]/5 hover:bg-[#434FCF]/10 border border-[#434FCF]/10 transition-all"
                        >
                          {copiedId === item.id ? (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              </svg>
                              已复制
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                              </svg>
                              复制链接
                            </>
                          )}
                        </button>
                      )}
                      {item.qr_code && (
                        <a
                          href={item.qr_code}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          查看二维码
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
