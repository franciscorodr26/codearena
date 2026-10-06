const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const leoProfanity = require('leo-profanity');
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const db = require('../db');
const logger = require('../utils/logger');
const { isValidAdminKey } = require('../utils/adminKeyGuard');
const { sessionUserFromRequest } = require('../utils/sessionAuthentication');
const {
  sendEmail,
  sendEmailChangeVerification,
  sendEmailChangeAlert,
  sendEmailChangeConfirmation,
  send2FAEnabledEmail,
  send2FADisabledEmail,
  sendNewTrustedDeviceEmail,
  sendBackupCodesRegeneratedEmail
} = require('../services/email');
const { chains } = require('../middleware/validation');
const { getLocationFromIP, getClientIP } = require('../services/geolocation');
const { FRONTEND_URL } = require('../config/appUrls');

const router = express.Router();

// Rate limiter for forgot-password: 5 requests per 15 minutes per IP
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for reset-password: 10 attempts per 15 minutes per IP
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many password reset attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for admin endpoints: 30 requests per minute per IP
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many admin requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for check-username: 10 requests per minute per IP (prevents enumeration attacks)
const checkUsernameLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const { SECRET } = require('../config/jwt');
const JWT_EXPIRES_SESSION = '1d';      // Short session (no remember me)
const JWT_EXPIRES_REMEMBER = '30d';    // Long session (remember me checked)
const SALT_ROUNDS = 10;

// Google OAuth client ID - should be set in environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Admin emails from environment variable (comma-separated list)
// Example: ADMIN_EMAILS=admin@example.com,owner@example.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(email => email.length > 0);

// Check if email should be admin (uses only env var, no hardcoded emails)
function isAdminEmail(email) {
  if (!email) return false;
  const lowerEmail = email.toLowerCase();
  return ADMIN_EMAILS.includes(lowerEmail);
}

// Valid avatar IDs
const VALID_AVATARS = [
  'default-1', 'default-2', 'default-3', 'default-4', 'default-5',
  'gaming-1', 'gaming-2', 'gaming-3', 'gaming-4', 'gaming-5',
  'gaming-6', 'gaming-7', 'gaming-8', 'gaming-9', 'gaming-10',
  'dev-1', 'dev-2', 'dev-3', 'dev-4', 'dev-5',
  'dev-6', 'dev-7', 'dev-8', 'dev-9', 'dev-10',
  // Animals
  'animal-1', 'animal-2', 'animal-3', 'animal-4', 'animal-5',
  'animal-6', 'animal-7', 'animal-8', 'animal-9', 'animal-10',
  // Faces
  'face-1', 'face-2', 'face-3', 'face-4', 'face-5',
  'face-6', 'face-7', 'face-8', 'face-9', 'face-10',
  // All country flags (197 nations)
  'flag-af', 'flag-al', 'flag-dz', 'flag-ad', 'flag-ao', 'flag-ag', 'flag-ar', 'flag-am',
  'flag-au', 'flag-at', 'flag-az', 'flag-bs', 'flag-bh', 'flag-bd', 'flag-bb', 'flag-by',
  'flag-be', 'flag-bz', 'flag-bj', 'flag-bt', 'flag-bo', 'flag-ba', 'flag-bw', 'flag-br',
  'flag-bn', 'flag-bg', 'flag-bf', 'flag-bi', 'flag-cv', 'flag-kh', 'flag-cm', 'flag-ca',
  'flag-cf', 'flag-td', 'flag-cl', 'flag-cn', 'flag-co', 'flag-km', 'flag-cg', 'flag-cd',
  'flag-cr', 'flag-ci', 'flag-hr', 'flag-cu', 'flag-cy', 'flag-cz', 'flag-dk', 'flag-dj',
  'flag-dm', 'flag-do', 'flag-ec', 'flag-eg', 'flag-sv', 'flag-gq', 'flag-er', 'flag-ee',
  'flag-sz', 'flag-et', 'flag-fj', 'flag-fi', 'flag-fr', 'flag-ga', 'flag-gm', 'flag-ge',
  'flag-de', 'flag-gh', 'flag-gr', 'flag-gd', 'flag-gt', 'flag-gn', 'flag-gw', 'flag-gy',
  'flag-ht', 'flag-hn', 'flag-hu', 'flag-is', 'flag-in', 'flag-id', 'flag-ir', 'flag-iq',
  'flag-ie', 'flag-il', 'flag-it', 'flag-jm', 'flag-jp', 'flag-jo', 'flag-kz', 'flag-ke',
  'flag-ki', 'flag-kp', 'flag-kr', 'flag-kw', 'flag-kg', 'flag-la', 'flag-lv', 'flag-lb',
  'flag-ls', 'flag-lr', 'flag-ly', 'flag-li', 'flag-lt', 'flag-lu', 'flag-mg', 'flag-mw',
  'flag-my', 'flag-mv', 'flag-ml', 'flag-mt', 'flag-mh', 'flag-mr', 'flag-mu', 'flag-mx',
  'flag-fm', 'flag-md', 'flag-mc', 'flag-mn', 'flag-me', 'flag-ma', 'flag-mz', 'flag-mm',
  'flag-na', 'flag-nr', 'flag-np', 'flag-nl', 'flag-nz', 'flag-ni', 'flag-ne', 'flag-ng',
  'flag-mk', 'flag-no', 'flag-om', 'flag-pk', 'flag-pw', 'flag-ps', 'flag-pa', 'flag-pg',
  'flag-py', 'flag-pe', 'flag-ph', 'flag-pl', 'flag-pt', 'flag-qa', 'flag-ro', 'flag-ru',
  'flag-rw', 'flag-kn', 'flag-lc', 'flag-vc', 'flag-ws', 'flag-sm', 'flag-st', 'flag-sa',
  'flag-sn', 'flag-rs', 'flag-sc', 'flag-sl', 'flag-sg', 'flag-sk', 'flag-si', 'flag-sb',
  'flag-so', 'flag-za', 'flag-ss', 'flag-es', 'flag-lk', 'flag-sd', 'flag-sr', 'flag-se',
  'flag-ch', 'flag-sy', 'flag-tw', 'flag-tj', 'flag-tz', 'flag-th', 'flag-tl', 'flag-tg',
  'flag-to', 'flag-tt', 'flag-tn', 'flag-tr', 'flag-tm', 'flag-tv', 'flag-ug', 'flag-ua',
  'flag-ae', 'flag-gb', 'flag-us', 'flag-uy', 'flag-uz', 'flag-vu', 'flag-va', 'flag-ve',
  'flag-vn', 'flag-ye', 'flag-zm', 'flag-zw'
];

// Profanity filter - combines leo-profanity dictionary with substring matching and leetspeak detection
leoProfanity.loadDictionary();

// Get base bad words from leo-profanity and add our own
const BAD_WORDS = new Set([
  ...leoProfanity.list(),
  // Add extra words
  'nazi', 'hitler', 'kill', 'murder', 'suicide',
  'terrorist', 'bomb', 'shooting', 'massacre', 'rape',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike',
  'spic', 'chink', 'gook', 'wetback', 'beaner',
  // Anatomical/sexual - inappropriate for public usernames
  'penis', 'vagina', 'dick', 'cock', 'pussy', 'tits', 'boobs',
  'cum', 'jizz', 'dildo', 'boner', 'erection'
]);

// Normalize leetspeak to regular characters
// Returns array of possible normalizations since some chars map to multiple letters
function normalizeLeetspeak(str) {
  const lower = str.toLowerCase().replace(/_/g, '');

  // Single normalization with most common mappings
  const normalized = lower
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/\*/g, '')
    .replace(/!/g, 'i')
    .replace(/\+/g, 't');

  // Alternative normalization for ambiguous chars (4 can be 'a' or 'u' sound in f4ck)
  const altNormalized = lower
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'u')  // f4ck -> fuck
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/\*/g, '')
    .replace(/!/g, 'i')
    .replace(/\+/g, 't');

  return [normalized, altNormalized];
}

// Safe substrings - words containing bad word fragments that are OK
const SAFE_PATTERNS = [
  'assassin', 'classic', 'bass', 'mass', 'pass', 'grass', 'class',
  'compass', 'bypass', 'harass', 'amass', 'carcass', 'molasses',
  'cockpit', 'cocktail', 'peacock', 'hancock', 'woodcock', 'stopcock',
  'scunthorpe', 'penistone', 'arsenal', 'therapist', 'shitake',
  'dickens', 'dickson', 'sussex', 'essex', 'middlesex', 'assume',
  'assess', 'assist', 'associate', 'assure', 'assignment', 'asset'
];

// Check if username contains profanity (including leetspeak like sh1t, a$$, f*ck)
function containsProfanity(username) {
  if (!username) return false;

  let testStr = username.toLowerCase().replace(/_/g, '');
  const normalizations = normalizeLeetspeak(username);

  // Remove safe patterns before checking
  for (const safe of SAFE_PATTERNS) {
    testStr = testStr.replace(new RegExp(safe, 'g'), '');
    for (let i = 0; i < normalizations.length; i++) {
      normalizations[i] = normalizations[i].replace(new RegExp(safe, 'g'), '');
    }
  }

  // Check if any bad word is contained in the remaining string
  for (const word of BAD_WORDS) {
    if (word.length >= 4) {
      if (testStr.includes(word)) return true;
      for (const norm of normalizations) {
        if (norm.includes(word)) return true;
      }
    } else if (word.length === 3) {
      if (testStr.includes(word)) return true;
      for (const norm of normalizations) {
        if (norm.includes(word)) return true;
      }
    }
  }
  return false;
}

// Disposable/temporary email domains (block fake signups)
const DISPOSABLE_EMAIL_DOMAINS = [
  'tempmail.com', 'temp-mail.org', 'guerrillamail.com', 'guerrillamail.org',
  'mailinator.com', 'mailinator.net', 'throwaway.email', 'throwawaymail.com',
  'fakeinbox.com', 'fakemailgenerator.com', 'getnada.com', 'getairmail.com',
  'yopmail.com', 'yopmail.fr', 'dispostable.com', 'mailnesia.com',
  'tempail.com', 'tempr.email', 'discard.email', 'discardmail.com',
  'spamgourmet.com', 'trashmail.com', 'trashmail.net', 'mytrashmail.com',
  '10minutemail.com', '10minutemail.net', 'minutemail.com', 'tempinbox.com',
  'mohmal.com', 'sharklasers.com', 'spam4.me', 'grr.la', 'guerrillamailblock.com',
  'pokemail.net', 'mailcatch.com', 'mailnull.com', 'e4ward.com', 'spamex.com',
  'jetable.org', 'kasmail.com', 'spamfree24.org', 'crazymailing.com',
  'maildrop.cc', 'mailsac.com', 'anonbox.net', 'anonymbox.com', 'tempmailo.com',
  'emailondeck.com', 'fakemail.net', 'throwam.com', 'tmpmail.org', 'tmpmail.net',
  'burnermail.io', 'inboxkitten.com', 'emailfake.com', 'generator.email'
];

// Check if email is from a disposable domain
function isDisposableEmail(email) {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.includes(domain);
}

// Username validation
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  // 3-20 characters, alphanumeric and underscores only
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) return false;
  // Check for profanity
  if (containsProfanity(username)) return false;
  return true;
}

function isValidAvatar(avatar) {
  return VALID_AVATARS.includes(avatar);
}

function hashAuthToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSessionForToken(req, userId, token) {
  const tokenHash = hashAuthToken(token);
  const userAgentInfo = parseUserAgent(req.headers['user-agent']);
  const clientIP = getClientIP(req);
  await db.createUserSession(userId, tokenHash, {
    deviceType: userAgentInfo.deviceType,
    browser: userAgentInfo.browser,
    os: userAgentInfo.os,
    ipAddress: clientIP,
    location: null
  });
  return tokenHash;
}

async function rotateCurrentSessionToken(req, userId, token) {
  const tokenHash = hashAuthToken(token);
  if (req.authSession?.id && typeof db.updateSessionTokenHash === 'function') {
    const updated = await db.updateSessionTokenHash(req.authSession.id, userId, tokenHash);
    if (updated) {
      req.tokenHash = tokenHash;
      return tokenHash;
    }
  }

  await createSessionForToken(req, userId, token);
  req.tokenHash = tokenHash;
  return tokenHash;
}

// Password strength validation
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  return { valid: true };
}

// JWT Middleware for protected routes
// 2FA pending-login tokens, ported from the hardened upstream version. The
// token carries the credential generation (token_version) it was issued for,
// so a pending login started before a password reset or a sign-out-everywhere
// can no longer be completed, and it is typed so no other check accepts it.
const PENDING_LOGIN_TOKEN_TTL_SECONDS = 5 * 60;

async function issuePendingLoginToken({ userId, rememberMe, tokenVersion }) {
  const pendingToken = jwt.sign(
    {
      sub: userId,
      type: '2fa_pending',
      rememberMe,
      tokenVersion
    },
    SECRET,
    { expiresIn: PENDING_LOGIN_TOKEN_TTL_SECONDS }
  );

  // Store the pending token hash so a stolen copy cannot be replayed.
  const pendingTokenHash = crypto.createHash('sha256').update(pendingToken).digest('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + PENDING_LOGIN_TOKEN_TTL_SECONDS;
  await db.save2FAPendingToken(userId, pendingTokenHash, expiresAt);

  return pendingToken;
}

async function isCurrent2FAPendingLogin(pendingData) {
  return Boolean(
    pendingData?.type === '2fa_pending'
    && Number.isInteger(Number(pendingData.tokenVersion))
    && await db.isTokenVersionValid(pendingData.sub, Number(pendingData.tokenVersion))
  );
}

// Compared against when no account matches, so a missing account costs the
// same bcrypt work as a wrong password and response timing does not reveal
// which usernames and emails exist.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('codearena-timing-equaliser', 10);

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    // Typed tokens (a 2FA pending login) are never sessions.
    if (decoded.type) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    // Compatibility shim: JWT payload uses `sub` per RFC 7519, but many
    // downstream routes historically read `req.user.id`. Normalize so both
    // work and we don't silently get `undefined` user ids in queries.
    req.user = { ...decoded, id: decoded.sub };

    // Verify token version (invalidates tokens after password change).
    // Fail-closed: tokens missing the claim are rejected so legacy/forged
    // tokens cannot bypass the check by simply omitting `tokenVersion`.
    if (decoded.tokenVersion === undefined) {
      return res.status(401).json({
        error: 'Token missing required claim',
        code: 'TOKEN_MISSING_CLAIM',
        message: 'Token missing required claim, please log in again'
      });
    }
    const isValid = await db.isTokenVersionValid(decoded.sub, decoded.tokenVersion);
    if (!isValid) {
      return res.status(401).json({
        error: 'Token invalidated',
        code: 'TOKEN_INVALIDATED',
        message: 'Your session has expired due to a security change. Please log in again.'
      });
    }

    const tokenHash = hashAuthToken(token);
    if (typeof db.getSessionByTokenHash === 'function') {
      const session = await db.getSessionByTokenHash(tokenHash);
      if (!session || Number(session.user_id) !== Number(decoded.sub)) {
        return res.status(401).json({
          error: 'Session revoked',
          code: 'SESSION_REVOKED',
          message: 'This session has been signed out. Please log in again.'
        });
      }
      req.authSession = session;
    }
    req.tokenHash = tokenHash;

    if (typeof db.updateSessionLastActive === 'function') {
      db.updateSessionLastActive(tokenHash).catch(err => {
        logger.warn('[AUTH] Failed to update session activity:', err.message);
      });
    }

    // Check if user is banned
    const ban = await db.isUserBanned(decoded.sub);
    if (ban) {
      return res.status(403).json({
        error: 'Account suspended',
        reason: ban.reason,
        isPermanent: !!ban.is_permanent,
        expiresAt: ban.expires_at
      });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Check username availability (supports both query param and path param)
router.get('/check-username/:username?', checkUsernameLimiter, async (req, res, next) => {
  // Support both /check-username/foo and /check-username?username=foo
  const username = req.params.username || req.query.username;
  logger.info('[AUTH] Check username:', username);
  try {
    // Check profanity first for specific error message
    if (username && containsProfanity(username)) {
      logger.info('[AUTH] Username contains inappropriate language');
      return res.json({
        available: false,
        reason: 'Username contains inappropriate language'
      });
    }

    if (!username || !isValidUsername(username)) {
      logger.info('[AUTH] Invalid username format');
      return res.json({
        available: false,
        reason: 'Username must be 3-20 characters, letters, numbers, and underscores only'
      });
    }

    // Check reserved usernames
    const reserved = ['admin', 'administrator', 'moderator', 'mod', 'support', 'help', 'codearena', 'system'];
    if (reserved.includes(username.toLowerCase())) {
      logger.info('[AUTH] Reserved username');
      return res.json({ available: false, reason: 'This username is reserved' });
    }

    // If user is authenticated, exclude their own username from the check
    let excludeUserId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const sessionUser = await sessionUserFromRequest(req, db, SECRET);
      if (sessionUser) excludeUserId = sessionUser.userId;
    }

    const available = await db.isUsernameAvailable(username, excludeUserId);
    logger.info('[AUTH] Username available:', available, 'excludeUserId:', excludeUserId);
    res.json({ available, reason: available ? null : 'Username is already taken' });
  } catch (err) {
    logger.info('[AUTH] Check username error:', err.message);
    next(err);
  }
});

// Register
router.post('/register', chains.register, async (req, res, next) => {
  logger.info('[AUTH] Register request:', { email: req.body.email, username: req.body.username });
  try {
    const { email, password, username, avatar = 'default-1', emailOptIn = true, linkedin_url, github_url, twitter_url, referralCode } = req.body;

    // Validate required fields
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Email, password, and username are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Block disposable/temporary email addresses
    if (isDisposableEmail(email)) {
      return res.status(400).json({ error: 'Please use a permanent email address. Temporary/disposable emails are not allowed.' });
    }

    // Check profanity first for specific error message
    if (containsProfanity(username)) {
      return res.status(400).json({ error: 'Username contains inappropriate language' });
    }

    // Validate username
    if (!isValidUsername(username)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters, letters, numbers, and underscores only'
      });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    // Check reserved usernames
    const reserved = ['admin', 'administrator', 'moderator', 'mod', 'support', 'help', 'codearena', 'system'];
    if (reserved.includes(username.toLowerCase())) {
      return res.status(400).json({ error: 'This username is reserved' });
    }

    // Validate avatar
    const selectedAvatar = isValidAvatar(avatar) ? avatar : 'default-1';

    // Normalize and validate social links if provided (optional during registration)
    const normalizeUrl = (url) => {
      if (!url || !url.trim()) return null;
      let normalized = url.trim();
      if (!normalized.match(/^https?:\/\//)) {
        normalized = 'https://' + normalized;
      }
      return normalized;
    };

    const normalizedLinkedin = normalizeUrl(linkedin_url);
    const normalizedGithub = normalizeUrl(github_url);
    const normalizedTwitter = normalizeUrl(twitter_url);

    if (normalizedLinkedin) {
      const linkedinPattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/;
      if (!linkedinPattern.test(normalizedLinkedin)) {
        return res.status(400).json({ error: 'Invalid LinkedIn URL. Use format: linkedin.com/in/username' });
      }
    }
    if (normalizedGithub) {
      const githubPattern = /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/?$/;
      if (!githubPattern.test(normalizedGithub)) {
        return res.status(400).json({ error: 'Invalid GitHub URL. Use format: github.com/username' });
      }
    }
    if (normalizedTwitter) {
      const twitterPattern = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?$/;
      if (!twitterPattern.test(normalizedTwitter)) {
        return res.status(400).json({ error: 'Invalid Twitter/X URL. Use format: x.com/username' });
      }
    }

    // Check if email already exists
    const existingEmail = await db.getUserByEmail(email.toLowerCase());
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Check if username already exists
    const usernameAvailable = await db.isUsernameAvailable(username);
    if (!usernameAvailable) {
      return res.status(409).json({ error: 'This username is already taken' });
    }

    // Create user
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await db.createUser(email.toLowerCase(), hashed, username, selectedAvatar);

    // Smurf detection: Check device fingerprint and set starting trust tier
    const deviceFingerprint = req.body.deviceFingerprint;
    if (deviceFingerprint) {
      try {
        // Check if device is associated with restricted/banned users
        const startingTier = await db.getStartingTierForDevice(deviceFingerprint);

        if (startingTier.reason) {
          // Device is associated with a problem account - adjust starting trust
          logger.warn(`[SMURF] New user ${user.id} (${username}) from device of ${startingTier.reason}`);
          await db.run(`
            UPDATE user_stats SET trust_score = ?, trust_tier = ? WHERE user_id = ?
          `, [startingTier.score, startingTier.tier, user.id]);

          // Log for admin review
          await db.run(`
            INSERT INTO trust_score_log (user_id, previous_score, new_score, change_amount, reason, created_at)
            VALUES (?, 50, ?, ?, ?, datetime('now'))
          `, [user.id, startingTier.score, startingTier.score - 50, `Smurf detection: ${startingTier.reason}`]);
        }

        // Record this device for the new user
        await db.recordDeviceFingerprint(user.id, deviceFingerprint);
      } catch (smurfErr) {
        logger.error('[SMURF] Detection error:', smurfErr);
        // Don't fail registration on smurf detection error
      }
    }

    // Always set email preferences - respect user's opt-in/opt-out choice
    try {
      await db.setEmailPreferences(user.id, { weeklyChallenge: emailOptIn, marketing: true });
      logger.info('[AUTH] Email preferences set for new user:', user.id, { weeklyChallenge: emailOptIn });
    } catch (prefErr) {
      logger.error('[AUTH] Failed to set email preferences:', prefErr);
      // Don't fail registration if preferences fail
    }

    // Set social links if provided (use normalized URLs)
    if (normalizedLinkedin || normalizedGithub || normalizedTwitter) {
      try {
        await db.updateUserProfile(user.id, {
          linkedin_url: normalizedLinkedin,
          github_url: normalizedGithub,
          twitter_url: normalizedTwitter
        });
        logger.info('[AUTH] Social links set for new user:', user.id);
      } catch (socialErr) {
        logger.error('[AUTH] Failed to set social links:', socialErr);
        // Don't fail registration if social links fail
      }
    }

    // Process referral code if provided
    if (referralCode && referralCode.trim()) {
      try {
        const referrer = await db.getReferrerByCode(referralCode.trim());
        if (referrer && referrer.id !== user.id) {
          const result = await db.createReferral(referrer.id, user.id, referralCode.trim());
          if (result) {
            logger.info('[AUTH] Referral created:', { referrer: referrer.username, referee: username, bonus: result.refereeBonus });
          }
        }
      } catch (refErr) {
        logger.error('[AUTH] Referral processing error:', refErr);
        // Don't fail registration if referral fails
      }
    }

    // Generate email verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours
    await db.createEmailVerification(user.id, tokenHash, expiresAt);

    // Send verification email
    const frontendUrl = FRONTEND_URL;
    const verifyUrl = `${frontendUrl}/verify-email?token=${rawToken}`;

    const emailResult = await sendEmail({
      to: email,
      subject: 'Verify your CodeArena email',
      text: `Welcome to CodeArena! Please verify your email by visiting: ${verifyUrl}\n\nThis link expires in 24 hours.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #581c87 100%); padding: 30px; text-align: center;">
            <h1 style="color: #22d3ee; margin: 0;">CodeArena</h1>
          </div>
          <div style="padding: 30px; background: #1e293b; color: #e2e8f0;">
            <h2 style="color: #ffffff; margin-top: 0;">Welcome, ${username}!</h2>
            <p>Thanks for signing up for CodeArena. Please verify your email address to unlock all features:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Verify Email
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 14px;">This link expires in 24 hours. If you didn't create this account, you can safely ignore this email.</p>
          </div>
          <div style="padding: 20px; background: #0f172a; text-align: center; color: #64748b; font-size: 12px;">
            <p>CodeArena - Competitive Coding Battles</p>
          </div>
        </div>
      `
    });
    if (emailResult.success) {
      logger.info('[AUTH] Verification email sent to:', email);
    } else {
      logger.error('[AUTH] Failed to send verification email:', emailResult.error);
    }

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        is_pro: false,
        email_verified: false
      },
      message: 'Account created! Please check your email to verify your account.'
    });
  } catch (err) {
    next(err);
  }
});

// Verify email
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    // Hash the token to look up in database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid verification
    const verification = await db.findValidEmailVerificationByTokenHash(tokenHash);
    if (!verification) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }

    // Mark user as verified
    await db.markUserEmailVerified(verification.user_id);
    await db.markEmailVerificationUsed(verification.id);

    // Get user for response
    const user = await db.getUserById(verification.user_id);

    logger.info('[AUTH] Email verified for user:', user.id, user.email);

    res.json({
      success: true,
      message: 'Email verified successfully! You can now log in.',
      user: {
        id: user.id,
        email: user.email,
        username: user.username
      }
    });
  } catch (err) {
    next(err);
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) {
      // Don't reveal if email exists
      return res.json({ success: true, message: 'If an account exists, a verification email has been sent.' });
    }

    // Auto-verify grandfather users (created before email verification was required)
    if (user.created_at && user.created_at < '2026-02-16') {
      await db.markUserEmailVerified(user.id);
      logger.info(`[AUTH] Auto-verified grandfather user ${user.id} on resend request`);
      return res.json({ success: true, message: 'Email is already verified.', auto_verified: true });
    }

    // Check if already verified
    const isVerified = await db.isUserEmailVerified(user.id);
    if (isVerified) {
      return res.json({ success: true, message: 'Email is already verified.' });
    }

    // Generate new verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours
    await db.createEmailVerification(user.id, tokenHash, expiresAt);

    // Send verification email
    const frontendUrl = FRONTEND_URL;
    const verifyUrl = `${frontendUrl}/verify-email?token=${rawToken}`;

    const emailResult = await sendEmail({
      to: email,
      subject: 'Verify your CodeArena email',
      text: `Please verify your email by visiting: ${verifyUrl}\n\nThis link expires in 24 hours.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #581c87 100%); padding: 30px; text-align: center;">
            <h1 style="color: #22d3ee; margin: 0;">CodeArena</h1>
          </div>
          <div style="padding: 30px; background: #1e293b; color: #e2e8f0;">
            <h2 style="color: #ffffff; margin-top: 0;">Verify Your Email</h2>
            <p>Click the button below to verify your email address:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}" style="background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Verify Email
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 14px;">This link expires in 24 hours.</p>
          </div>
          <div style="padding: 20px; background: #0f172a; text-align: center; color: #64748b; font-size: 12px;">
            <p>CodeArena - Competitive Coding Battles</p>
          </div>
        </div>
      `
    });
    if (emailResult.success) {
      logger.info('[AUTH] Resent verification email to:', email);
    } else {
      logger.error('[AUTH] Failed to resend verification email:', emailResult.error);
    }

    res.json({ success: true, message: 'Verification email sent.' });
  } catch (err) {
    next(err);
  }
});

/**
 * Local-only: issue a JWT for a fixed dev user so you can use the app without signing up.
 * Gated by NODE_ENV !== production AND CODEARENA_DEV_AUTO_LOGIN=1 (set by ./run.sh by default).
 */
router.post('/dev-session', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (process.env.CODEARENA_DEV_AUTO_LOGIN !== '1') {
      return res.status(404).json({ error: 'Not found' });
    }

    const rawSlot = Number(req.body?.slot);
    const slot = rawSlot === 2 ? 2 : 1;
    const DEV_EMAIL = slot === 2 ? 'localdev2@codearena.local' : 'localdev@codearena.local';
    const DEV_USERNAME = slot === 2 ? 'localdev2' : 'localdev';

    let user = await db.getUserByEmail(DEV_EMAIL);
    if (!user) {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hashed = await bcrypt.hash(randomPassword, SALT_ROUNDS);
      let username = DEV_USERNAME;
      let created = false;
      for (let attempt = 0; attempt < 8 && !created; attempt++) {
        try {
          user = await db.createUser(DEV_EMAIL, hashed, username, 'default-1');
          created = true;
        } catch (e) {
          const msg = String(e?.message || e || '');
          if (msg.includes('UNIQUE') || msg.includes('unique') || e?.code === 'SQLITE_CONSTRAINT') {
            username = `localdev_${crypto.randomBytes(3).toString('hex')}`;
          } else {
            throw e;
          }
        }
      }
      if (!created || !user?.id) {
        return res.status(500).json({ error: 'Could not create dev user' });
      }
    }

    const banStatus = await db.isUserBanned(user.id);
    if (banStatus) {
      return res.status(403).json({
        error: 'Dev user is banned',
        message: 'Unban localdev@codearena.local in the DB or delete the user and retry.'
      });
    }

    await db.markUserEmailVerified(user.id);

    const tokenExpiration = JWT_EXPIRES_REMEMBER;
    const tokenVersion = await db.getTokenVersion(user.id);
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar || 'default-1',
        tokenVersion
      },
      SECRET,
      { expiresIn: tokenExpiration }
    );

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const userAgentInfo = parseUserAgent(req.headers['user-agent']);
    const clientIP = getClientIP(req);
    try {
      await db.createUserSession(user.id, tokenHash, {
        deviceType: userAgentInfo.deviceType,
        browser: userAgentInfo.browser,
        os: userAgentInfo.os,
        ipAddress: clientIP,
        location: null
      });
    } catch (sessionErr) {
      logger.error('[AUTH] dev-session session:', sessionErr.message);
    }

    const isPro = await db.isUserPro(user.id);
    const isAdmin = user.is_admin === 1;
    const emailVerified = true;

    logger.info(`[AUTH] dev-session issued for user ${user.id} (${user.username})`);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        is_pro: isPro,
        is_admin: isAdmin,
        email_verified: emailVerified
      }
    });
  } catch (err) {
    return next(err);
  }
});

// Login (by username or email)
router.post('/login', chains.login, async (req, res, next) => {
  try {
    const {
      username,
      password,
      rememberMe = false,
      deviceToken,
      trustedDeviceToken
    } = req.body;
    const loginDeviceToken = deviceToken || trustedDeviceToken;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username or email and password required' });
    }

    // Look up user by username or email (case-insensitive)
    let user = await db.getUserByUsernameWithPassword(username);
    if (!user) {
      // Try email if username lookup failed
      user = await db.getUserByEmailWithPassword(username.toLowerCase());
    }
    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is banned/suspended
    const banStatus = await db.isUserBanned(user.id);
    if (banStatus) {
      if (banStatus.is_permanent || !banStatus.expires_at) {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Your account has been permanently suspended due to fair play violations. Contact support@codearena.co to appeal.',
          suspended: true,
          permanent: true
        });
      } else {
        const expiresAt = new Date(banStatus.expires_at);
        return res.status(403).json({
          error: 'Account suspended',
          message: `Your account is suspended until ${expiresAt.toLocaleString()}. Reason: ${banStatus.reason}`,
          suspended: true,
          permanent: false,
          expiresAt: banStatus.expires_at
        });
      }
    }

    // Check if 2FA is enabled for this user
    const is2FAEnabled = await db.is2FAEnabled(user.id);

    if (is2FAEnabled) {
      // Check if user has a valid trusted device token (skip 2FA)
      if (loginDeviceToken) {
        const deviceTokenHash = crypto.createHash('sha256').update(loginDeviceToken).digest('hex');
        const trustedDevice = await db.verifyTrustedDevice(user.id, deviceTokenHash);

        if (trustedDevice) {
          // Valid trusted device - skip 2FA and proceed with normal login
          const ipAddress = getClientIP(req);
          const userAgent = req.headers['user-agent'] || 'unknown';
          await db.log2FAAction(user.id, '2fa_skipped_trusted_device', true, ipAddress, userAgent, { device_id: trustedDevice.id });
          logger.info(`[AUTH] 2FA skipped for user ${user.id} (trusted device ${trustedDevice.id})`);

          // Continue to normal login flow (fall through to code below the if block)
        } else {
          // Invalid or expired device token - require 2FA
          logger.info(`[AUTH] Invalid trusted device token for user ${user.id}`);
        }
      }

      // If no valid trusted device, require 2FA
      if (!loginDeviceToken || !(await db.verifyTrustedDevice(user.id, crypto.createHash('sha256').update(loginDeviceToken || '').digest('hex')))) {
        // 2FA is enabled - issue a pending token instead of a full token
        // The pending token has a short expiration and can only be used for 2FA verification
        const pendingToken = await issuePendingLoginToken({
          userId: user.id,
          rememberMe,
          tokenVersion: await db.getTokenVersion(user.id)
        });

        // Log the 2FA challenge
        const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        await db.log2FAAction(user.id, '2fa_challenge_issued', true, ipAddress, userAgent);

        logger.info(`[AUTH] 2FA challenge issued for user ${user.id}`);

        return res.json({
          success: true,
          requires2FA: true,
          pendingToken,
          message: 'Please enter your 2FA code to complete login'
        });
      }
    }

    // No 2FA required (either disabled or trusted device) - proceed with normal login
    // Use longer expiration if "remember me" is checked
    const tokenExpiration = rememberMe ? JWT_EXPIRES_REMEMBER : JWT_EXPIRES_SESSION;

    // Get token version for invalidation tracking
    const tokenVersion = await db.getTokenVersion(user.id);

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: tokenExpiration }
    );

    // Check Pro status
    const isPro = await db.isUserPro(user.id);

    // Check email verification status
    let emailVerified = await db.isUserEmailVerified(user.id);

    // Auto-verify grandfather users (created before email verification was required)
    if (!emailVerified && user.created_at && user.created_at < '2026-02-16') {
      await db.markUserEmailVerified(user.id);
      emailVerified = true;
      logger.info(`[AUTH] Auto-verified grandfather user ${user.id} (created ${user.created_at})`);
    }

    // For password login, use database admin status only (don't auto-grant based on email)
    // Admin status via email is only granted through verified Google OAuth
    const isAdmin = user.is_admin === 1;

    // Create user session immediately (geolocation added in background)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const userAgentInfo = parseUserAgent(req.headers['user-agent']);
    const clientIP = getClientIP(req);

    try {
      await db.createUserSession(user.id, tokenHash, {
        deviceType: userAgentInfo.deviceType,
        browser: userAgentInfo.browser,
        os: userAgentInfo.os,
        ipAddress: clientIP,
        location: null
      });
    } catch (sessionErr) {
      logger.error('[AUTH] Failed to create session:', sessionErr.message);
    }

    // Send response immediately, don't block on geolocation
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        is_pro: isPro,
        is_admin: isAdmin,
        email_verified: emailVerified
      }
    });

    // Update session with geolocation in background (non-blocking)
    getLocationFromIP(clientIP).then(location => {
      if (location) {
        db.run('UPDATE user_sessions SET location = ? WHERE token_hash = ?', [location, tokenHash]).catch(() => {});
      }
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

// Google OAuth login/signup
router.post('/google', async (req, res, next) => {
  try {
    const { credential, rememberMe = false } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential required' });
    }

    if (!googleClient) {
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    // Verify the Google token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (err) {
      logger.error('[AUTH] Google token verification failed:', err.message);
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    // Never link or authenticate an account by an unverified Google email.
    if (!payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: 'Google account email is not verified' });
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split('@')[0];

    // Check if user exists with this Google ID
    let user = await db.getUserByGoogleId(googleId);

    if (!user) {
      // Check if user exists with this email (link accounts)
      const existingUser = await db.getUserByEmail(email.toLowerCase());

      if (existingUser) {
        // Link Google account to existing user
        const link = await db.linkOAuthIdentity(existingUser.id, 'google', googleId);
        if (link.reclaimed) {
          logger.warn(`[AUTH] google sign-in reclaimed unverified account ${existingUser.id}: earlier password, sessions and second factors removed`);
        }
        user = await db.getUserById(existingUser.id);
      } else {
        // Create new user with Google
        // Generate a random placeholder username (user will choose their own on complete-profile page)
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        let username = `player_${randomSuffix}`;

        // Ensure uniqueness
        let counter = 1;
        while (!(await db.isUsernameAvailable(username))) {
          username = `player_${randomSuffix}${counter}`;
          counter++;
        }

        user = await db.createUserFromGoogle(email.toLowerCase(), googleId, username);

        // Set default email preferences for new Google OAuth users (opted-in by default)
        try {
          await db.setEmailPreferences(user.id, { weeklyChallenge: true, marketing: true });
          logger.info('[AUTH] Email preferences set for new Google user:', user.id);
        } catch (prefErr) {
          logger.error('[AUTH] Failed to set email preferences for Google user:', prefErr);
        }
      }
    }

    // Check if user is banned/suspended
    const banStatus = await db.isUserBanned(user.id);
    if (banStatus) {
      if (banStatus.is_permanent || !banStatus.expires_at) {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Your account has been permanently suspended due to fair play violations. Contact support@codearena.co to appeal.',
          suspended: true,
          permanent: true
        });
      } else {
        const expiresAt = new Date(banStatus.expires_at);
        return res.status(403).json({
          error: 'Account suspended',
          message: `Your account is suspended until ${expiresAt.toLocaleString()}. Reason: ${banStatus.reason}`,
          suspended: true,
          permanent: false,
          expiresAt: banStatus.expires_at
        });
      }
    }

    // Check if 2FA is enabled for this user (only for existing users, not new signups)
    const isExistingUser = user.created_at && (Date.now() - new Date(user.created_at).getTime()) > 10000;
    const is2FAEnabled = isExistingUser && await db.is2FAEnabled(user.id);

    if (is2FAEnabled) {
      // 2FA is enabled - issue a pending token instead of a full token
      const pendingToken = await issuePendingLoginToken({
        userId: user.id,
        rememberMe,
        tokenVersion: await db.getTokenVersion(user.id)
      });

      // Log the 2FA challenge
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      await db.log2FAAction(user.id, '2fa_challenge_issued', true, ipAddress, userAgent, { via: 'google_oauth' });

      logger.info(`[AUTH] 2FA challenge issued for Google OAuth user ${user.id}`);

      return res.json({
        success: true,
        requires2FA: true,
        pendingToken,
        message: 'Please enter your 2FA code to complete login'
      });
    }

    // Generate JWT token
    const tokenExpiration = rememberMe ? JWT_EXPIRES_REMEMBER : JWT_EXPIRES_SESSION;
    const tokenVersion = await db.getTokenVersion(user.id);
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: tokenExpiration }
    );

    // Check Pro status
    const isPro = await db.isUserPro(user.id);

    // Promote-only admin sync from ADMIN_EMAILS env var.
    // We must NEVER demote a DB-granted admin just because their email isn't
    // listed in the env var (that would strip admin from anyone granted via
    // the DB whenever they OAuth-sign-in). Only flip 0 -> 1 here; demotion
    // is a deliberate action that happens elsewhere.
    const envSaysAdmin = isAdminEmail(user.email);
    const currentlyAdmin = user.is_admin === 1;
    if (envSaysAdmin && !currentlyAdmin) {
      await db.setUserAdminStatus(user.id, true);
    }
    const isAdmin = currentlyAdmin || envSaysAdmin;

    // Google OAuth users are always email-verified (Google verified their email)
    const emailVerified = await db.isUserEmailVerified(user.id);
    if (!emailVerified) {
      await db.markUserEmailVerified(user.id);
      logger.info(`[AUTH] Auto-verified Google OAuth user ${user.id}`);
    }

    // Create user session immediately (geolocation added in background)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const userAgentInfo = parseUserAgent(req.headers['user-agent']);
    const clientIP = getClientIP(req);

    try {
      await db.createUserSession(user.id, tokenHash, {
        deviceType: userAgentInfo.deviceType,
        browser: userAgentInfo.browser,
        os: userAgentInfo.os,
        ipAddress: clientIP,
        location: null
      });
    } catch (sessionErr) {
      logger.error('[AUTH] Failed to create session:', sessionErr.message);
    }

    // Send response immediately, don't block on geolocation
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        is_pro: isPro,
        is_admin: isAdmin,
        email_verified: true,
        username_chosen: user.username_chosen,
        has_onboarded: user.has_onboarded
      },
      isNewUser: !user.created_at || (Date.now() - new Date(user.created_at).getTime()) < 10000
    });

    // Update session with geolocation in background (non-blocking)
    getLocationFromIP(clientIP).then(location => {
      if (location) {
        db.run('UPDATE user_sessions SET location = ? WHERE token_hash = ?', [location, tokenHash]).catch(() => {});
      }
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

// GitHub OAuth login/signup
router.post('/github', async (req, res, next) => {
  try {
    const { code, rememberMe = false } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'GitHub authorization code required' });
    }

    // Check if GitHub OAuth is configured
    const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
    const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return res.status(500).json({ error: 'GitHub OAuth not configured' });
    }

    // Exchange code for access token
    let accessToken;
    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          redirect_uri: new URL('/auth/github/callback', FRONTEND_URL).toString(),
          code
        })
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        logger.error('[AUTH] GitHub token exchange failed:', tokenData.error_description);
        return res.status(401).json({ error: 'Invalid GitHub authorization code' });
      }

      accessToken = tokenData.access_token;
    } catch (err) {
      logger.error('[AUTH] GitHub token exchange error:', err.message);
      return res.status(500).json({ error: 'Failed to exchange GitHub authorization code' });
    }

    // Fetch user info from GitHub
    let githubUser;
    try {
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (!userResponse.ok) {
        throw new Error(`GitHub API error: ${userResponse.status}`);
      }

      githubUser = await userResponse.json();
    } catch (err) {
      logger.error('[AUTH] GitHub user fetch failed:', err.message);
      return res.status(500).json({ error: 'Failed to fetch GitHub user info' });
    }

    // Fetch user emails to get primary email (in case user has private email)
    let email = githubUser.email;
    if (!email) {
      try {
        const emailsResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        });

        if (emailsResponse.ok) {
          const emails = await emailsResponse.json();
          // Find primary verified email
          const primaryEmail = emails.find(e => e.primary && e.verified);
          if (primaryEmail) {
            email = primaryEmail.email;
          } else {
            // Fallback to any verified email
            const verifiedEmail = emails.find(e => e.verified);
            if (verifiedEmail) {
              email = verifiedEmail.email;
            }
          }
        }
      } catch (err) {
        logger.error('[AUTH] GitHub emails fetch failed:', err.message);
      }
    }

    if (!email) {
      return res.status(400).json({
        error: 'No verified email found',
        message: 'Your GitHub account must have a verified email address to sign in'
      });
    }

    const githubId = githubUser.id.toString();
    const name = githubUser.name || githubUser.login || email.split('@')[0];

    // Check if user exists with this GitHub ID
    let user = await db.getUserByGitHubId(githubId);

    if (!user) {
      // Check if user exists with this email (link accounts)
      const existingUser = await db.getUserByEmail(email.toLowerCase());

      if (existingUser) {
        // Link GitHub account to existing user
        const link = await db.linkOAuthIdentity(existingUser.id, 'github', githubId);
        if (link.reclaimed) {
          logger.warn(`[AUTH] github sign-in reclaimed unverified account ${existingUser.id}: earlier password, sessions and second factors removed`);
        }
        user = await db.getUserById(existingUser.id);
      } else {
        // Create new user with GitHub
        // Generate a random placeholder username (user will choose their own on complete-profile page)
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        let username = `player_${randomSuffix}`;

        // Ensure uniqueness
        let counter = 1;
        while (!(await db.isUsernameAvailable(username))) {
          username = `player_${randomSuffix}${counter}`;
          counter++;
        }

        user = await db.createUserFromGitHub(email.toLowerCase(), githubId, username);

        // Set default email preferences for new GitHub OAuth users (opted-in by default)
        try {
          await db.setEmailPreferences(user.id, { weeklyChallenge: true, marketing: true });
          logger.info('[AUTH] Email preferences set for new GitHub user:', user.id);
        } catch (prefErr) {
          logger.error('[AUTH] Failed to set email preferences for GitHub user:', prefErr);
        }
      }
    }

    // Store GitHub access token for game push and other features
    try {
      await db.updateUserGitHubToken(user.id, accessToken);
    } catch (tokenErr) {
      logger.warn('[AUTH] Failed to store GitHub token:', tokenErr.message);
    }

    // Check if user is banned/suspended
    const banStatus = await db.isUserBanned(user.id);
    if (banStatus) {
      if (banStatus.is_permanent || !banStatus.expires_at) {
        return res.status(403).json({
          error: 'Account suspended',
          message: 'Your account has been permanently suspended due to fair play violations. Contact support@codearena.co to appeal.',
          suspended: true,
          permanent: true
        });
      } else {
        const expiresAt = new Date(banStatus.expires_at);
        return res.status(403).json({
          error: 'Account suspended',
          message: `Your account is suspended until ${expiresAt.toLocaleString()}. Reason: ${banStatus.reason}`,
          suspended: true,
          permanent: false,
          expiresAt: banStatus.expires_at
        });
      }
    }

    // Check if 2FA is enabled for this user (only for existing users, not new signups)
    const isExistingUser = user.created_at && (Date.now() - new Date(user.created_at).getTime()) > 10000;
    const is2FAEnabled = isExistingUser && await db.is2FAEnabled(user.id);

    if (is2FAEnabled) {
      // 2FA is enabled - issue a pending token instead of a full token
      const pendingToken = await issuePendingLoginToken({
        userId: user.id,
        rememberMe,
        tokenVersion: await db.getTokenVersion(user.id)
      });

      // Log the 2FA challenge
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      await db.log2FAAction(user.id, '2fa_challenge_issued', true, ipAddress, userAgent, { via: 'github_oauth' });

      logger.info(`[AUTH] 2FA challenge issued for GitHub OAuth user ${user.id}`);

      return res.json({
        success: true,
        requires2FA: true,
        pendingToken,
        message: 'Please enter your 2FA code to complete login'
      });
    }

    // Generate JWT token
    const tokenExpiration = rememberMe ? JWT_EXPIRES_REMEMBER : JWT_EXPIRES_SESSION;
    const tokenVersion = await db.getTokenVersion(user.id);
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: tokenExpiration }
    );

    // Check Pro status
    const isPro = await db.isUserPro(user.id);

    // Promote-only admin sync from ADMIN_EMAILS env var.
    // We must NEVER demote a DB-granted admin just because their email isn't
    // listed in the env var (that would strip admin from anyone granted via
    // the DB whenever they OAuth-sign-in). Only flip 0 -> 1 here; demotion
    // is a deliberate action that happens elsewhere.
    const envSaysAdmin = isAdminEmail(user.email);
    const currentlyAdmin = user.is_admin === 1;
    if (envSaysAdmin && !currentlyAdmin) {
      await db.setUserAdminStatus(user.id, true);
    }
    const isAdmin = currentlyAdmin || envSaysAdmin;

    // GitHub OAuth users are always email-verified (GitHub verified their email)
    const emailVerified = await db.isUserEmailVerified(user.id);
    if (!emailVerified) {
      await db.markUserEmailVerified(user.id);
      logger.info(`[AUTH] Auto-verified GitHub OAuth user ${user.id}`);
    }

    // Create user session immediately (geolocation added in background)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const userAgentInfo = parseUserAgent(req.headers['user-agent']);
    const clientIP = getClientIP(req);

    try {
      await db.createUserSession(user.id, tokenHash, {
        deviceType: userAgentInfo.deviceType,
        browser: userAgentInfo.browser,
        os: userAgentInfo.os,
        ipAddress: clientIP,
        location: null
      });
    } catch (sessionErr) {
      logger.error('[AUTH] Failed to create session:', sessionErr.message);
    }

    // Send response immediately, don't block on geolocation
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        is_pro: isPro,
        is_admin: isAdmin,
        email_verified: true,
        username_chosen: user.username_chosen,
        has_onboarded: user.has_onboarded
      },
      isNewUser: !user.created_at || (Date.now() - new Date(user.created_at).getTime()) < 10000
    });

    // Update session with geolocation in background (non-blocking)
    getLocationFromIP(clientIP).then(location => {
      if (location) {
        db.run('UPDATE user_sessions SET location = ? WHERE token_hash = ?', [location, tokenHash]).catch(() => {});
      }
    }).catch(() => {});
  } catch (err) {
    next(err);
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await db.getUserById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has a real password (not Google OAuth placeholder)
    const userWithPassword = await db.getUserByIdWithPassword(req.user.sub);
    const hasPassword = userWithPassword && userWithPassword.password !== '$google_oauth_user$';

    const stats = await db.getUserStats(user.id);

    // Check email verification - auto-verify grandfather users
    let emailVerified = await db.isUserEmailVerified(user.id);
    if (!emailVerified && user.created_at && user.created_at < '2026-02-16') {
      await db.markUserEmailVerified(user.id);
      emailVerified = true;
      logger.info(`[AUTH] Auto-verified grandfather user ${user.id} (created ${user.created_at})`);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        bio: user.bio,
        github_url: user.github_url,
        linkedin_url: user.linkedin_url,
        twitter_url: user.twitter_url,
        created_at: user.created_at,
        has_onboarded: user.has_onboarded === 1,
        practice_demo_shown: !!user.practice_demo_shown_at,
        practice_demo_shown_at: user.practice_demo_shown_at || null,
        is_pro: user.is_pro === 1,
        is_admin: user.is_admin === 1,
        subscription_type: user.subscription_type || 'pro',
        email_verified: emailVerified,
        username_changed_at: user.username_changed_at,
        username_chosen: user.username_chosen,
        username_change_count: user.username_change_count || 0,
        has_password: hasPassword
      },
      stats: stats || {
        wins: 0,
        losses: 0,
        ties: 0,
        total_battles: 0,
        rating: 1000
      }
    });
  } catch (err) {
    next(err);
  }
});

// Claim practice demo so it is only shown once per user
router.post('/me/practice-demo/claim', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const result = await db.claimPracticeDemo(userId);

    res.json({
      success: true,
      shouldShow: result.claimed,
      alreadyShown: result.alreadyShown,
      practice_demo_shown_at: result.practiceDemoShownAt
    });
  } catch (err) {
    next(err);
  }
});

// Update profile
router.put('/me', authMiddleware, chains.updateProfile, async (req, res, next) => {
  try {
    const { username, avatar, bio, github_url, linkedin_url, twitter_url } = req.body;
    const userId = req.user.sub;
    const currentUser = await db.getUserById(userId);

    // Validate username if provided
    if (username !== undefined) {
      // Check profanity first for specific error message
      if (containsProfanity(username)) {
        return res.status(400).json({ error: 'Username contains inappropriate language' });
      }

      if (!isValidUsername(username)) {
        return res.status(400).json({
          error: 'Username must be 3-20 characters, letters, numbers, and underscores only'
        });
      }

      const reserved = ['admin', 'administrator', 'moderator', 'mod', 'support', 'help', 'codearena', 'system'];
      if (reserved.includes(username.toLowerCase())) {
        return res.status(400).json({ error: 'This username is reserved' });
      }

      // Check 7-day cooldown for username changes (first 2 changes are free, then 7-day cooldown)
      const changeCount = currentUser.username_change_count || 0;
      if (changeCount >= 2 && currentUser.username_changed_at) {
        const lastChange = new Date(currentUser.username_changed_at);
        const daysSinceChange = (Date.now() - lastChange.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceChange < 7) {
          const daysRemaining = Math.ceil(7 - daysSinceChange);
          return res.status(429).json({
            error: `You can only change your username once every 7 days. Please wait ${daysRemaining} more day${daysRemaining === 1 ? '' : 's'}.`,
            days_remaining: daysRemaining,
            next_change_date: new Date(lastChange.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
          });
        }
      }

      const available = await db.isUsernameAvailable(username, userId);
      if (!available) {
        return res.status(409).json({ error: 'This username is already taken' });
      }
    }

    // Validate avatar if provided
    if (avatar !== undefined && !isValidAvatar(avatar)) {
      return res.status(400).json({ error: 'Invalid avatar selection' });
    }

    // Validate bio length
    if (bio !== undefined && bio.length > 500) {
      return res.status(400).json({ error: 'Bio must be 500 characters or less' });
    }

    // Validate GitHub URL if provided
    if (github_url !== undefined && github_url !== '' && github_url !== null) {
      const githubPattern = /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+\/?$/;
      if (!githubPattern.test(github_url)) {
        return res.status(400).json({ error: 'Invalid GitHub URL. Use format: https://github.com/username' });
      }
    }

    // Validate LinkedIn URL if provided
    if (linkedin_url !== undefined && linkedin_url !== '' && linkedin_url !== null) {
      const linkedinPattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/;
      if (!linkedinPattern.test(linkedin_url)) {
        return res.status(400).json({ error: 'Invalid LinkedIn URL. Use format: https://linkedin.com/in/username' });
      }
    }

    // Validate Twitter/X URL if provided
    if (twitter_url !== undefined && twitter_url !== '' && twitter_url !== null) {
      const twitterPattern = /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?$/;
      if (!twitterPattern.test(twitter_url)) {
        return res.status(400).json({ error: 'Invalid Twitter/X URL. Use format: https://x.com/username' });
      }
    }

    // Update profile - handle case where social link columns don't exist yet
    try {
      await db.updateUserProfile(userId, { username, avatar, bio, github_url, linkedin_url, twitter_url });
    } catch (err) {
      // If social link columns don't exist, try updating without them
      if (err.message && err.message.includes('no such column')) {
        logger.warn('[AUTH] Social link columns not yet migrated, updating without them');
        await db.updateUserProfile(userId, { username, avatar, bio });
        if (github_url || linkedin_url || twitter_url) {
          return res.status(503).json({
            error: 'Social links feature is being deployed. Please try again in a few minutes.',
            retry: true
          });
        }
      } else {
        throw err;
      }
    }

    // Get updated user
    const user = await db.getUserById(userId);

    // Generate new token with updated info
    const tokenVersion = await db.getTokenVersion(user.id);
    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: JWT_EXPIRES_REMEMBER }
    );
    await rotateCurrentSessionToken(req, user.id, token);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        bio: user.bio,
        github_url: user.github_url,
        linkedin_url: user.linkedin_url,
        twitter_url: user.twitter_url
      }
    });
  } catch (err) {
    next(err);
  }
});

// Forgot password
//
// SECURITY: This endpoint must NOT leak whether an account exists for the
// supplied email. Both the "user found" and "user not found" paths return
// the same status code (200) and the same response body. We also add a
// small randomized delay on the not-found path so response timing cannot be
// used to enumerate accounts either.
const GENERIC_FORGOT_PASSWORD_RESPONSE = Object.freeze({
  success: true,
  message: 'If an account exists for that email, a reset link has been sent.'
});

router.post('/forgot-password', forgotPasswordLimiter, chains.forgotPassword, async (req, res, next) => {
  try {
    const { email } = req.body;
    logger.info('[FORGOT-PASSWORD] Request received');
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const user = await db.getUserByEmail(email.toLowerCase());
    // Log internally for monitoring / abuse detection, but never expose
    // existence to the caller.
    logger.info('[FORGOT-PASSWORD] Lookup result:', user ? `hit id=${user.id}` : 'miss');

    // If no account exists with this email, return the same generic response
    // as the happy path, after a small randomized delay so response timing is
    // indistinguishable from the work the hit path does.
    if (!user) {
      const jitterMs = 50 + Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, jitterMs));
      return res.status(200).json(GENERIC_FORGOT_PASSWORD_RESPONSE);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour
    await db.createPasswordReset(user.id, tokenHash, expiresAt);

    const frontendUrl = FRONTEND_URL;
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;

    logger.info('[FORGOT-PASSWORD] Sending email to:', user.email);
    logger.info('[FORGOT-PASSWORD] RESEND_API_KEY set:', !!process.env.RESEND_API_KEY);
    const emailResult = await sendEmail({
      to: user.email,
      subject: 'Reset your CodeArena password',
      text: `Reset your password by visiting: ${resetUrl}\n\nThis link expires in 1 hour.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #581c87 100%); padding: 30px; text-align: center;">
            <h1 style="color: #22d3ee; margin: 0;">CodeArena</h1>
          </div>
          <div style="padding: 30px; background: #1e293b; color: #e2e8f0;">
            <h2 style="color: #ffffff; margin-top: 0;">Reset Your Password</h2>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: linear-gradient(135deg, #06b6d4, #8b5cf6); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          </div>
          <div style="padding: 20px; background: #0f172a; text-align: center; color: #64748b; font-size: 12px;">
            <p>CodeArena - Competitive Coding Battles</p>
          </div>
        </div>
      `
    });
    if (!emailResult.success) {
      logger.error('[FORGOT-PASSWORD] Failed to send email:', emailResult.error);
    }

    // Return the same generic response as the not-found path so the caller
    // cannot distinguish "we sent a reset email" from "no such account".
    res.status(200).json(GENERIC_FORGOT_PASSWORD_RESPONSE);
  } catch (err) {
    next(err);
  }
});

// Reset password
router.post('/reset-password', resetPasswordLimiter, chains.resetPassword, async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password required' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await db.findValidResetByTokenHash(tokenHash);
    if (!row) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const hashed = await bcrypt.hash(password, SALT_ROUNDS);
    await db.updateUserPassword(row.user_id, hashed);
    await db.markResetUsed(row.id);

    // SECURITY: Increment token version to invalidate all existing sessions
    await db.incrementTokenVersion(row.user_id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Change password (authenticated)
router.post('/change-password', authMiddleware, chains.changePassword, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // Validate new password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    // Get user with password hash
    const user = await db.getUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and save new password
    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.updateUserPassword(user.id, hashed);

    // SECURITY: Increment token version to invalidate all existing sessions
    const newTokenVersion = await db.incrementTokenVersion(user.id);

    // Issue a new token for the current session
    const newToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion: newTokenVersion
      },
      SECRET,
      { expiresIn: JWT_EXPIRES_REMEMBER }
    );
    await rotateCurrentSessionToken(req, user.id, newToken);

    res.json({
      success: true,
      message: 'Password changed successfully',
      token: newToken // Client should update stored token
    });
  } catch (err) {
    next(err);
  }
});

// Set password for Google OAuth users who don't have one
router.post('/set-password', authMiddleware, async (req, res, next) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Get user with password hash
    const user = await db.getUserByIdWithPassword(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow if user doesn't have a real password (Google OAuth user)
    if (user.password !== '$google_oauth_user$') {
      return res.status(400).json({ error: 'You already have a password. Use change-password instead.' });
    }

    // Hash and save new password
    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.updateUserPassword(user.id, hashed);

    res.json({ success: true, message: 'Password set successfully' });
  } catch (err) {
    next(err);
  }
});

// Initiate email change (authenticated)
router.post('/change-email', authMiddleware, async (req, res, next) => {
  try {
    const { newEmail, password } = req.body;
    const userId = req.user.sub;

    if (!newEmail || !password) {
      return res.status(400).json({ error: 'New email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Get current user with password
    const user = await db.getUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if new email is same as current
    if (newEmail.toLowerCase() === user.email.toLowerCase()) {
      return res.status(400).json({ error: 'New email must be different from current email' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    // Check if new email is already in use
    const emailAvailable = await db.isEmailAvailable(newEmail, userId);
    if (!emailAvailable) {
      return res.status(409).json({ error: 'This email is already in use' });
    }

    // Generate verification token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

    // Store email change request
    await db.createEmailChange(userId, newEmail, tokenHash, expiresAt);

    // Build verification URL.
    // The token lives in the `email_changes` table and is consumed by the
    // POST /auth/verify-email-change endpoint, so the link in the email must
    // point at the frontend `/verify-email-change` page (NOT `/verify-email`,
    // which is for the initial signup verification flow against a different
    // table).
    const frontendUrl = FRONTEND_URL;
    const verifyUrl = `${frontendUrl}/verify-email-change?token=${rawToken}`;

    // Send verification email to NEW address
    await sendEmailChangeVerification({
      to: newEmail,
      username: user.username,
      verifyUrl
    });

    // Send security alert to OLD address
    await sendEmailChangeAlert({
      to: user.email,
      username: user.username,
      newEmail
    });

    res.json({
      success: true,
      message: 'Verification email sent to your new email address'
    });
  } catch (err) {
    next(err);
  }
});

// Verify email change
router.post('/verify-email-change', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    // Hash the token to look up in database
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid email change request
    const emailChange = await db.findValidEmailChangeByTokenHash(tokenHash);
    if (!emailChange) {
      return res.status(400).json({ error: 'Invalid or expired verification link' });
    }

    // Get user info before update (for sending confirmation)
    const user = await db.getUserById(emailChange.user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldEmail = user.email;
    const newEmail = emailChange.new_email;

    // Update user's email
    await db.updateUserEmail(user.id, newEmail);

    // Mark email change as used
    await db.markEmailChangeUsed(emailChange.id);

    // Send confirmation to both emails
    await sendEmailChangeConfirmation({
      to: oldEmail,
      username: user.username,
      isOldEmail: true
    });

    await sendEmailChangeConfirmation({
      to: newEmail,
      username: user.username,
      isOldEmail: false
    });

    // Generate new JWT with updated email
    const tokenVersion = await db.getTokenVersion(user.id);
    const newToken = jwt.sign(
      {
        sub: user.id,
        email: newEmail,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: JWT_EXPIRES_REMEMBER }
    );
    await createSessionForToken(req, user.id, newToken);

    res.json({
      success: true,
      message: 'Email changed successfully',
      token: newToken,
      user: {
        id: user.id,
        email: newEmail,
        username: user.username,
        avatar: user.avatar,
        is_pro: user.is_pro
      }
    });
  } catch (err) {
    next(err);
  }
});

// Complete onboarding
router.post('/onboarding/complete', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    await db.completeOnboarding(userId);
    res.json({ success: true, message: 'Onboarding completed' });
  } catch (err) {
    next(err);
  }
});

// Admin: Lookup user and their friend requests
function hasValidAdminKey(req) {
  const configuredKey = process.env.ADMIN_KEY;
  const providedKey = req.headers['x-admin-key'];

  if (typeof configuredKey !== 'string' || configuredKey.length === 0) {
    logger.error('[AUTH] ADMIN_KEY is not configured; rejecting admin endpoint request');
    return { valid: false, status: 503, error: 'Admin endpoints are not configured' };
  }

  if (typeof providedKey !== 'string' || providedKey.length === 0) {
    return { valid: false, status: 401, error: 'Unauthorized' };
  }

  // Hash both sides first so the comparison leaks neither content nor length.
  return {
    valid: isValidAdminKey(providedKey, configuredKey),
    status: 401,
    error: 'Unauthorized'
  };
}

router.get('/admin/user/:username', adminLimiter, async (req, res, next) => {
  try {
    const adminAuth = hasValidAdminKey(req);
    if (!adminAuth.valid) {
      return res.status(adminAuth.status).json({ error: adminAuth.error });
    }

    const { username } = req.params;
    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const incomingRequests = await db.getPendingFriendRequests(user.id);
    const outgoingRequests = await db.getSentFriendRequests(user.id);
    const friends = await db.getUserFriends(user.id, 50, 0);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      },
      incomingRequests,
      outgoingRequests,
      friends
    });
  } catch (err) {
    next(err);
  }
});

// Admin: Reset user password
router.post('/admin/reset-password', adminLimiter, async (req, res, next) => {
  try {
    const adminAuth = hasValidAdminKey(req);
    if (!adminAuth.valid) {
      return res.status(adminAuth.status).json({ error: adminAuth.error });
    }

    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Username and newPassword required' });
    }

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.updateUserPassword(user.id, hashed);

    // SECURITY: Increment token version to invalidate all existing sessions
    await db.incrementTokenVersion(user.id);

    res.json({ success: true, message: `Password reset for ${username}` });
  } catch (err) {
    next(err);
  }
});

// Export user data (GDPR compliance - right to data portability)
router.get('/export-data', authMiddleware, async (req, res, next) => {
  const userId = req.user.sub;
  logger.info('[AUTH] Data export request for user:', userId);

  try {
    const exportData = await db.exportUserData(userId);

    if (!exportData) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Set headers for file download
    const filename = `codearena-data-export-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.json({
      exportedAt: new Date().toISOString(),
      userId: userId,
      data: exportData
    });
  } catch (err) {
    logger.error('[AUTH] Data export error:', err);
    next(err);
  }
});

// Delete account
router.delete('/delete-account', authMiddleware, async (req, res, next) => {
  const userId = req.user.sub;
  logger.info('[AUTH] Delete account request for user:', userId);
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required to delete account' });
    }

    // Get user and verify password
    const user = await db.getUserByIdWithPassword(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      logger.info('[AUTH] Delete account failed - invalid password');
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Delete the account
    await db.deleteUserAccount(userId);
    logger.info('[AUTH] Account deleted successfully for user:', userId);

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    logger.error('[AUTH] Delete account error:', err);
    next(err);
  }
});

// ============================================
// COOKIE CONSENT (Per-User)
// ============================================

// Get user's cookie consent preferences
router.get('/consent', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const consent = await db.getUserCookieConsent(userId);
    res.json({ consent });
  } catch (err) {
    logger.error('[AUTH] Get consent error:', err);
    next(err);
  }
});

// Save user's cookie consent preferences
router.post('/consent', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { analytics, functional } = req.body;

    await db.saveUserCookieConsent(userId, analytics, functional);

    // Also save to consent_records for audit trail
    await db.saveConsentRecord({
      userId,
      anonymousId: null,
      analyticsConsent: analytics,
      functionalConsent: functional,
      action: 'update',
      ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
      userAgent: req.headers['user-agent'] || null
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('[AUTH] Save consent error:', err);
    next(err);
  }
});

// Export middleware for use in other routes
router.authMiddleware = authMiddleware;

// ============================================
// ACTIVE SESSIONS
// ============================================

// Helper to parse user agent
function parseUserAgent(userAgent) {
  if (!userAgent) return { browser: 'Unknown', os: 'Unknown', deviceType: 'desktop' };

  let browser = 'Unknown';
  let os = 'Unknown';
  let deviceType = 'desktop';

  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
  else if (userAgent.includes('Edg')) browser = 'Edge';
  else if (userAgent.includes('Opera') || userAgent.includes('OPR')) browser = 'Opera';

  // Detect OS
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac OS')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  // Detect device type
  if (userAgent.includes('Mobile') || userAgent.includes('Android')) deviceType = 'mobile';
  else if (userAgent.includes('iPad') || userAgent.includes('Tablet')) deviceType = 'tablet';

  return { browser, os, deviceType };
}

// Get active sessions
router.get('/sessions', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // getUserSessions now handles is_current marking internally
    const sessions = await db.getUserSessions(userId, req.tokenHash);

    res.json({ sessions });
  } catch (err) {
    logger.error('[AUTH] Get sessions error:', err);
    next(err);
  }
});

// Revoke a specific session
router.delete('/sessions/:sessionId', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const sessionId = parseInt(req.params.sessionId, 10);

    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    await db.deleteSession(sessionId, userId);
    res.json({ success: true, message: 'Session revoked' });
  } catch (err) {
    logger.error('[AUTH] Delete session error:', err);
    next(err);
  }
});

router.post('/logout', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    if (req.authSession?.id) {
      await db.deleteSession(req.authSession.id, userId);
    }
    res.json({ success: true, message: 'Signed out' });
  } catch (err) {
    logger.error('[AUTH] Logout error:', err);
    next(err);
  }
});

// Revoke all other sessions
router.post('/sessions/revoke-all', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    await db.deleteOtherSessions(userId, req.tokenHash);

    res.json({ success: true, message: 'All other sessions have been signed out' });
  } catch (err) {
    logger.error('[AUTH] Revoke all sessions error:', err);
    next(err);
  }
});

// ============================================
// TWO-FACTOR AUTHENTICATION (Industry Standard)
// RFC 6238 TOTP compliant implementation
// ============================================

// TOTP configuration
// window: 1 means codes from +/- 1 time step are accepted (handles clock drift)
const TOTP_WINDOW = 1;

// Rate limiter for 2FA verification
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  message: { error: 'Too many 2FA attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// Encryption helpers for TOTP secrets
// Using AES-256-GCM (authenticated encryption)
// ============================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derive a consistent encryption key from the JWT secret
 * Using HKDF-like derivation for security
 */
function getEncryptionKey() {
  return crypto.createHash('sha256').update(SECRET + '_2fa_encryption').digest();
}

/**
 * Encrypt TOTP secret using AES-256-GCM
 * Returns: iv:authTag:ciphertext (all hex encoded)
 */
function encryptTotpSecret(secret) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt TOTP secret
 * Handles both new format (iv:authTag:ciphertext) and legacy format
 */
function decryptTotpSecret(encryptedData) {
  const key = getEncryptionKey();

  // Check if it's the new format (contains colons)
  if (encryptedData.includes(':')) {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // Legacy format (deprecated createCipher) - for backward compatibility
  // This handles secrets encrypted with the old method
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key.slice(0, 32), Buffer.alloc(16, 0));
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new Error('Could not decrypt secret');
  }
}

/**
 * Generate backup codes (8 codes, 8 characters each)
 * Returns { codes: string[], hashes: string[] }
 */
function generateBackupCodes(count = 8) {
  const codes = [];
  const hashes = [];

  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    codes.push(formatted);
    hashes.push(crypto.createHash('sha256').update(formatted).digest('hex'));
  }

  return { codes, hashes };
}

// ============================================
// 2FA Endpoints
// ============================================

/**
 * POST /api/auth/2fa/setup
 * Initialize 2FA setup - generate secret and QR code
 */
router.post('/2fa/setup', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const userEmail = req.user.email;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Check if 2FA is already enabled
    const is2FAEnabled = await db.is2FAEnabled(userId);
    if (is2FAEnabled) {
      await db.log2FAAction(userId, '2fa_setup_failed', false, ipAddress, userAgent, { reason: 'already_enabled' });
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    // Generate secret (base32 encoded per RFC 6238)
    const secret = generateSecret(); // 160 bits = 20 bytes

    // Generate otpauth URL for QR code
    const otpauthUrl = generateURI({ secret, issuer: 'CodeArena', account: userEmail });

    // Generate QR code as data URL (high error correction for better scanning)
    const qrCode = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 256
    });

    // Encrypt and store secret (2FA not yet enabled - just stored for verification)
    const encryptedSecret = encryptTotpSecret(secret);
    await db.saveTotpSecret(userId, encryptedSecret);

    // Log the setup attempt
    await db.log2FAAction(userId, '2fa_setup_started', true, ipAddress, userAgent);

    res.json({
      secret,
      qrCode,
      otpauthUrl,
      message: 'Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.), then verify with a code'
    });
  } catch (err) {
    logger.error('[AUTH] 2FA setup error:', err);
    next(err);
  }
});

/**
 * POST /api/auth/2fa/verify-setup
 * Verify initial 2FA code and enable 2FA
 * This is used during setup, NOT during login
 */
router.post('/2fa/verify-setup', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { code } = req.body;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit code' });
    }

    // Check if already enabled
    const is2FAEnabled = await db.is2FAEnabled(userId);
    if (is2FAEnabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    // Get the stored secret
    const encryptedSecret = await db.getTotpSecret(userId);
    if (!encryptedSecret) {
      return res.status(400).json({ error: 'Please start 2FA setup first' });
    }

    // Decrypt secret
    let secret;
    try {
      secret = decryptTotpSecret(encryptedSecret);
    } catch (err) {
      logger.error('[AUTH] 2FA decrypt error:', err);
      await db.log2FAAction(userId, '2fa_setup_verify_failed', false, ipAddress, userAgent, { reason: 'decrypt_error' });
      return res.status(400).json({ error: 'Invalid 2FA configuration. Please restart setup.' });
    }

    // Verify the code with window tolerance
    const verifyResult = verifySync({ token: code, secret, window: TOTP_WINDOW });
    const isValid = verifyResult.valid;
    if (!isValid) {
      await db.log2FAAction(userId, '2fa_setup_verify_failed', false, ipAddress, userAgent, { reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    // Enable 2FA
    await db.enable2FA(userId);

    // Generate backup codes
    const { codes: backupCodes, hashes: backupCodeHashes } = generateBackupCodes(8);
    await db.saveBackupCodes(userId, backupCodeHashes);

    // Log successful setup
    await db.log2FAAction(userId, '2fa_enabled', true, ipAddress, userAgent, { backup_codes_generated: 8 });

    logger.info(`[AUTH] 2FA enabled for user ${userId}`);

    // Send email notification
    try {
      const user = await db.getUserById(userId);
      if (user && user.email) {
        const userAgentInfo = parseUserAgent(userAgent);
        await send2FAEnabledEmail({
          to: user.email,
          username: user.username,
          ipAddress,
          deviceInfo: [userAgentInfo.browser, userAgentInfo.os].filter(Boolean).join(' on ')
        });
      }
    } catch (emailErr) {
      logger.error('[AUTH] Failed to send 2FA enabled email:', emailErr.message);
    }

    res.json({
      success: true,
      message: '2FA has been enabled successfully',
      backupCodes,
      backupCodesWarning: 'Save these backup codes in a secure place. Each code can only be used once.'
    });
  } catch (err) {
    logger.error('[AUTH] 2FA verify-setup error:', err);
    next(err);
  }
});

/**
 * POST /api/auth/2fa/verify
 * Verify 2FA code during login
 * Requires pendingToken from initial login attempt
 */
router.post('/2fa/verify', twoFactorLimiter, async (req, res, next) => {
  try {
    const {
      pendingToken,
      code,
      rememberMe = false,
      trustDevice = false,
      rememberDevice = false
    } = req.body;
    const shouldTrustDevice = trustDevice || rememberDevice;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!pendingToken) {
      return res.status(400).json({ error: 'Missing pending token. Please log in again.' });
    }

    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit code' });
    }

    // Verify pending token format and extract user ID
    let pendingData;
    try {
      pendingData = jwt.verify(pendingToken, SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    if (!(await isCurrent2FAPendingLogin(pendingData))) {
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    const userId = pendingData.sub;
    const pendingTokenHash = crypto.createHash('sha256').update(pendingToken).digest('hex');

    // Verify pending token in database
    const isValidPending = await db.verify2FAPendingToken(userId, pendingTokenHash);
    if (!isValidPending) {
      await db.log2FAAction(userId, '2fa_verify_login', false, ipAddress, userAgent, { reason: 'invalid_pending_token' });
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    // Check rate limiting in database
    const canAttempt = await db.check2FAAttempts(userId, 15, 10);
    if (!canAttempt) {
      await db.log2FAAction(userId, '2fa_verify_login', false, ipAddress, userAgent, { reason: 'rate_limited' });
      return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });
    }

    // Get user and secret
    const encryptedSecret = await db.getTotpSecret(userId);
    if (!encryptedSecret) {
      return res.status(400).json({ error: '2FA is not properly configured' });
    }

    // Decrypt secret
    let secret;
    try {
      secret = decryptTotpSecret(encryptedSecret);
    } catch (err) {
      logger.error('[AUTH] 2FA decrypt error:', err);
      return res.status(400).json({ error: '2FA configuration error. Please contact support.' });
    }

    // Verify the TOTP code
    const verifyResult = verifySync({ token: code, secret, window: TOTP_WINDOW });
    const isValid = verifyResult.valid;
    if (!isValid) {
      await db.log2FAAction(userId, '2fa_verify_login', false, ipAddress, userAgent, { reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Success! Generate full JWT token
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tokenExpiration = rememberMe ? JWT_EXPIRES_REMEMBER : JWT_EXPIRES_SESSION;
    // Issue the session for the credential generation the pending login proved;
    // if it changed meanwhile, the login must start over.
    const tokenVersion = Number(pendingData.tokenVersion);
    if (!(await db.isTokenVersionValid(userId, tokenVersion))) {
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: tokenExpiration }
    );

    // Check Pro and admin status
    const isPro = await db.isUserPro(userId);
    const emailVerified = await db.isUserEmailVerified(userId);

    // Log successful verification
    await db.log2FAAction(userId, '2fa_verify_login', true, ipAddress, userAgent);

    logger.info(`[AUTH] 2FA login successful for user ${userId}`);

    // Create user session with geolocation
    const userAgentInfo = parseUserAgent(userAgent);
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const location = await getLocationFromIP(ipAddress);

      await db.createUserSession(userId, tokenHash, {
        deviceType: userAgentInfo.deviceType,
        browser: userAgentInfo.browser,
        os: userAgentInfo.os,
        ipAddress,
        location
      });
      logger.info(`[AUTH] Session created for 2FA user ${userId} from ${location || ipAddress || 'unknown'}`);
    } catch (sessionErr) {
      logger.error('[AUTH] Failed to create session:', sessionErr.message);
    }

    // Handle "Remember this device" option
    let deviceToken = null;
    if (shouldTrustDevice) {
      try {
        // Generate a secure device token
        const rawDeviceToken = crypto.randomBytes(32).toString('hex');
        const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');

        // Store in database
        await db.addTrustedDevice(userId, deviceTokenHash, {
          deviceName: [userAgentInfo.browser, userAgentInfo.os].filter(Boolean).join(' on '),
          browser: userAgentInfo.browser,
          os: userAgentInfo.os,
          ipAddress
        });

        deviceToken = rawDeviceToken;

        await db.log2FAAction(userId, 'trusted_device_added', true, ipAddress, userAgent);
        logger.info(`[AUTH] Trusted device added for user ${userId}`);

        // Send email notification for new trusted device
        try {
          await sendNewTrustedDeviceEmail({
            to: user.email,
            username: user.username,
            deviceName: [userAgentInfo.browser, userAgentInfo.os].filter(Boolean).join(' on '),
            browser: userAgentInfo.browser,
            os: userAgentInfo.os,
            ipAddress
          });
        } catch (emailErr) {
          logger.error('[AUTH] Failed to send trusted device email:', emailErr.message);
        }
      } catch (deviceErr) {
        logger.error('[AUTH] Failed to add trusted device:', deviceErr.message);
        // Don't fail the login if trusted device fails
      }
    }

    const responseData = {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        is_pro: isPro,
        is_admin: user.is_admin === 1,
        email_verified: emailVerified
      }
    };

    // Include device token if "trust device" was selected
    if (deviceToken) {
      responseData.deviceToken = deviceToken;
      responseData.trustedDeviceToken = deviceToken;
    }

    res.json(responseData);
  } catch (err) {
    logger.error('[AUTH] 2FA verify error:', err);
    next(err);
  }
});

/**
 * POST /api/auth/2fa/recovery
 * Use a backup/recovery code to bypass 2FA
 */
router.post('/2fa/recovery', twoFactorLimiter, async (req, res, next) => {
  try {
    const {
      pendingToken,
      recoveryCode,
      rememberMe = false,
      trustDevice = false,
      rememberDevice = false
    } = req.body;
    const shouldTrustDevice = trustDevice || rememberDevice;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (!pendingToken) {
      return res.status(400).json({ error: 'Missing pending token. Please log in again.' });
    }

    if (!recoveryCode) {
      return res.status(400).json({ error: 'Recovery code is required' });
    }

    // Verify pending token
    let pendingData;
    try {
      pendingData = jwt.verify(pendingToken, SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    if (!(await isCurrent2FAPendingLogin(pendingData))) {
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    const userId = pendingData.sub;
    const pendingTokenHash = crypto.createHash('sha256').update(pendingToken).digest('hex');

    // Verify pending token in database
    const isValidPending = await db.verify2FAPendingToken(userId, pendingTokenHash);
    if (!isValidPending) {
      await db.log2FAAction(userId, '2fa_recovery_attempt', false, ipAddress, userAgent, { reason: 'invalid_pending_token' });
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    // Check rate limiting
    const canAttempt = await db.check2FAAttempts(userId, 15, 10);
    if (!canAttempt) {
      await db.log2FAAction(userId, '2fa_recovery_attempt', false, ipAddress, userAgent, { reason: 'rate_limited' });
      return res.status(429).json({ error: 'Too many failed attempts. Please try again in 15 minutes.' });
    }

    // Normalize recovery code (uppercase, handle with or without dash)
    const normalizedCode = recoveryCode.toUpperCase().replace(/[^A-F0-9-]/g, '');
    const formattedCode = normalizedCode.includes('-')
      ? normalizedCode
      : `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`;

    // Hash and verify the recovery code
    const codeHash = crypto.createHash('sha256').update(formattedCode).digest('hex');
    const codeUsed = await db.useBackupCode(userId, codeHash);

    if (!codeUsed) {
      await db.log2FAAction(userId, '2fa_recovery_attempt', false, ipAddress, userAgent, { reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid recovery code' });
    }

    // Success! Generate full JWT token
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tokenExpiration = rememberMe ? JWT_EXPIRES_REMEMBER : JWT_EXPIRES_SESSION;
    // Issue the session for the credential generation the pending login proved;
    // if it changed meanwhile, the login must start over.
    const tokenVersion = Number(pendingData.tokenVersion);
    if (!(await db.isTokenVersionValid(userId, tokenVersion))) {
      return res.status(401).json({ error: 'Invalid or expired login session. Please log in again.' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        tokenVersion
      },
      SECRET,
      { expiresIn: tokenExpiration }
    );

    // Check Pro and admin status
    const isPro = await db.isUserPro(userId);
    const emailVerified = await db.isUserEmailVerified(userId);

    // Get remaining backup codes count
    const backupCodesRemaining = await db.getBackupCodesCount(userId);

    // Log successful recovery
    await db.log2FAAction(userId, '2fa_recovery_success', true, ipAddress, userAgent, { remaining_codes: backupCodesRemaining });

    logger.info(`[AUTH] 2FA recovery successful for user ${userId}, ${backupCodesRemaining} codes remaining`);

    // Create user session with geolocation
    const userAgentInfo = parseUserAgent(userAgent);
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const location = await getLocationFromIP(ipAddress);

      await db.createUserSession(userId, tokenHash, {
        deviceType: userAgentInfo.deviceType,
        browser: userAgentInfo.browser,
        os: userAgentInfo.os,
        ipAddress,
        location
      });
      logger.info(`[AUTH] Session created for 2FA recovery user ${userId} from ${location || ipAddress || 'unknown'}`);
    } catch (sessionErr) {
      logger.error('[AUTH] Failed to create session:', sessionErr.message);
    }

    let deviceToken = null;
    if (shouldTrustDevice) {
      try {
        const rawDeviceToken = crypto.randomBytes(32).toString('hex');
        const deviceTokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');

        await db.addTrustedDevice(userId, deviceTokenHash, {
          deviceName: [userAgentInfo.browser, userAgentInfo.os].filter(Boolean).join(' on '),
          browser: userAgentInfo.browser,
          os: userAgentInfo.os,
          ipAddress
        });

        deviceToken = rawDeviceToken;
        await db.log2FAAction(userId, 'trusted_device_added', true, ipAddress, userAgent, { via: 'recovery_code' });
      } catch (deviceErr) {
        logger.error('[AUTH] Failed to add trusted device after recovery:', deviceErr.message);
      }
    }

    const responseData = {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        avatar_url: user.avatar_url || null,
        is_pro: isPro,
        is_admin: user.is_admin === 1,
        email_verified: emailVerified
      },
      backupCodesRemaining,
      warning: backupCodesRemaining <= 2
        ? 'You have few backup codes remaining. Please generate new backup codes in settings.'
        : null
    };

    if (deviceToken) {
      responseData.deviceToken = deviceToken;
      responseData.trustedDeviceToken = deviceToken;
    }

    res.json(responseData);
  } catch (err) {
    logger.error('[AUTH] 2FA recovery error:', err);
    next(err);
  }
});

/**
 * POST /api/auth/2fa/disable
 * Disable 2FA (requires password + 2FA code for security)
 */
router.post('/2fa/disable', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { code, password } = req.body;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Require BOTH password and 2FA code for maximum security
    if (!password) {
      return res.status(400).json({ error: 'Password is required to disable 2FA' });
    }

    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Current 2FA code is required' });
    }

    // Verify password
    const user = await db.getUserByIdWithPassword(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has a password (might be Google-only account)
    if (user.password && user.password !== '$google_oauth_user$') {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        await db.log2FAAction(userId, '2fa_disable_failed', false, ipAddress, userAgent, { reason: 'invalid_password' });
        return res.status(401).json({ error: 'Incorrect password' });
      }
    }

    // Verify TOTP code
    const encryptedSecret = await db.getTotpSecret(userId);
    if (!encryptedSecret) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    let secret;
    try {
      secret = decryptTotpSecret(encryptedSecret);
    } catch {
      await db.log2FAAction(userId, '2fa_disable_failed', false, ipAddress, userAgent, { reason: 'decrypt_error' });
      return res.status(400).json({ error: 'Could not verify 2FA code' });
    }

    const verifyResult = verifySync({ token: code, secret, window: TOTP_WINDOW });
    if (!verifyResult.valid) {
      await db.log2FAAction(userId, '2fa_disable_failed', false, ipAddress, userAgent, { reason: 'invalid_code' });
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    // Disable 2FA (also clears backup codes)
    await db.disable2FA(userId);

    // Also revoke all trusted devices when 2FA is disabled
    await db.revokeAllTrustedDevices(userId);

    // Log successful disable
    await db.log2FAAction(userId, '2fa_disabled', true, ipAddress, userAgent);

    logger.info(`[AUTH] 2FA disabled for user ${userId}`);

    // Send email notification
    try {
      const userAgentInfo = parseUserAgent(userAgent);
      await send2FADisabledEmail({
        to: user.email,
        username: user.username,
        ipAddress,
        deviceInfo: [userAgentInfo.browser, userAgentInfo.os].filter(Boolean).join(' on ')
      });
    } catch (emailErr) {
      logger.error('[AUTH] Failed to send 2FA disabled email:', emailErr.message);
    }

    res.json({ success: true, message: '2FA has been disabled successfully' });
  } catch (err) {
    logger.error('[AUTH] 2FA disable error:', err);
    next(err);
  }
});

/**
 * GET /api/auth/2fa/status
 * Check if 2FA is enabled for the current user
 */
router.get('/2fa/status', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const enabled = await db.is2FAEnabled(userId);
    const backupCodesRemaining = enabled ? await db.getBackupCodesCount(userId) : 0;

    res.json({
      enabled,
      backupCodesRemaining,
      lowBackupCodes: enabled && backupCodesRemaining <= 2
    });
  } catch (err) {
    logger.error('[AUTH] 2FA status error:', err);
    next(err);
  }
});

/**
 * GET /api/auth/2fa/backup-codes-count
 * Get remaining backup codes count
 */
router.get('/2fa/backup-codes-count', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const enabled = await db.is2FAEnabled(userId);

    if (!enabled) {
      return res.json({ count: 0 });
    }

    const count = await db.getBackupCodesCount(userId);
    res.json({ count });
  } catch (err) {
    logger.error('[AUTH] 2FA backup codes count error:', err);
    next(err);
  }
});

/**
 * POST /api/auth/2fa/regenerate-backup-codes
 * Generate new backup codes (invalidates old ones)
 * Requires 2FA code or password
 */
router.post('/2fa/regenerate-backup-codes', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { code, password } = req.body;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Check if 2FA is enabled
    const is2FAEnabled = await db.is2FAEnabled(userId);
    if (!is2FAEnabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Require either 2FA code or password
    if (!code && !password) {
      return res.status(400).json({ error: 'Please provide your 2FA code or password' });
    }

    // Verify authentication
    if (code) {
      const encryptedSecret = await db.getTotpSecret(userId);
      if (encryptedSecret) {
        let secret;
        try {
          secret = decryptTotpSecret(encryptedSecret);
        } catch {
          return res.status(400).json({ error: 'Could not verify 2FA code' });
        }

        const verifyResult = verifySync({ token: code, secret, window: TOTP_WINDOW });
        if (!verifyResult.valid) {
          await db.log2FAAction(userId, '2fa_regenerate_codes_failed', false, ipAddress, userAgent, { reason: 'invalid_code' });
          return res.status(400).json({ error: 'Invalid 2FA code' });
        }
      }
    } else if (password) {
      const user = await db.getUserByIdWithPassword(userId);
      if (user && user.password && user.password !== '$google_oauth_user$') {
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          await db.log2FAAction(userId, '2fa_regenerate_codes_failed', false, ipAddress, userAgent, { reason: 'invalid_password' });
          return res.status(401).json({ error: 'Incorrect password' });
        }
      }
    }

    // Generate new backup codes
    const { codes: backupCodes, hashes: backupCodeHashes } = generateBackupCodes(8);
    await db.saveBackupCodes(userId, backupCodeHashes);

    // Log the action
    await db.log2FAAction(userId, '2fa_regenerate_codes', true, ipAddress, userAgent, { codes_generated: 8 });

    logger.info(`[AUTH] Backup codes regenerated for user ${userId}`);

    // Send email notification
    try {
      const user = await db.getUserById(userId);
      if (user && user.email) {
        const userAgentInfo = parseUserAgent(userAgent);
        await sendBackupCodesRegeneratedEmail({
          to: user.email,
          username: user.username,
          ipAddress,
          deviceInfo: [userAgentInfo.browser, userAgentInfo.os].filter(Boolean).join(' on ')
        });
      }
    } catch (emailErr) {
      logger.error('[AUTH] Failed to send backup codes regenerated email:', emailErr.message);
    }

    res.json({
      success: true,
      backupCodes,
      message: 'New backup codes generated. Old codes are no longer valid.',
      warning: 'Save these backup codes in a secure place. Each code can only be used once.'
    });
  } catch (err) {
    logger.error('[AUTH] 2FA regenerate codes error:', err);
    next(err);
  }
});

// ============================================
// RE-AUTHENTICATION MIDDLEWARE
// ============================================

/**
 * Middleware: requireRecentAuth
 * Checks if the user has authenticated within the last 15 minutes
 * If not, returns { requiresReauth: true }
 */
async function requireRecentAuth(req, res, next) {
  try {
    const userId = req.user.sub;
    const hasRecent = await db.hasRecentAuth(userId, 15); // 15 minutes

    if (!hasRecent) {
      return res.status(403).json({
        error: 'Recent authentication required',
        requiresReauth: true,
        message: 'Please verify your password to continue with this sensitive action.'
      });
    }

    next();
  } catch (err) {
    logger.error('[AUTH] requireRecentAuth middleware error:', err);
    next(err);
  }
}

// ============================================
// TRUSTED DEVICES ENDPOINTS
// ============================================

/**
 * GET /api/auth/2fa/trusted-devices
 * List all trusted devices for the authenticated user
 */
router.get('/2fa/trusted-devices', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const devices = await db.getTrustedDevices(userId);

    res.json({
      success: true,
      devices: devices.map(d => ({
        id: d.id,
        deviceName: d.device_name,
        browser: d.browser,
        os: d.os,
        ipAddress: d.ip_address,
        lastUsed: d.last_used,
        createdAt: d.created_at,
        expiresAt: d.expires_at
      }))
    });
  } catch (err) {
    logger.error('[AUTH] Get trusted devices error:', err);
    next(err);
  }
});

/**
 * DELETE /api/auth/2fa/trusted-devices/:id
 * Revoke a specific trusted device
 * Requires recent authentication
 */
router.delete('/2fa/trusted-devices/:id', authMiddleware, requireRecentAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const deviceId = parseInt(req.params.id, 10);
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    if (isNaN(deviceId)) {
      return res.status(400).json({ error: 'Invalid device ID' });
    }

    const revoked = await db.revokeTrustedDevice(userId, deviceId);
    if (!revoked) {
      return res.status(404).json({ error: 'Device not found or already revoked' });
    }

    await db.log2FAAction(userId, 'trusted_device_revoked', true, ipAddress, userAgent, { device_id: deviceId });
    logger.info(`[AUTH] Trusted device ${deviceId} revoked for user ${userId}`);

    res.json({ success: true, message: 'Device has been removed from trusted devices' });
  } catch (err) {
    logger.error('[AUTH] Revoke trusted device error:', err);
    next(err);
  }
});

/**
 * DELETE /api/auth/2fa/trusted-devices
 * Revoke all trusted devices for the authenticated user
 * Requires recent authentication
 */
router.delete('/2fa/trusted-devices', authMiddleware, requireRecentAuth, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const count = await db.revokeAllTrustedDevices(userId);

    await db.log2FAAction(userId, 'all_trusted_devices_revoked', true, ipAddress, userAgent, { devices_revoked: count });
    logger.info(`[AUTH] All trusted devices (${count}) revoked for user ${userId}`);

    res.json({ success: true, message: `${count} trusted device(s) have been removed`, devicesRevoked: count });
  } catch (err) {
    logger.error('[AUTH] Revoke all trusted devices error:', err);
    next(err);
  }
});

// ============================================
// RE-AUTHENTICATION ENDPOINT
// ============================================

/**
 * POST /api/auth/verify-password
 * Verify password for re-authentication before sensitive actions
 * Updates last_auth_at on success
 */
router.post('/verify-password', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { password, totpCode } = req.body;
    const ipAddress = getClientIP(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const user = await db.getUserByIdWithPassword(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // OAuth-only users have no real password. Previously this branch returned
    // success unconditionally, bypassing step-up auth entirely. Instead:
    //  - If 2FA is enabled, require a valid TOTP code (proof of possession)
    //  - Otherwise reject with a code the client can use to surface a
    //    different step-up flow (re-auth via the OAuth provider)
    if (!user.password || user.password === '$google_oauth_user$') {
      const has2FA = await db.is2FAEnabled(userId);

      if (!has2FA) {
        await db.log2FAAction(userId, 'verify_password_failed', false, ipAddress, userAgent, { reason: 'oauth_no_stepup' });
        return res.status(400).json({
          error: 'This account does not use a password. Please re-authenticate with your OAuth provider.',
          code: 'OAUTH_USER_REQUIRES_DIFFERENT_STEPUP'
        });
      }

      if (!totpCode) {
        return res.status(400).json({
          error: 'TOTP code is required for OAuth accounts with 2FA enabled',
          code: 'OAUTH_USER_REQUIRES_DIFFERENT_STEPUP',
          requires2FA: true
        });
      }

      const encryptedSecret = await db.getTotpSecret(userId);
      if (!encryptedSecret) {
        await db.log2FAAction(userId, 'verify_password_failed', false, ipAddress, userAgent, { reason: 'totp_secret_missing' });
        return res.status(400).json({
          error: 'Could not verify TOTP code',
          code: 'OAUTH_USER_REQUIRES_DIFFERENT_STEPUP'
        });
      }

      let secret;
      try {
        secret = decryptTotpSecret(encryptedSecret);
      } catch {
        await db.log2FAAction(userId, 'verify_password_failed', false, ipAddress, userAgent, { reason: 'totp_decrypt_failed' });
        return res.status(400).json({
          error: 'Could not verify TOTP code',
          code: 'OAUTH_USER_REQUIRES_DIFFERENT_STEPUP'
        });
      }

      const verifyResult = verifySync({ token: totpCode, secret, window: TOTP_WINDOW });
      if (!verifyResult.valid) {
        await db.log2FAAction(userId, 'verify_password_failed', false, ipAddress, userAgent, { reason: 'invalid_totp' });
        return res.status(401).json({ error: 'Invalid TOTP code' });
      }

      await db.updateLastAuthAt(userId);
      await db.log2FAAction(userId, 'verify_password_success', true, ipAddress, userAgent, { method: 'totp' });
      logger.info(`[AUTH] OAuth user ${userId} verified via TOTP for sensitive action`);
      return res.json({ success: true, message: 'Authentication verified', method: 'totp' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      await db.log2FAAction(userId, 'verify_password_failed', false, ipAddress, userAgent);
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Update last_auth_at
    await db.updateLastAuthAt(userId);

    await db.log2FAAction(userId, 'verify_password_success', true, ipAddress, userAgent);
    logger.info(`[AUTH] Password verified for user ${userId} (re-auth)`);

    res.json({ success: true, message: 'Authentication verified' });
  } catch (err) {
    logger.error('[AUTH] Verify password error:', err);
    next(err);
  }
});

module.exports = router;

// Export middleware for use in other routes
module.exports.requireRecentAuth = requireRecentAuth;
module.exports.authMiddleware = authMiddleware;
