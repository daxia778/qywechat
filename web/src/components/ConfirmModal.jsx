import { useState, useEffect, useRef, useCallback, useId } from 'react';

export default function ConfirmModal({
  visible, title, message, type = 'info', detail, showInput, inputPlaceholder,
  confirmText = '确认', cancelText = '取消', onConfirm, onCancel,
}) {
  const [inputValue, setInputValue] = useState('');
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);
  const generatedId = useId();
  const titleId = `confirm-modal-title-${generatedId}`;

  const handleConfirm = () => {
    onConfirm?.(inputValue);
    setInputValue('');
  };

  const handleCancel = useCallback(() => {
    onCancel?.();
    setInputValue('');
  }, [onCancel]);

  // Focus trap and Escape key handler
  useEffect(() => {
    if (!visible) return;

    // Store the previously focused element to restore later
    previousActiveElement.current = document.activeElement;

    // Focus the modal container on open
    const timer = setTimeout(() => {
      modalRef.current?.focus();
    }, 50);

    const handleKeyDown = (e) => {
      // Escape key closes the modal
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
        return;
      }

      // Focus trap: Tab cycling within modal
      if (e.key === 'Tab') {
        const modal = modalRef.current;
        if (!modal) return;

        const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const focusableElements = Array.from(modal.querySelectorAll(focusableSelectors)).filter(
          (el) => !el.disabled && el.offsetParent !== null
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modal.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modal.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to previously focused element
      if (previousActiveElement.current && previousActiveElement.current.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [visible, handleCancel]);

  if (!visible) return null;

  const iconBg = type === 'danger' ? 'bg-red-100' : type === 'warning' ? 'bg-amber-100' : 'bg-blue-100';
  const iconColor = type === 'danger' ? 'text-red-500' : type === 'warning' ? 'text-amber-500' : 'text-brand-500';
  const btnClass = type === 'danger' ? 'bg-red-500 hover:bg-red-600' : type === 'warning' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand-500 hover:bg-brand-600';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={modalRef}
      tabIndex={-1}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-10 h-10 rounded-full ${iconBg} flex items-center justify-center shrink-0`} aria-hidden="true">
              {type === 'danger' ? (
                <svg className={`w-5 h-5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              ) : type === 'warning' ? (
                <svg className={`w-5 h-5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              ) : (
                <svg className={`w-5 h-5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
            </div>
            <h3 id={titleId} className="text-lg font-bold text-slate-800">{title}</h3>
          </div>
        </div>
        <div className="px-6 py-3">
          <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
          {detail && (
            <div className="mt-3 bg-slate-50 rounded-xl p-4 text-sm space-y-2">
              {Object.entries(detail).map(([key, val]) => (
                <div key={key} className="flex justify-between items-center">
                  <span className="text-slate-500">{key}</span>
                  <span className="font-semibold text-slate-800">{val}</span>
                </div>
              ))}
            </div>
          )}
          {showInput && (
            <div className="mt-3">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={inputPlaceholder}
                aria-label={inputPlaceholder || '请输入内容'}
                rows="3"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#465FFF] focus:border-transparent resize-none outline-none transition-all"
              />
            </div>
          )}
        </div>
        <div className="px-6 pb-6 pt-2 flex justify-end gap-3">
          <button onClick={handleCancel} className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">{cancelText}</button>
          <button
            onClick={handleConfirm}
            disabled={showInput && !inputValue.trim()}
            className={`px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-50 ${btnClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
