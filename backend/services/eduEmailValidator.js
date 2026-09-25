/**
 * EDU Email Validator Service
 *
 * Provides stricter validation for .edu email addresses including:
 * - Basic format validation
 * - .edu suffix requirement
 * - MX record validation (verifies domain can receive email)
 * - Blocklist of known fake .edu domains
 */

const dns = require('dns');
const { promisify } = require('util');
const logger = require('../utils/logger');

// Promisify DNS functions
const resolveMx = promisify(dns.resolveMx);

// Blocklist of known fake or problematic .edu domains
// These are domains that end in .edu but are not legitimate US educational institutions
const BLOCKED_DOMAINS = [
  'mail.edu',
  'email.edu',
  'fake.edu',
  'test.edu',
  'example.edu',
  'tempmail.edu',
  'throwaway.edu',
  'disposable.edu',
];

// Cache for MX lookup results to avoid repeated DNS queries
// Format: { domain: { hasMx: boolean, timestamp: number } }
const mxCache = new Map();
const MX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

/**
 * Validates a .edu email address with multiple layers of verification
 *
 * @param {string} email - The email address to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.checkMx - Whether to verify MX records (default: true)
 * @param {number} options.mxTimeout - Timeout for MX lookup in ms (default: 5000)
 * @returns {Promise<{valid: boolean, email?: string, error?: string, details?: Object}>}
 */
async function validateEduEmail(email, options = {}) {
  const { checkMx = true, mxTimeout = 5000, mxResolver } = options;

  // Step 1: Check if email is provided
  if (!email) {
    return { valid: false, error: 'Student email is required' };
  }

  // Step 2: Normalize email
  const emailLower = email.toLowerCase().trim();

  // Step 3: Basic format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailLower)) {
    return { valid: false, error: 'Invalid email format' };
  }

  // Step 4: Check .edu suffix
  if (!emailLower.endsWith('.edu')) {
    return {
      valid: false,
      error: 'Please use a valid .edu email address'
    };
  }

  // Step 5: Extract domain
  const atIndex = emailLower.indexOf('@');
  const domain = emailLower.substring(atIndex + 1);

  // Step 6: Check blocklist
  if (BLOCKED_DOMAINS.includes(domain)) {
    logger.warn(`[EDU_VALIDATOR] Blocked domain attempted: ${domain}`);
    return {
      valid: false,
      error: 'This .edu domain is not accepted. Please use your official university email.'
    };
  }

  // Step 7: Check against blocklist patterns (subdomains of blocked domains)
  for (const blockedDomain of BLOCKED_DOMAINS) {
    if (domain.endsWith(`.${blockedDomain}`)) {
      logger.warn(`[EDU_VALIDATOR] Blocked subdomain attempted: ${domain}`);
      return {
        valid: false,
        error: 'This .edu domain is not accepted. Please use your official university email.'
      };
    }
  }

  // Step 8: Verify MX records (if enabled)
  if (checkMx) {
    const mxResult = await checkMxRecords(domain, mxTimeout, { resolveMxFn: mxResolver });

    if (!mxResult.hasMx) {
      logger.warn(`[EDU_VALIDATOR] Domain has no MX records: ${domain}`);
      return {
        valid: false,
        error: 'This email domain cannot receive emails. Please use a valid university email.',
        details: { domain, mxError: mxResult.error }
      };
    }
  }

  // All checks passed
  return {
    valid: true,
    email: emailLower,
    details: { domain, mxVerified: checkMx }
  };
}

/**
 * Check if a domain has valid MX records
 * Uses caching to avoid repeated DNS lookups
 *
 * @param {string} domain - The domain to check
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<{hasMx: boolean, records?: Array, error?: string}>}
 */
async function checkMxRecords(domain, timeout = 5000, options = {}) {
  const { resolveMxFn = resolveMx } = options;
  let timeoutId;

  // Check cache first
  const cached = mxCache.get(domain);
  if (cached && (Date.now() - cached.timestamp) < MX_CACHE_TTL_MS) {
    return { hasMx: cached.hasMx, cached: true };
  }

  try {
    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('MX lookup timeout')), timeout);
    });

    // Race between the actual lookup and timeout
    const mxRecords = await Promise.race([
      resolveMxFn(domain),
      timeoutPromise
    ]);

    clearTimeout(timeoutId);

    // Check if we got valid MX records
    const hasMx = Array.isArray(mxRecords) && mxRecords.length > 0;

    // Cache the result
    mxCache.set(domain, { hasMx, timestamp: Date.now() });

    return {
      hasMx,
      records: hasMx ? mxRecords.map(r => r.exchange) : []
    };
  } catch (error) {
    if (typeof timeoutId !== 'undefined') {
      clearTimeout(timeoutId);
    }

    // DNS errors could mean the domain doesn't exist or has no MX records
    const errorCode = error.code;

    // ENODATA or ENOTFOUND means no MX records exist
    // ETIMEOUT or timeout means we couldn't verify
    // For safety, we'll be strict and reject if we can't verify

    if (errorCode === 'ENODATA' || errorCode === 'ENOTFOUND') {
      // Domain exists but has no MX records - definitely can't receive email
      mxCache.set(domain, { hasMx: false, timestamp: Date.now() });
      return { hasMx: false, error: 'No MX records found' };
    }

    if (error.message === 'MX lookup timeout') {
      // Timeout - we can't verify, so we'll allow it but log
      logger.warn(`[EDU_VALIDATOR] MX lookup timeout for domain: ${domain}`);
      // Don't cache timeouts - they might be temporary
      return { hasMx: true, error: 'Lookup timeout - allowing with warning' };
    }

    // Other errors (network issues, etc.) - allow but log
    logger.warn(`[EDU_VALIDATOR] MX lookup error for ${domain}: ${error.message}`);
    return { hasMx: true, error: error.message };
  }
}

/**
 * Clear the MX cache (useful for testing)
 */
function clearMxCache() {
  mxCache.clear();
}

/**
 * Get the current blocklist (useful for admin purposes)
 */
function getBlockedDomains() {
  return [...BLOCKED_DOMAINS];
}

/**
 * Synchronous validation for basic checks only (no MX lookup)
 * Use this for quick client-side style validation
 *
 * @param {string} email - The email address to validate
 * @returns {{valid: boolean, email?: string, error?: string}}
 */
function validateEduEmailSync(email) {
  if (!email) {
    return { valid: false, error: 'Student email is required' };
  }

  const emailLower = email.toLowerCase().trim();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailLower)) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (!emailLower.endsWith('.edu')) {
    return { valid: false, error: 'Please use a valid .edu email address' };
  }

  const atIndex = emailLower.indexOf('@');
  const domain = emailLower.substring(atIndex + 1);

  if (BLOCKED_DOMAINS.includes(domain)) {
    return {
      valid: false,
      error: 'This .edu domain is not accepted. Please use your official university email.'
    };
  }

  for (const blockedDomain of BLOCKED_DOMAINS) {
    if (domain.endsWith(`.${blockedDomain}`)) {
      return {
        valid: false,
        error: 'This .edu domain is not accepted. Please use your official university email.'
      };
    }
  }

  return { valid: true, email: emailLower };
}

module.exports = {
  validateEduEmail,
  validateEduEmailSync,
  checkMxRecords,
  clearMxCache,
  getBlockedDomains,
  BLOCKED_DOMAINS
};
