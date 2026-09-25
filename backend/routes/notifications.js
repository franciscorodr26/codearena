const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const db = require('../db');
const authRouter = require('./auth');
const emailService = require('../services/email');
const { SECRET } = require('../config/jwt');
const { FRONTEND_URL } = require('../config/appUrls');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

// Rate limiter for admin endpoints: 10 requests per minute per IP
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many admin requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Generate unsubscribe token for email
function generateUnsubscribeToken(email, type = 'weekly-challenge') {
  // Always lowercase email for consistent token generation
  const data = `${email.toLowerCase()}:${type}`;
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex').substring(0, 32);
}

// Verify unsubscribe token
function verifyUnsubscribeToken(email, token, type = 'weekly-challenge') {
  // Validate token length first to avoid timingSafeEqual buffer length error
  if (!token || token.length !== 32) {
    return false;
  }
  try {
    const expectedToken = generateUnsubscribeToken(email, type);
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
  } catch (err) {
    // Handle any buffer comparison errors gracefully
    return false;
  }
}

// Export for use in email service
router.generateUnsubscribeToken = generateUnsubscribeToken;

// Import problems loader for email content
const problemsLoader = require('../problemsLoader');

/**
 * GET /api/notifications/preferences
 * Get user's email notification preferences
 */
router.get('/preferences', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const prefs = await db.getEmailPreferences(userId);

    res.json({
      success: true,
      preferences: prefs ? {
        weeklyChallenge: !!prefs.weekly_challenge,
        marketing: !!prefs.marketing,
        progressDigest: prefs.progress_digest !== 0, // Default to true
        tournamentNotifications: !!prefs.tournament_notifications,
        activityReminders: prefs.activity_reminders !== 0, // Default to true
        creatorArenaEmails: prefs.creator_arena_emails !== 0, // Default to true
        messageDigest: prefs.message_digest !== 0 // Default to true
      } : {
        // Defaults match email sending behavior (NULL = opted-in)
        // Legacy users without preferences are considered opted-in
        weeklyChallenge: true,
        marketing: false,
        progressDigest: true,
        tournamentNotifications: false,
        activityReminders: true,
        creatorArenaEmails: true,
        messageDigest: true
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/preferences
 * Update user's email notification preferences
 */
router.put('/preferences', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { weeklyChallenge, marketing, progressDigest, tournamentNotifications, activityReminders, creatorArenaEmails, messageDigest } = req.body;

    const prefs = await db.setEmailPreferences(userId, {
      weeklyChallenge: weeklyChallenge !== false,
      marketing: !!marketing,
      progressDigest: progressDigest !== false, // Default to true if not specified
      tournamentNotifications: !!tournamentNotifications,
      messageDigest: messageDigest !== false // Default to true if not specified
    });

    // Handle activity reminders separately if specified
    if (activityReminders === false) {
      await db.unsubscribeFromActivityReminders(userId);
    } else if (activityReminders === true) {
      // Re-subscribe to activity reminders
      await db.run(
        `UPDATE user_email_preferences SET activity_reminders = 1 WHERE user_id = ?`,
        [userId]
      );
    }

    if (creatorArenaEmails === false) {
      await db.unsubscribeFromCreatorArenaEmails(userId);
    } else if (creatorArenaEmails === true) {
      await db.run(
        `UPDATE user_email_preferences SET creator_arena_emails = 1 WHERE user_id = ?`,
        [userId]
      );
    }

    // Re-fetch preferences to get updated values
    const updatedPrefs = await db.getEmailPreferences(userId);

    res.json({
      success: true,
      preferences: {
        weeklyChallenge: !!updatedPrefs.weekly_challenge,
        marketing: !!updatedPrefs.marketing,
        progressDigest: updatedPrefs.progress_digest !== 0,
        tournamentNotifications: !!updatedPrefs.tournament_notifications,
        activityReminders: updatedPrefs.activity_reminders !== 0,
        creatorArenaEmails: updatedPrefs.creator_arena_emails !== 0,
        messageDigest: updatedPrefs.message_digest !== 0
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/subscribe/weekly-challenge
 * Quick subscribe to weekly challenge emails
 */
router.post('/subscribe/weekly-challenge', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    await db.setEmailPreferences(userId, {
      weeklyChallenge: true
    });

    res.json({
      success: true,
      message: 'Subscribed to weekly challenge notifications'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/unsubscribe/weekly-challenge
 * Quick unsubscribe from weekly challenge emails (authenticated)
 */
router.post('/unsubscribe/weekly-challenge', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    await db.unsubscribeFromWeeklyChallenge(userId);

    res.json({
      success: true,
      message: 'Unsubscribed from weekly challenge notifications'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Shared unsubscribe handler used by both GET (browser link click) and
 * POST (RFC 8058 one-click unsubscribe from Gmail/Outlook).
 * Reads params from req.query, POST middleware merges body into query first.
 */
async function handleUnsubscribe(req, res) {
  try {
    const { email, token, type = 'weekly-challenge', html } = req.query;

    // Validate inputs
    if (!email || !token) {
      if (html) {
        return res.status(400).send(`
          <html>
            <head><title>Unsubscribe - Error</title></head>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>Invalid Link</h1>
              <p>This unsubscribe link is invalid or expired.</p>
              <p><a href="${FRONTEND_URL}/settings/profile">Manage preferences</a></p>
            </body>
          </html>
        `);
      }
      return res.status(400).json({ ok: false, error: 'This unsubscribe link is invalid or expired.' });
    }

    // Verify token
    if (!verifyUnsubscribeToken(email, token, type)) {
      if (html) {
        return res.status(400).send(`
          <html>
            <head><title>Unsubscribe - Error</title></head>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>Invalid Link</h1>
              <p>This unsubscribe link is invalid or has been tampered with.</p>
              <p><a href="${FRONTEND_URL}/settings/profile">Manage preferences</a></p>
            </body>
          </html>
        `);
      }
      return res.status(400).json({ ok: false, error: 'This unsubscribe link is invalid or has been tampered with.' });
    }

    // Find user by email
    const user = await db.getUserByEmail(email.toLowerCase());
    if (!user) {
      if (html) {
        return res.status(404).send(`
          <html>
            <head><title>Unsubscribe - Error</title></head>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>User Not Found</h1>
              <p>No account found with this email address.</p>
            </body>
          </html>
        `);
      }
      return res.status(404).json({ ok: false, error: 'No account found with this email address.' });
    }

    // Map of type to human-readable name
    const typeLabels = {
      'weekly-challenge': 'weekly challenge',
      'marketing': 'product update',
      'tournaments': 'tournament',
      'activity-reminders': 'activity reminder',
      'creator-arena-emails': 'CreatorArena milestone',
      'message-digest': 'weekly message digest'
    };

    // Check if already unsubscribed before making changes
    let wasAlreadyUnsubscribed = false;

    if (type === 'weekly-challenge') {
      const prefs = await db.getEmailPreferences(user.id);
      wasAlreadyUnsubscribed = !prefs || prefs.weekly_challenge === 0;
      await db.unsubscribeFromWeeklyChallenge(user.id);
    } else if (type === 'marketing') {
      const prefs = await db.getEmailPreferences(user.id);
      wasAlreadyUnsubscribed = !!prefs && prefs.marketing === 0;
      await db.unsubscribeFromMarketing(user.id);
    } else if (type === 'tournaments') {
      const currentPrefs = await db.getEmailPreferences(user.id);
      wasAlreadyUnsubscribed = !currentPrefs || currentPrefs.tournament_notifications === 0;
      await db.setEmailPreferences(user.id, {
        weeklyChallenge: currentPrefs?.weekly_challenge || false,
        marketing: currentPrefs?.marketing || false,
        progressDigest: currentPrefs?.progress_digest !== 0,
        tournamentNotifications: false,
        messageDigest: currentPrefs?.message_digest !== 0
      });
    } else if (type === 'activity-reminders') {
      const prefs = await db.getEmailPreferences(user.id);
      wasAlreadyUnsubscribed = !prefs || prefs.activity_reminders === 0;
      await db.unsubscribeFromActivityReminders(user.id);
    } else if (type === 'creator-arena-emails') {
      const prefs = await db.getEmailPreferences(user.id);
      wasAlreadyUnsubscribed = !!prefs && prefs.creator_arena_emails === 0;
      await db.unsubscribeFromCreatorArenaEmails(user.id);
    } else if (type === 'message-digest') {
      const prefs = await db.getEmailPreferences(user.id);
      wasAlreadyUnsubscribed = !!prefs && prefs.message_digest === 0;
      await db.unsubscribeFromMessageDigest(user.id);
    }

    logger.info(`[NOTIFICATIONS] User ${user.id} unsubscribed from ${type} via email link (already unsubscribed: ${wasAlreadyUnsubscribed})`);

    // Return appropriate message
    const typeLabel = typeLabels[type] || type;
    const message = wasAlreadyUnsubscribed
      ? `You have already unsubscribed from ${typeLabel} emails.`
      : `You've been unsubscribed from ${typeLabel} emails.`;

    // Return JSON or HTML based on request
    if (html) {
      res.send(`
        <html>
          <head><title>Unsubscribed - CodeArena</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center; background: #0f172a; color: white;">
            <h1 style="color: #22c55e;">Successfully Unsubscribed</h1>
            <p>${message}</p>
            <p style="margin-top: 20px;">
              <a href="${FRONTEND_URL}/settings/profile"
                 style="color: #6366f1; text-decoration: none;">
                Manage all email preferences
              </a>
            </p>
            <p style="margin-top: 30px;">
              <a href="${FRONTEND_URL}"
                 style="background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
                Back to CodeArena
              </a>
            </p>
          </body>
        </html>
      `);
    } else {
      res.json({ ok: true, message, alreadyUnsubscribed: wasAlreadyUnsubscribed });
    }
  } catch (err) {
    logger.error('[NOTIFICATIONS] Unsubscribe error:', err);
    if (req.query.html) {
      return res.status(500).send(`
        <html>
          <head><title>Unsubscribe - Error</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Something went wrong</h1>
            <p>Please try again or manage your preferences in your account settings.</p>
            <p><a href="${FRONTEND_URL}/settings/profile">Manage preferences</a></p>
          </body>
        </html>
      `);
    }
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again later.' });
  }
}

router.get('/unsubscribe', handleUnsubscribe);

// RFC 8058 one-click unsubscribe, Gmail/Outlook POST form-encoded params here
router.post('/unsubscribe',
  express.urlencoded({ extended: false }),
  express.json(),
  (req, res, next) => {
    req.query = { ...req.query, ...(req.body || {}) };
    return handleUnsubscribe(req, res).catch(next);
  }
);

/**
 * POST /api/notifications/send-weekly-challenge
 * Admin endpoint to trigger weekly challenge emails
 * (In production, this would be called by a cron job)
 */
router.post('/send-weekly-challenge', adminLimiter, async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const allProblems = problemsLoader.getAll();
    if (allProblems.length === 0) {
      return res.status(500).json({ error: 'Problems not loaded' });
    }

    // Get this week's challenge
    const challenge = await db.getOrCreateArenaChallenge(allProblems);
    const problem = problemsLoader.getById(challenge.problem_id);

    if (!problem) {
      return res.status(500).json({ error: 'Challenge problem not found' });
    }

    // Get all subscribed users
    const subscribers = await db.getWeeklyChallengeSubscribers();

    logger.debug(`[NOTIFICATIONS] Sending weekly challenge to ${subscribers.length} users`);

    const results = {
      total: subscribers.length,
      sent: 0,
      failed: 0,
      errors: []
    };

    for (const user of subscribers) {
      const result = await emailService.sendWeeklyChallengeNotification({
        email: user.email,
        username: user.username,
        problem,
        week: challenge.challenge_date
      });

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ userId: user.id, error: result.error });
      }

      // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    res.json({
      success: true,
      results
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/subscribe/tournaments
 * Quick subscribe to tournament notifications
 */
router.post('/subscribe/tournaments', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentPrefs = await db.getEmailPreferences(userId);

    await db.setEmailPreferences(userId, {
      weeklyChallenge: currentPrefs?.weekly_challenge || false,
      marketing: currentPrefs?.marketing || false,
      progressDigest: currentPrefs?.progress_digest !== 0,
      tournamentNotifications: true,
      messageDigest: currentPrefs?.message_digest !== 0
    });

    res.json({
      success: true,
      message: 'Subscribed to tournament notifications'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/unsubscribe/tournaments
 * Quick unsubscribe from tournament notifications
 */
router.post('/unsubscribe/tournaments', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentPrefs = await db.getEmailPreferences(userId);

    await db.setEmailPreferences(userId, {
      weeklyChallenge: currentPrefs?.weekly_challenge || false,
      marketing: currentPrefs?.marketing || false,
      progressDigest: currentPrefs?.progress_digest !== 0,
      tournamentNotifications: false,
      messageDigest: currentPrefs?.message_digest !== 0
    });

    res.json({
      success: true,
      message: 'Unsubscribed from tournament notifications'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/subscribe/activity-reminders
 * Quick subscribe to activity reminder notifications
 */
router.post('/subscribe/activity-reminders', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const now = new Date().toISOString();

    await db.run(`
      INSERT INTO user_email_preferences (user_id, activity_reminders, created_at, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        activity_reminders = 1,
        updated_at = excluded.updated_at
    `, [userId, now, now]);

    res.json({
      success: true,
      message: 'Subscribed to activity reminder notifications'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/unsubscribe/activity-reminders
 * Quick unsubscribe from activity reminder notifications
 */
router.post('/unsubscribe/activity-reminders', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    await db.unsubscribeFromActivityReminders(userId);

    res.json({
      success: true,
      message: 'Unsubscribed from activity reminder notifications'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/send-tournament
 * Admin endpoint to trigger tournament notification emails
 * Can accept either tournamentId (for DB lookup) or direct tournament data
 */
router.post('/send-tournament', adminLimiter, async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { tournamentId, tournamentName, startDate, registrationDeadline, prizePool, tournamentUrl, description } = req.body;

    let tournament;

    // If tournamentId provided, look up from DB
    if (tournamentId) {
      tournament = await db.getTournamentById(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }
    } else if (tournamentName && startDate) {
      // Otherwise use provided data directly (for testing or ad-hoc notifications)
      tournament = {
        id: 'manual-notification',
        name: tournamentName,
        start_time: startDate,
        registration_deadline: registrationDeadline || startDate,
        prize_pool: prizePool || '',
        description: description || ''
      };
      // Add custom URL if provided
      if (tournamentUrl) {
        tournament.custom_url = tournamentUrl;
      }
    } else {
      return res.status(400).json({ error: 'Either tournamentId or tournamentName+startDate required' });
    }

    const results = await emailService.sendTournamentNotificationToAll(db, tournament);

    res.json({
      success: true,
      results
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/send-activity-reminders
 * Admin endpoint to trigger activity reminder emails
 */
router.post('/send-activity-reminders', adminLimiter, async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'] || (req.body && req.body.adminKey);
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Import scheduler to use the trigger function
    const scheduler = require('../services/scheduler');
    const results = await scheduler.triggerActivityReminderEmails();

    res.json({
      success: true,
      results
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/send-changelog
 * Admin endpoint to trigger changelog emails
 * Accepts { changes: string[], dryRun?: boolean } in body
 * dryRun returns subscriber count without sending
 * Requires x-admin-key header
 */
router.post('/send-changelog', adminLimiter, async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.body.adminKey;
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { changes, dryRun } = req.body;

    // Validate changes array
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid changes array',
        message: 'Request body must include a non-empty "changes" array of strings'
      });
    }

    // Validate each change is a string
    if (!changes.every(c => typeof c === 'string' && c.trim().length > 0)) {
      return res.status(400).json({
        error: 'Invalid changes format',
        message: 'All changes must be non-empty strings'
      });
    }

    // Get verified users who have NOT opted out of marketing emails.
    // Changelog is a marketing/product-update email, so marketing = 0 (explicit
    // unsubscribe) must be excluded. NULL = no preference set yet = include.
    const subscribers = await db.all(`
      SELECT u.id, u.email, u.username
      FROM users u
      LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
      WHERE u.email IS NOT NULL AND u.email != '' AND u.email_verified = 1
        AND (uep.marketing IS NULL OR uep.marketing = 1)
    `);

    // If dry run, just return the count
    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        subscriberCount: subscribers.length,
        changes: changes
      });
    }

    // Send changelog emails using the email service
    const results = await emailService.sendWeeklyChangelogToAll(db, changes);

    logger.info(`[NOTIFICATIONS] Changelog sent: ${results.sent}/${results.total} successful`);

    res.json({
      success: true,
      results
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/preview/activity-reminder
 * Preview what your activity reminder email would look like
 */
router.get('/preview/activity-reminder', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await db.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get actual pending data for preview
    const friendRequests = await db.getPendingFriendRequestsForReminder(userId, 3);
    const messages = await db.getUnreadMessagesForReminder(userId, 3);

    // Get total counts
    const pendingFriendRequests = await db.all(
      'SELECT COUNT(*) as count FROM friend_requests WHERE requested_id = ? AND status = ?',
      [userId, 'pending']
    );
    const unreadMessages = await db.all(
      'SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND read_at IS NULL',
      [userId]
    );

    const friendRequestCount = pendingFriendRequests[0]?.count || 0;
    const messageCount = unreadMessages[0]?.count || 0;

    // If user has no activity, generate sample preview
    const hasSampleData = friendRequestCount === 0 && messageCount === 0;
    const sampleFriendRequests = hasSampleData ? [
      { sender_username: 'alex_coder', sender_avatar: null, created_at: new Date().toISOString() },
      { sender_username: 'ninja_dev', sender_avatar: null, created_at: new Date().toISOString() }
    ] : friendRequests;
    const sampleMessages = hasSampleData ? [
      { sender_username: 'sarah_js', content: 'Hey! Great battle yesterday, want a rematch?', sender_avatar: null, created_at: new Date().toISOString() },
      { sender_username: 'python_master', content: 'Check out this new algorithm I found...', sender_avatar: null, created_at: new Date().toISOString() }
    ] : messages;

    const html = emailService.generateActivityReminderEmail({
      email: user.email,
      username: user.username,
      friendRequests: sampleFriendRequests,
      messages: sampleMessages,
      friendRequestCount: hasSampleData ? 2 : friendRequestCount,
      messageCount: hasSampleData ? 2 : messageCount
    });

    // Return the HTML preview
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/test-email
 * Send a test email to the current user (for testing)
 */
router.post('/test-email', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const user = await db.getUserById(userId);

    if (!user || !user.email) {
      return res.status(400).json({ error: 'No email address found' });
    }

    const allProblems = problemsLoader.getAll();
    if (allProblems.length === 0) {
      return res.status(500).json({ error: 'Problems not loaded' });
    }

    // Get this week's challenge for the test
    const challenge = await db.getOrCreateArenaChallenge(allProblems);
    const problem = problemsLoader.getById(challenge.problem_id);

    if (!problem) {
      return res.status(500).json({ error: 'Challenge problem not found' });
    }

    const result = await emailService.sendWeeklyChallengeNotification({
      email: user.email,
      username: user.username,
      problem,
      week: challenge.challenge_date
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Test email sent to ${user.email}`
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (err) {
    next(err);
  }
});

// ============================================
// PRIVACY SETTINGS
// ============================================

/**
 * GET /api/notifications/privacy
 * Get user's privacy settings (read receipts, etc.)
 */
router.get('/privacy', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const showReadReceipts = await db.getReadReceiptsPreference(userId);

    res.json({
      success: true,
      privacy: {
        showReadReceipts
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/privacy
 * Update user's privacy settings
 */
router.put('/privacy', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { showReadReceipts } = req.body;

    if (typeof showReadReceipts === 'boolean') {
      await db.setReadReceiptsPreference(userId, showReadReceipts);
    }

    const updatedShowReadReceipts = await db.getReadReceiptsPreference(userId);

    res.json({
      success: true,
      privacy: {
        showReadReceipts: updatedShowReadReceipts
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// IN-APP NOTIFICATIONS
// ============================================

/** GET /api/notifications/in-app: Get user's notifications */
router.get('/in-app', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { unreadOnly } = req.query;
    const notifications = await db.getUserNotifications(userId, { unreadOnly: unreadOnly === 'true' });
    const unreadCount = await db.getUnreadNotificationCount(userId);
    res.json({ notifications, unreadCount });
  } catch (err) {
    logger.error('[NOTIFICATIONS] In-app fetch error:', err.message);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

/** GET /api/notifications/in-app/count: Get unread count */
router.get('/in-app/count', authMiddleware, async (req, res) => {
  try {
    const count = await db.getUnreadNotificationCount(req.user.sub);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

/** POST /api/notifications/in-app/:id/read: Mark one as read */
router.post('/in-app/:id/read', authMiddleware, async (req, res) => {
  try {
    await db.markNotificationRead(req.params.id, req.user.sub);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

/** POST /api/notifications/in-app/read-all: Mark all as read */
router.post('/in-app/read-all', authMiddleware, async (req, res) => {
  try {
    await db.markAllNotificationsRead(req.user.sub);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

module.exports = router;
