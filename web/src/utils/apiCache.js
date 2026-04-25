/**
 * Simple in-memory API response cache with TTL.
 *
 * Design rationale:
 * - Caches resolved data (not Promises) for simplicity.
 * - Uses request deduplication: if the same key is being fetched concurrently,
 *   subsequent callers await the same Promise instead of firing duplicate requests.
 * - Supports manual invalidation and stale-while-revalidate pattern.
 * - No persistence — clears on page refresh (intentional for security).
 *
 * Usage:
 *   const data = await apiCache.get('dashboard', fetchDashboard, { ttl: 60000 });
 *   apiCache.invalidate('dashboard');  // force next fetch
 *   apiCache.clear();  // clear all
 */

class APICache {
  constructor() {
    /** @type {Map<string, { data: any, expiresAt: number }>} */
    this.cache = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.pending = new Map();
  }

  /**
   * Get cached data or fetch from source.
   *
   * @param {string} key - Cache key (e.g. 'employees', 'dashboard')
   * @param {Function} fetcher - Async function that returns data
   * @param {Object} options
   * @param {number} options.ttl - Time-to-live in ms (default: 60000 = 1 min)
   * @param {boolean} options.staleWhileRevalidate - If true, return stale data immediately
   *   while revalidating in background (default: false)
   * @param {AbortSignal} options.signal - Optional AbortSignal
   * @returns {Promise<any>} Cached or fresh data
   */
  async get(key, fetcher, options = {}) {
    const { ttl = 60000, staleWhileRevalidate = false, signal } = options;
    const now = Date.now();
    const entry = this.cache.get(key);

    // Fresh cache hit — return immediately
    if (entry && now < entry.expiresAt) {
      return entry.data;
    }

    // Stale-while-revalidate: return stale data, revalidate in background
    if (entry && staleWhileRevalidate) {
      this._revalidate(key, fetcher, ttl);
      return entry.data;
    }

    // Request deduplication: if same key is already being fetched, await it
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }

    // Fresh fetch
    const promise = this._fetch(key, fetcher, ttl, signal);
    this.pending.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  /** @private */
  async _fetch(key, fetcher, ttl, signal) {
    const data = await fetcher(signal);
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
    return data;
  }

  /** @private Background revalidation — errors are swallowed */
  _revalidate(key, fetcher, ttl) {
    if (this.pending.has(key)) return; // already revalidating
    const promise = this._fetch(key, fetcher, ttl)
      .catch(() => {}) // swallow errors for background refresh
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
  }

  /**
   * Check if a key has a fresh (non-expired) cache entry.
   */
  has(key) {
    const entry = this.cache.get(key);
    return entry && Date.now() < entry.expiresAt;
  }

  /**
   * Manually update cache with data (e.g. after a mutation).
   */
  set(key, data, ttl = 60000) {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Invalidate a specific cache key.
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix.
   * e.g. apiCache.invalidatePrefix('orders') clears 'orders', 'orders:page2', etc.
   */
  invalidatePrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached data.
   */
  clear() {
    this.cache.clear();
    this.pending.clear();
  }
}

/** Singleton instance */
const apiCache = new APICache();
export default apiCache;
