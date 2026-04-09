import { useState, useEffect, useRef } from 'react';
import { searchDesigners } from '../api/orders';

export default function DesignerSelectModal({ visible, order, onConfirm, onClose, loading }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWechat, setNewWechat] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newSpecialty, setNewSpecialty] = useState('');
  const [show, setShow] = useState(false);
  const inputRef = useRef(null);

  // 进入动画 + 聚焦
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSelectedId(null);
      setShowNewForm(false);
      setNewName('');
      setNewWechat('');
      setNewPhone('');
      setNewSpecialty('');
      requestAnimationFrame(() => setShow(true));
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    } else {
      setShow(false);
    }
  }, [visible]);

  // 搜索防抖
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchDesigners(query.trim());
        setResults(res.data.data || res.data.designers || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 加载全部（空搜索）
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await searchDesigners('');
        if (!cancelled) setResults(res.data.data || res.data.designers || []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const handleConfirm = () => {
    if (showNewForm) {
      if (!newName.trim()) return;
      onConfirm({ designer_name: newName.trim(), wechat: newWechat, phone: newPhone, specialty: newSpecialty });
    } else if (selectedId) {
      onConfirm({ freelance_designer_id: selectedId });
    }
  };

  const handleClose = () => {
    setShow(false);
    setTimeout(() => onClose(), 200);
  };

  if (!visible) return null;

  const canConfirm = showNewForm ? newName.trim().length > 0 : selectedId !== null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={handleClose}
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200"
        style={{ opacity: show ? 1 : 0 }}
      />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 max-h-[85vh] flex flex-col transition-all duration-200"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(8px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">选择设计师</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                接单前请选择负责的设计师
                {order && <span className="ml-1 text-indigo-500">· {order.order_sn}</span>}
              </p>
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
          {!showNewForm ? (
            <>
              {/* 搜索框 */}
              <div className="relative mb-3">
                <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="搜索设计师姓名 / 微信号..."
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

              {/* 设计师列表 */}
              <div className="max-h-[280px] overflow-y-auto -mx-1 px-1 space-y-1">
                {results.length === 0 && !searching && (
                  <div className="text-center py-8 text-sm text-slate-400">
                    {query ? '无匹配结果' : '暂无设计师数据'}
                  </div>
                )}
                {results.map((d) => {
                  const isSelected = selectedId === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedId(isSelected ? null : d.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 ring-2 ring-indigo-500'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                        isSelected
                          ? 'bg-indigo-500 text-white'
                          : 'bg-gradient-to-br from-slate-200 to-slate-300 text-slate-600'
                      }`}>
                        {(d.name || '?')[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800 truncate">{d.name}</span>
                          {d.specialty && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">{d.specialty}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          {d.wechat_id && <span className="text-[11px] text-slate-400 truncate">微信: {d.wechat_id}</span>}
                          <span className="text-[11px] text-slate-400">累计 {d.total_orders || 0} 单</span>
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

              {/* 新建设计师入口 */}
              <button
                type="button"
                onClick={() => setShowNewForm(true)}
                className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl border-2 border-dashed border-indigo-200 hover:border-indigo-300 transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                花名册中没有？新建设计师
              </button>
            </>
          ) : (
            /* 新建设计师表单 */
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 cursor-pointer mb-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                </svg>
                返回列表选择
              </button>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">姓名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="设计师姓名"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">微信号</label>
                <input
                  type="text"
                  value={newWechat}
                  onChange={(e) => setNewWechat(e.target.value)}
                  placeholder="选填"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">手机号</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="选填"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">擅长类型</label>
                <input
                  type="text"
                  value={newSpecialty}
                  onChange={(e) => setNewSpecialty(e.target.value)}
                  placeholder="如: 商务PPT、创意设计"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/30 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="text-slate-600 hover:text-slate-800 font-medium px-4 py-2.5 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
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
  );
}
