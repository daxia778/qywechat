import { formatTime } from '../utils/formatters';

export default function NotificationPanel({ notifications, unreadCount, onMarkRead, onMarkAllRead }) {
  return (
    <div role="region" aria-label="通知中心" className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl border border-slate-200/80 z-50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
      <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
        <span className="font-semibold text-slate-800 text-sm">通知中心</span>
        {unreadCount > 0 && (
          <button onClick={onMarkAllRead} className="text-xs text-[#465FFF] hover:underline font-medium bg-transparent border-none cursor-pointer">全部已读</button>
        )}
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">
            <svg className="w-8 h-8 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
            暂无通知
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => onMarkRead(n)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMarkRead(n); } }}
              className={`px-4 py-3 border-b border-slate-50/80 hover:bg-slate-50 cursor-pointer transition-colors ${!n.is_read ? 'bg-[#F5F8FF]' : ''}`}
            >
              <div className="flex items-start gap-2">
                {!n.is_read && <div className="w-2 h-2 rounded-full bg-[#465FFF] mt-1.5 shrink-0" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{n.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.content}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{formatTime(n.created_at)}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
