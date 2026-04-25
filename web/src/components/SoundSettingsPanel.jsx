import { memo } from 'react';

/**
 * 声音设置小面板 — 嵌入通知面板顶部
 * Props: enabled, volume, soundType, soundTypes, onToggle, onVolume, onSoundType, onPreview
 */
const SoundSettingsPanel = memo(function SoundSettingsPanel({
  enabled, volume, soundType, soundTypes,
  onToggle, onVolume, onSoundType, onPreview,
}) {
  return (
    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
      {/* 第一行: 标题 + 总开关 */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
          <span className="text-[12px] font-semibold text-slate-600">提示音</span>
        </div>
        <button
          onClick={onToggle}
          role="switch"
          aria-checked={enabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 shrink-0 ${
            enabled ? 'bg-brand-500' : 'bg-slate-300'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`} />
        </button>
      </div>

      {enabled && (
        <>
          {/* 音量条 */}
          <div className="flex items-center gap-2 mb-2.5">
            <svg className="w-3 h-3 text-slate-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" clipRule="evenodd" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => onVolume(parseFloat(e.target.value))}
              className="flex-1 h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-brand-500"
              style={{ accentColor: '#434FCF' }}
            />
            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
            </svg>
          </div>

          {/* 音色选择 */}
          <div className="flex gap-1.5">
            {soundTypes.map((st) => (
              <button
                key={st.key}
                onClick={() => { onSoundType(st.key); onPreview(st.key); }}
                title={st.desc}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 border ${
                  soundType === st.key
                    ? 'bg-brand-50 border-brand-300 text-brand-600 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                {st.key === 'crystal' && '✨'}
                {st.key === 'gentle' && '🔔'}
                {st.key === 'alert' && '⚡'}
                {st.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

export default SoundSettingsPanel;
