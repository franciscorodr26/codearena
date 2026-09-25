/**
 * Lightweight in-memory cache with TTL.
 *
 * Used for short-lived response caching (see routes/analytics.js, which caches
 * the progress dashboard for ~30s). The backend runs as a single Railway
 * process, so an in-memory store is sufficient. The API is async so it can be
 * swapped for a Redis-backed implementation later without touching callers.
 */

const store = new Map(); // key -> { value, expiresAt } (expiresAt === 0 means no expiry)

/**
 * Get a cached value. Returns null if the key is missing or expired.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== 0 && Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a value with an optional TTL in seconds. A ttl <= 0 means no expiry.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttlSeconds=30]
 * @returns {Promise<void>}
 */
async function set(key, value, ttlSeconds = 30) {
  const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0;
  store.set(key, { value, expiresAt });
}

/**
 * Delete a single key, or clear the whole cache when called with no key.
 * @param {string} [key]
 * @returns {Promise<void>}
 */
async function del(key) {
  if (key === undefined) {
    store.clear();
    return;
  }
  store.delete(key);
}

module.exports = { get, set, del };
