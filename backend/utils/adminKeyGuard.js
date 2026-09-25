const crypto = require('crypto');

/**
 * Compare the supplied admin key without leaking information about the
 * configured secret's length or contents. An unset/blank ADMIN_KEY always
 * fails closed.
 */
function isValidAdminKey(providedKey, configuredKey = process.env.ADMIN_KEY) {
  if (
    typeof configuredKey !== 'string' || configuredKey.trim().length === 0 ||
    typeof providedKey !== 'string' || providedKey.length === 0
  ) {
    return false;
  }

  const configuredDigest = crypto.createHash('sha256').update(configuredKey, 'utf8').digest();
  const providedDigest = crypto.createHash('sha256').update(providedKey, 'utf8').digest();

  return crypto.timingSafeEqual(configuredDigest, providedDigest);
}

function requireAdminKey(req, res, next) {
  if (!isValidAdminKey(req.headers['x-admin-key'])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

module.exports = {
  isValidAdminKey,
  requireAdminKey
};
