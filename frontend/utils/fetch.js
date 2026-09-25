/**
 * Fetch utilities for consistent API request handling
 */

// Custom event for auth errors (401)
export const AUTH_ERROR_EVENT = 'auth:unauthorized';

/**
 * Dispatch auth error event (triggers logout in AuthContext)
 */
const dispatchAuthError = (message = 'Session expired') => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, {
      detail: { message }
    }));
  }
};

/**
 * Fetch with automatic timeout and retry logic for network failures
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @param {number} maxRetries - Maximum retry attempts for network failures (default: 2)
 * @returns {Promise<Response>} - The fetch response
 */
export const fetchWithTimeout = async (url, options = {}, timeoutMs = 30000, maxRetries = 2) => {
  let lastError;
  const userSignal = options.signal || null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Compose the caller's signal with our timeout signal so neither is lost.
    // If the caller already aborted, fail fast with their reason.
    let onUserAbort = null;
    if (userSignal) {
      if (userSignal.aborted) {
        clearTimeout(timeout);
        throw userSignal.reason || new DOMException('Aborted', 'AbortError');
      }
      onUserAbort = () => controller.abort(userSignal.reason);
      userSignal.addEventListener('abort', onUserAbort);
    }

    try {
      // Strip the user's signal from options so our composed controller wins.
      const { signal: _ignored, ...restOptions } = options;
      const response = await fetch(url, { ...restOptions, signal: controller.signal });
      clearTimeout(timeout);
      if (userSignal && onUserAbort) userSignal.removeEventListener('abort', onUserAbort);
      return response;
    } catch (err) {
      clearTimeout(timeout);
      if (userSignal && onUserAbort) userSignal.removeEventListener('abort', onUserAbort);
      lastError = err;

      if (err.name === 'AbortError') {
        // Distinguish: caller aborted vs timeout fired.
        // If the user signal aborted, re-throw with the caller's reason so
        // callers can detect their own cancellations.
        if (userSignal && userSignal.aborted) {
          throw userSignal.reason || err;
        }
        if (timedOut) {
          throw new Error('Request timed out. Please check your connection and try again.');
        }
        // Aborted for some other reason: propagate as-is.
        throw err;
      }

      // Network errors (Load failed, Failed to fetch, etc.) - retry
      const isNetworkError = err.message?.includes('Load failed') ||
                             err.message?.includes('Failed to fetch') ||
                             err.message?.includes('NetworkError') ||
                             err.message?.includes('Network request failed') ||
                             err.name === 'TypeError';

      if (isNetworkError && attempt < maxRetries) {
        // Bail out of retry loop if the caller aborted while we were preparing to wait.
        if (userSignal && userSignal.aborted) {
          throw userSignal.reason || err;
        }
        // Wait before retry (exponential backoff: 1s, 2s)
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }

      // Transform generic network errors to user-friendly message
      if (isNetworkError) {
        throw new Error('Connection failed. Please check your internet connection and try again.');
      }

      throw err;
    }
  }

  throw lastError;
};

/**
 * Authenticated fetch - automatically adds auth token and handles 401 errors
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options (headers will be merged)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>} - The fetch response
 */
export const authFetch = async (url, options = {}, timeoutMs = 30000) => {
  // Get token from storage
  const token = typeof window !== 'undefined'
    ? (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token'))
    : null;

  // Merge headers with auth token
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(url, { ...options, headers }, timeoutMs);

  // Handle 401 Unauthorized - trigger logout
  if (response.status === 401) {
    const data = await response.clone().json().catch(() => ({}));
    const message = data.message || data.error || 'Session expired. Please log in again.';

    // Special handling for token invalidation (password changed)
    if (data.code === 'TOKEN_INVALIDATED') {
      dispatchAuthError('Your session was invalidated due to a security change. Please log in again.');
    } else {
      dispatchAuthError(message);
    }
  }

  return response;
};
