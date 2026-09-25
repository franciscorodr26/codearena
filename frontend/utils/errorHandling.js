/**
 * Error Handling Utilities
 *
 * Provides retry logic, error classification, and user-friendly error messages.
 */

import { config } from '../config/env';

// Error types for better handling
export const ErrorType = {
  NETWORK: 'NETWORK',
  AUTH: 'AUTH',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMIT: 'RATE_LIMIT',
  SERVER: 'SERVER',
  UNKNOWN: 'UNKNOWN'
};

// User-friendly error messages
export const errorMessages = {
  [ErrorType.NETWORK]: 'Unable to connect. Please check your internet connection.',
  [ErrorType.AUTH]: 'Your session has expired. Please log in again.',
  [ErrorType.VALIDATION]: 'Please check your input and try again.',
  [ErrorType.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorType.RATE_LIMIT]: 'Too many requests. Please wait a moment and try again.',
  [ErrorType.SERVER]: 'Something went wrong on our end. Please try again later.',
  [ErrorType.UNKNOWN]: 'An unexpected error occurred. Please try again.'
};

/**
 * Classify an error based on its properties
 */
export function classifyError(error, response = null) {
  const message = error?.message || '';

  // Network errors (no response)
  if (!response && (
    error?.name === 'TypeError' ||
    error?.name === 'AbortError' ||
    message === 'Failed to fetch' ||
    message.includes('Failed to fetch') ||
    message.includes('Load failed') ||
    message.includes('NetworkError') ||
    message.includes('Network request failed') ||
    message.includes('Connection failed') ||
    message.includes('Request timed out')
  )) {
    return ErrorType.NETWORK;
  }

  // HTTP status-based classification
  if (response) {
    const status = response.status;
    if (status === 401 || status === 403) return ErrorType.AUTH;
    if (status === 400 || status === 422) return ErrorType.VALIDATION;
    if (status === 404) return ErrorType.NOT_FOUND;
    if (status === 429) return ErrorType.RATE_LIMIT;
    if (status >= 500) return ErrorType.SERVER;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Get a user-friendly message for an error
 */
export function getErrorMessage(error, response = null, customMessages = {}) {
  const errorType = classifyError(error, response);
  return customMessages[errorType] || errorMessages[errorType];
}

/**
 * Retry a function with exponential backoff
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Function to determine if should retry (default: network errors only)
 * @param {Function} options.onRetry - Callback called on each retry attempt
 * @returns {Promise} - Result of the function
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    shouldRetry = (error, response) => {
      const errorType = classifyError(error, response);
      // Only retry network and server errors
      return errorType === ErrorType.NETWORK || errorType === ErrorType.SERVER;
    },
    onRetry = null
  } = options;

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error;
      lastResponse = error.response;

      // Don't retry if we shouldn't
      if (!shouldRetry(error, lastResponse)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, delay, error);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Wrapper for fetch with retry logic
 *
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryOptions - Retry options (see withRetry)
 * @returns {Promise<Response>} - Fetch response
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  return withRetry(async () => {
    const response = await fetch(url, options);

    // Attach response to error for classification
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.response = response;
      throw error;
    }

    return response;
  }, retryOptions);
}

/**
 * API fetch helper with auth, retry, and error handling
 *
 * @param {string} endpoint - API endpoint (will be prefixed with backend URL)
 * @param {Object} options - Fetch options
 * @param {Object} retryOptions - Retry options
 * @returns {Promise<Object>} - Parsed JSON response
 */
export async function apiFetch(endpoint, options = {}, retryOptions = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

  const url = endpoint.startsWith('http') ? endpoint : `${config.backend_url}${endpoint}`;

  const fetchOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    }
  };

  const response = await fetchWithRetry(url, fetchOptions, retryOptions);

  // Handle empty responses
  const text = await response.text();
  if (!text) return null;

  return JSON.parse(text);
}

/**
 * Create an error boundary fallback component props
 */
export function createErrorFallbackProps(error, resetFn) {
  const errorType = classifyError(error);

  return {
    title: errorType === ErrorType.NETWORK ? 'Connection Problem' : 'Something went wrong',
    message: getErrorMessage(error),
    canRetry: errorType === ErrorType.NETWORK || errorType === ErrorType.SERVER,
    onRetry: resetFn,
    showReload: errorType === ErrorType.AUTH
  };
}

export default {
  ErrorType,
  errorMessages,
  classifyError,
  getErrorMessage,
  withRetry,
  fetchWithRetry,
  apiFetch,
  createErrorFallbackProps
};
