import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { useDebounce } from '../hooks/useDebounce';
import { listCustomers, getCustomerDetail, updateCustomer } from '../api/customers';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatTime } from '../utils/formatters';
import LoadingSpinner from '../components/LoadingSpinner';

export default function CustomersPage() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState(searchParams.get('keyword') || '');
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 50;
  const debouncedKeyword = useDebounce(searchKeyword, 300);

  const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));

  // Slide-over state
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editRemark, setEditRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchCustomers = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    try {
      const params = { limit: pageSize, offset: currentPage * pageSize };
      if (debouncedKeyword.trim()) params.keyword = debouncedKeyword.trim();
      const res = await listCustomers(params);
      setCustomers(res.data.data || []);
      setTotalCustomers(res.data.total || 0);
      if (manual) toast('顾客数据已刷新', 'success');
    } catch (err) {
      if (manual) toast('获取顾客失败: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedKeyword, toast]);

  useEffect(() => {
    fetchCustomers();
  }, [currentPage, debouncedKeyword, fetchCustomers]);

  // Reset page and sync URL when debounced keyword changes
  useEffect(() => {
    setCurrentPage(0);
    if (debouncedKeyword.trim()) {
      setSearchParams({ keyword: debouncedKeyword.trim() }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [debouncedKeyword, setSearchParams]);

  // Load detail when a customer is selected
  useEffect(() => {
    if (!selectedCustomerId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const loadDetail = async () => {
      setDetailLoading(true);
      try {
        const res = await getCustomerDetail(selectedCustomerId);
        if (!cancelled) {
          const d = res.data;
          setDetail(d);
          setEditNickname(d.customer?.nickname || '');
          setEditRemark(d.customer?.remark || '');
        }
      } catch (err) {
        if (!cancelled) {
          toast('获取顾客详情失败: ' + (err.response?.data?.error || err.message), 'error');
          setSelectedCustomerId(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    loadDetail();
    return () => { cancelled = true; };
  }, [selectedCustomerId, toast]);

  const handleSave = async () => {
    if (!selectedCustomerId) return;
    setSaving(true);
    try {
      await updateCustomer(selectedCustomerId, {
        nickname: editNickname,
        remark: editRemark,
      });
      toast('顾客信息已更新', 'success');
      // Refresh list to reflect changes
      fetchCustomers();
      // Refresh detail
      const res = await getCustomerDetail(selectedCustomerId);
      setDetail(res.data);
    } catch (err) {
      toast('保存失败: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  const closePanel = () => setSelectedCustomerId(null);

  const customer = detail?.customer;
  const orders = detail?.orders || [];
  const stats = detail?.stats || {};

  return (
    <div className="flex flex-col gap-5 w-full max-w-[1400px] mx-auto">
      {/* Title */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-extrabold text-slate-800 font-[Outfit] tracking-tight">顾客管理</h1>
          <p className="text-sm text-slate-500 mt-1">查看顾客画像与消费历史</p>
        </div>
        <button onClick={() => fetchCustomers(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm active:scale-[0.98]" disabled={loading}>
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <span>{loading ? '同步中...' : '刷新'}</span>
        </button>
      </div>

      {/* Main Card */}
      <div className="bg-surface-container-lowest ghost-border rounded-xl flex flex-col overflow-hidden">
        {/* Search Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-brand-50">
              <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">顾客列表</h2>
          </div>
          <div className="relative w-64">
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              type="text"
              placeholder="搜索微信号/手机号/昵称..."
              aria-label="搜索顾客"
              className="w-full px-4 py-1.5 pl-9 text-[13px] text-slate-800 bg-white border border-slate-200 rounded-lg outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto relative min-h-[450px]">
          {loading && customers.length === 0 && <LoadingSpinner />}
          <table>
            <thead>
              <tr>
                <th className="pl-6">顾客</th>
                <th>微信号</th>
                <th>手机号</th>
                <th>历史订单</th>
                <th>累计消费</th>
                <th className="text-right pr-6">最近下单</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 && !loading && (
                <tr>
                  <td colSpan="6" className="py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <p className="font-medium text-slate-600">暂无顾客</p>
                      <p className="text-sm mt-0.5">当前没有匹配的顾客数据。</p>
                    </div>
                  </td>
                </tr>
              )}
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="group transition-colors hover:bg-[#FAFBFC] cursor-pointer"
                  onClick={() => setSelectedCustomerId(c.id)}
                >
                  <td className="pl-6">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 bg-brand-500">
                        {(c.nickname || c.customer_contact || '?').substring(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 text-[13px]">{c.nickname || c.customer_contact || '-'}</span>
                          {c.total_orders > 1 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-500">复购</span>
                          )}
                        </div>
                        {c.nickname && c.customer_contact && c.nickname !== c.customer_contact && (
                          <div className="text-[12px] text-slate-400 mt-0.5">{c.customer_contact}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-[13px] text-slate-700 font-medium font-mono">{c.wechat_id || '-'}</td>
                  <td className="text-[13px] text-slate-700 font-medium tabular-nums">{c.mobile || '-'}</td>
                  <td>
                    <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-[12px] font-bold bg-slate-100 text-slate-600 tabular-nums">{c.total_orders || 0}</span>
                  </td>
                  <td className="text-[14px] font-bold text-slate-800 tabular-nums">&yen;{c.total_spent ? (c.total_spent / 100).toFixed(2) : '0.00'}</td>
                  <td className="text-right pr-6">
                    <span className="text-[12px] text-slate-500 font-medium tabular-nums">{formatTime(c.last_order_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-surface-container-low px-6 py-3.5 border-t border-slate-200 flex justify-between items-center">
          <span className="text-[13px] font-medium text-slate-500">共 <span className="font-bold text-slate-700">{totalCustomers}</span> 位顾客</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { if (currentPage > 0) setCurrentPage(currentPage - 1); }} disabled={currentPage === 0} className={`inline-flex items-center justify-center gap-2 px-3 py-1 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm text-[12px] active:scale-[0.98] ${currentPage === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}>上一页</button>
            <span className="text-[13px] text-slate-500 font-medium px-3 tabular-nums">{currentPage + 1} / {totalPages}</span>
            <button onClick={() => { if (currentPage < totalPages - 1) setCurrentPage(currentPage + 1); }} disabled={currentPage >= totalPages - 1} className={`inline-flex items-center justify-center gap-2 px-3 py-1 text-sm font-semibold rounded-xl text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 cursor-pointer shadow-sm text-[12px] active:scale-[0.98] ${currentPage >= totalPages - 1 ? 'opacity-40 cursor-not-allowed' : ''}`}>下一页</button>
          </div>
        </div>
      </div>

      {/* Slide-over Detail Panel */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-[80]" onClick={closePanel}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity" />
          {/* Panel */}
          <div
            className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl flex flex-col animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel Header */}
            <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold bg-brand-500 shrink-0">
                  {(customer?.nickname || customer?.customer_contact || '?').substring(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800 font-[Outfit]">顾客详情</h3>
                  <p className="text-[13px] text-slate-500">{customer?.customer_contact || '-'}</p>
                </div>
              </div>
              <button onClick={closePanel} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors active:scale-[0.98]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-y-auto">
              {detailLoading ? (
                <div className="relative min-h-[300px]"><LoadingSpinner /></div>
              ) : detail ? (
                <div className="flex flex-col gap-5 p-6">
                  {/* Basic Info & Editable Fields */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50">
                      <h4 className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">基础信息</h4>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-[12px] font-semibold text-slate-400 mb-1">昵称</label>
                        <input
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          type="text"
                          placeholder="设置昵称..."
                          className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="block text-[12px] font-semibold text-slate-400 mb-1">联系方式</span>
                          <p className="text-sm font-medium text-slate-800">{customer?.customer_contact || '-'}</p>
                        </div>
                        <div>
                          <span className="block text-[12px] font-semibold text-slate-400 mb-1">微信号</span>
                          <p className="text-sm font-medium text-slate-800 font-mono">{customer?.wechat_id || '-'}</p>
                        </div>
                        <div>
                          <span className="block text-[12px] font-semibold text-slate-400 mb-1">手机号</span>
                          <p className="text-sm font-medium text-slate-800 tabular-nums">{customer?.mobile || '-'}</p>
                        </div>
                        <div>
                          <span className="block text-[12px] font-semibold text-slate-400 mb-1">复购状态</span>
                          {(customer?.total_orders || 0) > 1 ? (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-brand-50 text-brand-500">复购顾客</span>
                          ) : (
                            <span className="text-sm text-slate-500">新顾客</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[12px] font-semibold text-slate-400 mb-1">备注</label>
                        <textarea
                          value={editRemark}
                          onChange={(e) => setEditRemark(e.target.value)}
                          placeholder="添加备注信息..."
                          rows={3}
                          className="w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-200 rounded-lg outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 resize-none"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white bg-brand-500 hover:bg-brand-600 transition-all duration-150 cursor-pointer border-none shadow-sm active:scale-[0.98]"
                        >
                          {saving ? '保存中...' : '保存修改'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Consumption Stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-brand-50/50 rounded-xl p-4 text-center border border-brand-100 hover:border-[#434FCF]/20 transition-colors">
                      <p className="text-[11px] text-slate-500 mb-1 font-medium">总消费金额</p>
                      <p className="text-xl font-bold text-slate-800 font-[Outfit] tabular-nums">&yen;{stats.total_spent ? (stats.total_spent / 100).toFixed(2) : '0.00'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-100 hover:border-slate-200 transition-colors">
                      <p className="text-[11px] text-slate-500 mb-1 font-medium">平均单价</p>
                      <p className="text-xl font-bold text-slate-800 font-[Outfit] tabular-nums">&yen;{stats.avg_price ? (stats.avg_price / 100).toFixed(2) : '0.00'}</p>
                    </div>
                  </div>

                  {/* Order History */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <h4 className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">历史订单</h4>
                      <span className="text-[12px] text-slate-400 font-medium tabular-nums">{orders.length} 条</span>
                    </div>
                    {orders.length === 0 ? (
                      <div className="py-10 text-center text-sm text-slate-400">
                        <svg className="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        暂无订单记录
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {orders.map((o) => (
                          <Link
                            key={o.id}
                            to={`/orders/${o.id}`}
                            className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors group/order"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold text-brand-500 group-hover/order:underline">{o.order_sn}</span>
                                <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${BADGE_VARIANT_CLASSES[STATUS_BADGE_MAP[o.status]] || BADGE_VARIANT_CLASSES.secondary}`}>{STATUS_MAP[o.status] || o.status}</span>
                              </div>
                              <div className="text-[12px] text-slate-400 mt-0.5 tabular-nums">{formatTime(o.created_at)}</div>
                            </div>
                            <span className="text-[14px] font-bold text-slate-800 tabular-nums shrink-0 ml-4">&yen;{o.price ? (o.price / 100).toFixed(2) : '0.00'}</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
