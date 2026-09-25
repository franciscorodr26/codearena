/**
 * Activity Service
 * Handles creating activity events and sending push notifications
 */

const webpush = require('web-push');
const logger = require('../utils/logger');
const db = require('../db');

// Configure web-push with VAPID keys
// VAPID keys are required for push notifications in production
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

// Push notifications are optional - only configure if keys are present and valid
let pushNotificationsEnabled = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      'mailto:support@codearena.co',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    pushNotificationsEnabled = true;
    logger.info('[ACTIVITY] Push notifications enabled');
  } catch (err) {
    logger.warn(
      '[ACTIVITY] Push notifications disabled, invalid VAPID keys (use real keys or remove VAPID_* from .env):',
      err.message
    );
  }
} else {
  logger.warn('[ACTIVITY] Push notifications disabled - VAPID keys not configured');
}

/**
 * Event type configurations with display info
 */
const eventConfig = {
  battle_win: {
    icon: '⚔️',
    getTitle: (data) => 'Battle Victory!',
    getMessage: (data, username) => `${username} won a battle${data.opponent ? ` against ${data.opponent}` : ''}!`
  },
  badge_earned: {
    icon: '🏆',
    getTitle: (data) => 'Badge Earned!',
    getMessage: (data, username) => `${username} earned the "${data.badgeName}" badge!`
  },
  friend_added: {
    icon: '👋',
    getTitle: (data) => 'New Friend!',
    getMessage: (data, username) => `${username} and ${data.friendName} are now friends!`
  },
  rank_up: {
    icon: '📈',
    getTitle: (data) => 'Rank Up!',
    getMessage: (data, username) => `${username} reached ${data.rank}!`
  },
  streak_milestone: {
    icon: '🔥',
    getTitle: (data) => 'Win Streak!',
    getMessage: (data, username) => `${username} is on a ${data.streak}-win streak!`
  },
  weekly_completed: {
    icon: '📅',
    getTitle: (data) => 'Weekly Challenge Complete!',
    getMessage: (data, username) => `${username} completed this week's challenge${data.rank ? ` and ranked #${data.rank}` : ''}!`
  },
  practice_milestone: {
    icon: '📚',
    getTitle: (data) => 'Practice Milestone!',
    getMessage: (data, username) => `${username} solved ${data.count} practice problems!`
  },
  tournament_registered: {
    icon: '🏆',
    getTitle: (data) => 'Tournament Registration!',
    getMessage: (data, username) => `${username} registered for ${data.tournamentName}!`
  },
  tournament_match_won: {
    icon: '⚔️',
    getTitle: (data) => 'Tournament Match Won!',
    getMessage: (data, username) => `${username} won a match in ${data.tournamentName}!`
  },
  tournament_won: {
    icon: '👑',
    getTitle: (data) => 'Tournament Champion!',
    getMessage: (data, username) => `${username} won the ${data.tournamentName} tournament!`
  },
  tournament_finalist: {
    icon: '🥈',
    getTitle: (data) => 'Tournament Finalist!',
    getMessage: (data, username) => `${username} reached the finals of ${data.tournamentName}!`
  }
};

/**
 * Create an activity event and optionally notify friends
 * @param {number} userId - The user who triggered the event
 * @param {string} eventType - Type of event (see eventConfig)
 * @param {object} eventData - Additional data about the event
 * @param {boolean} isPublic - Whether the event is publicly visible
 * @param {boolean} notifyFriends - Whether to send push notifications to friends
 */
async function createActivity(userId, eventType, eventData = {}, isPublic = true, notifyFriends = true) {
  try {
    // Create the activity event
    const event = await db.createActivityEvent(userId, eventType, eventData, isPublic);

    // Get user info for notification
    const user = await db.getUserById(userId);
    if (!user) return event;

    // Send push notifications to friends if enabled
    if (notifyFriends && isPublic && eventConfig[eventType]) {
      await notifyFriendsOfActivity(userId, user.username, eventType, eventData);
    }

    return event;
  } catch (err) {
    logger.error('[ACTIVITY] Error creating activity:', err);
    return null;
  }
}

/**
 * Send push notifications to a user's friends about an activity
 */
async function notifyFriendsOfActivity(userId, username, eventType, eventData) {
  try {
    // Get friend IDs who have activity notifications enabled
    const friendIds = await db.getUserFriendIds(userId);
    if (!friendIds.length) return;

    // Get push subscriptions for friends
    const subscriptions = await db.getPushSubscriptionsForUsers(friendIds);
    if (!subscriptions.length) return;

    const config = eventConfig[eventType];
    if (!config) return;

    const notification = {
      title: config.getTitle(eventData),
      body: config.getMessage(eventData, username),
      icon: config.icon,
      data: {
        type: eventType,
        userId: userId,
        ...eventData
      }
    };

    // Send to all friend subscriptions
    const sendPromises = subscriptions.map(sub => sendPushNotification(sub, notification));
    await Promise.allSettled(sendPromises);
  } catch (err) {
    logger.error('[ACTIVITY] Error notifying friends:', err);
  }
}

/**
 * Send a push notification to a specific subscription
 */
async function sendPushNotification(subscription, payload) {
  try {
    // Skip if push notifications not enabled
    if (!pushNotificationsEnabled) {
      return { success: false, reason: 'Push notifications not configured' };
    }

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };

    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return { success: true };
  } catch (err) {
    // If subscription is expired/invalid, remove it
    if (err.statusCode === 404 || err.statusCode === 410) {
      await db.removePushSubscription(subscription.endpoint);
      logger.info('[PUSH] Removed expired subscription');
    }
    return { success: false, error: err.message };
  }
}

/**
 * Helper function to create a battle win activity
 */
async function recordBattleWin(userId, { opponentName, opponentId, solveTime, problem }) {
  return createActivity(userId, 'battle_win', {
    opponent: opponentName,
    opponentId,
    solveTime,
    problemTitle: problem?.title
  }, true, true);
}

/**
 * Helper function to create a badge earned activity
 */
async function recordBadgeEarned(userId, { badgeName, badgeSlug, badgeIcon, badgeRarity }) {
  return createActivity(userId, 'badge_earned', {
    badgeName,
    badgeSlug,
    badgeIcon,
    badgeRarity
  }, true, true);
}

/**
 * Helper function to create a friend added activity
 */
async function recordFriendAdded(userId1, userId2, username1, username2) {
  // Create activity for both users
  await createActivity(userId1, 'friend_added', { friendId: userId2, friendName: username2 }, true, false);
  await createActivity(userId2, 'friend_added', { friendId: userId1, friendName: username1 }, true, false);
}

/**
 * Helper function to record rank up
 */
async function recordRankUp(userId, { rank, rating }) {
  return createActivity(userId, 'rank_up', { rank, rating }, true, true);
}

/**
 * Helper function to record streak milestone
 */
async function recordStreakMilestone(userId, streak) {
  // Only record notable streaks (3, 5, 10, 15, 25)
  const notableStreaks = [3, 5, 10, 15, 25];
  if (!notableStreaks.includes(streak)) return null;

  return createActivity(userId, 'streak_milestone', { streak }, true, true);
}

/**
 * Helper function to record weekly challenge completion
 */
async function recordWeeklyCompleted(userId, { rank, time }) {
  return createActivity(userId, 'weekly_completed', { rank, time }, true, true);
}

/**
 * Helper function to record practice milestone
 */
async function recordPracticeMilestone(userId, count) {
  // Only record notable milestones (10, 25, 50, 100, 250, 500)
  const notableMilestones = [10, 25, 50, 100, 250, 500];
  if (!notableMilestones.includes(count)) return null;

  return createActivity(userId, 'practice_milestone', { count }, true, true);
}

/**
 * Get the VAPID public key for client-side subscription
 */
function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

module.exports = {
  createActivity,
  recordBattleWin,
  recordBadgeEarned,
  recordFriendAdded,
  recordRankUp,
  recordStreakMilestone,
  recordWeeklyCompleted,
  recordPracticeMilestone,
  sendPushNotification,
  getVapidPublicKey,
  VAPID_PUBLIC_KEY
};
