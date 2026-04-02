import { createPortal } from 'react-dom';
import { useToast } from '../hooks/useToast';

const toastClasses = {
  success: 'bg-white/95 border-slate-200 text-slate-600',
  error: 'bg-red-50/95 border-red-200 text-red-800',
  warning: 'bg-amber-50/95 border-amber-200 text-amber-800',
  info: 'bg-blue-50/95 border-blue-200 text-blue-800',
};

const toastIconColors = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

function ToastIcon({ type }) {
  const colorClass = toastIconColors[type] || toastIconColors.info;

  if (type === 'success') {
    return (
      <svg className={`w-[18px] h-[18px] ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <svg className={`w-[18px] h-[18px] ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type === 'warning') {
    return (
      <svg className={`w-[18px] h-[18px] ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    );
  }
  // info (default)
  return (
    <svg className={`w-[18px] h-[18px] ${colorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return createPortal(
    <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto min-w-[240px] max-w-[360px] rounded-xl shadow-md border backdrop-blur-sm px-3.5 py-2.5 flex items-center gap-2.5 animate-fade-in-up ${toastClasses[t.type] || toastClasses.info}`}
        >
          <div className="shrink-0"><ToastIcon type={t.type} /></div>
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
