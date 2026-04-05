import { useState, useEffect, useCallback } from 'react';
import { createContactWay, listContactWays, listEmployees } from '../api/admin';
import { useToast } from '../hooks/useToast';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import EmptyState from '../components/EmptyState';
import { formatTime } from '../utils/constants';
import {
  Plus,
  QrCode,
  Users,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Tag,
  X,
  ImageOff,
  Loader2,
  UserCheck,
} from 'lucide-react';

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

  const roleLabel = (role) =>
    role === 'sales' ? '谈单' : role === 'follow' ? '跟单' : '管理';

  return (
    <div className="space-y-6">
      <PageHeader title="联系我管理" subtitle="创建和管理企微「联系我」二维码渠道">
        <Button onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />
          新建联系我
        </Button>
      </PageHeader>

      {/* ── Modal Overlay ── */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setSelectedUserIDs([]); setState(''); } }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" style={{ animation: 'fadeInUp 0.2s ease both' }} />

          {/* Dialog */}
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.12)] border border-black/[0.06] animate-modal-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800 font-[Outfit]">新建联系我</h2>
                <p className="text-sm text-slate-500 mt-0.5">选择接待员工，生成专属二维码</p>
              </div>
              <button
                onClick={() => { setShowForm(false); setSelectedUserIDs([]); setState(''); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
              {/* Channel identifier */}
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <Tag className="w-3.5 h-3.5 text-slate-400" />
                  渠道标识
                  <span className="text-xs font-normal text-slate-400 ml-1">可选</span>
                </label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="如: 官网、公众号、海报..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                />
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  用于区分不同渠道来源，客户添加时会带上此标识
                </p>
              </div>

              {/* Employee Selection */}
              <div>
                <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                  <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                  接待员工
                  <span className="text-red-400 text-xs">*</span>
                </label>
                {employees.length === 0 ? (
                  <div className="flex items-center justify-center py-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                    <p className="text-sm text-slate-400">暂无可选员工</p>
                  </div>
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
                            className={`group relative px-3.5 py-2 rounded-xl text-sm font-medium border transition-all duration-150 cursor-pointer ${
                              selected
                                ? 'bg-[#434FCF] text-white border-[#434FCF] shadow-[0_2px_8px_rgba(67,79,207,0.25)]'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-[#434FCF]/30 hover:shadow-[0_2px_8px_rgba(67,79,207,0.06)]'
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className={`flex items-center justify-center w-4 h-4 rounded-md border transition-all ${
                                selected
                                  ? 'bg-white/20 border-white/40'
                                  : 'border-slate-300 group-hover:border-[#434FCF]/40'
                              }`}>
                                {selected && <Check className="w-3 h-3" />}
                              </span>
                              {emp.name}
                              <span className={`text-xs ${selected ? 'text-white/60' : 'text-slate-400'}`}>
                                {roleLabel(emp.role)}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
                {selectedUserIDs.length > 0 && (
                  <p className="text-xs text-[#434FCF]/70 mt-2 flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    已选 {selectedUserIDs.length} 人，客户会随机分配给其中一人
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
              <Button variant="secondary" onClick={() => { setShowForm(false); setSelectedUserIDs([]); setState(''); }}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={submitting || selectedUserIDs.length === 0}>
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? '创建中...' : '创建渠道'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-10 h-10 rounded-full border-[3px] border-slate-200 border-t-[#434FCF] animate-spin" />
          <p className="text-sm text-slate-400 mt-4">加载中...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <EmptyState
            icon={<QrCode className="w-12 h-12 text-slate-300 mb-3" strokeWidth={1.5} />}
            title="暂无联系我渠道"
            description="创建二维码渠道，客户扫码即可添加企微好友"
          />
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" />
            创建第一个渠道
          </Button>
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <QrCode className="w-4 h-4 text-slate-400" />
            共 <span className="font-semibold text-slate-700">{items.length}</span> 个渠道
          </div>

          {/* Card Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="group bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 transition-all duration-200"
                style={{ animation: `fadeInUp 0.35s cubic-bezier(0.16,1,0.3,1) ${idx * 0.05}s both` }}
              >
                <div className="p-5">
                  {/* Top row: channel name + badge */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-800 font-[Outfit] tracking-tight truncate">
                        {item.state || '默认渠道'}
                      </h3>
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-slate-100 text-[11px] text-slate-500 font-mono leading-relaxed">
                        {item.config_id}
                      </span>
                    </div>
                    {/* Status dot */}
                    <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-100">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[11px] font-semibold text-emerald-600">活跃</span>
                    </div>
                  </div>

                  {/* QR Code area */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="shrink-0">
                      {item.qr_code ? (
                        <a href={item.qr_code} target="_blank" rel="noopener noreferrer" className="block">
                          <div className="w-[72px] h-[72px] rounded-xl border border-black/[0.06] bg-white p-1.5 shadow-[0_1px_4px_rgba(0,0,0,0.04)] group-hover:shadow-[0_4px_12px_rgba(67,79,207,0.08)] transition-shadow">
                            <img
                              src={item.qr_code}
                              alt="二维码"
                              className="w-full h-full object-contain rounded-lg"
                            />
                          </div>
                        </a>
                      ) : (
                        <div className="w-[72px] h-[72px] rounded-xl border border-dashed border-slate-200 flex items-center justify-center bg-slate-50/80">
                          <ImageOff className="w-5 h-5 text-slate-300" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{(item.user_names || []).join(', ') || '-'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>{formatTime(item.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-2">
                      {item.qr_code && (
                        <button
                          onClick={() => copyToClipboard(item.qr_code, item.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer ${
                            copiedId === item.id
                              ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
                              : 'text-[#434FCF] bg-[#434FCF]/[0.04] hover:bg-[#434FCF]/[0.08] border border-[#434FCF]/10 hover:border-[#434FCF]/20'
                          }`}
                        >
                          {copiedId === item.id ? (
                            <><Check className="w-3.5 h-3.5" /> 已复制</>
                          ) : (
                            <><Copy className="w-3.5 h-3.5" /> 复制链接</>
                          )}
                        </button>
                      )}
                      {item.qr_code && (
                        <a
                          href={item.qr_code}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 transition-all duration-150"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          查看
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
