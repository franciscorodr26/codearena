const express = require('express');
const logger = require('../utils/logger');
const db = require('../db');
const authRouter = require('./auth');
const badgeService = require('../services/badgeService');
const promptEngineeringLoader = require('../services/promptEngineeringLoader');
const { runPracticePrompt } = require('../services/promptPracticeRunner');
const { judgeModelOutput } = require('../services/promptJudgeScore');
const {
  getConsumerFairUseLimit
} = require('../../shared/codearenaProductMode');

const router = express.Router();
const authMiddleware = authRouter.authMiddleware;

/**
 * Detect if user's prompt is a copy-paste (or near-copy) of the problem text.
 * Uses word-level overlap ratio, catches exact copies and "change a few words" tricks.
 * Only triggers on prompts that are substantial enough to actually BE a copy-paste
 * (short lazy prompts are handled by the LLM judge scoring them low on prompt quality).
 * Returns a similarity ratio 0–1.
 */
function getPromptSimilarity(userPrompt, problem) {
  const normalize = (text) => {
    if (!text) return [];
    // Lowercase, strip punctuation, split into words, remove very short/common words
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3); // Skip words ≤3 chars (the, and, for, with, etc.)
  };

  const promptWordsList = normalize(userPrompt);
  // Must have at least 20 meaningful words to be considered a copy-paste.
  // Short prompts (even if words overlap) are just lazy, not copy-pasting.
  if (promptWordsList.length < 20) return 0;

  const promptWords = new Set(promptWordsList);

  // Combine all problem text the user has access to
  const problemText = [
    problem.description || '',
    problem.scenario || '',
    problem.targetOutput || ''
  ].join(' ');
  const problemWords = new Set(normalize(problemText));

  if (problemWords.size === 0) return 0;

  // What fraction of the user's prompt words appear in the problem text?
  let overlap = 0;
  for (const word of promptWords) {
    if (problemWords.has(word)) overlap++;
  }

  return overlap / promptWords.size;
}

/**
 * Detect if user's prompt is essentially just the problem's description/instruction line
 * (or a near-copy). This catches short copy-pastes that the main similarity check
 * would miss due to the 20-word minimum.
 */
function getDescriptionSimilarity(userPrompt, problem) {
  const normalize = (text) => {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  };

  const promptWords = normalize(userPrompt);
  // If user wrote a long prompt, it's not just copying the description
  if (promptWords.length > 30) return 0;
  // Need at least 4 words to compare
  if (promptWords.length < 4) return 0;

  const descWords = new Set(normalize(problem.description || ''));
  if (descWords.size < 4) return 0;

  const promptSet = new Set(promptWords);

  // Check both directions: how much of the prompt is in the description,
  // AND how much of the description is in the prompt
  let promptInDesc = 0;
  for (const word of promptSet) {
    if (descWords.has(word)) promptInDesc++;
  }

  let descInPrompt = 0;
  for (const word of descWords) {
    if (promptSet.has(word)) descInPrompt++;
  }

  // Use the higher of the two ratios, catches both exact copies and
  // slightly expanded versions of the description
  const ratio1 = promptInDesc / promptSet.size;    // what % of user's words come from desc
  const ratio2 = descInPrompt / descWords.size;     // what % of desc words are in user's prompt

  return Math.max(ratio1, ratio2);
}

/**
 * Detect if user's prompt is a copy (or near-copy) of the example/reference prompt.
 * Uses bidirectional word overlap, catches both direct copy-paste and versions
 * where the user deletes/edits a few words.
 */
function getExamplePromptSimilarity(userPrompt, problem) {
  if (!problem.examplePrompt) return 0;

  const normalize = (text) => {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  };

  const promptWords = normalize(userPrompt);
  if (promptWords.length < 10) return 0;

  const exampleWords = normalize(problem.examplePrompt);
  if (exampleWords.length < 5) return 0;

  const promptSet = new Set(promptWords);
  const exampleSet = new Set(exampleWords);

  // What fraction of user's words appear in the example prompt?
  let promptInExample = 0;
  for (const word of promptSet) {
    if (exampleSet.has(word)) promptInExample++;
  }

  // What fraction of example prompt words appear in user's prompt?
  let exampleInPrompt = 0;
  for (const word of exampleSet) {
    if (promptSet.has(word)) exampleInPrompt++;
  }

  const ratio1 = promptInExample / promptSet.size;
  const ratio2 = exampleInPrompt / exampleSet.size;

  return Math.max(ratio1, ratio2);
}

/**
 * GET /api/prompt-practice/challenges
 * List all prompt engineering problems (same pool as battles), optionally filtered by difficulty
 */
router.get('/challenges', (req, res) => {
  try {
    const all = promptEngineeringLoader.getAll();
    let challenges = all.map(p => ({
      id: p.id,
      title: p.title,
      difficulty: p.difficulty,
      category: p.category,
      description: p.description,
      scenario: p.scenario,
      targetOutput: p.targetOutput,
      hintsCount: p.hints?.length || 0,
      tierCount: p.modelOutputScoring?.tiers?.length || 0
    }));

    const { difficulty } = req.query;
    if (difficulty && difficulty !== 'All') {
      challenges = challenges.filter(c => c.difficulty === difficulty);
    }

    res.json({ modelConfigured: Boolean(process.env.ANTHROPIC_API_KEY), challenges });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error listing challenges:', err.message);
    res.status(500).json({ error: 'Failed to load challenges' });
  }
});

/**
 * GET /api/prompt-practice/challenges/:id
 * Get a single challenge by ID (strips examplePrompt for anti-cheat)
 */
router.get('/challenges/:id', (req, res) => {
  try {
    const problem = promptEngineeringLoader.getById(req.params.id);
    if (!problem) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Strip sensitive fields: examplePrompt, hints (progressive), modelOutputScoring (contains scoring keywords)
    const { examplePrompt, hints, modelOutputScoring, ...safeProblem } = problem;
    safeProblem.hintsCount = hints?.length || 0;
    // Send only tier labels and percentages (no check needles)
    if (modelOutputScoring?.tiers) {
      safeProblem.scoringTiers = modelOutputScoring.tiers.map(t => ({
        id: t.id, label: t.label, scorePercent: t.scorePercent
      }));
    }

    res.json({ challenge: safeProblem });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error getting challenge:', err.message);
    res.status(500).json({ error: 'Failed to load challenge' });
  }
});

/**
 * POST /api/prompt-practice/evaluate
 * Submit a prompt, runs it through the same model + scorer as battles
 */
router.post('/evaluate', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { challengeId, promptText, timeSpent, pasteDetected, tabSwitchCount } = req.body;

    if (!challengeId || !promptText) {
      return res.status(400).json({ error: 'challengeId and promptText are required' });
    }

    if (promptText.length > 12000) {
      return res.status(400).json({ error: 'Prompt text must be under 12000 characters' });
    }

    // Find the problem (same data as battles)
    const problem = promptEngineeringLoader.getById(challengeId);
    if (!problem) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const dailyLimit = getConsumerFairUseLimit('promptPracticeAttemptsPerDay');
    const globalDailyLimit = getConsumerFairUseLimit('globalPromptEvaluationsPerDay');

    // Detect copy-paste of problem text or example prompt (exact or near-copy with minor edits)
    const similarity = getPromptSimilarity(promptText, problem);
    const descSimilarity = getDescriptionSimilarity(promptText, problem);
    const exampleSimilarity = getExamplePromptSimilarity(promptText, problem);
    if (similarity >= 0.7 || descSimilarity >= 0.8 || exampleSimilarity >= 0.7) {
      // Record the attempt as 0% so it counts against daily limit
      try {
        await db.recordPromptAttempt(userId, {
          challengeId,
          promptText,
          score: 0,
          testsPassed: 0,
          testsTotal: 0,
          solved: false,
          timeSpent,
          pasteDetected: pasteDetected ? 1 : 0,
          tabSwitchCount: tabSwitchCount || 0
        });
      } catch (dbErr) {
        logger.warn('[PROMPT_PRACTICE] Failed to record copy-paste attempt:', dbErr.message);
      }

      return res.json({
        success: true,
        score: 0,
        solved: false,
        modelOutput: '',
        tierResults: [],
        passedTierId: null,
        rationale: 'Nice try, but no copy and pasting. Write your own prompt. The point is to practice crafting clear, specific instructions that get the AI to produce great output. Try adding format requirements, section structure, constraints, and success criteria.',
        criteria: [],
        newBadges: [],
        copyPasteDetected: true,
        attemptsRemaining: Math.max(0, dailyLimit - await db.getConsumerDailyUsage(
          'prompt_practice_evaluation',
          `user:${userId}`
        ))
      });
    }

    // Prompt evaluation invokes paid AI. Enforce both the per-user allowance
    // and a server-wide daily circuit breaker immediately before the model call.
    const promptQuota = await db.tryConsumeConsumerDailyUsage([
      { metric: 'prompt_practice_evaluation', subjectId: `user:${userId}`, limit: dailyLimit },
      { metric: 'prompt_evaluation', subjectId: 'global', limit: globalDailyLimit }
    ]);
    if (!promptQuota.allowed) {
      const globalLimitReached = promptQuota.reason === 'global_limit';
      return res.status(429).json({
        error: globalLimitReached
          ? 'CodeArena has reached today\'s prompt-evaluation capacity. Please try again tomorrow.'
          : `Daily fair-use limit reached (${dailyLimit} prompt evaluations). Try again tomorrow.`,
        limitReached: true,
        globalLimitReached,
        dailyLimit: globalLimitReached ? globalDailyLimit : dailyLimit,
        attemptsRemaining: 0
      });
    }
    const userQuota = promptQuota.usage.find(entry => entry.subjectId === `user:${userId}`);
    const attemptsRemaining = userQuota.remaining;

    // Run the user's prompt through the model (same as battle runner)
    let modelOutput;
    try {
      modelOutput = await runPracticePrompt(problem, promptText);
    } catch (runErr) {
      if (/not configured/i.test(runErr.message || '')) {
        return res.status(503).json({
          error: 'Prompt evaluation is not enabled on this server.',
          notConfigured: true,
          attemptsRemaining
        });
      }
      logger.error('[PROMPT_PRACTICE] Model run error:', runErr.message);
      return res.status(500).json({ error: 'Failed to run prompt. Please try again.', attemptsRemaining });
    }

    // Score with LLM judge (falls back to tiered scoring if API unavailable)
    const scoreResult = await judgeModelOutput(problem, modelOutput, promptText);

    // Apply paste penalty: cap score at 20% if paste was detected
    const rawScore = scoreResult.scorePercent;
    const pasteFlag = !!pasteDetected;
    const score = pasteFlag ? Math.min(rawScore, 20) : rawScore;
    const solved = score >= 70;

    // Map tier results to tests passed/total for DB storage
    const totalTiers = scoreResult.tierResults.length;
    const passedTiers = scoreResult.tierResults.filter(t => t.pass).length;

    // Record attempt
    try {
      await db.recordPromptAttempt(userId, {
        challengeId,
        promptText,
        score,
        testsPassed: passedTiers,
        testsTotal: totalTiers,
        solved,
        timeSpent,
        pasteDetected: pasteFlag ? 1 : 0,
        tabSwitchCount: tabSwitchCount || 0
      });
    } catch (dbErr) {
      logger.warn('[PROMPT_PRACTICE] Failed to record attempt:', dbErr.message);
    }

    // Check for new badges
    let newBadges = [];
    try {
      newBadges = await badgeService.checkAndAwardBadges(userId, { context: 'prompt_practice' });
    } catch (badgeErr) {
      logger.warn('[PROMPT_PRACTICE] Badge check failed:', badgeErr.message);
    }

    // Strip check needles from tier results (don't leak scoring keywords)
    const safeTierResults = (scoreResult.tierResults || []).map(tier => ({
      tierId: tier.tierId,
      label: tier.label,
      scorePercent: tier.scorePercent,
      pass: tier.pass,
      checks: (tier.checks || []).map(c => ({
        id: c.id,
        type: c.type,
        pass: c.pass,
        detail: c.detail
      }))
    }));

    res.json({
      success: true,
      score,
      solved,
      modelOutput,
      tierResults: safeTierResults,
      passedTierId: scoreResult.passedTierId,
      pastePenaltyApplied: pasteFlag,
      rationale: pasteFlag
        ? `[Score capped at 20%, paste detected. Write your own prompt.] ${scoreResult.rationale || ''}`
        : (scoreResult.rationale || ''),
      criteria: scoreResult.criteria || [],
      newBadges,
      attemptsRemaining
    });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Evaluation error:', err.message);
    res.status(500).json({ error: 'Evaluation failed. Please try again.' });
  }
});

/**
 * GET /api/prompt-practice/stats
 * Get user's prompt practice statistics
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const stats = await db.getPromptPracticeStats(userId);
    const allProblems = promptEngineeringLoader.getAll();
    const dailyLimit = getConsumerFairUseLimit('promptPracticeAttemptsPerDay');
    const attemptsToday = await db.getConsumerDailyUsage('prompt_practice_evaluation', `user:${userId}`);

    res.json({
      ...stats,
      totalChallenges: allProblems.length,
      dailyLimit,
      attemptsToday,
      attemptsRemaining: Math.max(0, dailyLimit - attemptsToday)
    });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error getting stats:', err.message);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

/**
 * GET /api/prompt-practice/stats/:username
 * Get a specific user's public prompt practice statistics (for profile pages)
 */
router.get('/stats/:username', async (req, res) => {
  try {
    const user = await db.getUserByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const stats = await db.getPromptPracticeStats(user.id);
    const allProblems = promptEngineeringLoader.getAll();

    res.json({
      ...stats,
      totalChallenges: allProblems.length
    });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error getting user stats:', err.message);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

/**
 * GET /api/prompt-practice/hints/:id/:index
 * Get a hint for a challenge
 */
router.get('/hints/:id/:index', authMiddleware, (req, res) => {
  try {
    const problem = promptEngineeringLoader.getById(req.params.id);
    if (!problem) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= (problem.hints?.length || 0)) {
      return res.status(400).json({ error: 'Invalid hint index' });
    }

    res.json({ hint: problem.hints[index], index, total: problem.hints.length });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error getting hint:', err.message);
    res.status(500).json({ error: 'Failed to load hint' });
  }
});

/**
 * GET /api/prompt-practice/solution/:id
 * Get the example prompt (only if user has solved the challenge with score >= 70)
 */
router.get('/solution/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const problem = promptEngineeringLoader.getById(req.params.id);
    if (!problem) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Check if user has solved this challenge
    const stats = await db.getPromptPracticeStats(userId);
    const solvedIds = (stats.byCategory || []).filter(c => c.solved).map(c => c.challenge_id);

    if (!solvedIds.includes(req.params.id)) {
      return res.status(403).json({ error: 'Score 70%+ to view the example prompt' });
    }

    res.json({ examplePrompt: problem.examplePrompt || null });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error getting solution:', err.message);
    res.status(500).json({ error: 'Failed to load solution' });
  }
});

/**
 * GET /api/prompt-practice/challenges/:id/history
 * Get user's attempt history for a specific challenge
 */
router.get('/challenges/:id/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const challengeId = req.params.id;

    const problem = promptEngineeringLoader.getById(challengeId);
    if (!problem) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const attempts = await db.all(
      `SELECT id, score, tests_passed, tests_total, solved, time_spent, created_at
       FROM prompt_attempts
       WHERE user_id = ? AND challenge_id = ?
       ORDER BY created_at DESC`,
      [userId, challengeId]
    );

    const totalAttempts = attempts.length;
    const bestScore = totalAttempts > 0 ? Math.max(...attempts.map(a => a.score)) : null;
    const solved = attempts.some(a => a.solved === 1);

    res.json({
      summary: { totalAttempts, bestScore, solved },
      attempts
    });
  } catch (err) {
    logger.error('[PROMPT_PRACTICE] Error getting challenge history:', err.message);
    res.status(500).json({ error: 'Failed to load challenge history' });
  }
});

module.exports = router;
