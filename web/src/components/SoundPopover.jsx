/**
 * 音色设置浮窗 — Lucide SVG 图标版
 */

/** Lucide SVG 图标映射 — 内联 path，无需依赖包 */
const LUCIDE_ICONS = {
  'bell-ring': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="M4 2C2.8 3.7 2 5.7 2 8" />
      <path d="M22 8c0-2.3-.8-4.3-2-6" />
    </svg>
  ),
  'music': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  'droplets': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
      <path d="M12.56 14.69c1.47 0 2.67-1.21 2.67-2.7 0-.78-.38-1.51-1.14-2.13-.76-.61-1.28-1.37-1.53-2.16-.25.79-.77 1.55-1.53 2.16-.76.62-1.14 1.35-1.14 2.13 0 1.49 1.2 2.7 2.67 2.7z" />
      <path d="M18 16.3c1.47 0 2.67-1.22 2.67-2.72 0-.78-.38-1.51-1.14-2.13-.76-.61-1.28-1.37-1.53-2.15-.25.78-.77 1.54-1.53 2.15-.76.62-1.14 1.35-1.14 2.13 0 1.5 1.2 2.72 2.67 2.72z" />
    </svg>
  ),
  'radio': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.4" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.4" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </svg>
  ),
  'zap': (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  ),
};

export default function SoundPopover({
  soundVolume, setSoundVolume,
  soundType, soundTypes,
  setSoundType, previewSound,
  onClose,
}) {
  return (
    <div
      className="absolute right-0 top-11 w-[230px] bg-white rounded-xl shadow-xl border border-slate-200/80 z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      style={{ animation: 'fadeInUp 0.15s ease-out' }}
    >
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-700">提示音设置</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="px-3.5 py-3 space-y-3">
        {/* 音量 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-slate-500">音量</span>
            <span className="text-[10px] text-slate-400 tabular-nums">{Math.round(soundVolume * 100)}%</span>
          </div>
          <input
            type="range" min="0" max="1" step="0.05"
            value={soundVolume}
            onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
            className="w-full h-1 bg-slate-200 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: '#434FCF' }}
          />
        </div>
        {/* 音色 */}
        <div>
          <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">音色</span>
          <div className="space-y-1">
            {soundTypes.map((st) => (
              <button
                key={st.key}
                onClick={() => { setSoundType(st.key); previewSound(st.key); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all duration-150 border ${
                  soundType === st.key
                    ? 'bg-brand-50 border-brand-200 text-brand-600'
                    : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
                }`}
              >
                <span className={`shrink-0 ${soundType === st.key ? 'text-brand-500' : 'text-slate-400'}`}>
                  {LUCIDE_ICONS[st.icon] || LUCIDE_ICONS['bell-ring']}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{st.label}</div>
                  <div className="text-[10px] text-slate-400 leading-tight">{st.desc}</div>
                </div>
                {soundType === st.key && (
                  <svg className="w-3.5 h-3.5 text-brand-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
