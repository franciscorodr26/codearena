/**
 * Shared JWT secret resolver for the CodeArena backend.
 *
 * The secret is resolved exactly ONCE at module load, so every jwt.sign /
 * jwt.verify site that imports this module within a single process uses the
 * SAME secret. Resolution policy:
 *
 *   1. If process.env.JWT_SECRET is set, use it.
 *   2. Else if NODE_ENV === 'production', throw at load time (fail fast):
 *      production must be configured with a real secret.
 *   3. Else (dev / test / CI without a secret), generate a per-process
 *      random secret and warn. There is NO hardcoded default, so tokens
 *      simply do not survive a process restart. This keeps dev/CI working
 *      without shipping a well-known secret that could be exploited if
 *      JWT_SECRET were ever unset in production.
 */

const crypto = require('crypto');
const logger = require('./logger');

function resolveSecret() {
  const envSecret = process.env.JWT_SECRET;
  if (envSecret) {
    return envSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CRITICAL: JWT_SECRET environment variable must be set in production'
    );
  }

  // Dev / test only: generate an ephemeral secret unique to this process.
  // Tokens will not survive a restart, but there is no known default to abuse.
  const ephemeralSecret = crypto.randomBytes(48).toString('hex');
  logger.warn(
    'JWT_SECRET is not set. Using an ephemeral per-process secret. ' +
      'Tokens will be invalidated when the process restarts. ' +
      'Set JWT_SECRET for stable auth.'
  );
  return ephemeralSecret;
}

const SECRET = resolveSecret();

module.exports = {
  SECRET,
  getSecret: () => SECRET,
};
