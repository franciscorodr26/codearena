const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');
const problemsLoader = require('../problemsLoader');
const agentRunner = require('../services/agentRunner');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ============================================================================
// SECURITY: Input Validation and Sanitization
// ============================================================================

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'prompt-engineering'];

// Rate limiter for training runs: 30 requests per hour per user
// More restrictive than regular test runs to prevent abuse
const trainingRunLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { error: 'Too many training runs. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

// Rate limiter for listing: 60 requests per minute
const listingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

/**
 * Helper function to load all problems from a specific difficulty file
 */
async function loadProblemsFromFile(difficulty) {
  return problemsLoader.getAgentProblems(difficulty);
}

/**
 * Helper function to load a specific problem by ID
 */
async function loadProblem(problemId) {
  const problem = problemsLoader.getAgentProblem(problemId);
  return problem ? { problem, difficulty: String(problem.difficulty).toLowerCase() } : null;
}

/**
 * Helper function to get user's loadout
 */
function getLoadout(loadoutId, userId) {
  return db.get(
    `SELECT * FROM agent_loadouts WHERE id = ? AND user_id = ?`,
    [loadoutId, userId]
  );
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/agent/training/problems
 * Get available training problems grouped by difficulty
 * Query params:
 *   - difficulty: filter by difficulty (optional)
 */
router.get('/problems', authMiddleware, listingLimiter, async (req, res, next) => {
  try {
    const { difficulty } = req.query;

    // Validate difficulty filter if provided
    if (difficulty && !VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({
        error: `Invalid difficulty. Must be one of: ${VALID_DIFFICULTIES.join(', ')}`
      });
    }

    // Load problems based on filter
    const difficulties = difficulty ? [difficulty] : VALID_DIFFICULTIES;
    const problemsByDifficulty = {};

    for (const diff of difficulties) {
      const problems = await loadProblemsFromFile(diff);
      // Only return basic info, not test cases (keep those hidden)
      problemsByDifficulty[diff] = problems.map(p => ({
        id: p.id,
        title: p.title,
        difficulty: p.difficulty || diff,
        description: p.description,
        examples: p.examples,
        constraints: p.constraints,
        testCaseCount: p.testCases ? p.testCases.length : 0
      }));
    }

    res.json({
      problems: problemsByDifficulty,
      total: Object.values(problemsByDifficulty).reduce((sum, arr) => sum + arr.length, 0)
    });
  } catch (err) {
    logger.error('Failed to load training problems:', err);
    next(err);
  }
});

/**
 * POST /api/agent/training/run
 * Run agent against a specific problem in training mode
 * Body: {
 *   problemId: string,
 *   loadoutId: string (optional - if not provided, uses loadout config directly)
 *   loadout: { model, systemPrompt, language, tools } (optional - if loadoutId not provided)
 * }
 *
 * Returns: {
 *   success: boolean,
 *   code: string,
 *   testResults: array,
 *   passedCount: number,
 *   totalTests: number,
 *   executionTimeMs: number,
 *   tokensUsed: number,
 *   problem: object (metadata only),
 *   trainingRunId: string
 * }
 */
router.post('/run', authMiddleware, trainingRunLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const { problemId, loadoutId, loadout: loadoutConfig } = req.body;

    // Validate input
    if (!problemId) {
      return res.status(400).json({ error: 'Problem ID is required' });
    }

    if (!loadoutId && !loadoutConfig) {
      return res.status(400).json({ error: 'Either loadoutId or loadout configuration is required' });
    }

    // Load the problem
    const problemData = await loadProblem(problemId);
    if (!problemData) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    const { problem, difficulty } = problemData;

    // Get or validate loadout
    let loadout;
    let loadoutDbId = loadoutId;

    if (loadoutId) {
      // Load from database
      loadout = await getLoadout(loadoutId, userId);
      if (!loadout) {
        return res.status(404).json({ error: 'Loadout not found' });
      }

      // Parse tools if stored as JSON
      if (typeof loadout.tools === 'string') {
        try {
          loadout.tools = JSON.parse(loadout.tools);
        } catch (e) {
          loadout.tools = [];
        }
      }
    } else {
      // Use provided configuration
      loadout = {
        model: loadoutConfig.model,
        system_prompt: loadoutConfig.systemPrompt,
        language: loadoutConfig.language,
        tools: loadoutConfig.tools || []
      };

      // For tracking purposes, try to find a matching loadout or create a temporary ID
      loadoutDbId = 'temp-' + uuidv4();
    }

    // Create training run record
    const trainingRunId = uuidv4();
    await db.run(
      `INSERT INTO agent_training_runs (
        id, user_id, loadout_id, started_at, status,
        total_problems, difficulty_filter
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'running', 1, ?)`,
      [trainingRunId, userId, loadoutDbId, difficulty]
    );

    // Prepare loadout for agent runner
    const agentLoadout = {
      model: loadout.model,
      systemPrompt: loadout.system_prompt,
      language: loadout.language,
      tools: Array.isArray(loadout.tools) ? loadout.tools : []
    };

    // Run the agent
    let result;
    let errorMessage = null;

    try {
      result = await agentRunner.runAgent(problem, agentLoadout, {
        maxRetries: agentLoadout.tools.includes('auto_retry') ? 2 : 0,
        timeout: 120000 // 2 minute timeout for training
      });
    } catch (err) {
      logger.error(`Training run ${trainingRunId} failed:`, err);
      errorMessage = err.message;
      result = {
        success: false,
        code: null,
        testResults: [],
        passedCount: 0,
        totalTests: problem.testCases?.length || 0,
        executionTimeMs: 0,
        tokensUsed: 0
      };
    }

    // Record the result
    await db.run(
      `INSERT INTO agent_training_results (
        training_run_id, problem_id, problem_title, problem_difficulty,
        success, code_generated, tests_passed, total_tests,
        tokens_used, execution_time_ms, error_message, test_results
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trainingRunId,
        problemId,
        problem.title,
        difficulty,
        result.success ? 1 : 0,
        result.code || '',
        result.passedCount || 0,
        result.totalTests || 0,
        result.tokensUsed || 0,
        result.executionTimeMs || 0,
        errorMessage,
        JSON.stringify(result.testResults || [])
      ]
    );

    // Update training run with completion
    await db.run(
      `UPDATE agent_training_runs SET
        completed_at = CURRENT_TIMESTAMP,
        status = 'completed',
        problems_solved = ?,
        total_tests_passed = ?,
        total_tests_failed = ?,
        total_tokens_used = ?,
        total_execution_time_ms = ?
      WHERE id = ?`,
      [
        result.success ? 1 : 0,
        result.passedCount || 0,
        (result.totalTests || 0) - (result.passedCount || 0),
        result.tokensUsed || 0,
        result.executionTimeMs || 0,
        trainingRunId
      ]
    );

    logger.info(`Training run ${trainingRunId} completed for user ${userId}: ${result.success ? 'SUCCESS' : 'FAILED'}`);

    // Return result with problem metadata (but not test cases)
    res.json({
      success: result.success,
      code: result.code,
      testResults: result.testResults,
      passedCount: result.passedCount,
      totalTests: result.totalTests,
      executionTimeMs: result.executionTimeMs,
      tokensUsed: result.tokensUsed,
      errorMessage,
      problem: {
        id: problem.id,
        title: problem.title,
        difficulty,
        description: problem.description,
        examples: problem.examples,
        constraints: problem.constraints
      },
      trainingRunId
    });
  } catch (err) {
    logger.error('Failed to run training:', err);
    next(err);
  }
});

/**
 * GET /api/agent/training/history
 * Get user's training run history
 * Query params:
 *   - limit: number of runs to return (default: 20, max: 100)
 *   - offset: pagination offset (default: 0)
 *   - loadoutId: filter by loadout (optional)
 *   - difficulty: filter by difficulty (optional)
 */
router.get('/history', authMiddleware, listingLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const { loadoutId, difficulty } = req.query;

    // Build query with filters
    let whereConditions = ['tr.user_id = ?'];
    let params = [userId];

    if (loadoutId) {
      whereConditions.push('tr.loadout_id = ?');
      params.push(loadoutId);
    }

    if (difficulty && VALID_DIFFICULTIES.includes(difficulty)) {
      whereConditions.push('tr.difficulty_filter = ?');
      params.push(difficulty);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countResult = await db.get(
      `SELECT COUNT(*) as total
       FROM agent_training_runs tr
       WHERE ${whereClause}`,
      params
    );

    // Get training runs with results
    const runs = await db.all(
      `SELECT
        tr.*,
        al.name as loadout_name,
        al.model as loadout_model,
        al.language as loadout_language
       FROM agent_training_runs tr
       LEFT JOIN agent_loadouts al ON tr.loadout_id = al.id
       WHERE ${whereClause}
       ORDER BY tr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get detailed results for each run
    const runsWithResults = await Promise.all(
      runs.map(async (run) => {
        const results = await db.all(
          `SELECT * FROM agent_training_results WHERE training_run_id = ?`,
          [run.id]
        );

        return {
          ...run,
          results: results.map(r => ({
            ...r,
            test_results: r.test_results ? JSON.parse(r.test_results) : []
          }))
        };
      })
    );

    // Calculate summary stats
    const stats = {
      totalRuns: countResult.total,
      totalProblems: 0,
      totalSolved: 0,
      totalTestsPassed: 0,
      totalTestsFailed: 0,
      averageSuccessRate: 0
    };

    if (runsWithResults.length > 0) {
      stats.totalProblems = runsWithResults.reduce((sum, r) => sum + (r.total_problems || 0), 0);
      stats.totalSolved = runsWithResults.reduce((sum, r) => sum + (r.problems_solved || 0), 0);
      stats.totalTestsPassed = runsWithResults.reduce((sum, r) => sum + (r.total_tests_passed || 0), 0);
      stats.totalTestsFailed = runsWithResults.reduce((sum, r) => sum + (r.total_tests_failed || 0), 0);

      const totalTests = stats.totalTestsPassed + stats.totalTestsFailed;
      stats.averageSuccessRate = totalTests > 0
        ? Math.round((stats.totalTestsPassed / totalTests) * 100)
        : 0;
    }

    res.json({
      runs: runsWithResults,
      pagination: {
        total: countResult.total,
        limit,
        offset,
        hasMore: offset + limit < countResult.total
      },
      stats
    });
  } catch (err) {
    logger.error('Failed to load training history:', err);
    next(err);
  }
});

/**
 * GET /api/agent/training/stats
 * Get overall training statistics for the user
 */
router.get('/stats', authMiddleware, listingLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;

    // Get overall stats
    const overallStats = await db.get(
      `SELECT
        COUNT(*) as total_runs,
        SUM(total_problems) as total_problems,
        SUM(problems_solved) as total_solved,
        SUM(total_tests_passed) as total_tests_passed,
        SUM(total_tests_failed) as total_tests_failed,
        SUM(total_tokens_used) as total_tokens_used,
        AVG(total_execution_time_ms) as avg_execution_time
       FROM agent_training_runs
       WHERE user_id = ? AND status = 'completed'`,
      [userId]
    );

    // Get stats by difficulty
    const difficultyStats = await db.all(
      `SELECT
        difficulty_filter,
        COUNT(*) as runs,
        SUM(problems_solved) as solved,
        SUM(total_problems) as total
       FROM agent_training_runs
       WHERE user_id = ? AND status = 'completed'
       GROUP BY difficulty_filter`,
      [userId]
    );

    // Get stats by loadout (top 5)
    const loadoutStats = await db.all(
      `SELECT
        al.id,
        al.name,
        al.model,
        COUNT(*) as runs,
        SUM(tr.problems_solved) as solved,
        SUM(tr.total_problems) as total
       FROM agent_training_runs tr
       JOIN agent_loadouts al ON tr.loadout_id = al.id
       WHERE tr.user_id = ? AND tr.status = 'completed'
       GROUP BY al.id
       ORDER BY solved DESC
       LIMIT 5`,
      [userId]
    );

    // Get recent activity (last 7 days)
    const recentActivity = await db.all(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as runs,
        SUM(problems_solved) as solved
       FROM agent_training_runs
       WHERE user_id = ?
         AND status = 'completed'
         AND created_at >= datetime('now', '-7 days')
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [userId]
    );

    // Calculate success rate
    const totalTests = (overallStats.total_tests_passed || 0) + (overallStats.total_tests_failed || 0);
    const successRate = totalTests > 0
      ? Math.round(((overallStats.total_tests_passed || 0) / totalTests) * 100)
      : 0;

    res.json({
      overall: {
        ...overallStats,
        success_rate: successRate,
        avg_execution_time: Math.round(overallStats.avg_execution_time || 0)
      },
      byDifficulty: difficultyStats.map(stat => ({
        ...stat,
        success_rate: stat.total > 0 ? Math.round((stat.solved / stat.total) * 100) : 0
      })),
      byLoadout: loadoutStats.map(stat => ({
        ...stat,
        success_rate: stat.total > 0 ? Math.round((stat.solved / stat.total) * 100) : 0
      })),
      recentActivity
    });
  } catch (err) {
    logger.error('Failed to load training stats:', err);
    next(err);
  }
});

/**
 * DELETE /api/agent/training/history/:runId
 * Delete a specific training run
 */
router.delete('/history/:runId', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const { runId } = req.params;

    // Verify ownership
    const run = await db.get(
      'SELECT id FROM agent_training_runs WHERE id = ? AND user_id = ?',
      [runId, userId]
    );

    if (!run) {
      return res.status(404).json({ error: 'Training run not found' });
    }

    // Delete (results will cascade)
    await db.run('DELETE FROM agent_training_runs WHERE id = ?', [runId]);

    logger.info(`Training run ${runId} deleted by user ${userId}`);

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete training run:', err);
    next(err);
  }
});

module.exports = router;
