const express = require('express');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');

const router = express.Router();

// Agent-battle and Centaur operations are intentionally outside the CodeArena
// consumer boundary. Keep the legacy handlers below dormant until they can be
// removed with their database schema, but never expose them over HTTP.

// Middleware to check if user is admin
const adminMiddleware = async (req, res, next) => {
  try {
    const user = await db.getUserById(req.user.sub || req.user.userId);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    if (user.is_admin === 1) {
      return next();
    }

    return res.status(403).json({ error: 'Admin access required' });
  } catch (err) {
    next(err);
  }
};

router.use('/community', authMiddleware, adminMiddleware, require('./communityAdmin'));

/**
 * GET /api/admin/emails/stats
 * Returns subscriber counts for each email type.
 * Counts mirror the actual send-side eligibility (verified users with email),
 * so the number reflects how many people would receive the email right now.
 */
router.get('/emails/stats', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const verifiedFilter = `
      u.email IS NOT NULL AND u.email != '' AND u.email_verified = 1
    `;

    const ALLOWED_PREF_COLUMNS = new Set([
      'weekly_challenge', 'marketing', 'progress_digest',
      'tournament_notifications', 'activity_reminders',
      'creator_arena_emails', 'message_digest'
    ]);

    // 1. Verified users total (denominator).
    const verifiedRow = await db.get(
      `SELECT COUNT(*) as count FROM users u WHERE ${verifiedFilter}`
    );
    const verifiedUsers = verifiedRow?.count || 0;

    // Helper for "NULL or != 0" (default opted-in) counts.
    const countDefaultOptIn = async (column) => {
      if (!ALLOWED_PREF_COLUMNS.has(column)) {
        throw new Error(`Unsafe column: ${column}`);
      }
      const row = await db.get(
        `SELECT COUNT(*) as count
         FROM users u
         LEFT JOIN user_email_preferences uep ON uep.user_id = u.id
         WHERE ${verifiedFilter}
           AND (uep.${column} IS NULL OR uep.${column} != 0)`
      );
      return row?.count || 0;
    };

    // Helper for "= 1 only" (default opted-out) counts.
    const countExplicitOptIn = async (column) => {
      if (!ALLOWED_PREF_COLUMNS.has(column)) {
        throw new Error(`Unsafe column: ${column}`);
      }
      const row = await db.get(
        `SELECT COUNT(*) as count
         FROM users u
         INNER JOIN user_email_preferences uep ON uep.user_id = u.id
         WHERE ${verifiedFilter}
           AND uep.${column} = 1`
      );
      return row?.count || 0;
    };

    // Run sequentially so tests can mock db.get with .mockResolvedValueOnce in this exact order.
    // (Response is keyed by `type`, so the *response* ordering doesn't matter to consumers.)
    const weeklyChallenge = await countDefaultOptIn('weekly_challenge');
    const marketingRegistered = await countExplicitOptIn('marketing');
    const progressDigest = await countDefaultOptIn('progress_digest');
    const tournamentNotifications = await countExplicitOptIn('tournament_notifications');
    const activityReminders = await countDefaultOptIn('activity_reminders');
    const creatorArenaEmails = await countDefaultOptIn('creator_arena_emails');
    const messageDigest = await countDefaultOptIn('message_digest');

    // Newsletter-only subscribers (non-registered users), de-duped against users.email.
    const newsletterRow = await db.get(
      `SELECT COUNT(*) as count
       FROM newsletter_subscriptions ns
       WHERE ns.unsubscribed_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM users u WHERE LOWER(u.email) = ns.email
         )`
    );
    const newsletterOnly = newsletterRow?.count || 0;

    const stats = [
      { type: 'weekly_challenge', label: 'Weekly Challenge', subscribers: weeklyChallenge },
      {
        type: 'marketing',
        label: 'Marketing / Newsletter',
        subscribers: marketingRegistered + newsletterOnly,
        registeredUsers: marketingRegistered,
        newsletterOnly
      },
      { type: 'progress_digest', label: 'Progress Digest', subscribers: progressDigest },
      { type: 'tournament_notifications', label: 'Tournament Notifications', subscribers: tournamentNotifications },
      { type: 'activity_reminders', label: 'Activity Reminders', subscribers: activityReminders },
      { type: 'creator_arena_emails', label: 'CreatorArena Emails', subscribers: creatorArenaEmails },
      { type: 'message_digest', label: 'Message Digest', subscribers: messageDigest }
    ];

    res.json({ success: true, verifiedUsers, stats });
  } catch (err) {
    logger.error('[Admin] Error fetching email subscriber stats:', err);
    next(err);
  }
});

/**
 * GET /api/admin/account-audit
 * Real members (email-backed) vs flagged test/seed accounts. Read-only; nothing deleted.
 */
router.get('/account-audit', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const audit = await db.getAccountAudit();
    res.json({ success: true, audit });
  } catch (err) {
    logger.error('[Admin] Error fetching account audit:', err);
    next(err);
  }
});

module.exports = router;
