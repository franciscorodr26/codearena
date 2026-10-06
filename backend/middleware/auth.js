/**
 * Authentication Middleware
 *
 * Verifies JWT tokens for protected routes
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { SECRET } = require('../config/jwt');
const db = require('../db');
const logger = require('../utils/logger');

/**
 * Middleware to authenticate JWT token
 * Adds user info to req.user if token is valid
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (typeof authHeader !== 'string' || !/^Bearer \S+$/.test(authHeader)) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, SECRET);

    if (decoded.sub === undefined || decoded.tokenVersion === undefined) {
      return res.status(401).json({
        error: 'Token missing required claim',
        code: 'TOKEN_MISSING_CLAIM',
        message: 'Token missing required claim, please log in again'
      });
    }

    const userId = Number(decoded.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const isValid = await db.isTokenVersionValid(userId, decoded.tokenVersion);
    if (!isValid) {
      return res.status(401).json({
        error: 'Token invalidated',
        code: 'TOKEN_INVALIDATED',
        message: 'Your session has expired due to a security change. Please log in again.'
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (typeof db.getSessionByTokenHash === 'function') {
      const session = await db.getSessionByTokenHash(tokenHash);
      if (!session || Number(session.user_id) !== Number(userId)) {
        return res.status(401).json({
          error: 'Session revoked',
          code: 'SESSION_REVOKED',
          message: 'This session has been signed out. Please log in again.'
        });
      }
      req.authSession = session;
    }

    const ban = await db.isUserBanned(userId);
    if (ban) {
      return res.status(403).json({
        error: 'Account suspended',
        reason: ban.reason,
        isPermanent: !!ban.is_permanent,
        expiresAt: ban.expires_at
      });
    }

    req.user = { ...decoded, sub: userId, id: userId, userId, username: decoded.username };
    req.tokenHash = tokenHash;

    if (typeof db.updateSessionLastActive === 'function') {
      db.updateSessionLastActive(tokenHash).catch(err => {
        logger.warn('[AUTH] Failed to update session activity:', err.message);
      });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authenticateToken;
