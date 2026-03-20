import { useState, useEffect } from 'react';

/**
 * Debounce a value by the given delay (ms).
 * Returns the debounced value — only updates after the caller stops
 * changing the input for `delay` ms.
 *
 * Usage:
 *   const debouncedKeyword = useDebounce(keyword, 400);
 *   useEffect(() => { fetch(debouncedKeyword); }, [debouncedKeyword]);
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
