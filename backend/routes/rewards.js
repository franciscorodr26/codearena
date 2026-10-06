const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rewardService = require('../services/rewardService');
const logger = require('../utils/logger');
const { SECRET } = require('../config/jwt');
const { sessionUserFromRequest } = require('../utils/sessionAuthentication');

// Auth middleware
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = await sessionUserFromRequest(req, require('../db'), SECRET);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  // Tokens carry the user id in `sub`; the old `decoded.id || decoded.userId`
  // read fields no token has, so every reward lookup used an undefined id.
  req.userId = user.userId;
  next();
}

// Get current user's reward stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const stats = await rewardService.getRewardStats(req.userId);
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    logger.error('Error fetching reward stats:', error);
    res.status(500).json({ error: 'Failed to fetch reward stats' });
  }
});

// Get XP rewards configuration
router.get('/config', (req, res) => {
  res.json({
    xpRewards: rewardService.XP_REWARDS,
    levelInfo: {
      level1: rewardService.getXpForLevel(1),
      level5: rewardService.getXpForLevel(5),
      level10: rewardService.getXpForLevel(10),
      level25: rewardService.getXpForLevel(25),
      level50: rewardService.getXpForLevel(50)
    }
  });
});

// Get level info for a specific level
router.get('/level/:level', (req, res) => {
  const level = parseInt(req.params.level);
  if (isNaN(level) || level < 1 || level > 100) {
    return res.status(400).json({ error: 'Invalid level' });
  }

  res.json({
    level,
    title: rewardService.getLevelTitle(level),
    xpRequired: rewardService.getXpForLevel(level),
    xpToNext: rewardService.getXpForLevel(level + 1) - rewardService.getXpForLevel(level)
  });
});

// Get leaderboard by XP
router.get('/leaderboard', async (req, res) => {
  try {
    const db = require('../db');
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const leaderboard = await db.all(`
      SELECT
        u.id,
        u.username,
        u.avatar_url,
        us.total_xp,
        us.level,
        us.daily_streak
      FROM users u
      JOIN user_stats us ON u.id = us.user_id
      WHERE us.total_xp > 0
      ORDER BY us.total_xp DESC
      LIMIT ?
    `, [limit]);

    res.json({
      success: true,
      leaderboard: leaderboard.map((user, index) => ({
        rank: index + 1,
        id: user.id,
        username: user.username,
        avatarUrl: user.avatar_url,
        totalXp: user.total_xp || 0,
        level: user.level || 1,
        levelTitle: rewardService.getLevelTitle(user.level || 1),
        dailyStreak: user.daily_streak || 0
      }))
    });
  } catch (error) {
    logger.error('Error fetching XP leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
