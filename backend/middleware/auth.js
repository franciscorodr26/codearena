/**
 * Authentication Middleware
 *
 * Verifies JWT tokens for protected routes
 */

const jwt = require('jsonwebtoken');
const { SECRET } = require('../config/jwt');

/**
 * Middleware to authenticate JWT token
 * Adds user info to req.user if token is valid
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    req.user = { userId: decoded.sub, username: decoded.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authenticateToken;
