const express = require('express');
const db = require('../db');
const authRouter = require('./auth');
const cache = require('../services/cache');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

/**
 * GET /api/analytics
 * Get comprehensive analytics for the authenticated user
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const analytics = await db.getUserAnalytics(userId);

    res.json({
      success: true,
      analytics
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/rating-history
 * Get rating history for charts
 */
router.get('/rating-history', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);

    const history = await db.getRatingHistory(userId, limit);

    res.json({
      success: true,
      history: history.reverse() // Oldest first for charts
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/languages
 * Get win/loss stats by language
 */
router.get('/languages', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const stats = await db.getStatsByLanguage(userId);

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/solve-times
 * Get solve time trends
 */
router.get('/solve-times', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);

    const trends = await db.getSolveTimeTrends(userId, limit);

    res.json({
      success: true,
      trends: trends.reverse()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/analytics/progress
 * Comprehensive progress dashboard data
 */
router.get('/progress', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Check cache first (30s TTL)
    const cacheKey = `dashboard:progress:${userId}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Use optimized batched query (reduces 8 queries to 3 batched operations)
    const {
      stats,
      ratingHistory: rawRatingHistory,
      languageStats,
      practiceStats,
      battleHistory: rawBattleHistory,
      behavioralStats,
      coderProfile,
      categoryStats,
      recentActivity,
      promptScoreHistory
    } = await db.getProgressDashboardData(userId);

    // Ensure arrays are never null/undefined to prevent runtime errors
    const ratingHistory = rawRatingHistory || [];
    const battleHistory = rawBattleHistory || [];

    // Calculate additional metrics
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Filter battles by time period
    const battlesLast30Days = battleHistory.filter(b => new Date(b.created_at) >= thirtyDaysAgo);
    const battlesLast7Days = battleHistory.filter(b => new Date(b.created_at) >= sevenDaysAgo);

    // Calculate win rates
    const calculateWinRate = (battles, usrId) => {
      if (!battles.length) return 0;
      const wins = battles.filter(b => b.winner_id === usrId && !b.is_tie).length;
      const losses = battles.filter(b => b.loser_id === usrId && !b.is_tie).length;
      return (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    };

    // Group rating history by week for trend analysis
    const weeklyRatings = {};
    ratingHistory.forEach(entry => {
      const date = new Date(entry.created_at);
      const weekKey = `${date.getFullYear()}-W${Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7)}`;
      if (!weeklyRatings[weekKey]) {
        weeklyRatings[weekKey] = { rating: entry.rating, games: 0 };
      }
      weeklyRatings[weekKey].rating = entry.rating;
      weeklyRatings[weekKey].games++;
    });

    // Calculate streak data
    let currentStreak = 0;
    let longestWinStreak = 0;
    let tempStreak = 0;
    battleHistory.slice().reverse().forEach(b => {
      if (b.winner_id === userId) {
        tempStreak++;
        longestWinStreak = Math.max(longestWinStreak, tempStreak);
        currentStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    });

    // Build activity heatmap data (last 90 days)
    const activityMap = {};
    for (let i = 0; i < 90; i++) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split('T')[0];
      activityMap[key] = { battles: 0, practice: 0, problems: 0 };
    }

    battleHistory.forEach(b => {
      const key = new Date(b.created_at).toISOString().split('T')[0];
      if (activityMap[key]) {
        activityMap[key].battles++;
        activityMap[key].problems++;
      }
    });

    if (practiceStats.recent) {
      practiceStats.recent.forEach(p => {
        const key = new Date(p.created_at).toISOString().split('T')[0];
        if (activityMap[key]) {
          activityMap[key].practice++;
          if (p.solved) activityMap[key].problems++;
        }
      });
    }

    // Build milestone achievements
    const milestones = [];
    if (stats?.wins >= 1) milestones.push({ type: 'first_win', title: 'First Victory', achieved: true });
    if (stats?.wins >= 10) milestones.push({ type: 'ten_wins', title: '10 Wins', achieved: true });
    if (stats?.wins >= 50) milestones.push({ type: 'fifty_wins', title: '50 Wins', achieved: true });
    if (stats?.wins >= 100) milestones.push({ type: 'hundred_wins', title: 'Centurion', achieved: true });
    if (stats?.rating >= 1200) milestones.push({ type: 'silver', title: 'Silver Rank', achieved: true });
    if (stats?.rating >= 1400) milestones.push({ type: 'gold', title: 'Gold Rank', achieved: true });
    if (stats?.rating >= 1600) milestones.push({ type: 'platinum', title: 'Platinum Rank', achieved: true });
    if (stats?.rating >= 1800) milestones.push({ type: 'diamond', title: 'Diamond Rank', achieved: true });
    if (stats?.rating >= 2000) milestones.push({ type: 'master', title: 'Master', achieved: true });
    if (stats?.best_win_streak >= 5) milestones.push({ type: 'streak_5', title: '5 Win Streak', achieved: true });
    if (stats?.best_win_streak >= 10) milestones.push({ type: 'streak_10', title: '10 Win Streak', achieved: true });

    const responseData = {
      success: true,
      progress: {
        // Core stats
        stats: {
          rating: stats?.rating || 1000,
          wins: stats?.wins || 0,
          losses: stats?.losses || 0,
          ties: stats?.ties || 0,
          totalBattles: (stats?.wins || 0) + (stats?.losses || 0),
          winRate: ((stats?.wins || 0) + (stats?.losses || 0)) > 0 ? Math.round(((stats?.wins || 0) / ((stats?.wins || 0) + (stats?.losses || 0))) * 100) : 0,
          avgSolveTime: stats?.avg_solve_time || null,
          fastestSolve: stats?.fastest_solve || null,
          currentStreak: stats?.win_streak || 0,
          bestStreak: stats?.best_win_streak || 0,
          dailyStreak: stats?.daily_streak || 0
        },

        // Rating trajectory
        ratingHistory: ratingHistory.reverse().map(r => ({
          rating: r.rating,
          change: r.rating_change,
          result: r.result,
          date: r.created_at
        })),

        // Performance by language
        languageStats,

        // Practice mode progress
        practice: {
          solved: practiceStats.stats?.problems_solved || 0,
          attempted: practiceStats.stats?.problems_attempted || 0,
          avgTime: practiceStats.stats?.avg_solve_time || null,
          fastestSolve: practiceStats.stats?.fastest_solve || null,
          byLanguage: practiceStats.byLanguage || []
        },

        // Time-based comparisons
        trends: {
          last7Days: {
            battles: battlesLast7Days.length,
            winRate: calculateWinRate(battlesLast7Days, userId)
          },
          last30Days: {
            battles: battlesLast30Days.length,
            winRate: calculateWinRate(battlesLast30Days, userId)
          }
        },

        // Activity heatmap
        activityHeatmap: Object.entries(activityMap).map(([date, data]) => ({
          date,
          ...data,
          intensity: Math.min(4, data.problems) // 0-4 scale for heatmap
        })).reverse(),

        // Milestones
        milestones,

        // Coder profile (AI analysis)
        profile: coderProfile ? {
          archetype: coderProfile.archetype,
          strengths: coderProfile.strengths,
          growthAreas: coderProfile.growth_areas,
          improvementRate: coderProfile.improvement_rate,
          consistencyScore: coderProfile.consistency_score
        } : null,

        // Category performance
        categoryStats: categoryStats || [],

        // Recent activity feed
        recentActivity: recentActivity || [],
        promptScoreHistory: promptScoreHistory || {}
      }
    };

    // Cache for 30 seconds
    await cache.set(cacheKey, responseData, 30);

    res.json(responseData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
