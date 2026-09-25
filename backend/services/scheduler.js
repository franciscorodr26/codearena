/**
 * Scheduler Service for CodeArena
 * Handles CodeArena's social reminders and routine data cleanup.
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const emailService = require('./email');

let db = null;
let dbHelper = null;
let problems = [];

/**
 * Initialize the scheduler with database and problems
 */
function init(database, problemList, databaseHelper = null) {
  db = database;
  dbHelper = databaseHelper;
  problems = problemList;
  logger.info('[SCHEDULER] Initialized with', problemList.length, 'problems');
}

/**
 * Send weekly challenge emails to all subscribed users
 */
async function sendWeeklyChallengeEmails() {
  if (!db) {
    logger.error('[SCHEDULER] Database not initialized');
    return { success: false, error: 'Database not initialized' };
  }

  if (problems.length === 0) {
    logger.error('[SCHEDULER] Problems not loaded');
    return { success: false, error: 'Problems not loaded' };
  }

  try {
    logger.info('[SCHEDULER] Starting weekly challenge email job...');

    // Get this week's challenge
    const challenge = await db.getOrCreateArenaChallenge(problems);
    const problem = problems.find(p => p.id === challenge.problem_id);

    if (!problem) {
      logger.error('[SCHEDULER] Challenge problem not found');
      return { success: false, error: 'Challenge problem not found' };
    }

    // Get all subscribed users
    const subscribers = await db.getWeeklyChallengeSubscribers();
    logger.debug(`[SCHEDULER] Found ${subscribers.length} subscribers`);

    if (subscribers.length === 0) {
      logger.info('[SCHEDULER] No subscribers to notify');
      return { success: true, sent: 0, total: 0 };
    }

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
        logger.debug(`[SCHEDULER] Email sent to ${user.email}`);
      } else {
        results.failed++;
        results.errors.push({ userId: user.id, email: user.email, error: result.error });
        logger.error(`[SCHEDULER] Failed to send to ${user.email}:`, result.error);
      }

      // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    logger.debug(`[SCHEDULER] Weekly challenge emails complete: ${results.sent}/${results.total} sent`);
    return { success: true, ...results };
  } catch (err) {
    logger.error('[SCHEDULER] Error sending weekly challenge emails:', err);
    return { success: false, error: err.message };
  }
}

// Configurable thresholds via environment variables
const ACTIVITY_REMINDER_DAYS = parseInt(process.env.ACTIVITY_REMINDER_DAYS, 10) || 3;
const REMINDER_COOLDOWN_DAYS = parseInt(process.env.REMINDER_COOLDOWN_DAYS, 10) || 7;

/**
 * Send activity reminder emails to users with pending friend requests or unread messages
 * Runs weekly (Wednesday 10 AM UTC)
 *
 * Configurable via env vars:
 * - ACTIVITY_REMINDER_DAYS: How old activity must be before reminding (default: 3)
 * - REMINDER_COOLDOWN_DAYS: Min days between reminders per user (default: 7)
 */
async function sendActivityReminderEmails() {
  if (!dbHelper) {
    logger.error('[SCHEDULER] Database helper not initialized');
    return { success: false, error: 'Database helper not initialized' };
  }

  try {
    logger.info(`[SCHEDULER] Starting activity reminder email job (activity threshold: ${ACTIVITY_REMINDER_DAYS} days, cooldown: ${REMINDER_COOLDOWN_DAYS} days)...`);

    // Get users with pending activity who haven't been reminded recently
    const usersNeedingReminder = await dbHelper.getUsersNeedingActivityReminder(ACTIVITY_REMINDER_DAYS, REMINDER_COOLDOWN_DAYS);
    logger.debug(`[SCHEDULER] Found ${usersNeedingReminder.length} users needing activity reminder`);

    if (usersNeedingReminder.length === 0) {
      logger.info('[SCHEDULER] No users need activity reminders');
      return { success: true, sent: 0, total: 0 };
    }

    const results = {
      total: usersNeedingReminder.length,
      sent: 0,
      failed: 0,
      errors: []
    };

    const reminderDetailsByUser = await dbHelper.getActivityReminderDetailsForUsers(
      usersNeedingReminder.map(user => user.id),
      3
    );

    for (const user of usersNeedingReminder) {
      try {
        const details = reminderDetailsByUser[user.id] || { friendRequests: [], messages: [] };

        // Send the email
        const result = await emailService.sendActivityReminderEmail({
          email: user.email,
          username: user.username,
          friendRequests: details.friendRequests,
          messages: details.messages,
          friendRequestCount: user.pending_friend_requests,
          messageCount: user.unread_messages
        });

        if (result.success) {
          // Record that we sent this reminder
          await dbHelper.recordActivityReminderSent(user.id, {
            friendRequests: user.pending_friend_requests,
            messages: user.unread_messages
          });
          results.sent++;
          logger.debug(`[SCHEDULER] Activity reminder sent to ${user.email}`);
        } else {
          results.failed++;
          results.errors.push({ userId: user.id, email: user.email, error: result.error });
          logger.error(`[SCHEDULER] Failed to send activity reminder to ${user.email}:`, result.error);
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ userId: user.id, email: user.email, error: err.message });
        logger.error(`[SCHEDULER] Error processing activity reminder for ${user.email}:`, err.message);
      }

      // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    logger.debug(`[SCHEDULER] Activity reminders complete: ${results.sent}/${results.total} sent`);
    return { success: true, ...results };
  } catch (err) {
    logger.error('[SCHEDULER] Error sending activity reminder emails:', err?.message || err || 'Unknown error');
    return { success: false, error: err?.message || 'Unknown error' };
  }
}

// Configurable threshold for student expiration warnings (default: 30 days before expiry)
const STUDENT_EXPIRATION_WARNING_DAYS = parseInt(process.env.STUDENT_EXPIRATION_WARNING_DAYS, 10) || 30;

/**
 * Send student expiration warning emails to users whose student verification is expiring soon
 * Runs daily at 8:00 AM UTC
 *
 * Configurable via env vars:
 * - STUDENT_EXPIRATION_WARNING_DAYS: How many days before expiry to warn (default: 30)
 */
async function sendStudentExpirationWarningEmails() {
  if (!dbHelper) {
    logger.error('[SCHEDULER] Database helper not initialized');
    return { success: false, error: 'Database helper not initialized' };
  }

  try {
    logger.info(`[SCHEDULER] Starting student expiration warning email job (warning threshold: ${STUDENT_EXPIRATION_WARNING_DAYS} days)...`);

    // Get users whose student verification is expiring within the threshold
    const usersNeedingWarning = await dbHelper.getUsersNeedingStudentExpirationWarning(STUDENT_EXPIRATION_WARNING_DAYS);
    logger.debug(`[SCHEDULER] Found ${usersNeedingWarning.length} users needing student expiration warning`);

    if (usersNeedingWarning.length === 0) {
      logger.info('[SCHEDULER] No users need student expiration warnings');
      return { success: true, sent: 0, total: 0 };
    }

    const results = {
      total: usersNeedingWarning.length,
      sent: 0,
      failed: 0,
      errors: []
    };

    for (const user of usersNeedingWarning) {
      try {
        // Calculate days until expiry for this user
        const verifiedAt = new Date(user.student_verified_at);
        const expiresAt = new Date(verifiedAt);
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        const now = new Date();
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysUntilExpiry = Math.ceil((expiresAt - now) / msPerDay);

        // Send the warning email
        const result = await emailService.sendStudentExpirationWarningEmail({
          email: user.email,
          username: user.username,
          daysUntilExpiry,
          studentEmail: user.student_email
        });

        if (result.success) {
          // Record that we sent this warning
          await dbHelper.recordStudentExpirationWarningSent(user.id);
          results.sent++;
          logger.debug(`[SCHEDULER] Student expiration warning sent to ${user.email} (expires in ${daysUntilExpiry} days)`);
        } else {
          results.failed++;
          results.errors.push({ userId: user.id, email: user.email, error: result.error });
          logger.error(`[SCHEDULER] Failed to send student expiration warning to ${user.email}:`, result.error);
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ userId: user.id, email: user.email, error: err.message });
        logger.error(`[SCHEDULER] Error processing student expiration warning for ${user.email}:`, err.message);
      }

      // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    logger.debug(`[SCHEDULER] Student expiration warnings complete: ${results.sent}/${results.total} sent`);
    return { success: true, ...results };
  } catch (err) {
    logger.error('[SCHEDULER] Error sending student expiration warning emails:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send weekly progress digest emails to all Pro users
 */
async function sendWeeklyProgressDigests() {
  if (!dbHelper) {
    logger.error('[SCHEDULER] Database helper not initialized');
    return { success: false, error: 'Database helper not initialized' };
  }

  try {
    logger.info('[SCHEDULER] Starting weekly progress digest job...');

    // Get all Pro users with email
    const proUsers = await dbHelper.getProUsersForWeeklyDigest();
    logger.debug(`[SCHEDULER] Found ${proUsers.length} Pro users for digest`);

    if (proUsers.length === 0) {
      logger.info('[SCHEDULER] No Pro users to send digest to');
      return { success: true, sent: 0, total: 0 };
    }

    const results = {
      total: proUsers.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    for (const user of proUsers) {
      try {
        // Get user's weekly stats
        const stats = await dbHelper.getUserWeeklyStats(user.id);

        // Skip if no activity this week
        if (stats.problemsSolved === 0 && stats.battlesWon === 0) {
          results.skipped++;
          logger.debug(`[SCHEDULER] Skipping ${user.email} - no activity this week`);
          continue;
        }

        const result = await emailService.sendWeeklyProgressDigest({
          email: user.email,
          username: user.username,
          stats
        });

        if (result.success) {
          results.sent++;
          logger.debug(`[SCHEDULER] Progress digest sent to ${user.email}`);
        } else {
          results.failed++;
          results.errors.push({ userId: user.id, email: user.email, error: result.error });
          logger.error(`[SCHEDULER] Failed to send digest to ${user.email}:`, result.error);
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ userId: user.id, email: user.email, error: err.message });
        logger.error(`[SCHEDULER] Error processing user ${user.email}:`, err.message);
      }

      // Rate limiting - wait 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    logger.debug(`[SCHEDULER] Weekly progress digests complete: ${results.sent} sent, ${results.skipped} skipped (no activity), ${results.failed} failed`);
    return { success: true, ...results };
  } catch (err) {
    logger.error('[SCHEDULER] Error sending weekly progress digests:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send weekly message digest emails to users who received messages in the past 7 days
 */
async function sendWeeklyMessageDigests() {
  if (!dbHelper) {
    logger.error('[SCHEDULER] Database helper not initialized');
    return { success: false, error: 'Database helper not initialized' };
  }

  try {
    logger.info('[SCHEDULER] Starting weekly message digest job...');

    const users = await dbHelper.getUsersForWeeklyMessageDigest();
    logger.debug(`[SCHEDULER] Found ${users.length} users for message digest`);

    if (users.length === 0) {
      logger.info('[SCHEDULER] No users to send message digest to');
      return { success: true, sent: 0, total: 0 };
    }

    const results = { total: users.length, sent: 0, skipped: 0, failed: 0, errors: [] };

    for (const user of users) {
      try {
        const senders = await dbHelper.getWeeklyMessageDigestDetails(user.id, 3);

        const result = await emailService.sendWeeklyMessageDigest({
          email: user.email,
          username: user.username,
          senders,
          totalMessages: user.total_messages
        });

        if (result.success) {
          results.sent++;
          logger.debug(`[SCHEDULER] Message digest sent to ${user.email}`);
        } else {
          results.failed++;
          results.errors.push({ userId: user.id, email: user.email, error: result.error });
          logger.error(`[SCHEDULER] Failed to send message digest to ${user.email}:`, result.error);
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ userId: user.id, email: user.email, error: err.message });
        logger.error(`[SCHEDULER] Error processing message digest for ${user.email}:`, err.message);
      }

      // Rate limiting - 600ms between emails to respect Resend's 2 req/sec limit
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    logger.debug(`[SCHEDULER] Message digests complete: ${results.sent} sent, ${results.failed} failed`);
    return { success: true, ...results };
  } catch (err) {
    logger.error('[SCHEDULER] Error sending weekly message digests:', err);
    return { success: false, error: err.message };
  }
}

// Store scheduled tasks for cleanup
const scheduledTasks = [];

/**
 * Start all scheduled jobs
 */
function startScheduledJobs() {
  // Weekly challenge emails are DISABLED: the weekly-challenge feature is no longer part
  // of the product, so we no longer send the "This Week's Challenge" email. The
  // sendWeeklyChallengeEmails() function is kept for any manual/admin trigger but is no
  // longer scheduled. (Previously: cron '0 9 * * 1', Monday 9:00 AM UTC.)

  // Send weekly message digests every Friday at 5:00 PM UTC
  // '0 17 * * 5' = At 17:00 on Friday
  const messageDigestTask = cron.schedule('0 17 * * 5', async () => {
    logger.info('[SCHEDULER] Running weekly message digest job (Friday 5 PM UTC)');
    await sendWeeklyMessageDigests();
  }, {
    timezone: 'UTC'
  });
  scheduledTasks.push(messageDigestTask);

  logger.info('[SCHEDULER] Weekly message digests scheduled for Friday 5:00 PM UTC');

  // Apply trust decay daily at 3:00 AM UTC
  // '0 3 * * *' = At 03:00 every day
  const decayTask = cron.schedule('0 3 * * *', async () => {
    logger.info('[SCHEDULER] Running trust decay job (daily 3 AM UTC)');
    try {
      if (!db || typeof db.applyTrustDecay !== 'function') {
        logger.warn('[SCHEDULER] Trust decay skipped: database not properly initialized');
        return;
      }
      const results = await db.applyTrustDecay();
      if (results) {
        logger.info(`[SCHEDULER] Trust decay complete: ${results.decayed || 0} users decayed, ${results.processed || 0} checked`);
      } else {
        logger.warn('[SCHEDULER] Trust decay returned no results');
      }
    } catch (err) {
      logger.error('[SCHEDULER] Trust decay error:', err?.message || err || 'Unknown error');
    }
  }, {
    timezone: 'UTC'
  });
  scheduledTasks.push(decayTask);

  logger.info('[SCHEDULER] Trust decay scheduled for daily 3:00 AM UTC');

  // Send activity reminder emails every Wednesday at 10:00 AM UTC
  // '0 10 * * 3' = At 10:00 on Wednesday
  const activityReminderTask = cron.schedule('0 10 * * 3', async () => {
    logger.info('[SCHEDULER] Running activity reminder email job (Wednesday 10 AM UTC)');
    await sendActivityReminderEmails();
  }, {
    timezone: 'UTC'
  });
  scheduledTasks.push(activityReminderTask);

  logger.info('[SCHEDULER] Activity reminder emails scheduled for Wednesday 10:00 AM UTC');

  // Cleanup expired user sessions daily at 3 AM UTC
  // Sessions older than 30 days (matching longest JWT expiration) are deleted
  const sessionCleanupTask = cron.schedule('0 3 * * *', async () => {
    logger.info('[SCHEDULER] Running session cleanup job (daily 3 AM UTC)');
    await cleanupExpiredSessions();
  }, {
    timezone: 'UTC'
  });
  scheduledTasks.push(sessionCleanupTask);

  logger.info('[SCHEDULER] Session cleanup scheduled for daily 3:00 AM UTC');

}

/**
 * Manually trigger the weekly challenge email job (for testing/admin)
 */
async function triggerWeeklyChallengeEmails() {
  logger.info('[SCHEDULER] Manually triggering weekly challenge emails');
  return await sendWeeklyChallengeEmails();
}

/**
 * Manually trigger the weekly progress digest job (for testing/admin)
 */
async function triggerWeeklyProgressDigests() {
  logger.info('[SCHEDULER] Manually triggering weekly progress digests');
  return await sendWeeklyProgressDigests();
}

/**
 * Manually trigger the weekly message digest job (for testing/admin)
 */
async function triggerWeeklyMessageDigests() {
  logger.info('[SCHEDULER] Manually triggering weekly message digests');
  return await sendWeeklyMessageDigests();
}

/**
 * Manually trigger the activity reminder email job (for testing/admin)
 */
async function triggerActivityReminderEmails() {
  logger.info('[SCHEDULER] Manually triggering activity reminder emails');
  return await sendActivityReminderEmails();
}

/**
 * Manually trigger the student expiration warning email job (for testing/admin)
 */
async function triggerStudentExpirationWarningEmails() {
  logger.info('[SCHEDULER] Manually triggering student expiration warning emails');
  return await sendStudentExpirationWarningEmails();
}

/**
 * Clean up expired student verification tokens to prevent database bloat
 */
async function cleanupExpiredStudentVerifications() {
  if (!db) {
    logger.error('[SCHEDULER] Database not initialized');
    return { success: false, error: 'Database not initialized' };
  }

  try {
    const result = await db.cleanupExpiredStudentVerifications();
    logger.info(`[SCHEDULER] Student verification cleanup complete: ${result.deletedCount} records deleted`);
    return { success: true, deletedCount: result.deletedCount };
  } catch (err) {
    logger.error('[SCHEDULER] Error cleaning up student verifications:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Manually trigger the student verification cleanup job (for testing/admin)
 */
async function triggerStudentVerificationCleanup() {
  logger.info('[SCHEDULER] Manually triggering student verification cleanup');
  return await cleanupExpiredStudentVerifications();
}

/**
 * Clean up expired user sessions (older than 30 days)
 */
async function cleanupExpiredSessions() {
  if (!db) {
    logger.error('[SCHEDULER] Database not initialized');
    return { success: false, error: 'Database not initialized' };
  }

  try {
    logger.info('[SCHEDULER] Cleaning up expired user sessions...');

    const result = await db.cleanupExpiredSessions();

    logger.info(`[SCHEDULER] Session cleanup complete: ${result.deletedCount} expired sessions deleted`);
    return { success: true, deletedCount: result.deletedCount };
  } catch (err) {
    logger.error('[SCHEDULER] Error cleaning up expired sessions:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Stop all scheduled jobs (for tests)
 */
function stop() {
  scheduledTasks.forEach(task => {
    if (task && typeof task.stop === 'function') {
      task.stop();
    }
  });
  scheduledTasks.length = 0;
  logger.debug('[SCHEDULER] All scheduled jobs stopped');
}

module.exports = {
  init,
  startScheduledJobs,
  stop,
  sendWeeklyChallengeEmails,
  triggerWeeklyChallengeEmails,
  sendWeeklyProgressDigests,
  triggerWeeklyProgressDigests,
  sendWeeklyMessageDigests,
  triggerWeeklyMessageDigests,
  sendActivityReminderEmails,
  triggerActivityReminderEmails,
  sendStudentExpirationWarningEmails,
  triggerStudentExpirationWarningEmails,
  cleanupExpiredStudentVerifications,
  triggerStudentVerificationCleanup,
  cleanupExpiredSessions
};
