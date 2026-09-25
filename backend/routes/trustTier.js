/**
 * Trust Tier API Routes
 *
 * Endpoints for trust tier management and viewing.
 * Includes both user-facing (view own trust) and admin endpoints.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const logger = require('../utils/logger');
const db = require('../db');
const authRouter = require('./auth');
const trustTierService = require('../services/trustTierService');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

// Rate limiter for trust queries
const trustQueryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 queries per minute
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
});

// Rate limiter for admin actions
const adminActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 admin actions per hour
  message: { error: 'Too many admin actions. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
});

// Middleware to check if user is admin
async function adminMiddleware(req, res, next) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const isAdmin = await db.isUserAdmin(userId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (err) {
    logger.error('[TRUST] Admin check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ============================================
// USER ENDPOINTS
// ============================================

/**
 * GET /api/trust/my-trust
 * Get own trust tier info with v2 transparency features
 */
router.get('/my-trust', authMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Get all trust-related data in parallel
    const [trustInfo, history, violationExplanations, userStats] = await Promise.all([
      db.getUserTrustTier(userId),
      db.getUserTrustHistory(userId, 10),
      db.getUserViolationExplanations(userId, 5),
      db.get(`SELECT last_trust_gain_date, daily_trust_gained, trust_frozen_until, milestone_streaks_claimed FROM user_stats WHERE user_id = ?`, [userId])
    ]);

    const tierDisplay = trustTierService.getTierDisplayInfo(trustInfo.trust_tier);
    const currentScore = trustInfo.trust_score || 50;
    const currentTier = trustInfo.trust_tier || 'standard';
    const cleanStreak = trustInfo.clean_battles_since_violation || 0;

    // Calculate next tier requirements
    const nextTierRequirements = calculateNextTierRequirements(currentScore, currentTier, cleanStreak);

    // Calculate daily cap status
    const today = new Date().toISOString().split('T')[0];
    const dailyGained = userStats?.last_trust_gain_date === today ? (userStats.daily_trust_gained || 0) : 0;
    const dailyCap = 3.0;
    const dailyRemaining = Math.max(0, dailyCap - dailyGained);

    // Check if trust is frozen
    const trustFrozen = userStats?.trust_frozen_until && new Date(userStats.trust_frozen_until) > new Date();

    // Generate improvement tips based on current status
    const improvementTips = generateImprovementTips(currentTier, currentScore, cleanStreak, violationExplanations);

    // Parse milestone status
    const claimedMilestones = JSON.parse(userStats?.milestone_streaks_claimed || '[]');

    res.json({
      success: true,
      trust: {
        score: currentScore,
        tier: currentTier,
        tierDisplay,
        cleanBattleStreak: cleanStreak,
        tierUpdatedAt: trustInfo.tier_updated_at,
        nextTierRequirements
      },
      dailyProgress: {
        gained: dailyGained.toFixed(2),
        remaining: dailyRemaining.toFixed(2),
        cap: dailyCap,
        frozen: trustFrozen,
        frozenUntil: trustFrozen ? userStats.trust_frozen_until : null
      },
      milestones: {
        claimed: claimedMilestones,
        next: getNextMilestone(cleanStreak, claimedMilestones)
      },
      recentHistory: history.map(h => ({
        change: h.change_amount,
        reason: h.reason,
        timestamp: h.created_at,
        type: h.change_amount >= 0 ? 'gain' : 'loss'
      })),
      recentViolations: violationExplanations.map(v => ({
        type: v.violation_type,
        message: v.user_facing_message,
        details: v.baseline_comparison ? JSON.parse(v.baseline_comparison) : null,
        appealable: v.appealable === 1,
        appealStatus: v.appeal_status,
        timestamp: v.created_at
      })),
      improvementTips
    });
  } catch (err) {
    logger.error('[TRUST] Error getting user trust:', err);
    res.status(500).json({ error: 'Failed to get trust info' });
  }
});

/**
 * Calculate requirements to reach next tier
 */
function calculateNextTierRequirements(currentScore, currentTier, cleanStreak) {
  const tiers = {
    restricted: { next: 'probation', minScore: 25, minStreak: 15, adminApproval: true },
    probation: { next: 'standard', minScore: 50, minStreak: 15 },
    standard: { next: 'trusted', minScore: 85, minStreak: 20, minAccountAge: 30 },
    trusted: { next: null, minScore: 100 }
  };

  const req = tiers[currentTier] || tiers.standard;

  if (!req.next) {
    return {
      targetTier: null,
      message: 'You have reached the highest trust tier!',
      progress: 100
    };
  }

  const scoreNeeded = Math.max(0, req.minScore - currentScore);
  const battlesNeeded = req.minStreak ? Math.max(0, req.minStreak - cleanStreak) : 0;
  const avgGainPerBattle = 0.75; // Average trust gain per clean battle
  const estimatedBattles = scoreNeeded > 0 ? Math.ceil(scoreNeeded / avgGainPerBattle) : 0;
  const totalBattlesNeeded = Math.max(battlesNeeded, estimatedBattles);

  return {
    targetTier: req.next,
    scoreNeeded: scoreNeeded.toFixed(1),
    currentScore: currentScore.toFixed(1),
    targetScore: req.minScore,
    battlesNeeded: totalBattlesNeeded,
    cleanStreakRequired: req.minStreak || 0,
    currentStreak: cleanStreak,
    adminApprovalRequired: req.adminApproval || false,
    progress: Math.min(100, Math.round((currentScore / req.minScore) * 100))
  };
}

/**
 * Generate improvement tips based on user status
 */
function generateImprovementTips(tier, score, cleanStreak, violations) {
  const tips = [];

  // Tier-specific tips
  if (tier === 'restricted') {
    tips.push('Focus on playing clean battles to rebuild your trust. Contact support if you believe this is an error.');
  } else if (tier === 'probation') {
    tips.push(`Complete ${Math.max(0, 15 - cleanStreak)} more clean battles to reach Standard tier.`);
  } else if (tier === 'standard') {
    const battlesToTrusted = Math.max(0, 20 - cleanStreak);
    const scoreToTrusted = Math.max(0, 85 - score);
    if (scoreToTrusted > 0 || battlesToTrusted > 0) {
      tips.push(`${battlesToTrusted} more clean battles and ${scoreToTrusted.toFixed(0)} more points to reach Trusted tier.`);
    }
  }

  // Violation-based tips
  if (violations && violations.length > 0) {
    const recentTypes = [...new Set(violations.map(v => v.violation_type))];
    if (recentTypes.includes('paste_detected') || recentTypes.includes('excessive_pastes')) {
      tips.push('Type your solutions directly instead of pasting to avoid flags.');
    }
    if (recentTypes.includes('ai_generated')) {
      tips.push('Write solutions in your own style. Practice problems to build confidence.');
    }
  }

  // General tips
  if (tips.length === 0) {
    tips.push('Keep playing clean battles to maintain your trust level.');
  }

  return tips;
}

/**
 * Get next milestone
 */
function getNextMilestone(cleanStreak, claimedMilestones) {
  const milestones = [
    { threshold: 10, bonus: 3, label: '10_streak' },
    { threshold: 25, bonus: 5, label: '25_streak' },
    { threshold: 50, bonus: 10, label: '50_streak' }
  ];

  for (const m of milestones) {
    if (!claimedMilestones.includes(m.label)) {
      return {
        threshold: m.threshold,
        bonus: m.bonus,
        progress: Math.min(cleanStreak, m.threshold),
        remaining: Math.max(0, m.threshold - cleanStreak)
      };
    }
  }

  return null; // All milestones claimed
}

// ============================================
// ADMIN ENDPOINTS
// ============================================

/**
 * GET /api/trust/admin/distribution
 * Get trust tier distribution stats
 */
router.get('/admin/distribution', authMiddleware, adminMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const distribution = await db.getTrustTierDistribution();

    // Calculate totals and percentages
    const total = distribution.reduce((sum, d) => sum + (d.count || 0), 0);
    const withPercentages = distribution.map(d => ({
      tier: d.trust_tier,
      count: d.count || 0,
      percentage: total > 0 ? ((d.count || 0) / total * 100).toFixed(1) : 0,
      displayInfo: trustTierService.getTierDisplayInfo(d.trust_tier)
    }));

    res.json({
      success: true,
      distribution: withPercentages,
      totalUsers: total
    });
  } catch (err) {
    logger.error('[TRUST] Error getting distribution:', err);
    res.status(500).json({ error: 'Failed to get distribution' });
  }
});

/**
 * GET /api/trust/admin/probation-list
 * Get users on probation or restricted
 */
router.get('/admin/probation-list', authMiddleware, adminMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const users = await db.getProbationUsers(limit);

    res.json({
      success: true,
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        trustScore: u.trust_score,
        trustTier: u.trust_tier,
        tierDisplay: trustTierService.getTierDisplayInfo(u.trust_tier),
        totalViolations: u.total_violations,
        cleanBattlesSinceViolation: u.clean_battles_since_violation,
        tierUpdatedAt: u.tier_updated_at
      })),
      count: users.length
    });
  } catch (err) {
    logger.error('[TRUST] Error getting probation list:', err);
    res.status(500).json({ error: 'Failed to get probation list' });
  }
});

/**
 * GET /api/trust/admin/user/:userId/history
 * Get full trust history for a user
 */
router.get('/admin/user/:userId/history', authMiddleware, adminMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const [trustInfo, scoreHistory, tierHistory, behaviorMetrics] = await Promise.all([
      db.getUserTrustTier(userId),
      db.getUserTrustHistory(userId, 100),
      db.getUserTierHistory(userId, 20),
      db.getUserBehaviorMetrics(userId)
    ]);

    // Get user info
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        createdAt: user.created_at
      },
      trustInfo: {
        score: trustInfo.trust_score,
        tier: trustInfo.trust_tier,
        tierDisplay: trustTierService.getTierDisplayInfo(trustInfo.trust_tier),
        cleanBattlesSinceViolation: trustInfo.clean_battles_since_violation,
        tierUpdatedAt: trustInfo.tier_updated_at
      },
      scoreHistory: scoreHistory.map(h => ({
        previousScore: h.previous_score,
        newScore: h.new_score,
        change: h.change_amount,
        reason: h.reason,
        battleId: h.battle_id,
        timestamp: h.created_at
      })),
      tierHistory: tierHistory.map(h => ({
        previousTier: h.previous_tier,
        newTier: h.new_tier,
        scoreAtChange: h.trust_score_at_change,
        reason: h.reason,
        triggeredBy: h.triggered_by,
        adminId: h.admin_id,
        timestamp: h.created_at
      })),
      behaviorMetrics: behaviorMetrics ? {
        avgTypingSpeed: behaviorMetrics.avg_typing_speed,
        avgPasteFrequency: behaviorMetrics.avg_paste_frequency,
        avgFocusLossCount: behaviorMetrics.avg_focus_loss_count,
        cleanBattleStreak: behaviorMetrics.clean_battle_streak,
        lastViolationAt: behaviorMetrics.last_violation_at,
        timesFlagged: behaviorMetrics.times_flagged,
        timesFalsePositive: behaviorMetrics.times_false_positive,
        battlesAnalyzed: behaviorMetrics.battles_analyzed
      } : null
    });
  } catch (err) {
    logger.error('[TRUST] Error getting user history:', err);
    res.status(500).json({ error: 'Failed to get user history' });
  }
});

/**
 * POST /api/trust/admin/user/:userId/override
 * Admin override of trust tier
 */
router.post('/admin/user/:userId/override', authMiddleware, adminMiddleware, adminActionLimiter, async (req, res) => {
  try {
    const adminId = req.user.sub;
    const userId = parseInt(req.params.userId);
    const { newTier, newScore, reason } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Validate tier
    const validTiers = ['trusted', 'standard', 'probation', 'restricted'];
    if (!validTiers.includes(newTier)) {
      return res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
    }

    // Validate score
    const score = parseInt(newScore);
    if (isNaN(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'Score must be a number between 0 and 100' });
    }

    // Validate reason
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Please provide a reason for the override (min 5 chars)' });
    }

    // Check user exists
    const user = await db.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot override own trust
    if (userId === adminId) {
      return res.status(400).json({ error: 'Cannot override your own trust tier' });
    }

    // Perform the override
    await db.adminOverrideTrustTier(adminId, userId, newTier, score, reason.trim());

    // Log admin action
    try {
      await db.logAdminAction(adminId, 'trust_override', 'user', userId, {
        newTier,
        newScore: score,
        reason: reason.trim()
      });
    } catch (auditErr) {
      logger.error('[TRUST] Failed to log admin action:', auditErr);
    }

    logger.info(`[TRUST] Admin ${adminId} overrode user ${userId} to tier=${newTier}, score=${score}`);

    res.json({
      success: true,
      message: `Trust tier updated to ${newTier} with score ${score}`,
      user: {
        id: userId,
        username: user.username,
        newTier,
        newScore: score
      }
    });
  } catch (err) {
    logger.error('[TRUST] Error overriding trust:', err);
    res.status(500).json({ error: 'Failed to override trust tier' });
  }
});

/**
 * POST /api/trust/admin/flagged/:submissionId/review
 * Review flagged submission and update trust accordingly
 */
router.post('/admin/flagged/:submissionId/review', authMiddleware, adminMiddleware, adminActionLimiter, async (req, res) => {
  try {
    const adminId = req.user.sub;
    const submissionId = parseInt(req.params.submissionId);
    const { verdict, notes } = req.body;

    if (isNaN(submissionId)) {
      return res.status(400).json({ error: 'Invalid submission ID' });
    }

    // Validate verdict
    const validVerdicts = ['confirmed_cheat', 'false_positive', 'dismissed'];
    if (!validVerdicts.includes(verdict)) {
      return res.status(400).json({ error: `Invalid verdict. Must be one of: ${validVerdicts.join(', ')}` });
    }

    // Get submission
    const submission = await db.get(
      `SELECT * FROM flagged_submissions WHERE id = ?`,
      [submissionId]
    );

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.review_status !== 'pending') {
      return res.status(400).json({ error: 'Submission already reviewed' });
    }

    // Update submission status
    await db.reviewFlaggedSubmission(submissionId, adminId, verdict, notes || '');

    // Apply trust adjustments based on verdict
    if (submission.user_id) {
      if (verdict === 'confirmed_cheat') {
        // Severe trust loss for confirmed cheating
        await db.updateTrustScore(
          submission.user_id,
          -50,
          `Admin confirmed cheating: ${notes || 'No details'}`,
          submission.battle_id
        );

        // Also apply discipline if not already done
        try {
          await db.applyCheatDiscipline(
            submission.user_id,
            'admin_confirmed_cheat',
            notes || 'Admin confirmed cheating during review',
            submission.battle_id
          );
        } catch (disciplineErr) {
          logger.error('[TRUST] Discipline already applied or failed:', disciplineErr.message);
        }

        logger.warn(`[TRUST] Admin ${adminId} confirmed cheat for user ${submission.user_id}`);
      } else if (verdict === 'false_positive') {
        // Restore trust for false positive
        await db.updateTrustScore(
          submission.user_id,
          10,
          'False positive flag cleared by admin',
          submission.battle_id
        );
        await db.incrementFalsePositive(submission.user_id);

        logger.info(`[TRUST] Admin ${adminId} cleared false positive for user ${submission.user_id}`);
      }
      // 'dismissed' doesn't affect trust
    }

    // Log admin action
    try {
      await db.logAdminAction(adminId, 'review_flagged_submission', 'flagged_submission', submissionId, {
        verdict,
        notes,
        userId: submission.user_id
      });
    } catch (auditErr) {
      logger.error('[TRUST] Failed to log admin action:', auditErr);
    }

    res.json({
      success: true,
      message: `Submission reviewed with verdict: ${verdict}`,
      submissionId,
      verdict
    });
  } catch (err) {
    logger.error('[TRUST] Error reviewing submission:', err);
    res.status(500).json({ error: 'Failed to review submission' });
  }
});

/**
 * GET /api/trust/admin/stats
 * Get overall trust system statistics
 */
router.get('/admin/stats', authMiddleware, adminMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const [distribution, flaggedStats] = await Promise.all([
      db.getTrustTierDistribution(),
      db.getFlaggedSubmissionStats()
    ]);

    const totalUsers = distribution.reduce((sum, d) => sum + (d.count || 0), 0);
    const probationUsers = distribution.find(d => d.trust_tier === 'probation')?.count || 0;
    const restrictedUsers = distribution.find(d => d.trust_tier === 'restricted')?.count || 0;
    const trustedUsers = distribution.find(d => d.trust_tier === 'trusted')?.count || 0;

    res.json({
      success: true,
      stats: {
        totalUsers,
        trustedUsers,
        probationUsers,
        restrictedUsers,
        atRiskUsers: probationUsers + restrictedUsers,
        trustedPercentage: totalUsers > 0 ? ((trustedUsers / totalUsers) * 100).toFixed(1) : 0,
        flaggedSubmissions: {
          total: flaggedStats?.total || 0,
          pending: flaggedStats?.pending || 0,
          confirmed: flaggedStats?.confirmed || 0,
          falsePositives: flaggedStats?.false_positives || 0,
          falsePositiveRate: flaggedStats?.total > 0
            ? (((flaggedStats?.false_positives || 0) / flaggedStats.total) * 100).toFixed(1)
            : 0
        }
      }
    });
  } catch (err) {
    logger.error('[TRUST] Error getting stats:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============================================
// APPEAL SYSTEM ENDPOINTS
// ============================================

/**
 * POST /api/trust/appeal
 * Submit an appeal for a violation
 */
router.post('/appeal', authMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { violationId, battleId, explanation } = req.body;

    // Validate explanation
    if (!explanation || explanation.trim().length < 20) {
      return res.status(400).json({
        error: 'Please provide a detailed explanation (at least 20 characters)'
      });
    }

    if (explanation.trim().length > 2000) {
      return res.status(400).json({
        error: 'Explanation too long (maximum 2000 characters)'
      });
    }

    // Submit the appeal
    const result = await db.submitTrustAppeal(
      userId,
      violationId || null,
      battleId || null,
      explanation.trim()
    );

    logger.info(`[TRUST] User ${userId} submitted appeal ${result.appealId}`);

    res.json({
      success: true,
      message: 'Your appeal has been submitted and will be reviewed by our team.',
      appealId: result.appealId
    });
  } catch (err) {
    // Check for specific error messages
    if (err.message.includes('already have a pending appeal') ||
        err.message.includes('maximum number of appeals')) {
      return res.status(429).json({ error: err.message });
    }
    logger.error('[TRUST] Error submitting appeal:', err);
    res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

/**
 * GET /api/trust/my-appeals
 * Get user's own appeals
 */
router.get('/my-appeals', authMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;
    const appeals = await db.getUserAppeals(userId, 20);

    res.json({
      success: true,
      appeals: appeals.map(a => ({
        id: a.id,
        violationType: a.violation_type,
        violationMessage: a.user_facing_message,
        userExplanation: a.user_explanation,
        status: a.status,
        adminResponse: a.admin_response,
        createdAt: a.created_at,
        resolvedAt: a.resolved_at
      }))
    });
  } catch (err) {
    logger.error('[TRUST] Error getting user appeals:', err);
    res.status(500).json({ error: 'Failed to get appeals' });
  }
});

/**
 * GET /api/trust/admin/appeals
 * Get pending appeals for admin review
 */
router.get('/admin/appeals', authMiddleware, adminMiddleware, trustQueryLimiter, async (req, res) => {
  try {
    const [pending, stats] = await Promise.all([
      db.getPendingAppeals(50),
      db.getAppealStats()
    ]);

    res.json({
      success: true,
      appeals: pending.map(a => ({
        id: a.id,
        user: {
          id: a.user_id,
          username: a.username,
          avatar: a.avatar,
          trustScore: a.trust_score,
          trustTier: a.trust_tier
        },
        violation: {
          type: a.violation_type,
          message: a.user_facing_message,
          baselineComparison: a.baseline_comparison ? JSON.parse(a.baseline_comparison) : null
        },
        battleId: a.battle_id,
        userExplanation: a.user_explanation,
        createdAt: a.created_at
      })),
      stats: {
        pending: stats.pending || 0,
        approved: stats.approved || 0,
        denied: stats.denied || 0,
        total: stats.total || 0,
        approvalRate: stats.total > 0
          ? ((stats.approved / (stats.approved + stats.denied)) * 100).toFixed(1)
          : 0
      }
    });
  } catch (err) {
    logger.error('[TRUST] Error getting pending appeals:', err);
    res.status(500).json({ error: 'Failed to get appeals' });
  }
});

/**
 * POST /api/trust/admin/appeals/:appealId/resolve
 * Resolve an appeal (approve or deny)
 */
router.post('/admin/appeals/:appealId/resolve', authMiddleware, adminMiddleware, adminActionLimiter, async (req, res) => {
  try {
    const adminId = req.user.sub;
    const appealId = parseInt(req.params.appealId);
    const { approved, response } = req.body;

    if (isNaN(appealId)) {
      return res.status(400).json({ error: 'Invalid appeal ID' });
    }

    if (typeof approved !== 'boolean') {
      return res.status(400).json({ error: 'Must specify approved: true or false' });
    }

    if (!response || response.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a response (at least 10 characters)' });
    }

    const result = await db.resolveAppeal(appealId, adminId, approved, response.trim());

    // Log admin action
    try {
      await db.logAdminAction(adminId, 'resolve_appeal', 'trust_appeal', appealId, {
        approved,
        response: response.trim()
      });
    } catch (auditErr) {
      logger.error('[TRUST] Failed to log admin action:', auditErr);
    }

    logger.info(`[TRUST] Admin ${adminId} ${approved ? 'approved' : 'denied'} appeal ${appealId}`);

    res.json({
      success: true,
      message: `Appeal ${approved ? 'approved' : 'denied'} successfully`,
      appealId,
      approved
    });
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('already resolved')) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('[TRUST] Error resolving appeal:', err);
    res.status(500).json({ error: 'Failed to resolve appeal' });
  }
});

module.exports = router;
