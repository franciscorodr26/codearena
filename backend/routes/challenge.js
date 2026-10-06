const express = require('express');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const db = require('../db');
const authRouter = require('./auth');
const elo = require('../elo');
const badgeService = require('../services/badgeService');
const activityService = require('../services/activityService');
const promptEngineeringLoader = require('../services/promptEngineeringLoader');
const promptBattleRunner = require('../services/promptBattleRunner');
const { judgeModelOutput } = require('../services/promptJudgeScore');
const { getConsumerFairUseLimit } = require('../../shared/codearenaProductMode');

const { SECRET } = require('../config/jwt');
const { sessionUserFromRequest } = require('../utils/sessionAuthentication');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

const CHALLENGE_TYPE = 'prompt';
const MAX_PROMPT_CHARS = 12000;

// In-flight AI-call lock keyed by `${userId}:${weekString}`. Prevents two
// concurrent /preview or /complete requests from the same user from both
// firing the model (and double-billing) before the first one's UPDATE commits.
// Single-instance backend, so an in-process Set is sufficient.
const inFlightCalls = new Set();

async function consumePromptEvaluationQuota(userId) {
  const userLimit = getConsumerFairUseLimit('dailyChallengePromptEvaluationsPerDay');
  const globalLimit = getConsumerFairUseLimit('globalPromptEvaluationsPerDay');
  const quota = await db.tryConsumeConsumerDailyUsage([
    { metric: 'daily_challenge_prompt', subjectId: `user:${userId}`, limit: userLimit },
    { metric: 'prompt_evaluation', subjectId: 'global', limit: globalLimit }
  ]);
  return { ...quota, userLimit, globalLimit };
}

// Divergence-weighted scoring: when the LLM-as-judge agrees with the keyword
// rubric on a given problem, we trust the judge fully. When they diverge a
// lot, blend with the rubric, the judge may be unstable on that problem
// (gameable, ambiguous criteria, judge bias). Trust scales linearly:
//   avg_divergence ≤ 10  →  trust = 1.0  (judge dominates)
//   avg_divergence ≥ 40  →  trust = 0.5  (50/50 blend, never lower)
// Floor at 0.5 so the judge always gets at least equal weight; if it ever
// falls below 0.5 we'd be saying "the keyword rubric is more accurate than
// reading the output" which is never true.
const DIVERGENCE_FULL_TRUST = 10;
const DIVERGENCE_HALF_TRUST = 40;
const MIN_SAMPLES_FOR_WEIGHTING = 5;

function judgeTrustWeight(avgDivergence, sampleCount) {
  if (typeof avgDivergence !== 'number' || !Number.isFinite(avgDivergence)) return 1;
  if (sampleCount < MIN_SAMPLES_FOR_WEIGHTING) return 1;
  if (avgDivergence <= DIVERGENCE_FULL_TRUST) return 1;
  if (avgDivergence >= DIVERGENCE_HALF_TRUST) return 0.5;
  // Linear in between.
  const t = (avgDivergence - DIVERGENCE_FULL_TRUST) / (DIVERGENCE_HALF_TRUST - DIVERGENCE_FULL_TRUST);
  return 1 - 0.5 * t;
}

/**
 * GET /api/challenge
 * Get this week's arena challenge (mystery until started)
 */
router.get('/', async (req, res, next) => {
  try {
    const problems = promptEngineeringLoader.getAll();
    if (problems.length === 0) {
      return res.status(500).json({ error: 'Weekly problems not loaded' });
    }

    const challenge = await db.getOrCreateArenaChallenge(problems, CHALLENGE_TYPE);
    const problem = problems.find(p => p.id === challenge.problem_id);

    if (!problem) {
      return res.status(500).json({ error: 'Arena challenge problem not found' });
    }

    const stats = await db.getArenaChallengeStats(challenge.challenge_date);
    // Current-week leaderboard always redacts prompts (anti-copying).
    // Past-week reveal happens via the dedicated /leaderboard?week= endpoint.
    const leaderboard = await db.getArenaLeaderboard(challenge.challenge_date, 10, { revealPrompts: false });
    const timeUntilNext = db.getTimeUntilNextWeek();

    // Check if user has started (to reveal problem details)
    let userStarted = false;
    let userCompleted = false;
    let userAttempt = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const sessionUser = await sessionUserFromRequest(req, db, SECRET);
        if (!sessionUser) throw new Error('Invalid session');
        const attempt = await db.getArenaAttempt(sessionUser.userId, challenge.challenge_date);
        userStarted = !!attempt;
        userCompleted = attempt?.completed || false;
        if (attempt) {
          userAttempt = {
            submitCount: attempt.prompt_submit_count || 0,
            score: attempt.prompt_score || null
          };
        }
      } catch (e) {
        // Invalid token, treat as not started
      }
    }

    const problemData = userStarted ? {
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      category: problem.category,
      description: problem.description,
      scenario: problem.scenario,
      targetOutput: problem.targetOutput
    } : {
      id: null,
      title: 'Mystery Prompt Challenge',
      difficulty: problem.difficulty,
      description: 'Start the challenge to reveal this week\'s prompt engineering scenario. You have ONE submission, think before you prompt!',
      scenario: null,
      targetOutput: null
    };

    res.json({
      success: true,
      challengeType: CHALLENGE_TYPE,
      challenge: {
        week: challenge.challenge_date,
        problem: problemData,
        revealed: userStarted
      },
      userStarted,
      userCompleted,
      userAttempt,
      stats: {
        totalAttempts: stats?.total_attempts || 0,
        completions: stats?.completions || 0,
        avgScore: null,
        bestScore: null
      },
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        userId: entry.user_id,
        username: entry.username,
        avatar: entry.avatar,
        score: entry.prompt_score,
        submitCount: entry.prompt_submit_count,
        passedTierId: entry.passed_tier_id,
        modelUsed: entry.model_used,
        // current-week feed always has prompt/output as null (redacted by query)
        prompt: entry.prompt || null,
        modelOutput: entry.model_output || null,
        streak: entry.weekly_streak || 0,
        totalCompletions: entry.total_completions || 1
      })),
      timeUntilNext
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenge/attempt
 * Get user's attempt for this week's challenge
 */
router.get('/attempt', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentWeek = db.getCurrentWeekString();

    const attempt = await db.getArenaAttempt(userId, currentWeek);
    const stats = await db.getUserStats(userId);

    res.json({
      success: true,
      attempt: attempt ? {
        started: true,
        completed: !!attempt.completed,
        solveTime: attempt.solve_time,
        startedAt: attempt.started_at,
        completedAt: attempt.completed_at,
        submitCount: attempt.prompt_submit_count || 0,
        score: attempt.prompt_score || null
      } : null,
      streak: {
        current: stats?.daily_streak || 0,
        best: stats?.best_daily_streak || 0,
        lastCompletion: stats?.last_daily_completion
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/challenge/start
 * Start this week's arena challenge - reveals the problem
 */
router.post('/start', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const currentWeek = db.getCurrentWeekString();

    const problems = promptEngineeringLoader.getAll();
    if (problems.length === 0) {
      return res.status(500).json({ error: 'Weekly problems not loaded' });
    }

    // Check if already started (one attempt only!)
    const existingAttempt = await db.getArenaAttempt(userId, currentWeek);
    if (existingAttempt) {
      return res.status(400).json({
        error: 'You have already started this week\'s challenge. One submission per week!',
        alreadyStarted: true
      });
    }

    const challenge = await db.getOrCreateArenaChallenge(problems, CHALLENGE_TYPE);
    const problem = problems.find(p => p.id === challenge.problem_id);

    if (!problem) {
      return res.status(500).json({ error: 'Challenge problem not found. Please try again later.', success: false });
    }

    const attempt = await db.startArenaAttempt(userId, currentWeek, 'prompt');

    res.json({
      success: true,
      attempt: {
        started: true,
        completed: false,
        startedAt: attempt.started_at,
        submitCount: 0
      },
      problem: {
        id: problem.id,
        title: problem.title,
        difficulty: problem.difficulty,
        category: problem.category,
        description: problem.description,
        scenario: problem.scenario,
        targetOutput: problem.targetOutput
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/challenge/preview
 *
 * Free fair-use preview. Runs the user's prompt through the model and returns
 * the AI output. Does NOT increment submit_count, does NOT decay the score,
 * does NOT write the prompt or output to the challenge-attempt DB.
 *
 * Subject to the same in-flight lock as scored runs so a user can't open
 * 5 tabs and parallel-fire AI calls. Same 12k char limit.
 */
router.post('/preview', authMiddleware, async (req, res, next) => {
  const userId = req.user.sub;
  const currentWeek = db.getCurrentWeekString();
  const lockKey = `${userId}:${currentWeek}`;
  if (inFlightCalls.has(lockKey)) {
    return res.status(409).json({ error: 'Another run is already in progress for this week.' });
  }
  inFlightCalls.add(lockKey);
  try {
    const { prompt, modelId } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `Prompt exceeds ${MAX_PROMPT_CHARS} character limit` });
    }

    const attempt = await db.getArenaAttempt(userId, currentWeek);
    if (!attempt) {
      return res.status(400).json({ error: 'Challenge not started' });
    }
    if (attempt.completed) {
      return res.status(400).json({ error: 'Challenge already completed' });
    }

    const problems = promptEngineeringLoader.getAll();
    const challenge = await db.getOrCreateArenaChallenge(problems, CHALLENGE_TYPE);
    const problem = problems.find(p => p.id === challenge.problem_id);
    if (!problem) {
      return res.status(500).json({ error: 'Challenge problem not found' });
    }

    const sanitizedModelId = promptBattleRunner.sanitizeModelId(modelId);
    if (!sanitizedModelId) {
      return res.status(503).json({ error: 'No AI model is configured' });
    }

    const quota = await consumePromptEvaluationQuota(userId);
    if (!quota.allowed) {
      const globalLimitReached = quota.reason === 'global_limit';
      return res.status(429).json({
        error: globalLimitReached
          ? 'CodeArena has reached today\'s prompt capacity. Please try again tomorrow.'
          : `Daily fair-use limit reached (${quota.userLimit} prompt evaluations). Try again tomorrow.`,
        limitReached: true,
        globalLimitReached
      });
    }

    const result = await promptBattleRunner.runPlayerModel(problem, prompt.trim(), { modelId: sanitizedModelId });

    res.json({
      success: true,
      modelOutput: result.text,
      modelId: sanitizedModelId,
      free: true,
      tokenUsage: {
        promptTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        totalTokens: result.totalTokens || 0
      }
    });
  } catch (err) {
    logger.error('[challenge] preview error:', err);
    if (err.message && err.message.includes('No AI model')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  } finally {
    inFlightCalls.delete(lockKey);
  }
});

/**
 * POST /api/challenge/complete
 * Final submission: run the prompt, score the output via LLM-as-judge
 * (with divergence-weighted blending against the keyword rubric),
 * mark the challenge complete. PURE ONE-SHOT, no decay, no submit
 * count, no resubmits. Free iteration happens via /preview.
 */
router.post('/complete', authMiddleware, async (req, res, next) => {
  const userId = req.user.sub;
  const currentWeek = db.getCurrentWeekString();
  const lockKey = `${userId}:${currentWeek}`;
  if (inFlightCalls.has(lockKey)) {
    return res.status(409).json({ error: 'A submission is already in progress for this week.' });
  }
  inFlightCalls.add(lockKey);
  try {
    const { prompt, modelId, submittedAt } = req.body || {};

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `Prompt exceeds ${MAX_PROMPT_CHARS} character limit` });
    }

    const existingAttempt = await db.getArenaAttempt(userId, currentWeek);
    if (!existingAttempt) {
      return res.status(400).json({ error: 'Challenge not started' });
    }
    if (existingAttempt.completed) {
      return res.status(400).json({ error: 'Challenge already completed' });
    }

    const startedAt = new Date(existingAttempt.started_at).getTime();
    const now = Date.now();
    const effectiveEndTime = (submittedAt && typeof submittedAt === 'number' && submittedAt >= startedAt && submittedAt <= now)
      ? submittedAt : now;
    const solveTime = Math.floor((effectiveEndTime - startedAt) / 1000);

    const problems = promptEngineeringLoader.getAll();
    const challenge = await db.getOrCreateArenaChallenge(problems, CHALLENGE_TYPE);
    const problem = problems.find(p => p.id === challenge.problem_id);
    if (!problem) {
      return res.status(500).json({ error: 'Challenge problem not found' });
    }

    const sanitizedModelId = promptBattleRunner.sanitizeModelId(modelId);
    if (!sanitizedModelId) {
      return res.status(503).json({ error: 'No AI model is configured' });
    }

    const quota = await consumePromptEvaluationQuota(userId);
    if (!quota.allowed) {
      const globalLimitReached = quota.reason === 'global_limit';
      return res.status(429).json({
        error: globalLimitReached
          ? 'CodeArena has reached today\'s prompt capacity. Please try again tomorrow.'
          : `Daily fair-use limit reached (${quota.userLimit} prompt evaluations). Try again tomorrow.`,
        limitReached: true,
        globalLimitReached
      });
    }

    // Run the prompt and evaluate output via LLM-as-judge.
    // The judge reads the model output and rates it against the problem's
    // weighted evaluationCriteria. Falls back to the keyword-rubric tiered
    // scorer on judge failure (no API key, parse error, etc).
    const result = await promptBattleRunner.runPlayerModel(problem, prompt.trim(), { modelId: sanitizedModelId });
    const evaluation = await judgeModelOutput(problem, result.text);

    // Divergence-weighted scoring. If this problem has historically shown
    // big gaps between judge and rubric scores, the judge may be unstable
    // for it (gameable, ambiguous criteria, judge bias). Blend with the
    // rubric proportional to that historical divergence. Brand-new
    // problems get full judge trust until enough samples accumulate.
    let trust = 1;
    let avgDivergence = null;
    let sampleCount = 0;
    if (evaluation.source === 'judge') {
      try {
        const stats = await db.getProblemDivergenceStats(problem.id);
        avgDivergence = stats?.avg_divergence ?? null;
        sampleCount = stats?.sample_count ?? 0;
        trust = judgeTrustWeight(avgDivergence, sampleCount);
      } catch (statsErr) {
        logger.warn('[challenge] divergence stats lookup failed:', statsErr.message);
      }
    }
    const judgeScore = evaluation.scorePercent || 0;
    const rubricScore = evaluation.rubricScore || 0;
    const finalScore = Math.round(trust * judgeScore + (1 - trust) * rubricScore);

    // Fire-and-forget judge-vs-rubric divergence telemetry. Wrapped in
    // try/catch so a logging failure can never fail the user's submission.
    // Logged AFTER the trust calculation reads stats, if we logged first,
    // this submission would self-bias its own trust weight.
    try {
      await db.logJudgeScore({
        userId,
        challengeDate: currentWeek,
        problemId: problem.id,
        judgeScore,
        rubricScore,
        judgeSource: evaluation.source,
        modelUsed: sanitizedModelId
      });
    } catch (logErr) {
      logger.warn('[challenge] judge log failed:', logErr.message);
    }

    const attempt = await db.completeArenaAttempt(userId, currentWeek, solveTime, prompt, {
      promptScore: finalScore,
      // Pure one-shot: no submit count to track. Stays at 1 for legacy
      // schema compatibility (the column has a default of 0; we set it
      // to 1 here so old leaderboard queries that read it still work).
      promptSubmitCount: 1,
      modelOutput: result.text,
      passedTierId: evaluation.passedTierId || null,
      modelUsed: sanitizedModelId
    });

    const rank = await db.getUserArenaRank(userId, currentWeek);
    const stats = await db.getUserStats(userId);

    // Badge & activity tracking
    let newBadges = [];
    try {
      newBadges = await badgeService.checkAfterWeeklyComplete(userId);
      if (newBadges.length > 0 && global.emitToUser) {
        global.emitToUser(userId, 'badges-earned', { badges: newBadges, context: 'weekly_challenge' });
      }
    } catch (err) {
      logger.error('Badge check failed for weekly challenge:', err);
    }

    try {
      await activityService.recordWeeklyCompleted(userId, { rank, time: solveTime });
      for (const badge of newBadges) {
        await activityService.recordBadgeEarned(userId, {
          badgeName: badge.name, badgeSlug: badge.slug, badgeIcon: badge.icon, badgeRarity: badge.rarity
        });
      }
    } catch (err) {
      logger.error('Activity recording failed:', err);
    }

    res.json({
      success: true,
      modelOutput: result.text,
      attempt: {
        completed: true,
        solveTime: attempt?.solve_time,
        completedAt: attempt?.completed_at,
        score: finalScore,
        // Component scores so the UI can show "judge said X, rubric said Y"
        // when divergence weighting actually shifted the result.
        judgeScore,
        rubricScore
      },
      // Divergence-weighted scoring metadata.
      scoring: {
        trust: Math.round(trust * 100) / 100,
        avgDivergence: typeof avgDivergence === 'number' ? Math.round(avgDivergence * 10) / 10 : null,
        sampleCount,
        blended: trust < 1
      },
      rank,
      streak: {
        current: stats?.daily_streak || 0,
        best: stats?.best_daily_streak || 0
      },
      newBadges,
      tierResults: evaluation.tierResults || [],
      passedTierId: evaluation.passedTierId || null,
      // LLM-as-judge fields (null on judge fallback to keyword rubric).
      judgeRationale: evaluation.rationale || null,
      judgeCriteria: evaluation.criteria || [],
      scoreSource: evaluation.source || 'tiered-fallback'
    });
  } catch (err) {
    logger.error('[challenge] complete error:', err);
    next(err);
  } finally {
    inFlightCalls.delete(lockKey);
  }
});

/**
 * GET /api/challenge/leaderboard
 *
 * Past-week leaderboards reveal each entry's prompt + model output as a
 * "study the winners" hook. Current-week prompts stay redacted to prevent
 * trivial prompt copying.
 */
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { week } = req.query;
    const currentWeek = db.getCurrentWeekString();
    const challengeWeek = week || currentWeek;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 100);
    const isPastWeek = challengeWeek < currentWeek;

    const leaderboard = await db.getArenaLeaderboard(challengeWeek, limit, { revealPrompts: isPastWeek });
    const stats = await db.getArenaChallengeStats(challengeWeek);

    res.json({
      success: true,
      week: challengeWeek,
      revealed: isPastWeek,
      stats: {
        totalAttempts: stats?.total_attempts || 0,
        completions: stats?.completions || 0
      },
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        userId: entry.user_id,
        username: entry.username,
        avatar: entry.avatar,
        score: entry.prompt_score,
        submitCount: entry.prompt_submit_count,
        passedTierId: entry.passed_tier_id,
        modelUsed: entry.model_used,
        prompt: entry.prompt || null,
        modelOutput: entry.model_output || null,
        streak: entry.weekly_streak || 0,
        totalCompletions: entry.total_completions || 1
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenge/models
 * AI models available for the prompt challenge.
 */
router.get('/models', async (req, res, next) => {
  try {
    const models = promptBattleRunner.getAvailablePromptBattleModels();
    res.json({
      success: true,
      models,
      defaultModelId: promptBattleRunner.getDefaultPromptBattleModelId(),
      aiAvailable: models.length > 0
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenge/history
 */
router.get('/history', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 100);

    const history = await db.getUserArenaHistory(userId, limit);
    const stats = await db.getUserStats(userId);

    res.json({
      success: true,
      streak: {
        current: stats?.daily_streak || 0,
        best: stats?.best_daily_streak || 0,
        lastCompletion: stats?.last_daily_completion
      },
      history: history.map(h => ({
        week: h.challenge_date,
        problemId: h.problem_id,
        difficulty: h.difficulty,
        completed: !!h.completed,
        solveTime: h.solve_time,
        score: h.prompt_score,
        submitCount: h.prompt_submit_count
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenge/streak
 */
router.get('/streak', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const stats = await db.getUserStats(userId);
    const currentWeek = db.getCurrentWeekString();
    const attempt = await db.getArenaAttempt(userId, currentWeek);

    res.json({
      success: true,
      streak: {
        current: stats?.daily_streak || 0,
        best: stats?.best_daily_streak || 0,
        lastCompletion: stats?.last_daily_completion,
        completedThisWeek: !!(attempt?.completed)
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenge/archive
 */
router.get('/archive', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 50);
    const pastChallenges = await db.getPastArenaChallenges(limit);

    res.json({
      success: true,
      challenges: pastChallenges.map(c => ({
        week: c.challenge_date,
        problemId: c.problem_id,
        difficulty: c.difficulty,
        completions: c.completions || 0
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/challenge/admin/divergence
 * Judge-vs-rubric divergence leaderboard. Surfaces problems where the
 * LLM judge and the keyword rubric disagree the most, usually a sign
 * the problem is gameable, the judge is biased, or both. Requires the
 * x-admin-key header (matching the pattern in routes/notifications.js).
 */
router.get('/admin/divergence', async (req, res, next) => {
  try {
    const adminKey = req.headers['x-admin-key'] || (req.body && req.body.adminKey);
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 20;
    const rows = await db.getDivergenceLeaderboard(limit);

    res.json({
      success: true,
      problems: rows.map(r => ({
        problemId: r.problem_id,
        samples: r.samples,
        avgDivergence: Math.round((r.avg_divergence || 0) * 10) / 10,
        avgJudgeScore: Math.round(r.avg_judge_score || 0),
        avgRubricScore: Math.round(r.avg_rubric_score || 0)
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
