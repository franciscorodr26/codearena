const crypto = require('crypto')
const jwt = require('jsonwebtoken')

// A signature proves issuance, not that the session is still authorized.
// Use the persisted session and current credential generation on every access.
async function authenticateSessionToken(token, db, secret) {
  if (typeof token !== 'string' || !token || token.length > 8192) throw new Error('Invalid session')
  const claims = jwt.verify(token, secret, { algorithms: ['HS256'] })
  if (!['number', 'string'].includes(typeof claims.sub)) throw new Error('Invalid session')
  const userId = Number(claims.sub)
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      !Number.isSafeInteger(claims.tokenVersion) || claims.tokenVersion < 0 ||
      !Number.isFinite(claims.exp)) throw new Error('Invalid session')
  if (!await db.isTokenVersionValid(userId, claims.tokenVersion)) throw new Error('Invalid session')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const session = await db.getSessionByTokenHash(tokenHash)
  if (!session || Number(session.user_id) !== userId) throw new Error('Invalid session')
  if (await db.isUserBanned(userId)) throw new Error('Invalid session')
  return { userId, username: claims.username, claims, tokenHash, session }
}

// Convenience for routes with their own auth helpers: the session user for a
// Bearer header, or null when the header is missing or the session is not valid.
async function sessionUserFromRequest(req, db, secret) {
  const authHeader = req.headers && req.headers.authorization
  if (typeof authHeader !== 'string' || !/^Bearer \S+$/.test(authHeader)) return null
  try {
    const { userId, claims, tokenHash } = await authenticateSessionToken(authHeader.slice(7), db, secret)
    return { ...claims, sub: userId, id: userId, userId, tokenHash }
  } catch {
    return null
  }
}

module.exports = { authenticateSessionToken, sessionUserFromRequest }
