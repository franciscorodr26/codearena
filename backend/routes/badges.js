/**
 * Badge Routes
 *
 * API endpoints for the badge/achievement system
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const badgeService = require('../services/badgeService');
const authRouter = require('./auth');
const logger = require('../utils/logger');

const authMiddleware = authRouter.authMiddleware;

/**
 * GET /api/badges
 * Get all badges (optionally filtered by category)
 */
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const badges = await db.getAllBadges(category || null);
    res.json({ badges });
  } catch (error) {
    logger.error('Error fetching badges:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

/**
 * GET /api/badges/user/:userId
 * Get badges earned by a specific user
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const badges = await db.getUserBadges(userId);
    const stats = await db.getUserBadgeStats(userId);

    res.json({ badges, stats });
  } catch (error) {
    logger.error('Error fetching user badges:', error);
    res.status(500).json({ error: 'Failed to fetch user badges' });
  }
});

/**
 * GET /api/badges/showcase/:userId
 * Get all badges with user's earned status (for badge showcase page)
 */
router.get('/showcase/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const badges = await db.getBadgesWithUserStatus(userId);
    const stats = await db.getUserBadgeStats(userId);

    // Group badges by category
    const grouped = badges.reduce((acc, badge) => {
      if (!acc[badge.category]) {
        acc[badge.category] = [];
      }
      acc[badge.category].push(badge);
      return acc;
    }, {});

    res.json({ badges: grouped, stats });
  } catch (error) {
    logger.error('Error fetching badge showcase:', error);
    res.status(500).json({ error: 'Failed to fetch badge showcase' });
  }
});

/**
 * GET /api/badges/me
 * Get current user's badges (requires auth)
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const badges = await db.getUserBadges(userId);
    const stats = await db.getUserBadgeStats(userId);

    res.json({ badges, stats });
  } catch (error) {
    logger.error('Error fetching my badges:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

/**
 * GET /api/badges/me/unnotified
 * Get badges the user hasn't been notified about yet
 */
router.get('/me/unnotified', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const badges = await db.getUnnotifiedBadges(userId);
    res.json({ badges });
  } catch (error) {
    logger.error('Error fetching unnotified badges:', error);
    res.status(500).json({ error: 'Failed to fetch unnotified badges' });
  }
});

/**
 * POST /api/badges/me/mark-notified
 * Mark badges as notified (after showing notification to user)
 */
router.post('/me/mark-notified', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { badgeIds } = req.body;

    if (!Array.isArray(badgeIds)) {
      return res.status(400).json({ error: 'badgeIds must be an array' });
    }

    // Use batch update (single query) instead of loop
    await db.markBadgesNotified(userId, badgeIds);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking badges notified:', error);
    res.status(500).json({ error: 'Failed to mark badges as notified' });
  }
});

/**
 * POST /api/badges/check
 * Manually trigger badge check for current user (useful for testing/retroactive awards)
 */
router.post('/check', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const newBadges = await badgeService.checkAndAwardBadges(userId);

    res.json({
      newBadges,
      message: newBadges.length > 0
        ? `Congratulations! You earned ${newBadges.length} new badge(s)!`
        : 'No new badges earned.'
    });
  } catch (error) {
    logger.error('Error checking badges:', error);
    res.status(500).json({ error: 'Failed to check badges' });
  }
});

module.exports = router;
