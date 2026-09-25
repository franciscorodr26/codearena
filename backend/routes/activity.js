const express = require('express');
const db = require('../db');
const { authMiddleware } = require('./auth');
const activityService = require('../services/activityService');

const router = express.Router();

/**
 * GET /api/activity/vapid-key
 * Get the VAPID public key for push subscription
 */
router.get('/vapid-key', (req, res) => {
  res.json({
    success: true,
    publicKey: activityService.VAPID_PUBLIC_KEY
  });
});

/**
 * GET /api/activity
 * Get personalized activity feed (own + friends' public events)
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const events = await db.getActivityFeed(userId, limit, offset);

    res.json({
      success: true,
      events,
      pagination: { limit, offset, hasMore: events.length === limit }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/activity/global
 * Get global activity feed (notable public events from all users)
 */
router.get('/global', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
    const offset = parseInt(req.query.offset, 10) || 0;

    const events = await db.getGlobalActivityFeed(limit, offset);

    res.json({
      success: true,
      events,
      pagination: { limit, offset, hasMore: events.length === limit }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/activity/user/:userId
 * Get activity events for a specific user
 */
router.get('/user/:userId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }
    const viewerId = req.user?.sub || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = parseInt(req.query.offset, 10) || 0;

    const events = await db.getUserActivityEvents(userId, viewerId, limit, offset);

    res.json({
      success: true,
      events,
      pagination: { limit, offset, hasMore: events.length === limit }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/activity/push/subscribe
 * Subscribe to push notifications
 */
router.post('/push/subscribe', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { subscription } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    await db.savePushSubscription(userId, subscription);

    res.json({
      success: true,
      message: 'Push subscription saved'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/activity/push/unsubscribe
 * Unsubscribe from push notifications
 */
router.post('/push/unsubscribe', authMiddleware, async (req, res, next) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint required' });
    }

    await db.removePushSubscription(endpoint);

    res.json({
      success: true,
      message: 'Push subscription removed'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/activity/preferences
 * Get user's activity/notification preferences
 */
router.get('/preferences', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const prefs = await db.getActivityPreferences(userId);

    res.json({
      success: true,
      preferences: prefs
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/activity/preferences
 * Update user's activity/notification preferences
 */
router.put('/preferences', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { activityFeed } = req.body;

    const prefs = await db.setActivityPreferences(userId, { activityFeed });

    res.json({
      success: true,
      preferences: prefs
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
