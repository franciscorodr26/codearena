const express = require('express');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');
const { getSpendingStatus, LIMITS } = require('../services/agentSpendingLimiter');
const moduleTelemetry = require('../services/moduleTelemetry');
const agentModules = require('../services/agentModules');

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

// Agent battle admin tools respond only when agent battles are enabled.
router.use('/agent-battles', (req, res, next) => (process.env.CODEARENA_AGENT_BATTLES === '1' && process.env.ANTHROPIC_API_KEY ? next() : res.status(503).json({ notEnabled: true, error: 'Agent battles are not enabled on this server.' })));

/**
 * GET /api/admin/agent-battles/stats
 * Get overall agent battle statistics
 */
router.get('/agent-battles/stats', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    // Get total battles count
    const totalBattlesResult = await db.get(
      'SELECT COUNT(*) as count FROM agent_battles'
    );
    const totalBattles = totalBattlesResult?.count || 0;

    // Get completed battles count
    const completedBattlesResult = await db.get(
      "SELECT COUNT(*) as count FROM agent_battles WHERE status = 'completed'"
    );
    const completedBattles = completedBattlesResult?.count || 0;

    // Get active battles from global state (in-memory)
    let activeBattles = 0;
    let queueSize = 0;

    if (global.agentBattles && global.agentBattles instanceof Map) {
      // Count battles that are running or matched
      for (const [, battle] of global.agentBattles.entries()) {
        if (battle.state === 'running' || battle.state === 'matched') {
          activeBattles++;
        }
      }
    }

    if (global.agentQueue && Array.isArray(global.agentQueue)) {
      queueSize = global.agentQueue.length;
    }

    // Get battles in last 24 hours
    const recentBattlesResult = await db.get(
      `SELECT COUNT(*) as count FROM agent_battles
       WHERE created_at >= datetime('now', '-24 hours')`
    );
    const battlesLast24h = recentBattlesResult?.count || 0;

    // Get unique users who have participated in agent battles
    const uniqueUsersResult = await db.get(
      `SELECT COUNT(DISTINCT user_id) as count FROM (
        SELECT player1_id as user_id FROM agent_battles
        UNION
        SELECT player2_id as user_id FROM agent_battles
      )`
    );
    const uniqueUsers = uniqueUsersResult?.count || 0;

    // Get average battle duration
    const avgDurationResult = await db.get(
      `SELECT AVG((player1_time_ms + player2_time_ms) / 2) as avg_ms
       FROM agent_battles
       WHERE status = 'completed' AND player1_time_ms IS NOT NULL AND player2_time_ms IS NOT NULL`
    );
    const avgDurationMs = avgDurationResult?.avg_ms || 0;

    res.json({
      success: true,
      stats: {
        totalBattles,
        completedBattles,
        activeBattles,
        queueSize,
        battlesLast24h,
        uniqueUsers,
        avgDurationMs: Math.round(avgDurationMs)
      }
    });
  } catch (err) {
    logger.error('[Admin] Error fetching agent battle stats:', err);
    next(err);
  }
});

/**
 * GET /api/admin/agent-battles/recent
 * Get recent agent battles with details
 * Query params: limit (default 50)
 */
router.get('/agent-battles/recent', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const battles = await db.all(
      `SELECT
        ab.id,
        ab.status,
        ab.created_at,
        ab.winner_id,
        ab.problem_id,
        ab.player1_time_ms,
        ab.player2_time_ms,
        ab.player1_tokens_used,
        ab.player2_tokens_used,
        ab.player1_tool_calls,
        ab.player2_tool_calls,
        ab.player1_elo_change,
        ab.player2_elo_change,
        u1.id as player1_id,
        u1.username as player1_username,
        u1.avatar as player1_avatar,
        u2.id as player2_id,
        u2.username as player2_username,
        u2.avatar as player2_avatar,
        l1.name as loadout1_name,
        l1.model as loadout1_model,
        l1.language as loadout1_language,
        l2.name as loadout2_name,
        l2.model as loadout2_model,
        l2.language as loadout2_language
       FROM agent_battles ab
       LEFT JOIN users u1 ON ab.player1_id = u1.id
       LEFT JOIN users u2 ON ab.player2_id = u2.id
       LEFT JOIN agent_loadouts l1 ON ab.loadout1_id = l1.id
       LEFT JOIN agent_loadouts l2 ON ab.loadout2_id = l2.id
       ORDER BY ab.created_at DESC
       LIMIT ?`,
      [limit]
    );

    // Format the battles
    const formattedBattles = battles.map(b => ({
      id: b.id,
      status: b.status,
      createdAt: b.created_at,
      winnerId: b.winner_id,
      problemId: b.problem_id,
      player1: {
        id: b.player1_id,
        username: b.player1_username,
        avatar: b.player1_avatar,
        timeMs: b.player1_time_ms,
        tokensUsed: b.player1_tokens_used,
        toolCalls: b.player1_tool_calls,
        eloChange: b.player1_elo_change,
        loadout: {
          name: b.loadout1_name,
          model: b.loadout1_model,
          language: b.loadout1_language
        }
      },
      player2: {
        id: b.player2_id,
        username: b.player2_username,
        avatar: b.player2_avatar,
        timeMs: b.player2_time_ms,
        tokensUsed: b.player2_tokens_used,
        toolCalls: b.player2_tool_calls,
        eloChange: b.player2_elo_change,
        loadout: {
          name: b.loadout2_name,
          model: b.loadout2_model,
          language: b.loadout2_language
        }
      }
    }));

    res.json({
      success: true,
      battles: formattedBattles
    });
  } catch (err) {
    logger.error('[Admin] Error fetching recent battles:', err);
    next(err);
  }
});

/**
 * GET /api/admin/agent-battles/rate-limits
 * Get users who are near or at their rate limits
 * Query params: threshold (default 0.8 = 80% of limit)
 */
router.get('/agent-battles/rate-limits', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const threshold = parseFloat(req.query.threshold) || 0.8;

    // Get all users with spending data
    const spendingData = await db.all(
      `SELECT
        s.user_id,
        s.daily_spend,
        s.monthly_spend,
        s.daily_reset_date,
        s.monthly_reset_date,
        s.updated_at,
        u.username,
        u.email,
        u.is_pro,
        u.pro_expires_at
       FROM agent_spending s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.daily_spend DESC`
    );

    // Filter users who are near limits
    const usersNearLimit = spendingData
      .map(row => {
        const isPro = row.is_pro === 1 && row.pro_expires_at && new Date(row.pro_expires_at) > new Date();
        const limits = isPro ? LIMITS.pro : LIMITS.free;

        const dailyPercentage = (row.daily_spend / limits.daily) * 100;
        const monthlyPercentage = (row.monthly_spend / limits.monthly) * 100;
        const nearLimit = dailyPercentage >= (threshold * 100) || monthlyPercentage >= (threshold * 100);

        return {
          userId: row.user_id,
          username: row.username,
          email: row.email,
          isPro,
          dailySpend: row.daily_spend,
          dailyLimit: limits.daily,
          dailyPercentage: Math.round(dailyPercentage),
          monthlySpend: row.monthly_spend,
          monthlyLimit: limits.monthly,
          monthlyPercentage: Math.round(monthlyPercentage),
          nearLimit,
          atLimit: dailyPercentage >= 100 || monthlyPercentage >= 100,
          lastActivity: row.updated_at
        };
      })
      .filter(user => user.nearLimit);

    res.json({
      success: true,
      users: usersNearLimit,
      threshold: threshold * 100
    });
  } catch (err) {
    logger.error('[Admin] Error fetching rate limits:', err);
    next(err);
  }
});

/**
 * GET /api/admin/agent-battles/spending
 * Get spending breakdown by user
 * Query params: limit (default 50), sortBy (daily|monthly, default daily)
 */
router.get('/agent-battles/spending', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const sortBy = req.query.sortBy === 'monthly' ? 'monthly_spend' : 'daily_spend';

    const spendingData = await db.all(
      `SELECT
        s.user_id,
        s.daily_spend,
        s.monthly_spend,
        s.daily_reset_date,
        s.monthly_reset_date,
        s.created_at,
        s.updated_at,
        u.username,
        u.email,
        u.is_pro,
        u.pro_expires_at,
        (SELECT COUNT(*) FROM agent_battles
         WHERE player1_id = s.user_id OR player2_id = s.user_id) as total_battles,
        (SELECT COUNT(*) FROM agent_battles
         WHERE (player1_id = s.user_id OR player2_id = s.user_id)
         AND created_at >= datetime('now', '-24 hours')) as battles_24h
       FROM agent_spending s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.${sortBy} DESC
       LIMIT ?`,
      [limit]
    );

    // Calculate totals
    const totalSpending = spendingData.reduce((sum, row) => sum + row.monthly_spend, 0);
    const totalToday = spendingData.reduce((sum, row) => sum + row.daily_spend, 0);

    // Format response
    const formattedData = spendingData.map(row => {
      const isPro = row.is_pro === 1 && row.pro_expires_at && new Date(row.pro_expires_at) > new Date();
      const limits = isPro ? LIMITS.pro : LIMITS.free;

      return {
        userId: row.user_id,
        username: row.username,
        email: row.email,
        isPro,
        dailySpend: row.daily_spend,
        dailyLimit: limits.daily,
        dailyRemaining: Math.max(0, limits.daily - row.daily_spend),
        monthlySpend: row.monthly_spend,
        monthlyLimit: limits.monthly,
        monthlyRemaining: Math.max(0, limits.monthly - row.monthly_spend),
        totalBattles: row.total_battles,
        battlesLast24h: row.battles_24h,
        avgCostPerBattle: row.total_battles > 0 ? (row.monthly_spend / row.total_battles).toFixed(4) : 0,
        lastActivity: row.updated_at,
        accountCreated: row.created_at
      };
    });

    res.json({
      success: true,
      spending: formattedData,
      summary: {
        totalMonthlySpending: totalSpending.toFixed(2),
        totalDailySpending: totalToday.toFixed(2),
        activeUsers: spendingData.length
      }
    });
  } catch (err) {
    logger.error('[Admin] Error fetching spending data:', err);
    next(err);
  }
});

/**
 * POST /api/admin/agent-battles/reset-rate-limit/:userId
 * Reset a user's agent battle rate limit
 */
router.post('/agent-battles/reset-rate-limit/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Delete the rate limit entry
    await db.run('DELETE FROM agent_rate_limits WHERE user_id = ?', [userId]);

    logger.info(`[Admin] Rate limit reset for user ${userId} by admin ${req.user.sub || req.user.userId}`);

    res.json({
      success: true,
      message: 'Rate limit reset successfully'
    });
  } catch (err) {
    logger.error('[Admin] Error resetting rate limit:', err);
    next(err);
  }
});

/**
 * POST /api/admin/agent-battles/reset-spending/:userId
 * Reset a user's agent battle spending
 */
router.post('/agent-battles/reset-spending/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Reset spending to 0 and update reset dates
    const now = new Date();
    await db.run(
      `UPDATE agent_spending
       SET daily_spend = 0,
           monthly_spend = 0,
           daily_reset_date = ?,
           monthly_reset_date = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [now.toISOString(), now.toISOString(), userId]
    );

    logger.info(`[Admin] Spending reset for user ${userId} by admin ${req.user.sub || req.user.userId}`);

    res.json({
      success: true,
      message: 'Spending reset successfully'
    });
  } catch (err) {
    logger.error('[Admin] Error resetting spending:', err);
    next(err);
  }
});

/**
 * POST /api/admin/agent-battles/ban-user/:userId
 * Temporarily ban a user from agent battles
 * Body: { duration: number (hours), reason: string }
 */
router.post('/agent-battles/ban-user/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);
    const { duration, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    if (!duration || duration <= 0) {
      return res.status(400).json({ error: 'Duration must be a positive number' });
    }

    const adminId = req.user.sub || req.user.userId;
    const bannedUntil = new Date();
    bannedUntil.setHours(bannedUntil.getHours() + duration);

    // Check if user exists
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove any existing bans for this user
    await db.run('DELETE FROM agent_battle_bans WHERE user_id = ?', [userId]);

    // Insert new ban
    await db.run(
      `INSERT INTO agent_battle_bans (user_id, banned_until, reason, banned_by)
       VALUES (?, ?, ?, ?)`,
      [userId, bannedUntil.toISOString(), reason || 'No reason provided', adminId]
    );

    logger.info(`[Admin] User ${userId} banned from agent battles until ${bannedUntil.toISOString()} by admin ${adminId}. Reason: ${reason}`);

    res.json({
      success: true,
      message: 'User banned successfully',
      bannedUntil: bannedUntil.toISOString()
    });
  } catch (err) {
    logger.error('[Admin] Error banning user:', err);
    next(err);
  }
});

/**
 * POST /api/admin/agent-battles/unban-user/:userId
 * Remove ban from a user
 */
router.post('/agent-battles/unban-user/:userId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);

    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Remove ban
    const result = await db.run('DELETE FROM agent_battle_bans WHERE user_id = ?', [userId]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'No active ban found for this user' });
    }

    logger.info(`[Admin] User ${userId} unbanned from agent battles by admin ${req.user.sub || req.user.userId}`);

    res.json({
      success: true,
      message: 'User unbanned successfully'
    });
  } catch (err) {
    logger.error('[Admin] Error unbanning user:', err);
    next(err);
  }
});

/**
 * GET /api/admin/agent-battles/banned-users
 * Get list of currently banned users
 */
router.get('/agent-battles/banned-users', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const bans = await db.all(
      `SELECT
        b.id,
        b.user_id,
        b.banned_at,
        b.banned_until,
        b.reason,
        b.banned_by,
        u.username,
        u.email,
        u.avatar,
        admin.username as banned_by_username
       FROM agent_battle_bans b
       JOIN users u ON b.user_id = u.id
       LEFT JOIN users admin ON b.banned_by = admin.id
       WHERE b.banned_until > datetime('now')
       ORDER BY b.banned_at DESC`
    );

    const formattedBans = bans.map(ban => ({
      id: ban.id,
      userId: ban.user_id,
      username: ban.username,
      email: ban.email,
      avatar: ban.avatar,
      bannedAt: ban.banned_at,
      bannedUntil: ban.banned_until,
      reason: ban.reason,
      bannedBy: ban.banned_by,
      bannedByUsername: ban.banned_by_username
    }));

    res.json({
      success: true,
      bans: formattedBans
    });
  } catch (err) {
    logger.error('[Admin] Error fetching banned users:', err);
    next(err);
  }
});

/**
 * GET /api/admin/agent-battles/module-stats
 * Get module usage and win rate statistics for balancing
 */
router.get('/agent-battles/module-stats', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    const stats = await moduleTelemetry.getModuleStats(db, { startDate, endDate });

    // Enrich with module details and flag imbalanced modules
    const enrichedStats = stats.map(s => {
      const module = agentModules.getModule(s.moduleId);
      const isImbalanced = s.totalBattles >= 10 && (s.winRate > 60 || s.winRate < 40);

      return {
        ...s,
        module: module ? {
          id: module.id,
          name: module.name,
          category: module.category,
          isDefault: module.isDefault
        } : null,
        isImbalanced,
        balanceStatus: s.totalBattles < 10
          ? 'insufficient_data'
          : s.winRate > 60
          ? 'overpowered'
          : s.winRate < 40
          ? 'underpowered'
          : 'balanced'
      };
    });

    res.json({
      success: true,
      dateRange: { startDate, endDate, days: parseInt(days) },
      stats: enrichedStats,
      summary: {
        totalModulesTracked: stats.length,
        imbalancedCount: enrichedStats.filter(s => s.isImbalanced).length,
        overpowered: enrichedStats.filter(s => s.balanceStatus === 'overpowered').map(s => s.moduleId),
        underpowered: enrichedStats.filter(s => s.balanceStatus === 'underpowered').map(s => s.moduleId)
      }
    });
  } catch (err) {
    logger.error('[Admin] Error fetching module stats:', err);
    next(err);
  }
});

/**
 * GET /api/admin/agent-battles/module-combinations
 * Get which modules are commonly used together and their effectiveness
 */
router.get('/agent-battles/module-combinations', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { days = 30 } = req.query;

    const combinations = await moduleTelemetry.getModuleCombinations(db, parseInt(days));

    // Enrich with module names
    const enrichedCombos = combinations.map(c => ({
      ...c,
      moduleNames: c.modules.map(id => {
        const mod = agentModules.getModule(id);
        return mod ? mod.name : id;
      }),
      isEffective: c.uses >= 5 && c.winRate > 55
    }));

    res.json({
      success: true,
      days: parseInt(days),
      combinations: enrichedCombos,
      topCombos: enrichedCombos.filter(c => c.uses >= 5).slice(0, 10)
    });
  } catch (err) {
    logger.error('[Admin] Error fetching module combinations:', err);
    next(err);
  }
});


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
