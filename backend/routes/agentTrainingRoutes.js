/**
 * Agent Training Routes
 *
 * Training mode for testing loadouts against problems.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');
const problemsLoader = require('../problemsLoader');
const agentRunner = require('../services/agentRunner');
const { reserveSpending } = require('../services/agentSpendingLimiter');
const {
  loadoutLimiter,
  parseStoredModules
} = require('./agentBattleUtils');

const router = express.Router();

// Hard cap on problems executed per training run to prevent a single POST from
// kicking off dozens of paid Claude calls even if the spending limiter would
// otherwise allow them (defense in depth alongside reserveSpending).
const MAX_PROBLEMS_PER_RUN = 10;

// Local rate limiter for training executions. The shared agentTestLimiter
// in agentBattleUtils keys on `req.user?.userId`, but auth (see auth.js
// commit 1c7337d9) populates the JWT payload as `req.user.sub` and adds a
// compatibility shim `req.user.id = decoded.sub`. `req.user.userId` is
// ALWAYS undefined, which made the shared limiter silently fall back to a
// per-IP key — meaning a single authenticated user behind a shared NAT
// could trigger the cost-amplification loop unbounded. We key on
// `req.user.id || req.user.sub` so the limit is actually per-user.
const trainingExecuteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many training executions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.user?.sub || ipKeyGenerator(req.ip),
  validate: false
});

/**
 * POST /api/agent/training/start
 * Start a training run with selected problems
 */
router.post('/start', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.sub;
    const { loadoutId, problemIds, difficulty } = req.body;

    if (!loadoutId) {
      return res.status(400).json({ error: 'Loadout ID is required' });
    }

    const loadout = await db.get(
      'SELECT * FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({ error: 'Loadout not found or does not belong to you' });
    }

    let problems = [];
    const problemFiles = [];

    if (difficulty) {
      if (!['easy', 'medium', 'hard'].includes(difficulty)) {
        return res.status(400).json({ error: 'Invalid difficulty. Must be easy, medium, or hard' });
      }
      problemFiles.push(`${difficulty}.json`);
    } else if (problemIds && problemIds.length > 0) {
      problemFiles.push('easy.json', 'medium.json', 'hard.json', 'prompt-engineering.json');
    } else {
      problemFiles.push('easy.json', 'medium.json', 'hard.json');
    }

    for (const file of problemFiles) {
      // Open edition: "easy.json" style names map to the open problem set by difficulty.
      const difficultyName = file.replace('.json', '');
      if (['easy', 'medium', 'hard'].includes(difficultyName)) problems.push(...problemsLoader.getAgentProblems(difficultyName));
    }

    if (problemIds && problemIds.length > 0) {
      problems = problems.filter(p => problemIds.includes(p.id));
    }

    if (problems.length === 0) {
      return res.status(400).json({ error: 'No problems found matching criteria' });
    }

    const trainingRunId = uuidv4();
    await db.run(
      `INSERT INTO agent_training_runs (
        id, user_id, loadout_id, status, total_problems, difficulty_filter, started_at
      ) VALUES (?, ?, ?, 'running', ?, ?, datetime('now'))`,
      [trainingRunId, userId, loadoutId, problems.length, difficulty || null]
    );

    logger.info(`[Agent Training] User ${userId} started training run ${trainingRunId} with ${problems.length} problems`);

    res.json({
      success: true,
      trainingRunId,
      problems: problems.map(p => ({
        id: p.id,
        title: p.title,
        difficulty: p.difficulty || difficulty
      })),
      totalProblems: problems.length
    });
  } catch (err) {
    logger.error(`[Agent Training] Error starting training: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/training/:runId/execute
 * Execute training run against all problems
 */
router.post('/:runId/execute', authMiddleware, trainingExecuteLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.sub;
    const trainingRunId = req.params.runId;

    const trainingRun = await db.get(
      'SELECT * FROM agent_training_runs WHERE id = ? AND user_id = ?',
      [trainingRunId, userId]
    );

    if (!trainingRun) {
      return res.status(404).json({ error: 'Training run not found' });
    }

    if (trainingRun.status === 'completed') {
      return res.status(400).json({ error: 'Training run already completed' });
    }

    const loadout = await db.get('SELECT * FROM agent_loadouts WHERE id = ?', [trainingRun.loadout_id]);
    if (!loadout) {
      return res.status(404).json({ error: 'Loadout not found' });
    }

    let problems = [];
    const problemFiles = trainingRun.difficulty_filter
      ? [`${trainingRun.difficulty_filter}.json`]
      : ['easy.json', 'medium.json', 'hard.json'];

    for (const file of problemFiles) {
      // Open edition: "easy.json" style names map to the open problem set by difficulty.
      const difficultyName = file.replace('.json', '');
      if (['easy', 'medium', 'hard'].includes(difficultyName)) problems.push(...problemsLoader.getAgentProblems(difficultyName));
    }

    // Hard cap on problems per run as a defense-in-depth measure: even if the
    // spending limiter has budget, one POST must not kick off >MAX_PROBLEMS_PER_RUN
    // paid Claude calls.
    const totalAvailable = problems.length;
    if (problems.length > MAX_PROBLEMS_PER_RUN) {
      logger.warn(`[Agent Training] Capping run ${trainingRunId} from ${problems.length} to ${MAX_PROBLEMS_PER_RUN} problems`);
      problems = problems.slice(0, MAX_PROBLEMS_PER_RUN);
    }

    // Determine pro status once for spending limits.
    let isPro = false;
    try {
      isPro = await db.isUserPro(userId);
    } catch (proErr) {
      logger.warn(`[Agent Training] Failed to check pro status for user ${userId}: ${proErr.message}`);
    }

    let problemsSolved = 0;
    let totalTestsPassed = 0;
    let totalTestsFailed = 0;
    let totalTokensUsed = 0;
    let totalExecutionTime = 0;
    const results = [];
    let budgetExhausted = false;
    let budgetExhaustedReason = null;

    for (const problem of problems) {
      // Per-problem spend gate. reserveSpending atomically checks + commits
      // the cost so concurrent training runs can't blow past the daily/monthly
      // cap. If !ok, stop the loop and return partial results — DO NOT keep
      // billing the user past their limit.
      const reservation = await reserveSpending(userId, loadout.model, isPro);
      if (!reservation.ok) {
        budgetExhausted = true;
        budgetExhaustedReason = reservation.reason;
        logger.warn(`[Agent Training] Spending gate denied problem ${problem.id} for user ${userId} in run ${trainingRunId}: ${reservation.reason}`);
        break;
      }

      // Audit log so post-incident we can trace exactly what was billed.
      logger.info(`[Agent Training] Spend reserved for user ${userId} run ${trainingRunId} problem ${problem.id}: $${reservation.cost?.toFixed?.(3) ?? reservation.cost} (model=${loadout.model}, reservationId=${reservation.reservationId}, dailySpend=$${reservation.dailySpend?.toFixed?.(2)}/$${reservation.dailyLimit?.toFixed?.(2)})`);

      try {
        logger.info(`[Agent Training] Running problem ${problem.id} for training ${trainingRunId}`);

        const result = await agentRunner.runAgent(problem, {
          model: loadout.model,
          systemPrompt: loadout.system_prompt || '',
          language: loadout.language,
          tools: parseStoredModules(loadout.tools)
        });

        const success = result.success ? 1 : 0;
        if (success) problemsSolved++;

        totalTestsPassed += result.passedCount || 0;
        totalTestsFailed += (result.totalTests || 0) - (result.passedCount || 0);
        totalTokensUsed += result.tokensUsed || 0;
        totalExecutionTime += result.executionTimeMs || 0;

        await db.run(
          `INSERT INTO agent_training_results (
            training_run_id, problem_id, problem_title, problem_difficulty,
            success, code_generated, tests_passed, total_tests,
            tokens_used, execution_time_ms, error_message, test_results
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            trainingRunId,
            problem.id,
            problem.title,
            problem.difficulty || trainingRun.difficulty_filter,
            success,
            result.code || '',
            result.passedCount || 0,
            result.totalTests || 0,
            result.tokensUsed || 0,
            result.executionTimeMs || 0,
            result.error || null,
            JSON.stringify(result.testResults || [])
          ]
        );

        results.push({
          problemId: problem.id,
          title: problem.title,
          success: !!success,
          testsPassed: result.passedCount || 0,
          totalTests: result.totalTests || 0,
          tokensUsed: result.tokensUsed || 0,
          executionTimeMs: result.executionTimeMs || 0
        });
      } catch (problemErr) {
        logger.error(`[Agent Training] Error on problem ${problem.id}: ${problemErr.message}`);
        results.push({
          problemId: problem.id,
          title: problem.title,
          success: false,
          error: problemErr.message
        });
      }
    }

    const attempted = results.length;
    const finalStatus = budgetExhausted ? 'partial' : 'completed';

    await db.run(
      `UPDATE agent_training_runs SET
        status = ?,
        problems_solved = ?,
        total_tests_passed = ?,
        total_tests_failed = ?,
        total_tokens_used = ?,
        total_execution_time_ms = ?,
        completed_at = datetime('now')
      WHERE id = ?`,
      [finalStatus, problemsSolved, totalTestsPassed, totalTestsFailed, totalTokensUsed, totalExecutionTime, trainingRunId]
    );

    logger.info(`[Agent Training] Training run ${trainingRunId} ${finalStatus}: ${problemsSolved}/${attempted} solved (${problems.length} planned, ${totalAvailable} available, capped=${totalAvailable > MAX_PROBLEMS_PER_RUN}, budgetExhausted=${budgetExhausted})`);

    const summary = {
      trainingRunId,
      problemsSolved,
      problemsAttempted: attempted,
      totalProblems: problems.length,
      totalAvailable,
      cappedAt: MAX_PROBLEMS_PER_RUN,
      wasCapped: totalAvailable > MAX_PROBLEMS_PER_RUN,
      partial: budgetExhausted,
      successRate: attempted > 0
        ? ((problemsSolved / attempted) * 100).toFixed(1)
        : '0.0',
      totalTestsPassed,
      totalTestsFailed,
      totalTokensUsed,
      totalExecutionTimeMs: totalExecutionTime
    };

    if (budgetExhausted) {
      // 402 Payment Required — partial results returned so the caller can
      // still display what completed before the limit was hit.
      return res.status(402).json({
        success: false,
        partial: true,
        error: budgetExhaustedReason || 'Spending limit reached',
        summary,
        results
      });
    }

    res.json({
      success: true,
      summary,
      results
    });
  } catch (err) {
    logger.error(`[Agent Training] Error executing training: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/training/history
 * Get training run history
 */
router.get('/history', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.id || req.user?.sub;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const runs = await db.all(
      `SELECT tr.*, al.name as loadout_name
       FROM agent_training_runs tr
       LEFT JOIN agent_loadouts al ON tr.loadout_id = al.id
       WHERE tr.user_id = ?
       ORDER BY tr.started_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    const total = await db.get(
      'SELECT COUNT(*) as count FROM agent_training_runs WHERE user_id = ?',
      [userId]
    );

    res.json({
      success: true,
      runs: runs.map(run => ({
        id: run.id,
        loadoutId: run.loadout_id,
        loadoutName: run.loadout_name,
        status: run.status,
        totalProblems: run.total_problems,
        problemsSolved: run.problems_solved,
        successRate: run.total_problems > 0
          ? ((run.problems_solved / run.total_problems) * 100).toFixed(1)
          : 0,
        totalTestsPassed: run.total_tests_passed,
        totalTestsFailed: run.total_tests_failed,
        totalTokensUsed: run.total_tokens_used,
        difficultyFilter: run.difficulty_filter,
        startedAt: run.started_at,
        completedAt: run.completed_at
      })),
      total: total.count,
      limit,
      offset
    });
  } catch (err) {
    logger.error(`[Agent Training] Error fetching history: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/training/stats
 * Get aggregate training statistics
 */
router.get('/stats', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;

    const stats = await db.get(
      `SELECT
        COUNT(*) as total_runs,
        SUM(problems_solved) as total_problems_solved,
        SUM(total_problems) as total_problems_attempted,
        SUM(total_tests_passed) as total_tests_passed,
        SUM(total_tests_failed) as total_tests_failed,
        SUM(total_tokens_used) as total_tokens_used,
        SUM(total_execution_time_ms) as total_execution_time_ms
       FROM agent_training_runs
       WHERE user_id = ? AND status = 'completed'`,
      [userId]
    );

    const byDifficulty = await db.all(
      `SELECT
        difficulty_filter,
        COUNT(*) as runs,
        SUM(problems_solved) as solved,
        SUM(total_problems) as attempted
       FROM agent_training_runs
       WHERE user_id = ? AND status = 'completed' AND difficulty_filter IS NOT NULL
       GROUP BY difficulty_filter`,
      [userId]
    );

    res.json({
      success: true,
      stats: {
        totalRuns: stats.total_runs || 0,
        totalProblemsSolved: stats.total_problems_solved || 0,
        totalProblemsAttempted: stats.total_problems_attempted || 0,
        overallSuccessRate: stats.total_problems_attempted > 0
          ? ((stats.total_problems_solved / stats.total_problems_attempted) * 100).toFixed(1)
          : 0,
        totalTestsPassed: stats.total_tests_passed || 0,
        totalTestsFailed: stats.total_tests_failed || 0,
        totalTokensUsed: stats.total_tokens_used || 0,
        totalExecutionTimeMs: stats.total_execution_time_ms || 0
      },
      byDifficulty: byDifficulty.map(d => ({
        difficulty: d.difficulty_filter,
        runs: d.runs,
        solved: d.solved,
        attempted: d.attempted,
        successRate: d.attempted > 0 ? ((d.solved / d.attempted) * 100).toFixed(1) : 0
      }))
    });
  } catch (err) {
    logger.error(`[Agent Training] Error fetching stats: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/training/:runId
 * Get details of a specific training run
 */
router.get('/:runId', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const trainingRunId = req.params.runId;

    const run = await db.get(
      `SELECT tr.*, al.name as loadout_name, al.model, al.language
       FROM agent_training_runs tr
       LEFT JOIN agent_loadouts al ON tr.loadout_id = al.id
       WHERE tr.id = ? AND tr.user_id = ?`,
      [trainingRunId, userId]
    );

    if (!run) {
      return res.status(404).json({ error: 'Training run not found' });
    }

    const results = await db.all(
      `SELECT * FROM agent_training_results
       WHERE training_run_id = ?
       ORDER BY id ASC`,
      [trainingRunId]
    );

    res.json({
      success: true,
      run: {
        id: run.id,
        loadoutId: run.loadout_id,
        loadoutName: run.loadout_name,
        model: run.model,
        language: run.language,
        status: run.status,
        totalProblems: run.total_problems,
        problemsSolved: run.problems_solved,
        totalTestsPassed: run.total_tests_passed,
        totalTestsFailed: run.total_tests_failed,
        totalTokensUsed: run.total_tokens_used,
        totalExecutionTimeMs: run.total_execution_time_ms,
        difficultyFilter: run.difficulty_filter,
        startedAt: run.started_at,
        completedAt: run.completed_at
      },
      results: results.map(r => ({
        problemId: r.problem_id,
        problemTitle: r.problem_title,
        difficulty: r.problem_difficulty,
        success: r.success === 1,
        code: r.code_generated,
        testsPassed: r.tests_passed,
        totalTests: r.total_tests,
        tokensUsed: r.tokens_used,
        executionTimeMs: r.execution_time_ms,
        error: r.error_message,
        testResults: JSON.parse(r.test_results || '[]')
      }))
    });
  } catch (err) {
    logger.error(`[Agent Training] Error fetching run details: ${err.message}`, err);
    next(err);
  }
});

module.exports = router;
