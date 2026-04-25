/**
 * 音色设置浮窗 — 从齿轮按钮弹出
 * 包含音量滑块 + 3种音色选择（点击即试听）
 */
export default function SoundPopover({
  soundVolume, setSoundVolume,
  soundType, soundTypes,
  setSoundType, previewSound,
  onClose,
}) {
  return (
    <div
      className="absolute right-0 top-11 w-[220px] bg-white rounded-xl shadow-xl border border-slate-200/80 z-50 overflow-hidden animate-fade-in-up"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3.5 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-700">提示音设置</span>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="px-3.5 py-3 space-y-3">
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
        <div>
          <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">音色</span>
          <div className="space-y-1">
            {soundTypes.map((st) => (
              <button
                key={st.key}
                onClick={() => { setSoundType(st.key); previewSound(st.key); }}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all duration-150 border ${
                  soundType === st.key
                    ? 'bg-brand-50 border-brand-200 text-brand-600'
                    : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
                }`}
              >
                <span className="text-[13px]">
                  {st.key === 'crystal' && '✨'}
                  {st.key === 'gentle' && '🔔'}
                  {st.key === 'alert' && '⚡'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{st.label}</div>
                  <div className="text-[10px] text-slate-400">{st.desc}</div>
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
