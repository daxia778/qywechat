import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { listPendingMatchOrders, matchOrderContact } from '../api/orders';
import { useToast } from '../hooks/useToast';

const formatPrice = (price) => {
  if (!price) return '0.00';
  return (price / 100).toFixed(2);
};

const formatTime = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${min}`;
};

export default function OrderMatchModal({ visible, contactInfo, onClose, onMatched }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(null);
  const [search, setSearch] = useState('');
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);
  const generatedId = useId();
  const titleId = `match-modal-title-${generatedId}`;

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listPendingMatchOrders();
      setOrders(res.data?.data || []);
    } catch (err) {
      toast('获取待匹配订单失败: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (visible) {
      fetchOrders();
      setSearch('');
      previousActiveElement.current = document.activeElement;
      const timer = setTimeout(() => modalRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [visible, fetchOrders]);

  // Focus trap + Escape
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElement.current?.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [visible, onClose]);

  const handleMatch = async (order) => {
    if (!contactInfo?.external_user_id) return;
    setMatching(order.id);
    try {
      await matchOrderContact(order.id, {
        external_user_id: contactInfo.external_user_id,
        nickname: contactInfo.nickname || '',
      });
      toast(`订单 ${order.order_sn} 已成功关联好友`, 'success');
      onMatched?.();
      onClose();
    } catch (err) {
      toast('关联失败: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setMatching(null);
    }
  };

  if (!visible) return null;

  const keyword = search.trim().toLowerCase();
  const filtered = keyword
    ? orders.filter((o) => {
        const sn = (o.order_sn || '').toLowerCase();
        const contact = (o.customer_contact || '').toLowerCase();
        const mobile = (o.customer_mobile || '').toLowerCase();
        const wechat = (o.customer_wechat_id || '').toLowerCase();
        const topic = (o.topic || '').toLowerCase();
        return sn.includes(keyword) || contact.includes(keyword) || mobile.includes(keyword) || wechat.includes(keyword) || topic.includes(keyword);
      })
    : orders;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={modalRef}
      tabIndex={-1}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div>
                <h3 id={titleId} className="text-lg font-bold text-slate-800">匹配好友订单</h3>
                <p className="text-sm text-slate-500 mt-0.5">将新添加的好友关联到对应的待匹配订单</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="关闭"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Contact info card */}
          {contactInfo && (
            <div className="bg-gradient-to-r from-brand-50 to-indigo-50 rounded-xl p-4 mb-4">
              <div className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-2">新好友信息</div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-brand-500 font-bold text-lg">
                  {(contactInfo.nickname || '?')[0]}
                </div>
                <div>
                  <div className="font-semibold text-slate-800 text-[15px]">{contactInfo.nickname || '未知昵称'}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">{contactInfo.external_user_id}</div>
                </div>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="text"
              placeholder="搜索订单号 / 联系方式 / 主题..."
              aria-label="搜索待匹配订单"
              className="w-full px-4 py-2.5 pl-10 text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl outline-none transition-all duration-150 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 focus:bg-white"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Order list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <svg className="w-8 h-8 animate-spin text-brand-400 mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm font-medium">加载中...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <p className="font-medium text-slate-500">暂无待匹配订单</p>
              <p className="text-sm mt-1">{keyword ? '没有匹配搜索条件的订单' : '所有 PENDING 订单都已关联好友'}</p>
            </div>
          ) : (
            filtered.map((order) => (
              <div
                key={order.id}
                className="group bg-white border border-slate-200 rounded-xl p-4 hover:border-brand-300 hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-brand-500 text-[14px]">{order.order_sn}</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200">
                        待匹配
                      </span>
                    </div>
                    {order.topic && (
                      <div className="text-sm text-slate-600 mb-2 truncate" title={order.topic}>{order.topic}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {order.customer_contact && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          {order.customer_contact}
                        </span>
                      )}
                      {order.customer_mobile && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          {order.customer_mobile}
                        </span>
                      )}
                      {order.customer_wechat_id && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.328.328 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM12.598 5.8a1 1 0 110 2 1 1 0 010-2zm-5.77 0a1 1 0 110 2 1 1 0 010-2z" />
                          </svg>
                          {order.customer_wechat_id}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatTime(order.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="text-lg font-bold text-slate-800 tabular-nums">&yen;{formatPrice(order.price)}</div>
                    <button
                      onClick={() => handleMatch(order)}
                      disabled={matching === order.id}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-all duration-150 cursor-pointer border-none shadow-sm active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {matching === order.id ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          关联中...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                          </svg>
                          关联此订单
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 shrink-0 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {filtered.length > 0 ? `共 ${filtered.length} 条待匹配订单` : ''}
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
