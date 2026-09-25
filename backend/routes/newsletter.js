const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db');
const logger = require('../utils/logger');

// Ensure newsletter_subscriptions table exists (safety fallback if migration didn't run)
(async () => {
  try {
    await db.run(`CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      unsubscribed_at TEXT,
      source TEXT DEFAULT 'website'
    )`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscriptions(email)`);
    logger.info('[Newsletter] Ensured newsletter_subscriptions table exists');
  } catch (err) {
    logger.error('[Newsletter] Failed to ensure table exists:', err);
  }
})();

// Email validation constants
const MAX_EMAIL_LENGTH = 254; // RFC 5321
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate email helper
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Email is required' };
  }
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return { valid: false, error: 'Email is too long' };
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' };
  }
  return { valid: true, email: trimmed };
}

// Rate limiter for newsletter endpoints (prevent spam/abuse)
const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour per IP
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * POST /api/newsletter/subscribe
 * Subscribe an email to the newsletter
 * - If email belongs to a registered user, updates their marketing preference
 * - Otherwise, adds to newsletter_subscriptions table
 */
router.post('/subscribe', newsletterLimiter, async (req, res) => {
  try {
    // Validate email
    const validation = validateEmail(req.body.email);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const trimmedEmail = validation.email;

    // First, check if this email belongs to a registered user
    const existingUser = await db.get(
      'SELECT id FROM users WHERE LOWER(email) = ?',
      [trimmedEmail]
    );

    if (existingUser) {
      // User exists - update their marketing preference instead
      const existingPref = await db.get(
        'SELECT marketing FROM user_email_preferences WHERE user_id = ?',
        [existingUser.id]
      );

      if (existingPref) {
        if (existingPref.marketing === 1) {
          return res.json({ success: true, message: 'You are already subscribed!' });
        }
        // Update existing preference
        await db.run(
          'UPDATE user_email_preferences SET marketing = 1, updated_at = datetime("now") WHERE user_id = ?',
          [existingUser.id]
        );
      } else {
        // Create new preference record
        await db.run(
          'INSERT INTO user_email_preferences (user_id, marketing, created_at, updated_at) VALUES (?, 1, datetime("now"), datetime("now"))',
          [existingUser.id]
        );
      }

      logger.info(`[Newsletter] Registered user subscribed to marketing: ${trimmedEmail}`);
      return res.json({ success: true, message: 'Successfully subscribed to the newsletter!' });
    }

    // Not a registered user - check newsletter_subscriptions table
    const existing = await db.get(
      'SELECT id, unsubscribed_at FROM newsletter_subscriptions WHERE email = ?',
      [trimmedEmail]
    );

    if (existing) {
      if (existing.unsubscribed_at) {
        // Re-subscribe previously unsubscribed email
        await db.run(
          'UPDATE newsletter_subscriptions SET unsubscribed_at = NULL, subscribed_at = datetime("now") WHERE id = ?',
          [existing.id]
        );
        logger.info(`[Newsletter] Re-subscribed: ${trimmedEmail}`);
        return res.json({ success: true, message: 'Welcome back! You have been re-subscribed.' });
      }
      // Already subscribed
      return res.json({ success: true, message: 'You are already subscribed!' });
    }

    // Insert new subscription for non-user
    await db.run(
      'INSERT INTO newsletter_subscriptions (email, subscribed_at) VALUES (?, datetime("now"))',
      [trimmedEmail]
    );

    logger.info(`[Newsletter] New subscription: ${trimmedEmail}`);
    res.json({ success: true, message: 'Successfully subscribed to the newsletter!' });

  } catch (err) {
    logger.error('[Newsletter] Subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe. Please try again.' });
  }
});

/**
 * POST /api/newsletter/unsubscribe
 * Unsubscribe an email from the newsletter
 * - If email belongs to a registered user, updates their marketing preference
 * - Otherwise, marks as unsubscribed in newsletter_subscriptions table
 */
router.post('/unsubscribe', newsletterLimiter, async (req, res) => {
  try {
    // Validate email
    const validation = validateEmail(req.body.email);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const trimmedEmail = validation.email;

    // First, check if this email belongs to a registered user
    const existingUser = await db.get(
      'SELECT id FROM users WHERE LOWER(email) = ?',
      [trimmedEmail]
    );

    if (existingUser) {
      // User exists - update their marketing preference
      const result = await db.run(
        'UPDATE user_email_preferences SET marketing = 0, updated_at = datetime("now") WHERE user_id = ? AND marketing = 1',
        [existingUser.id]
      );

      if (result.changes === 0) {
        // Check if they have a record at all
        const existingPref = await db.get(
          'SELECT marketing FROM user_email_preferences WHERE user_id = ?',
          [existingUser.id]
        );
        if (existingPref && existingPref.marketing === 0) {
          return res.json({ success: true, message: 'You are already unsubscribed.' });
        }
        // No preference record means they weren't subscribed
        return res.status(404).json({ error: 'Email not found or already unsubscribed' });
      }

      logger.info(`[Newsletter] Registered user unsubscribed from marketing: ${trimmedEmail}`);
      return res.json({ success: true, message: 'Successfully unsubscribed from the newsletter.' });
    }

    // Not a registered user - check newsletter_subscriptions table
    const result = await db.run(
      'UPDATE newsletter_subscriptions SET unsubscribed_at = datetime("now") WHERE email = ? AND unsubscribed_at IS NULL',
      [trimmedEmail]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Email not found or already unsubscribed' });
    }

    logger.info(`[Newsletter] Unsubscribed: ${trimmedEmail}`);
    res.json({ success: true, message: 'Successfully unsubscribed from the newsletter.' });

  } catch (err) {
    logger.error('[Newsletter] Unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe. Please try again.' });
  }
});

module.exports = router;
