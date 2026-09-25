/**
 * Centralized JWT configuration for CodeArena MVP Backend
 *
 * All JWT_SECRET validation and access should go through this module
 * to ensure consistent security checks across the application.
 *
 * The actual secret is resolved by utils/jwtSecret.js, which resolves it
 * ONCE per process: env value if set, throw in production if missing,
 * otherwise an ephemeral random per-process secret in dev/test (no known
 * default). This module re-exports that single shared secret so that every
 * sign/verify site uses the same value.
 */

const { SECRET } = require('../utils/jwtSecret');

const isProduction = process.env.NODE_ENV === 'production';

// Extra strictness in production: a real secret must be reasonably long.
// (utils/jwtSecret already throws in production when JWT_SECRET is unset.)
if (isProduction && SECRET.length < 32) {
  throw new Error('CRITICAL: JWT_SECRET must be at least 32 characters for security');
}

module.exports = {
  SECRET,
  isProduction
};
