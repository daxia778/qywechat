import { useRef, useCallback } from 'react';

/**
 * Throttled callback hook — ensures a function runs at most once per `delay` ms.
 *
 * Use case: WebSocket event handlers that may fire rapidly (e.g. order_updated).
 * Instead of fetching data on every event, we batch them into one fetch.
 *
 * Features:
 * - Leading call: fires immediately on first invocation
 * - Trailing call: fires once more after delay if events arrived during cooldown
 * - The returned function is stable (never changes identity)
 *
 * @param {Function} callback - The function to throttle
 * @param {number} delay - Minimum interval between invocations (ms)
 * @returns {Function} Throttled version of callback
 */
export function useThrottledCallback(callback, delay) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const lastCalledRef = useRef(0);
  const timerRef = useRef(null);

  return useCallback((...args) => {
    const now = Date.now();
    const elapsed = now - lastCalledRef.current;

    if (elapsed >= delay) {
      // Enough time has passed — fire immediately
      lastCalledRef.current = now;
      callbackRef.current(...args);
    } else {
      // Within cooldown — schedule a trailing call (replace any pending)
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastCalledRef.current = Date.now();
        callbackRef.current(...args);
      }, delay - elapsed);
    }
  }, [delay]);
}
