import { useState, useEffect, useRef } from 'react';
import { searchDesignersUnified } from '../api/orders';

const SOURCE_BADGE = {
  roster:   { bg: 'bg-blue-50',   text: 'text-blue-600',   border: 'border-blue-200',   label: '花名册' },
  team:     { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', label: '团队' },
  contacts: { bg: 'bg-amber-50',  text: 'text-amber-600',  border: 'border-amber-200',  label: '外部联系人' },
};

const SOURCE_TABS = [
  { key: 'all',      label: '全部' },
  { key: 'roster',   label: '花名册' },
  { key: 'team',     label: '企微团队' },
  { key: 'contacts', label: '外部联系人' },
];

const ROLE_NAME = { admin: '管理员', follow: '跟单', sales: '谈单', designer: '设计' };

export default function DesignerSelectModal({ visible, order, onConfirm, onClose, loading }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [summary, setSummary] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [quickName, setQuickName] = useState('');
  const [show, setShow] = useState(false);
  const inputRef = useRef(null);
  const quickRef = useRef(null);

  const isSearching = query.trim().length > 0;

  // 进入动画 + 聚焦
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSelectedId(null);
      setSelectedItem(null);
      setSourceFilter('all');
      setSummary({});
      setRecommendations([]);
      setQuickName('');
      requestAnimationFrame(() => setShow(true));
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    } else {
      setShow(false);
    }
  }, [visible]);

  // 搜索防抖
  useEffect(() => {
    if (!visible) return;

    const trimmed = query.trim();
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        if (trimmed === '') {
          // 空搜索：拉推荐
          const res = await searchDesignersUnified('', 'all');
          setRecommendations(res.data.recommendations || []);
          setResults([]);
          setSummary({});
        } else {
          // 关键词搜索
          const res = await searchDesignersUnified(trimmed, sourceFilter);
          setResults(res.data.data || []);
          setSummary(res.data.summary || {});
          setRecommendations([]);
        }
      } catch (e) {
        console.error('designer search error:', e);
        setResults([]);
        setSummary({});
        setRecommendations([]);
      } finally {
        setSearching(false);
      }
    }, trimmed ? 300 : 100);
    return () => clearTimeout(timer);
  }, [visible, query, sourceFilter]);

  // Tab / 查询变化时重置选中
  useEffect(() => {
    setSelectedId(null);
    setSelectedItem(null);
  }, [sourceFilter, query]);

  const handleSelect = (item) => {
    const key = `${item.source}-${item.id}`;
    if (selectedId === key) {
      setSelectedId(null);
      setSelectedItem(null);
    } else {
      setSelectedId(key);
      setSelectedItem(item);
    }
  };

  const handleConfirm = () => {
    if (selectedItem) {
      if (selectedItem.source === 'roster') {
        onConfirm({ freelance_designer_id: selectedItem.id });
      } else {
        const realName = selectedItem.name.includes(' (')
          ? selectedItem.name.split(' (')[0]
          : selectedItem.name;
        onConfirm({
          designer_name: realName,
          wechat: selectedItem.wechat_id || '',
          external_user_id: selectedItem.external_user_id || '',
        });
      }
    }
  };

  // 快速输入接单
  const handleQuickSubmit = () => {
    const name = quickName.trim();
    if (!name) return;
    onConfirm({ designer_name: name });
  };

  const handleClose = () => {
    setShow(false);
    setTimeout(() => onClose(), 200);
  };

  if (!visible) return null;

  const canConfirm = selectedId !== null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]"
      onClick={handleClose}
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200"
        style={{ opacity: show ? 1 : 0 }}
      />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 max-h-[78vh] flex flex-col transition-all duration-200"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0)' : 'translateY(-16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">选择设计师</h3>
              {order && <p className="text-[11px] text-slate-400 mt-0.5">{order.order_sn}</p>}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-y-auto min-h-0">
          {/* 搜索框 */}
          <div className="relative mb-3">
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索设计师姓名 / 微信号 / 手机号..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors"
            />
            {searching && (
              <svg className="w-4 h-4 text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>

          {/* ═══ 默认视图：推荐 + 快速输入 ═══ */}
          {!isSearching && (
            <>
              {/* 🏆 智能推荐 */}
              {recommendations.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">🏆 智能推荐</span>
                    <span className="text-[10px] text-slate-400">基于接单量与售后率加权评分</span>
                  </div>
                  <div className="space-y-1.5">
                    {recommendations.map((rec, idx) => {
                      const recKey = `rec-${rec.id}`;
                      const isSelected = selectedId === recKey;
                      const medals = ['🥇', '🥈', '🥉'];
                      return (
                        <button
                          key={recKey}
                          type="button"
                          onClick={() => {
                            if (selectedId === recKey) {
                              setSelectedId(null);
                              setSelectedItem(null);
                            } else {
                              setSelectedId(recKey);
                              setSelectedItem({ source: 'roster', id: rec.id, name: rec.name, wechat_id: rec.wechat_id });
                            }
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                            isSelected
                              ? 'bg-amber-50 ring-2 ring-amber-400'
                              : 'bg-gradient-to-r from-amber-50/60 to-transparent hover:from-amber-50'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 bg-gradient-to-br from-amber-100 to-amber-200">
                            {medals[idx] || '⭐'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800">{rec.name}</span>
                              {rec.specialty && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100/80 text-amber-700 whitespace-nowrap">{rec.specialty}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 mt-0.5 text-[11px]">
                              <span className="text-slate-500">{rec.total_orders} 单</span>
                              <span className="text-emerald-500">完成 {rec.completion_rate}%</span>
                              {rec.refund_rate > 0 && <span className="text-red-400">退款 {rec.refund_rate}%</span>}
                              <span className="text-amber-500 font-semibold">{rec.score}分</span>
                            </div>
                          </div>
                          {isSelected && (
                            <svg className="w-5 h-5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ✏️ 快速输入：还没在系统中的设计师 */}
              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[11px] font-medium text-slate-500">✏️ 不在列表中？直接输入姓名接单</span>
                </div>
                <div className="flex gap-2">
                  <input
                    ref={quickRef}
                    type="text"
                    placeholder="输入设计师姓名..."
                    value={quickName}
                    onChange={(e) => {
                      setQuickName(e.target.value);
                      // 快捷输入时取消列表选中
                      if (e.target.value.trim()) {
                        setSelectedId(null);
                        setSelectedItem(null);
                      }
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleQuickSubmit(); }}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleQuickSubmit}
                    disabled={!quickName.trim() || loading}
                    className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    接单
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ═══ 搜索视图：Tab + 结果列表 ═══ */}
          {isSearching && (
            <>
              {/* 来源 Tab 栏 */}
              <div className="flex gap-1 mb-3 overflow-x-auto scrollbar-hide">
                {SOURCE_TABS.map((tab) => {
                  const count = tab.key === 'all' ? (summary.total || 0) : (summary[tab.key] || 0);
                  const isActive = sourceFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setSourceFilter(tab.key)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer border ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
                      }`}
                    >
                      {tab.label}
                      {count > 0 && (
                        <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 搜索结果列表 */}
              <div className="max-h-[260px] overflow-y-auto -mx-1 px-1 space-y-1">
                {results.length === 0 && !searching && (
                  <div className="text-center py-6 text-sm text-slate-400">
                    无匹配结果，试试其他关键词
                  </div>
                )}
                {results.map((d) => {
                  const key = `${d.source}-${d.id}`;
                  const isSelected = selectedId === key;
                  const badge = SOURCE_BADGE[d.source] || SOURCE_BADGE.roster;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelect(d)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 ring-2 ring-indigo-500'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      {d.avatar ? (
                        <img src={d.avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                          isSelected
                            ? 'bg-indigo-500 text-white'
                            : 'bg-gradient-to-br from-slate-200 to-slate-300 text-slate-600'
                        }`}>
                          {(d.name || '?')[0]}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800 truncate">{d.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold whitespace-nowrap ${badge.bg} ${badge.text} ${badge.border}`}>
                            {badge.label}
                          </span>
                          {d.specialty && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">{d.specialty}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {d.extra_info && (
                            <span className="text-[11px] text-slate-400 truncate">
                              {d.source === 'team' ? (ROLE_NAME[d.extra_info] || d.extra_info) : d.extra_info}
                            </span>
                          )}
                          {d.wechat_id && <span className="text-[11px] text-slate-400 truncate">微信: {d.wechat_id}</span>}
                          {d.source === 'roster' && <span className="text-[11px] text-slate-400">累计 {d.total_orders || 0} 单</span>}
                        </div>
                      </div>
                      {isSelected && (
                        <svg className="w-5 h-5 text-indigo-500 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100 bg-slate-50/30 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="text-slate-600 hover:text-slate-800 font-medium px-4 py-2 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <div className="flex items-center gap-3">
            {selectedItem && (
              <span className="text-[11px] text-slate-400">
                已选: <span className="font-medium text-slate-600">{selectedItem.name}</span>
              </span>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm || loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  接单中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  确认接单
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
