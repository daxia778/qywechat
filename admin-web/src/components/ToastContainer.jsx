import { createPortal } from 'react-dom';
import { useToast } from '../hooks/useToast';

const toastClasses = {
  success: 'bg-emerald-50/95 border-emerald-200 text-emerald-800',
  error: 'bg-red-50/95 border-red-200 text-red-800',
  warning: 'bg-amber-50/95 border-amber-200 text-amber-800',
  info: 'bg-blue-50/95 border-blue-200 text-blue-800',
};

const toastIcons = {
  success: '\u2705', error: '\u274C', warning: '\u26A0\uFE0F', info: '\u2139\uFE0F',
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return createPortal(
    <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto min-w-[320px] max-w-[420px] rounded-xl shadow-lg border backdrop-blur-sm px-4 py-3 flex items-start gap-3 animate-fade-in-up ${toastClasses[t.type] || toastClasses.info}`}
        >
          <div className="text-lg shrink-0 mt-0.5">{toastIcons[t.type] || toastIcons.info}</div>
          <div className="flex-1 min-w-0">
            {t.title && <div className="font-semibold text-sm mb-0.5">{t.title}</div>}
            <div className="text-sm opacity-90">{t.message}</div>
          </div>
          <button
            onClick={() => removeToast(t.id)}
            className="shrink-0 text-current opacity-40 hover:opacity-80 bg-transparent border-none cursor-pointer text-lg leading-none mt-0.5"
          >
            &times;
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
