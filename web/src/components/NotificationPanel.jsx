import { useState } from 'react';
import { formatTime } from '../utils/formatters';
import SoundSettingsPanel from './SoundSettingsPanel';
import OrderPreviewCard from './OrderPreviewCard';

export default function NotificationPanel({
  notifications, unreadCount, onMarkRead, onMarkAllRead,
  // Sound props
  soundEnabled, soundVolume, soundType, soundTypes,
  onSoundToggle, onSoundVolume, onSoundType, onSoundPreview,
}) {
  const [showSoundSettings, setShowSoundSettings] = useState(false);

  return (
    <div
      role="region"
      aria-label="通知中心"
      className="absolute right-0 top-12 w-[340px] bg-white rounded-xl shadow-xl border border-slate-200/80 z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
        <span className="font-semibold text-slate-800 text-sm">通知中心</span>
        <div className="flex items-center gap-2">
          {/* 声音设置按钮 */}
          <button
            onClick={() => setShowSoundSettings(!showSoundSettings)}
            className={`p-1 rounded-md transition-colors ${
              showSoundSettings ? 'bg-brand-50 text-brand-500' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
            title="提示音设置"
          >
            {soundEnabled ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="text-xs text-brand-500 hover:underline font-medium bg-transparent border-none cursor-pointer"
            >
              全部已读
            </button>
          )}
        </div>
      </div>

      {/* Sound Settings (collapsible) */}
      {showSoundSettings && (
        <SoundSettingsPanel
          enabled={soundEnabled}
          volume={soundVolume}
          soundType={soundType}
          soundTypes={soundTypes}
          onToggle={onSoundToggle}
          onVolume={onSoundVolume}
          onSoundType={onSoundType}
          onPreview={onSoundPreview}
        />
      )}

      {/* Notifications List */}
      <div className="max-h-[380px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            <svg className="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            暂无通知
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => onMarkRead(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMarkRead(n); }
              }}
              className={`px-4 py-3 border-b border-slate-50/80 hover:bg-slate-50 cursor-pointer transition-colors ${
                !n.is_read ? 'bg-brand-50/30' : ''
              }`}
            >
              <div className="flex items-start gap-2">
                {!n.is_read && (
                  <div className="w-2 h-2 rounded-full bg-brand-500 mt-1.5 shrink-0 animate-pulse" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-slate-800 truncate">{n.title}</div>
                  <div className="text-[12px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{n.content}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{formatTime(n.created_at)}</div>
                  {/* 订单预览卡片 */}
                  <OrderPreviewCard notification={n} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
