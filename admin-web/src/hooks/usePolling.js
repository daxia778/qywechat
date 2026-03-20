import { useEffect, useRef, useCallback } from 'react';

/**
 * Smart polling hook with Page Visibility API awareness.
 *
 * - Pauses the interval when the tab is hidden (saves bandwidth).
 * - Immediately fires the callback once when the tab becomes visible again.
 * - Accepts an `enabled` flag to pause/resume externally.
 */
export function usePolling(callback, interval, enabled = true) {
  const savedCallback = useRef(callback);
  const intervalRef = useRef(null);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => savedCallback.current(), interval);
  }, [interval]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !interval) return;

    // Start polling immediately
    start();

    // Pause when tab is hidden, resume + fire immediately when visible
    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Fire immediately on tab re-focus, then resume interval
        savedCallback.current();
        start();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [interval, enabled, start, stop]);
}
