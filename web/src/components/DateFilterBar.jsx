import { useRef } from 'react';

/**
 * 日期筛选栏 — 快捷 toggle 按钮 + 独立日历选择器
 *
 * 快捷按钮：点击激活，再点取消，独立于日历
 * 日历选择：手动设定自定义范围，会自动取消快捷预设
 */
export default function DateFilterBar({
  datePreset, togglePreset,
  startDate, endDate, setStartDate, setEndDate,
  clearDateFilter,
  onPageReset,
}) {
  const startRef = useRef(null);
  const endRef = useRef(null);

  // 今天的日期字符串（限制日历不能选未来）
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const presets = [
    { key: 'today', label: '今日' },
    { key: 'week',  label: '本周' },
    { key: 'month', label: '本月' },
  ];

  // 格式化显示日期 (YYYY-MM-DD → MM/DD)
  const fmtDate = (d) => {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length !== 3) return d;
    return `${parts[1]}/${parts[2]}`;
  };

  const hasAnyFilter = datePreset || startDate || endDate;

  return (
    <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2 flex-wrap">
      {/* 日历图标 */}
      <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>

      {/* 快捷 toggle 按钮 */}
      {presets.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => { togglePreset(key); onPageReset?.(); }}
          className={`px-2.5 py-1 text-[12px] font-semibold rounded-lg border transition-all duration-150 cursor-pointer ${
            datePreset === key
              ? 'border-brand-400 bg-brand-500 text-white shadow-sm'
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}

      {/* 分隔线 */}
      <div className="w-px h-5 bg-slate-200 mx-0.5" />

      {/* 日期选择器 — 点击开日历、禁键盘输入 */}
      <div className="flex items-center gap-1.5">
        <div
          onClick={() => startRef.current?.showPicker?.()}
          className={`relative flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-lg border cursor-pointer transition-all hover:border-slate-300 ${
            startDate && !datePreset ? 'bg-white border-slate-300 text-slate-700 font-medium' : 'bg-white border-slate-200 text-slate-400'
          }`}
        >
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{startDate && !datePreset ? fmtDate(startDate) : '开始'}</span>
          <input
            ref={startRef}
            type="date"
            value={startDate}
            max={todayStr}
            onChange={(e) => { setStartDate(e.target.value); onPageReset?.(); }}
            onKeyDown={(e) => e.preventDefault()}
            className="absolute inset-0 opacity-0 cursor-pointer"
            tabIndex={-1}
          />
        </div>

        <span className="text-[11px] text-slate-300 select-none">→</span>

        <div
          onClick={() => endRef.current?.showPicker?.()}
          className={`relative flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-lg border cursor-pointer transition-all hover:border-slate-300 ${
            endDate && !datePreset ? 'bg-white border-slate-300 text-slate-700 font-medium' : 'bg-white border-slate-200 text-slate-400'
          }`}
        >
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{endDate && !datePreset ? fmtDate(endDate) : '结束'}</span>
          <input
            ref={endRef}
            type="date"
            value={endDate}
            max={todayStr}
            onChange={(e) => { setEndDate(e.target.value); onPageReset?.(); }}
            onKeyDown={(e) => e.preventDefault()}
            className="absolute inset-0 opacity-0 cursor-pointer"
            tabIndex={-1}
          />
        </div>
      </div>

      {/* 清除按钮 */}
      {hasAnyFilter && (
        <button
          onClick={() => { clearDateFilter(); onPageReset?.(); }}
          className="px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer border-none bg-transparent flex items-center gap-0.5"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          清除
        </button>
      )}
    </div>
  );
}
