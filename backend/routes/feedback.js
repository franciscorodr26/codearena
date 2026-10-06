const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const problemsLoader = require('../problemsLoader');
const logger = require('../utils/logger');
const { getComplexityPercentile } = require('../utils/complexityRank');
const { getConsumerFairUseLimit } = require('../../shared/codearenaProductMode');

// CodeArena keeps lightweight feedback collection and deterministic complexity
// feedback. Behavioral session capture and standalone AI coaching/review were
// retired and are deliberately unreachable.
const DISABLED_COACH_PATHS = [
  '/coach',
  '/profile',
  '/code',
  '/insights',
  '/milestones',
  '/digest',
  '/categories',
  '/hint',
  '/review',
  '/recommendations',
  '/chat',
  '/evaluate-explanation',
  '/analyze-battle',
  '/rank-comparison',
  '/weekly-progress',
  '/subscription',
  '/session'
];

router.use((req, res, next) => {
  // Express route matching is case-insensitive by default. Normalize here too,
  // otherwise a mixed-case path can bypass this retired-surface guard.
  const requestPath = String(req.path || '').toLowerCase();
  const disabled = DISABLED_COACH_PATHS.some(path => requestPath === path || requestPath.startsWith(`${path}/`));
  if (disabled) return res.status(404).json({ error: 'Not found' });
  return next();
});

// Rate limiter for AI-powered endpoints (expensive external API calls)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute per user (reduced from 10 for cost control)
  message: { error: 'Too many AI requests. Please wait a moment before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip), // Rate limit by user ID if authenticated
});

const { SECRET } = require('../config/jwt');
const { sessionUserFromRequest } = require('../utils/sessionAuthentication');

// Create a map for quick problem lookup (initialized once at module load)
// Using a getter function to handle case where problems aren't loaded yet
let problemMap = null;
let problemMapInitialized = false;
function getProblemMap() {
  if (!problemMapInitialized) {
    const problems = problemsLoader.getAll();
    if (problems.length > 0) {
      problemMap = new Map(problems.map(p => [p.id, p]));
      problemMapInitialized = true;
    }
  }
  return problemMap || new Map();
}

// Helper to format seconds to readable time (mm:ss or "X min Y sec")
function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);

  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m`;
  }

  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

// Helper to extract the first JSON object or array from a string (handles markdown code blocks)
function extractFirstJSON(text) {
  if (!text) return null;
  try {
    // Try parsing the whole string first
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch { /* fall through */ }
    }
    // Try finding first { ... } or [ ... ]
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch { /* fall through */ }
    }
    return null;
  }
}

// Helper to get problem title from ID
function getProblemTitle(problemId) {
  // Try direct lookup
  const problem = getProblemMap().get(problemId);
  if (problem) return problem.title;

  // Handle legacy "prob_XXX" format - extract number and find by index
  const match = problemId?.match(/prob_(\d+)/);
  if (match) {
    const index = parseInt(match[1], 10) - 1;
    const allProblems = problemsLoader.getAll();
    if (index >= 0 && index < allProblems.length) {
      return allProblems[index].title;
    }
  }

  // Fallback: humanize the ID
  return problemId?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown Problem';
}

// Initialize Anthropic client with 30-second timeout
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30000, // 30 seconds
  maxRetries: 2
});

// ============================================
// MIDDLEWARE
// ============================================

// Auth middleware
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  // Signature alone is not enough: the session must still exist and match the
  // current credential generation (logout, password change, 2FA pending).
  const user = await sessionUserFromRequest(req, db, SECRET);
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
};

// Pro-only middleware - requires Pro subscription
const proOnlyMiddleware = async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const isPro = await db.isUserPro(userId);

    if (!isPro) {
      // Return teaser data for free users
      const basicStats = await getBasicStatsForTeaser(userId);
      return res.status(403).json({
        error: 'Pro subscription required',
        isPro: false,
        teaser: basicStats,
        upgradeMessage: 'Unlock AI Coach Pro to get personalized insights, weekly digests, and detailed analysis of your coding patterns.'
      });
    }

    req.isPro = true;
    next();
  } catch (err) {
    logger.error('[AI COACH] Pro check error:', err);
    return res.status(500).json({ error: 'Failed to verify subscription' });
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get basic stats for free users (teaser to encourage upgrade)
 */
async function getBasicStatsForTeaser(userId) {
  const [practiceStats, battleStats, sessions] = await Promise.all([
    db.getPracticeStats(userId),
    db.getUserStats(userId),
    db.getUserCodingSessions(userId, 10)
  ]);

  return {
    problemsSolved: practiceStats?.stats?.problems_solved || 0,
    battlesWon: battleStats?.wins || 0,
    totalBattles: battleStats?.total_battles || 0,
    sessionsTracked: sessions?.length || 0,
    // Blurred/locked preview
    lockedFeatures: [
      '🧠 Personalized Coder Profile',
      '📊 Behavioral Analysis',
      '💡 AI-Powered Insights',
      '📈 Weekly Progress Digests',
      '🎯 Problem Recommendations'
    ]
  };
}

/**
 * Determine coder archetype based on behavioral patterns
 */
function determineArchetype(behavioralStats, sessionPatterns) {
  const {
    avg_thinking_time: thinkingTime,
    avg_revisions: revisions,
    typing_ratio: typingRatio,
    total_pastes: pastes
  } = behavioralStats || {};

  const totalSessions = sessionPatterns?.totalSessions || 0;
  const pasteRate = totalSessions > 0 ? (pastes || 0) / totalSessions : 0;

  // Archetype classification based on patterns
  if (thinkingTime > 30 && revisions < 3 && typingRatio < 0.5) {
    return {
      archetype: 'Methodical Planner',
      description: 'You think deeply before coding, leading to clean first drafts.',
      icon: '🎯',
      confidence: 0.85
    };
  }

  if (thinkingTime < 10 && revisions > 5) {
    return {
      archetype: 'Rapid Prototyper',
      description: 'You dive in quickly and iterate fast. Move fast and break things!',
      icon: '🚀',
      confidence: 0.8
    };
  }

  if (typingRatio > 0.7 && revisions < 4) {
    return {
      archetype: 'Flow State Coder',
      description: 'When you code, you code. High focus and steady output.',
      icon: '🌊',
      confidence: 0.8
    };
  }

  if (pasteRate > 2) {
    return {
      archetype: 'Pattern Matcher',
      description: 'You leverage existing code patterns effectively.',
      icon: '🔄',
      confidence: 0.75
    };
  }

  if (thinkingTime > 20 && revisions > 4) {
    return {
      archetype: 'Perfectionist',
      description: 'You value quality over speed and refine until it\'s right.',
      icon: '💎',
      confidence: 0.75
    };
  }

  // Default for new users or mixed patterns
  return {
    archetype: 'Adaptive Learner',
    description: 'Your coding style is evolving. Keep practicing to reveal your true archetype!',
    icon: '🌱',
    confidence: 0.5
  };
}

/**
 * Build comprehensive context for AI analysis
 */
async function buildComprehensiveContext(userId) {
  const data = await db.getComprehensiveCoachingData(userId);

  // Calculate derived metrics
  const totalPractice = data.practiceStats?.stats?.problems_solved || 0;
  const battleWinRate = (data.battleStats?.wins + data.battleStats?.losses) > 0
    ? Math.round((data.battleStats.wins / (data.battleStats.wins + data.battleStats.losses)) * 100)
    : 0;

  // Session patterns
  const solvedSessions = data.recentSessions.filter(s => s.solved);
  const avgSolveTime = solvedSessions.length > 0
    ? Math.round(solvedSessions.reduce((sum, s) => sum + (s.total_duration || 0), 0) / solvedSessions.length)
    : null;

  // Determine archetype
  const archetype = determineArchetype(data.behavioralStats, {
    totalSessions: data.recentSessions.length
  });

  return {
    userId,
    profile: data.profile,
    archetype,
    behavioral: {
      thinkingTime: Math.round(data.behavioralStats?.avg_thinking_time || 0),
      typingRatio: Math.round((data.behavioralStats?.typing_ratio || 0) * 100),
      avgRevisions: Math.round(data.behavioralStats?.avg_revisions || 0),
      totalSessions: data.recentSessions.length,
      solvedSessions: solvedSessions.length,
      avgSolveTime
    },
    performance: {
      practiceSolved: totalPractice,
      battleWins: data.battleStats?.wins || 0,
      battleLosses: data.battleStats?.losses || 0,
      battleWinRate,
      rating: data.battleStats?.rating || 1000,
      winStreak: data.battleStats?.win_streak || 0
    },
    categoryStats: data.categoryStats,
    recentSessions: data.recentSessions.slice(0, 10),
    existingInsights: data.activeInsights,
    milestones: data.recentMilestones
  };
}

// ============================================
// CODER ARCHETYPES
// ============================================

const CODER_ARCHETYPES = {
  'Methodical Planner': {
    strengths: ['Clean code on first attempt', 'Fewer bugs', 'Strong algorithmic thinking'],
    challenges: ['May over-think simple problems', 'Time pressure in battles'],
    tips: ['Trust your planning instincts', 'Set time limits for thinking phase', 'Practice timed challenges']
  },
  'Rapid Prototyper': {
    strengths: ['Fast to working solution', 'Good under time pressure', 'Flexible thinking'],
    challenges: ['May introduce bugs', 'Code might need cleanup'],
    tips: ['Add a quick review step before submitting', 'Write tests mentally first', 'Pause briefly before starting']
  },
  'Flow State Coder': {
    strengths: ['High productivity', 'Consistent output', 'Deep focus'],
    challenges: ['May miss edge cases when in flow', 'Can over-engineer'],
    tips: ['Take micro-breaks to zoom out', 'Review edge cases checklist', 'Set strategic breakpoints']
  },
  'Pattern Matcher': {
    strengths: ['Efficient use of existing solutions', 'Quick to recognize patterns', 'Pragmatic approach'],
    challenges: ['May miss novel approaches', 'Over-reliance on memorized patterns'],
    tips: ['Challenge yourself with unfamiliar problem types', 'Try to derive solutions from first principles occasionally']
  },
  'Perfectionist': {
    strengths: ['High code quality', 'Thorough edge case handling', 'Reliable solutions'],
    challenges: ['Time management', 'May over-optimize'],
    tips: ['Set a "good enough" threshold', 'Submit working solution first, then refine', 'Time-box your refinement phase']
  },
  'Adaptive Learner': {
    strengths: ['Flexible approach', 'Open to different strategies', 'Growing skill set'],
    challenges: ['Style still developing', 'May be inconsistent'],
    tips: ['Try different approaches intentionally', 'Track what works for you', 'Build a consistent routine']
  }
};

// ============================================
// AI ANALYSIS FUNCTIONS
// ============================================

/**
 * Generate comprehensive AI coaching analysis
 */
async function generateCoachingAnalysis(context) {
  const prompt = `You are an expert coding coach analyzing a competitive programmer's data. Your goal is to provide insightful, actionable feedback that helps them improve.

## Coder Profile:
- Archetype: ${context.archetype.archetype} (${context.archetype.icon})
- Archetype Confidence: ${Math.round(context.archetype.confidence * 100)}%

## Behavioral Patterns:
- Average thinking time before coding: ${formatTime(context.behavioral.thinkingTime)}
- Time spent actively typing: ${context.behavioral.typingRatio}% of session
- Average code revisions per problem: ${context.behavioral.avgRevisions}
- Total sessions tracked: ${context.behavioral.totalSessions}
- Problems solved: ${context.behavioral.solvedSessions}/${context.behavioral.totalSessions}
- Average solve time: ${context.behavioral.avgSolveTime ? formatTime(context.behavioral.avgSolveTime) : 'N/A'}

## Battle Performance:
- Rating: ${context.performance.rating}
- Win/Loss: ${context.performance.battleWins}W - ${context.performance.battleLosses}L (${context.performance.battleWinRate}% win rate)
- Current streak: ${context.performance.winStreak}

## Practice Performance:
- Problems solved in practice: ${context.performance.practiceSolved}

## Category Performance:
${context.categoryStats.map(c => `- ${c.category}: ${c.problems_solved}/${c.problems_attempted} solved (${Math.round(c.problems_solved * 100 / c.problems_attempted)}%)`).join('\n') || 'No category data yet'}

## Recent Sessions:
${context.recentSessions.slice(0, 5).map(s =>
  `- "${getProblemTitle(s.problem_id)}": ${s.solved ? '✓ Solved' : '✗ Attempted'} in ${s.total_duration || '?'}s, ${s.revision_count || 0} revisions`
).join('\n') || 'No recent sessions'}

Based on this data, provide coaching feedback in this exact JSON format:
{
  "overallAssessment": "2-3 sentence personalized assessment of their coding approach and current level",
  "keyStrengths": [
    {"strength": "Specific strength", "evidence": "Based on what data point"}
  ],
  "growthAreas": [
    {"area": "Specific improvement area", "currentState": "Current observation", "targetState": "Where they should aim"}
  ],
  "weeklyFocus": "One specific thing to focus on this week with a concrete goal",
  "strategicAdvice": [
    "Specific tactical advice 1",
    "Specific tactical advice 2"
  ],
  "practiceRecommendation": {
    "category": "Problem category to focus on",
    "reason": "Why this category",
    "goal": "Specific measurable goal"
  },
  "motivationalNote": "Brief encouraging message based on their progress"
}

CRITICAL: Output ONLY the JSON object. Do not include any preamble, explanation, thinking, or commentary before or after the JSON. Do not say "Here is the feedback" or similar. Start your response with the opening brace { and end with the closing brace }.

Be specific, use the data to back up your observations, and focus on actionable advice. Avoid generic platitudes.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]    });

    const content = response.content?.[0]?.text;
    if (!content) {
      logger.error('[AI COACH] Empty response from Anthropic API');
      throw new Error('Empty response from AI');
    }

    const parsed = extractFirstJSON(content);

    if (parsed) {
      return parsed;
    }

    throw new Error('Failed to parse AI response');
  } catch (err) {
    logger.error('[AI COACH] Analysis error:', err);
    throw err;
  }
}

/**
 * Generate quick feedback on specific code
 */
async function generateCodeFeedback(code, language, problemContext) {
  try {
    const prompt = `Analyze this ${language} solution for the problem "${problemContext.title || 'Coding Challenge'}".

## Problem:
${problemContext.description || 'A competitive programming problem'}

## Solution:
\`\`\`${language}
${code}
\`\`\`

Provide brief, actionable feedback in JSON:
{
  "verdict": "Good/Needs Improvement/Review",
  "complexity": {"time": "O(?)", "space": "O(?)"},
  "highlights": ["What they did well (max 2)"],
  "improvements": ["Specific improvement (max 2)"],
  "alternativeApproach": "Brief mention if there's a better approach (or null)",
  "oneThingToRemember": "Single most important takeaway"
}

IMPORTANT: Output ONLY the JSON object. No preamble, no explanation, no thinking. Start with { and end with }.

Be concise and practical.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]    });

    const content = response.content?.[0]?.text;
    if (!content) {
      logger.error('[AI FEEDBACK] Empty response from Anthropic API');
      throw new Error('Empty response from AI');
    }

    const parsed = extractFirstJSON(content);

    if (parsed) {
      return parsed;
    }

    throw new Error('Failed to parse code feedback');
  } catch (err) {
    logger.error('[AI FEEDBACK] Code feedback error:', err?.message || err || 'Unknown error');

    // Classify error for better user feedback
    const errorMessage = err?.message || '';
    const statusCode = err?.status || err?.statusCode;

    if (statusCode === 401 || errorMessage.includes('authentication') || errorMessage.includes('API key')) {
      const error = new Error('AI service authentication failed. Please contact support.');
      error.code = 'AUTH_ERROR';
      throw error;
    } else if (statusCode === 429 || errorMessage.includes('rate limit')) {
      const error = new Error('AI service is busy. Please try again in a moment.');
      error.code = 'RATE_LIMIT';
      throw error;
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNREFUSED')) {
      const error = new Error('AI service is temporarily unavailable. Please try again.');
      error.code = 'NETWORK_ERROR';
      throw error;
    } else if (errorMessage.includes('parse') || errorMessage.includes('JSON')) {
      const error = new Error('Failed to process AI response. Please try again.');
      error.code = 'PARSE_ERROR';
      throw error;
    }

    throw err;
  }
}

/**
 * Generate weekly digest using AI
 */
async function generateWeeklyDigest(userId, weekData) {
  const prompt = `Generate a weekly progress digest for a competitive programmer.

## This Week's Stats:
- Sessions: ${weekData.sessions}
- Problems Solved: ${weekData.solved}/${weekData.attempted}
- Total coding time: ${Math.round(weekData.totalTime / 60)} minutes
- Battle record: ${weekData.battleWins}W - ${weekData.battleLosses}L
- Rating change: ${weekData.ratingChange > 0 ? '+' : ''}${weekData.ratingChange}

## Compared to Last Week:
- Sessions: ${weekData.sessionsChange > 0 ? '+' : ''}${weekData.sessionsChange}
- Solve rate: ${weekData.solveRateChange > 0 ? '+' : ''}${weekData.solveRateChange}%
- Time: ${weekData.timeChange > 0 ? '+' : ''}${Math.round(weekData.timeChange / 60)} min

## Notable Events:
${weekData.notableEvents.join('\n') || 'Regular practice week'}

Provide a personalized weekly digest in JSON:
{
  "headline": "Catchy 5-7 word summary of the week",
  "summary": "2-3 sentence overview of their week",
  "winOfTheWeek": "Their biggest achievement this week",
  "focusForNextWeek": "One specific thing to work on",
  "motivationalQuote": "Brief motivating message",
  "trend": "improving/steady/declining"
}

IMPORTANT: Output ONLY the JSON object. No preamble or explanation. Start with { and end with }.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0].text;
  const parsed = extractFirstJSON(content);

  if (parsed) {
    return parsed;
  }

  throw new Error('Failed to generate weekly digest');
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/feedback/coach
 * Get comprehensive AI coaching analysis (Pro only)
 */
router.get('/coach', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;
    const forceRefresh = req.query.refresh === 'true';
    const aiEnabled = !!process.env.ANTHROPIC_API_KEY;

    // Check cache first (unless force refresh) - only if AI is enabled
    if (aiEnabled && !forceRefresh) {
      const cached = await db.getCachedAIFeedback(userId, 'comprehensive');
      if (cached) {
        return res.json({
          success: true,
          cached: true,
          aiAnalysisAvailable: true,
          ...cached
        });
      }
    }

    // Build comprehensive context
    const context = await buildComprehensiveContext(userId);

    // Check if user has enough data (just 1 session needed for immediate value)
    if (context.behavioral.totalSessions < 1) {
      return res.json({
        success: true,
        needsMoreData: true,
        archetype: context.archetype,
        message: 'Complete one practice problem or battle to unlock your personalized AI coaching.',
        sessionsCompleted: context.behavioral.totalSessions,
        sessionsNeeded: 1
      });
    }

    // Get archetype-specific tips
    const archetypeTips = CODER_ARCHETYPES[context.archetype.archetype] || CODER_ARCHETYPES['Adaptive Learner'];

    // Generate AI analysis only if API key is configured
    let analysis = null;
    if (aiEnabled) {
      try {
        analysis = await generateCoachingAnalysis(context);
      } catch (aiError) {
        logger.error('[AI COACH] AI analysis failed:', aiError.message);
        // Continue without AI analysis
      }
    }

    // Update coder profile with new data
    await db.updateCoderProfile(userId, {
      archetype: context.archetype.archetype,
      archetypeConfidence: context.archetype.confidence,
      avgThinkingTime: context.behavioral.thinkingTime,
      avgRevisionCount: context.behavioral.avgRevisions,
      sessionsAnalyzed: context.behavioral.totalSessions
    });

    // Check for new milestones
    const newMilestones = await db.checkForNewMilestones(userId, {
      totalSolved: context.performance.practiceSolved + context.performance.battleWins,
      fastestSolve: context.behavioral.avgSolveTime,
      winStreak: context.performance.winStreak
    });

    // Build response
    const response = {
      success: true,
      cached: false,
      aiAnalysisAvailable: aiEnabled && !!analysis,
      analyzedAt: new Date().toISOString(),
      archetype: {
        ...context.archetype,
        ...archetypeTips
      },
      behavioral: context.behavioral,
      performance: context.performance,
      analysis,
      categoryBreakdown: context.categoryStats,
      milestones: context.milestones,
      newMilestones: newMilestones.length > 0 ? newMilestones : undefined
    };

    // Cache the response (6 hours) - only cache if AI analysis was successful
    if (aiEnabled && analysis) {
      await db.cacheAIFeedback(userId, 'comprehensive', response, 6);
    }

    res.json(response);

  } catch (err) {
    logger.error('[AI COACH] Error:', err);
    res.status(500).json({
      error: 'Failed to generate coaching analysis',
      success: false
    });
  }
});

/**
 * GET /api/feedback/profile
 * Get coder profile (basic data available for all, full for Pro)
 */
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const isPro = await db.isUserPro(userId);

    // Get basic profile data
    const [profile, behavioralStats, practiceStats, battleStats] = await Promise.all([
      db.getCoderProfile(userId),
      db.getUserBehavioralStats(userId),
      db.getPracticeStats(userId),
      db.getUserStats(userId)
    ]);

    // Calculate archetype
    const archetype = determineArchetype(behavioralStats, {
      totalSessions: behavioralStats?.total_sessions || 0
    });

    // Basic response for everyone
    const response = {
      success: true,
      isPro,
      archetype: {
        name: archetype.archetype,
        icon: archetype.icon,
        description: archetype.description,
        confidence: archetype.confidence
      },
      stats: {
        practiceProblems: practiceStats?.stats?.problems_solved || 0,
        battlesWon: battleStats?.wins || 0,
        rating: battleStats?.rating || 1000,
        sessionsTracked: behavioralStats?.total_sessions || 0
      }
    };

    // Pro users get additional insights
    if (isPro) {
      const archetypeTips = CODER_ARCHETYPES[archetype.archetype] || CODER_ARCHETYPES['Adaptive Learner'];
      const [categoryStats, insights, milestones] = await Promise.all([
        db.getProblemCategoryStats(userId),
        db.getActiveInsights(userId, 5),
        db.getRecentMilestones(userId, 5)
      ]);

      response.proFeatures = {
        behavioral: {
          avgThinkingTime: Math.round(behavioralStats?.avg_thinking_time || 0),
          avgTypingRatio: Math.round((behavioralStats?.typing_ratio || 0) * 100),
          avgRevisions: Math.round(behavioralStats?.avg_revisions || 0)
        },
        archetypeDetails: archetypeTips,
        categoryStats: categoryStats.slice(0, 5),
        activeInsights: insights,
        recentMilestones: milestones
      };
    }

    res.json(response);

  } catch (err) {
    logger.error('[AI COACH] Profile error:', err);
    res.status(500).json({ error: 'Failed to get profile', success: false });
  }
});

/**
 * POST /api/feedback/code
 * Get AI feedback on specific code (Pro only)
 */
router.post('/code', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const { code, language, problemId, problemTitle, problemDescription } = req.body;

    if (!code || !language) {
      return res.status(400).json({
        error: 'Code and language are required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI feedback is not configured',
        success: false
      });
    }

    const feedback = await generateCodeFeedback(code, language, {
      title: problemTitle,
      description: problemDescription
    });

    res.json({
      success: true,
      feedback
    });

  } catch (err) {
    logger.error('[AI COACH] Code analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze code', success: false });
  }
});

/**
 * GET /api/feedback/insights
 * Get active coaching insights (Pro only)
 */
router.get('/insights', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const insights = await db.getActiveInsights(userId, 10);

    res.json({
      success: true,
      insights
    });
  } catch (err) {
    logger.error('[AI COACH] Insights error:', err);
    res.status(500).json({ error: 'Failed to get insights', success: false });
  }
});

/**
 * POST /api/feedback/insights/:id/dismiss
 * Dismiss an insight
 */
router.post('/insights/:id/dismiss', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    // SECURITY: verify the insight belongs to the requesting user before
    // mutating it. db.dismissInsight has no user scoping (db.js owned by
    // another agent), so we enforce ownership here. See Bug M4.
    const insight = await db.get(
      'SELECT user_id FROM coaching_insights WHERE id = ?',
      [req.params.id]
    );
    if (!insight) {
      return res.status(404).json({ error: 'Insight not found', success: false });
    }
    if (String(insight.user_id) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'Forbidden', success: false });
    }
    await db.dismissInsight(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('[AI COACH] Dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss insight', success: false });
  }
});

/**
 * GET /api/feedback/milestones
 * Get learning milestones (Pro only)
 */
router.get('/milestones', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const milestones = await db.getRecentMilestones(userId, 20);

    res.json({
      success: true,
      milestones
    });
  } catch (err) {
    logger.error('[AI COACH] Milestones error:', err);
    res.status(500).json({ error: 'Failed to get milestones', success: false });
  }
});

/**
 * GET /api/feedback/digest
 * Get weekly digest (Pro only)
 */
router.get('/digest', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const digests = await db.getRecentDigests(userId, 4);

    res.json({
      success: true,
      digests
    });
  } catch (err) {
    logger.error('[AI COACH] Digest error:', err);
    res.status(500).json({ error: 'Failed to get digest', success: false });
  }
});

/**
 * GET /api/feedback/categories
 * Get problem category stats (Pro only)
 */
router.get('/categories', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const [all, weak, strong] = await Promise.all([
      db.getProblemCategoryStats(userId),
      db.getWeakCategories(userId, 3),
      db.getStrongCategories(userId, 3)
    ]);

    res.json({
      success: true,
      categories: all,
      weakAreas: weak,
      strengths: strong
    });
  } catch (err) {
    logger.error('[AI COACH] Categories error:', err);
    res.status(500).json({ error: 'Failed to get categories', success: false });
  }
});

/**
 * POST /api/feedback/session/start
 * Start tracking a coding session
 */
router.post('/session/start', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { problemId, sessionType, language, problemDifficulty, problemCategory } = req.body;

    if (!problemId || !sessionType || !language) {
      return res.status(400).json({
        error: 'problemId, sessionType, and language are required',
        success: false
      });
    }

    const sessionId = await db.startCodingSession(userId, {
      problemId,
      sessionType,
      language
    });

    res.json({
      success: true,
      sessionId
    });
  } catch (err) {
    logger.error('[AI COACH] Session start error:', err);
    res.status(500).json({ error: 'Failed to start session', success: false });
  }
});

/**
 * POST /api/feedback/session/:id/update
 * Update session with behavioral metrics
 */
router.post('/session/:id/update', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const metrics = req.body;

    // SECURITY: verify session ownership before mutating. db.updateCodingSession
    // updates by id alone, enforce user scoping at the route layer. See Bug M4.
    const session = await db.get(
      'SELECT user_id FROM coding_sessions WHERE id = ?',
      [sessionId]
    );
    if (!session) {
      return res.status(404).json({ error: 'Session not found', success: false });
    }
    if (String(session.user_id) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'Forbidden', success: false });
    }

    await db.updateCodingSession(sessionId, metrics);

    res.json({ success: true });
  } catch (err) {
    logger.error('[AI COACH] Session update error:', err);
    res.status(500).json({ error: 'Failed to update session', success: false });
  }
});

/**
 * POST /api/feedback/session/:id/end
 * End a coding session
 */
router.post('/session/:id/end', authMiddleware, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { solved, finalCode, firstKeystrokeDelay, problemCategory } = req.body;

    // SECURITY: verify session ownership before mutating. See Bug M4.
    const ownerCheck = await db.get(
      'SELECT user_id FROM coding_sessions WHERE id = ?',
      [sessionId]
    );
    if (!ownerCheck) {
      return res.status(404).json({ error: 'Session not found', success: false });
    }
    if (String(ownerCheck.user_id) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'Forbidden', success: false });
    }

    await db.endCodingSession(sessionId, {
      solved,
      finalCode,
      firstKeystrokeDelay
    });

    // Update category stats if category provided
    if (problemCategory) {
      const userId = req.user.sub;
      // Get solve time from session
      const session = await db.get('SELECT total_duration FROM coding_sessions WHERE id = ?', [sessionId]);
      await db.updateProblemCategoryStats(userId, problemCategory, {
        solved,
        solveTime: session?.total_duration
      });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('[AI COACH] Session end error:', err);
    res.status(500).json({ error: 'Failed to end session', success: false });
  }
});

/**
 * GET /api/feedback/subscription
 * Check Pro subscription status
 */
router.get('/subscription', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;
    const [isPro, subscription] = await Promise.all([
      db.isUserPro(userId),
      db.getUserSubscription(userId)
    ]);

    res.json({
      success: true,
      isPro,
      expiresAt: subscription?.pro_expires_at,
      features: isPro ? [
        'Full AI Coaching Analysis',
        'Personalized Coder Profile',
        'Problem Category Analytics',
        'Weekly Progress Digests',
        'Learning Milestones',
        'Code Feedback on Submissions',
        'Real-time Coaching Hints'
      ] : []
    });
  } catch (err) {
    logger.error('[AI COACH] Subscription check error:', err);
    res.status(500).json({ error: 'Failed to check subscription', success: false });
  }
});

// ============================================
// REAL-TIME COACHING (Exceptional AI Features)
// ============================================

/**
 * Generate contextual coaching hint based on current code state
 * This is the "godly" real-time coaching feature
 */
async function generateRealTimeHint(context) {
  const { code, language, problem, archetype, stuckDuration, lineCount, errorHint } = context;

  const prompt = `You are an expert coding coach providing real-time guidance. A ${archetype || 'coder'} is working on a problem and may need a hint.

## Problem:
${problem.title} (${problem.difficulty})
${problem.description}

## Their Current Code (${language}):
\`\`\`${language}
${code || '// No code written yet'}
\`\`\`

## Context:
- Lines written: ${lineCount || 0}
- Time stuck without progress: ${formatTime(stuckDuration || 0)}
${errorHint ? `- Recent error: ${errorHint}` : ''}

## Your Task:
Provide a SINGLE helpful hint. Do NOT give away the solution. The hint should:
1. Guide them toward the right approach without solving it
2. Be specific to their current code state
3. Match the ${problem.difficulty} difficulty level (don't over-explain for Easy, provide more scaffolding for Hard)

Respond with JSON:
{
  "hint": "Your concise, helpful hint (1-2 sentences max)",
  "hintType": "approach|syntax|optimization|edge-case|encouragement",
  "confidence": 0.0-1.0,
  "shouldShow": true/false
}

Rules:
- If code is empty and stuckDuration < 30s, set shouldShow: false (let them think first)
- If code is good and on track, give encouragement hint
- If they're stuck, provide gentle nudge toward solution approach
- NEVER give the complete solution or exact code to write`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]    });

    const content = response.content?.[0]?.text;
    if (!content) {
      logger.error('[AI HINT] Empty response from Anthropic API');
      return { hint: null, shouldShow: false, error: true };
    }

    const parsed = extractFirstJSON(content);

    if (parsed) {
      return parsed;
    }

    return { hint: null, shouldShow: false };
  } catch (err) {
    logger.error('[AI COACH] Hint generation error:', err);
    return { hint: null, shouldShow: false, error: true };
  }
}

/**
 * Generate comprehensive code review after solving
 */
async function generateComprehensiveReview(context) {
  const { code, language, problem, solveTime, testResults, archetype } = context;

  const allPassed = (testResults?.length > 0 && testResults.every(t => t.passed)) || false;

  const prompt = `You are an expert coding mentor reviewing a ${archetype || 'student'}'s solution.

## Problem:
${problem.title} (${problem.difficulty})
${problem.description}

## Their Solution (${language}):
\`\`\`${language}
${code}
\`\`\`

## Results:
- All tests passed: ${allPassed ? 'Yes' : 'No'}
- Solve time: ${formatTime(solveTime)}
${testResults ? `- Test results: ${testResults.filter(t => t.passed).length}/${testResults.length} passed` : ''}

Provide a comprehensive yet concise code review in JSON:
{
  "overallScore": 1-10,
  "verdict": "Excellent|Good|Needs Improvement|Review Required",
  "complexityAnalysis": {
    "time": "O(?)",
    "space": "O(?)",
    "isOptimal": true/false,
    "explanation": "Brief explanation of complexity"
  },
  "codeQuality": {
    "readability": 1-10,
    "efficiency": 1-10,
    "style": 1-10
  },
  "whatYouDidWell": ["Specific praise 1", "Specific praise 2"],
  "improvements": [
    {
      "issue": "What could be better",
      "suggestion": "How to improve it",
      "priority": "high|medium|low"
    }
  ],
  "alternativeApproach": {
    "exists": true/false,
    "name": "Approach name if exists",
    "benefit": "Why it might be better",
    "complexity": "Time and space"
  },
  "learningMoment": "One key concept they should remember from this problem",
  "nextChallenge": "What type of problem to try next to build on this"
}

Be specific, educational, and encouraging. This is for learning, not criticism.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]    });

    const content = response.content?.[0]?.text;
    if (!content) {
      logger.error('[AI COACH] Empty response from Anthropic API');
      throw new Error('Empty response from AI');
    }

    const parsed = extractFirstJSON(content);

    if (parsed) {
      return parsed;
    }

    throw new Error('Failed to parse review');
  } catch (err) {
    logger.error('[AI COACH] Review generation error:', err?.message || err || 'Unknown error');
    logger.error('[AI COACH] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err || {})));

    // Classify error for better user feedback
    const errorMessage = err?.message || '';
    const statusCode = err?.status || err?.statusCode;

    if (statusCode === 401 || errorMessage.includes('authentication') || errorMessage.includes('API key')) {
      const error = new Error('AI service authentication failed. Please contact support.');
      error.code = 'AUTH_ERROR';
      throw error;
    } else if (statusCode === 429 || errorMessage.includes('rate limit')) {
      const error = new Error('AI service is busy. Please try again in a moment.');
      error.code = 'RATE_LIMIT';
      throw error;
    } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNREFUSED')) {
      const error = new Error('AI service is temporarily unavailable. Please try again.');
      error.code = 'NETWORK_ERROR';
      throw error;
    } else if (errorMessage.includes('parse') || errorMessage.includes('JSON')) {
      const error = new Error('Failed to process AI response. Please try again.');
      error.code = 'PARSE_ERROR';
      throw error;
    }

    throw err;
  }
}

/**
 * Generate personalized problem recommendations
 */
async function generateProblemRecommendations(context) {
  const { archetype, weakCategories, recentProblems, performanceLevel } = context;

  const prompt = `You are a coding coach creating a personalized practice plan.

## Coder Profile:
- Archetype: ${archetype}
- Performance Level: ${performanceLevel}
- Weak Areas: ${weakCategories.join(', ') || 'None identified yet'}
- Recently Solved: ${recentProblems.slice(0, 5).join(', ') || 'None yet'}

Create a personalized practice recommendation in JSON:
{
  "focusArea": {
    "category": "Primary category to focus on",
    "reason": "Why this category",
    "goalThisWeek": "Specific goal like 'Solve 3 medium array problems'"
  },
  "recommendedSequence": [
    {
      "type": "Easy|Medium|Hard",
      "category": "Problem category",
      "purpose": "Why this fits their learning path",
      "concepts": ["Key concept 1", "Key concept 2"]
    }
  ],
  "warmupAdvice": "How they should warm up before practice",
  "archetypeSpecificTip": "A tip specific to their coding style/archetype"
}

Base recommendations on their weak areas but also include some strength reinforcement.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]    });

    const content = response.content?.[0]?.text;
    if (!content) {
      logger.error('[AI COACH] Empty response from Anthropic API');
      throw new Error('Empty response from AI');
    }

    const parsed = extractFirstJSON(content);

    if (parsed) {
      return parsed;
    }

    throw new Error('Failed to parse recommendations');
  } catch (err) {
    logger.error('[AI COACH] Recommendations error:', err);
    throw err;
  }
}

/**
 * POST /api/feedback/hint
 * Get real-time coaching hint (Pro only)
 * Called when user appears stuck or requests a hint
 */
router.post('/hint', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const { code, language, problemId, problemTitle, problemDescription, problemDifficulty, stuckDuration, errorHint } = req.body;

    if (!language || !problemTitle) {
      return res.status(400).json({
        error: 'Language and problem info are required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI hints not configured',
        success: false
      });
    }

    // Get user's archetype for personalized hints
    const userId = req.user.sub;
    const profile = await db.getCoderProfile(userId);

    const hint = await generateRealTimeHint({
      code: code || '',
      language,
      problem: {
        id: problemId,
        title: problemTitle,
        description: problemDescription || '',
        difficulty: problemDifficulty || 'Medium'
      },
      archetype: profile?.archetype || 'coder',
      stuckDuration: stuckDuration || 0,
      lineCount: code ? code.split('\n').filter(l => l.trim()).length : 0,
      errorHint
    });

    // Track hint usage for analytics
    if (hint.shouldShow && hint.hint) {
      await db.run(`
        INSERT INTO coaching_hints (user_id, problem_id, hint_type, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `, [userId, problemId, hint.hintType]).catch(err => logger.warn('Failed to log coaching hint:', err.message));
    }

    res.json({
      success: true,
      ...hint
    });

  } catch (err) {
    logger.error('[AI COACH] Hint error:', err);
    res.status(500).json({ error: 'Failed to generate hint', success: false });
  }
});

/**
 * POST /api/feedback/review
 * Get comprehensive code review after solving (Pro only)
 */
router.post('/review', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const { code, language, problemId, problemTitle, problemDescription, problemDifficulty, solveTime, testResults } = req.body;

    if (!code || !language || !problemTitle) {
      return res.status(400).json({
        error: 'Code, language, and problem info are required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI review not configured',
        success: false
      });
    }

    const userId = req.user.sub;
    const profile = await db.getCoderProfile(userId);

    const review = await generateComprehensiveReview({
      code,
      language,
      problem: {
        id: problemId,
        title: problemTitle,
        description: problemDescription || '',
        difficulty: problemDifficulty || 'Medium'
      },
      solveTime: solveTime || 0,
      testResults: testResults || [],
      archetype: profile?.archetype || 'coder'
    });

    // Cache the review for this problem/user combo
    await db.cacheAIFeedback(userId, `review_${problemId}`, review, 24).catch(err => logger.warn('Failed to cache AI review:', err.message));

    res.json({
      success: true,
      review
    });

  } catch (err) {
    logger.error('[AI COACH] Review error:', err);

    // Return specific error message if available
    const errorMessage = err?.message || 'Failed to generate review';
    const errorCode = err?.code || 'UNKNOWN';

    let statusCode = 500;
    if (errorCode === 'AUTH_ERROR') statusCode = 503;
    else if (errorCode === 'RATE_LIMIT') statusCode = 429;
    else if (errorCode === 'NETWORK_ERROR') statusCode = 503;

    res.status(statusCode).json({
      error: errorMessage,
      errorCode,
      success: false
    });
  }
});

/**
 * GET /api/feedback/recommendations
 * Get personalized problem recommendations (Pro only)
 */
router.get('/recommendations', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI recommendations not configured',
        success: false
      });
    }

    // Check cache first
    const cached = await db.getCachedAIFeedback(userId, 'recommendations');
    if (cached) {
      return res.json({
        success: true,
        cached: true,
        ...cached
      });
    }

    // Gather context
    const [profile, weakCategories, recentSessions, battleStats] = await Promise.all([
      db.getCoderProfile(userId),
      db.getWeakCategories(userId, 3),
      db.getUserCodingSessions(userId, 10),
      db.getUserStats(userId)
    ]);

    // Determine performance level
    let performanceLevel = 'Beginner';
    const rating = battleStats?.rating || 1000;
    if (rating >= 1400) performanceLevel = 'Advanced';
    else if (rating >= 1200) performanceLevel = 'Intermediate';

    const recommendations = await generateProblemRecommendations({
      archetype: profile?.archetype || 'Adaptive Learner',
      weakCategories: weakCategories.map(c => c.category),
      recentProblems: recentSessions.map(s => getProblemTitle(s.problem_id)),
      performanceLevel
    });

    // Cache for 12 hours
    await db.cacheAIFeedback(userId, 'recommendations', recommendations, 12).catch(err => logger.warn('Failed to cache recommendations:', err.message));

    res.json({
      success: true,
      cached: false,
      ...recommendations
    });

  } catch (err) {
    logger.error('[AI COACH] Recommendations error:', err);
    res.status(500).json({ error: 'Failed to generate recommendations', success: false });
  }
});

// ============================================
// INTERACTIVE PROBLEM HELPER CHAT (Pro Only)
// ============================================

/**
 * POST /api/feedback/chat
 * Interactive AI chat for problem help (Pro only)
 * Helps understand problems WITHOUT giving solutions
 */
router.post('/chat', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const { message, problemId, problemTitle, problemDescription, problemDifficulty, code, language, conversationHistory } = req.body;

    if (!message || !problemTitle) {
      return res.status(400).json({
        error: 'Message and problem info are required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI chat not configured',
        success: false
      });
    }

    // Build conversation messages
    const messages = [];

    // Add previous conversation history if exists
    if (conversationHistory && Array.isArray(conversationHistory)) {
      conversationHistory.slice(-10).forEach(msg => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message
    });

    const systemPrompt = `You are a helpful coding tutor assisting a student with a programming problem. Your role is to help them UNDERSTAND the problem and guide their thinking, but NEVER give away the solution.

## Current Problem:
${problemTitle} (${problemDifficulty || 'Medium'})
${problemDescription || 'A coding challenge'}

${code ? `## Student's Current Code (${language || 'unknown'}):\n\`\`\`${language || ''}\n${code}\n\`\`\`` : '## No code written yet'}

## Your Guidelines:
1. Help understand the problem: Explain what the problem is asking, clarify requirements, explain examples
2. Guide their thinking: Ask leading questions, suggest what to think about
3. Explain concepts: If they ask about algorithms/data structures, explain concepts generally
4. NEVER give the solution: Do not write code for them, do not give step-by-step solution
5. Be encouraging: Help build confidence, acknowledge good thinking
6. Keep responses concise: Max 2-3 paragraphs unless explaining a concept

## If they ask for the solution directly:
Politely decline and instead offer to:
- Help them understand the problem better
- Discuss what approach might work
- Explain relevant concepts
- Review their thinking

Remember: You're a tutor, not a solution provider. Help them learn to solve it themselves!`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: messages    });

    const aiResponse = response.content?.[0]?.text;
    if (!aiResponse) {
      logger.error('[AI CHAT] Empty response from Anthropic API');
      throw new Error('Empty response from AI');
    }

    res.json({
      success: true,
      response: aiResponse,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    logger.error('[AI CHAT] Error:', err?.message || err || 'Unknown error');
    logger.error('[AI CHAT] Error status:', err?.status || 'N/A');
    logger.error('[AI CHAT] Error type:', err?.error?.type || err?.type || 'N/A');

    // Provide more specific error messages based on error type
    let userMessage = 'Failed to get AI response';
    let statusCode = 500;

    if (err?.status === 401 || err?.message?.includes('401') || err?.message?.includes('invalid_api_key')) {
      userMessage = 'AI service authentication failed. Please contact support.';
      statusCode = 503;
    } else if (err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate_limit')) {
      userMessage = 'AI service is temporarily busy. Please try again in a moment.';
      statusCode = 429;
    } else if (err?.status === 529 || err?.message?.includes('overloaded')) {
      userMessage = 'AI service is currently overloaded. Please try again shortly.';
      statusCode = 503;
    } else if (err?.message?.includes('credit') || err?.message?.includes('billing')) {
      userMessage = 'AI service temporarily unavailable. Please try again later.';
      statusCode = 503;
    }

    res.status(statusCode).json({ error: userMessage, success: false });
  }
});

// ============================================
// INTERVIEW MODE EVALUATION
// ============================================

/**
 * POST /api/feedback/evaluate-explanation
 * Evaluate interview-style explanations (approach + walkthrough) with code
 * Pro-only endpoint
 */
router.post('/evaluate-explanation', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      approachExplanation,
      walkthroughExplanation,
      code,
      language,
      problemId,
      problemTitle,
      problemDifficulty,
      solveTime
    } = req.body;

    // Validation
    if (!walkthroughExplanation || !code) {
      return res.status(400).json({
        error: 'Walkthrough explanation and code are required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI evaluation not configured',
        success: false
      });
    }

    const solveMinutes = Math.floor((solveTime || 0) / 60);
    const solveSeconds = (solveTime || 0) % 60;

    const prompt = `You are an expert technical interviewer evaluating a candidate's problem-solving and communication skills during a coding interview.

## Problem
${problemTitle || 'Unknown Problem'} (${problemDifficulty || 'Unknown'} difficulty)

## Candidate's Approach Explanation (before coding)
${approachExplanation || '(Not provided)'}

## Candidate's Solution (${language || 'Unknown language'})
\`\`\`${language || ''}
${code}
\`\`\`

## Candidate's Walkthrough (after solving)
${walkthroughExplanation}

## Solve Time
${solveMinutes} minutes ${solveSeconds} seconds

## Evaluation Criteria
Evaluate this interview performance considering:
1. Approach Explanation: Did they clearly articulate their thought process before coding? Did they identify the problem type, consider data structures, and discuss complexity?
2. Code Quality: Is the code correct, efficient, readable, and well-styled?
3. Walkthrough Quality: Did they explain their solution clearly? Did they highlight key decisions, discuss trade-offs, and demonstrate deep understanding?
4. Communication Overall: How well did they communicate throughout? Would this candidate pass a technical phone screen?

## Response Format
Respond with ONLY a valid JSON object (no markdown code blocks, no extra text) in this exact structure:
{
  "overall": <1-10 overall interview score>,
  "code": {
    "overall": <1-10>,
    "correctness": <1-10>,
    "efficiency": <1-10>,
    "style": <1-10>
  },
  "communication": {
    "overall": <1-10>,
    "clarity": <1-10>,
    "structure": <1-10>,
    "technicalDepth": <1-10>
  },
  "feedback": {
    "approach": {
      "strengths": ["specific strength 1", "specific strength 2"],
      "improvements": ["specific improvement 1", "specific improvement 2"]
    },
    "walkthrough": {
      "strengths": ["specific strength 1", "specific strength 2"],
      "improvements": ["specific improvement 1", "specific improvement 2"]
    },
    "keyTakeaway": "One specific, actionable thing to focus on for interview improvement"
  }
}

Be specific and actionable in your feedback. Reference actual parts of their explanation or code.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]    });

    const content = response.content?.[0]?.text;
    if (!content) {
      throw new Error('Empty response from AI');
    }

    // Parse JSON from response
    const evaluation = extractFirstJSON(content);
    if (!evaluation) {
      logger.error('[INTERVIEW EVAL] Failed to parse JSON from response:', content);
      throw new Error('Failed to parse AI response');
    }

    // Validate required fields exist
    if (!evaluation.overall || !evaluation.code || !evaluation.communication || !evaluation.feedback) {
      logger.error('[INTERVIEW EVAL] Invalid evaluation structure:', evaluation);
      throw new Error('Invalid evaluation structure from AI');
    }

    // Cache the result
    try {
      await db.cacheAIFeedback(userId, `interview_${problemId}`, evaluation, 24);
    } catch (cacheErr) {
      logger.warn('[INTERVIEW EVAL] Cache failed (non-fatal):', cacheErr.message);
    }

    res.json({
      success: true,
      evaluation
    });

  } catch (err) {
    logger.error('[INTERVIEW EVAL] Error:', err?.message || err || 'Unknown error');
    logger.error('[INTERVIEW EVAL] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
    res.status(500).json({
      error: 'Failed to evaluate interview performance',
      success: false
    });
  }
});

// ============================================
// COMPLEXITY QUIZ (Free + Pro)
// ============================================

/**
 * Generate battle replay analysis comparing two solutions
 */
async function generateBattleAnalysis(context) {
  const { problem, winner, loser, winnerTime, loserTime } = context;

  const prompt = `You are an expert coding coach analyzing a competitive programming battle between two players. Your goal is to provide insightful analysis that helps both players improve.

## Problem:
${problem.title} (${problem.difficulty || 'Unknown'} difficulty)
${problem.description || 'A competitive programming problem'}

## Winner's Solution (${winner.language || 'unknown'}) - Solved in ${formatTime(winnerTime || 0)}:
\`\`\`${winner.language || ''}
${winner.code || '// No code available'}
\`\`\`

## Loser's Solution (${loser.language || 'unknown'}) - Time: ${formatTime(loserTime || 0)}:
\`\`\`${loser.language || ''}
${loser.code || '// No code available'}
\`\`\`

Analyze both solutions and provide a comprehensive comparison. Be constructive and educational.

Respond with ONLY valid JSON (no markdown code blocks):
{
  "winner": {
    "approach": "Clear description of the winner's algorithmic approach",
    "strengths": ["Specific strength 1", "Specific strength 2"],
    "complexity": {
      "time": "O(...)",
      "space": "O(...)"
    }
  },
  "loser": {
    "approach": "Clear description of the loser's algorithmic approach",
    "improvements": ["Specific actionable improvement 1", "Specific actionable improvement 2"],
    "complexity": {
      "time": "O(...)",
      "space": "O(...)"
    }
  },
  "keyDifference": "The main factor that determined the outcome - what made the winner's approach faster or more effective",
  "learningMoments": [
    "Key lesson 1 that both players can learn from this battle",
    "Key lesson 2 applicable to similar problems"
  ],
  "encouragement": "Motivational message for the loser to keep improving, acknowledging what they did well"
}

Be specific and reference actual parts of the code. Focus on actionable insights.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content?.[0]?.text;
    if (!content) {
      logger.error('[BATTLE ANALYSIS] Empty response from Anthropic API');
      throw new Error('Empty response from AI');
    }

    const parsed = extractFirstJSON(content);
    if (parsed) {
      return parsed;
    }

    throw new Error('Failed to parse battle analysis');
  } catch (err) {
    logger.error('[BATTLE ANALYSIS] Error:', err?.message || err);
    throw err;
  }
}

/**
 * POST /api/feedback/analyze-battle
 * Get AI analysis of a completed battle (Pro only)
 * Compares both solutions and provides insights
 */
router.post('/analyze-battle', authMiddleware, proOnlyMiddleware, aiLimiter, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { battleId } = req.body;

    if (!battleId) {
      return res.status(400).json({
        error: 'battleId is required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI analysis not configured',
        success: false
      });
    }

    // Get battle from database
    const battle = await db.getBattleByUuid(battleId);
    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found',
        success: false
      });
    }

    // Verify user participated in this battle
    if (battle.winner_id !== userId && battle.loser_id !== userId) {
      return res.status(403).json({
        error: 'You can only analyze battles you participated in',
        success: false
      });
    }

    // Check cache first (24 hour cache)
    const cacheKey = `battle_analysis_${battleId}`;
    const cached = await db.getCachedAIFeedback(userId, cacheKey);
    if (cached) {
      return res.json({
        success: true,
        cached: true,
        analysis: cached
      });
    }

    // Get problem details
    const problem = problemsLoader.getById(battle.problem_id) || {
      id: battle.problem_id,
      title: getProblemTitle(battle.problem_id),
      description: '',
      difficulty: 'Unknown'
    };

    // Check if we have code to analyze
    if (!battle.winner_code && !battle.loser_code) {
      return res.status(400).json({
        error: 'Battle code not available for analysis. Code is only stored for recent battles.',
        success: false
      });
    }

    // Generate analysis
    const analysis = await generateBattleAnalysis({
      problem,
      winner: {
        code: battle.winner_code || '',
        language: battle.winner_language || 'unknown'
      },
      loser: {
        code: battle.loser_code || '',
        language: battle.loser_language || 'unknown'
      },
      winnerTime: battle.winner_time,
      loserTime: battle.loser_time
    });

    // Cache for 24 hours
    await db.cacheAIFeedback(userId, cacheKey, analysis, 24);

    res.json({
      success: true,
      cached: false,
      analysis
    });

  } catch (err) {
    logger.error('[BATTLE ANALYSIS] Error:', err?.message || err);
    res.status(500).json({
      error: 'Failed to analyze battle',
      success: false
    });
  }
});

/**
 * POST /api/feedback/complexity
 * Get time complexity quiz for a solved problem (available to all users)
 */
router.post('/complexity', authMiddleware, aiLimiter, async (req, res) => {
  try {
    const { code, language, problemTitle, problemDescription } = req.body;

    if (!code || !language) {
      return res.status(400).json({
        error: 'Code and language are required',
        success: false
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'AI analysis not configured',
        success: false
      });
    }

    const userLimit = getConsumerFairUseLimit('complexityAnalysesPerDay');
    const globalLimit = getConsumerFairUseLimit('globalPromptEvaluationsPerDay');
    const quota = await db.tryConsumeConsumerDailyUsage([
      { metric: 'complexity_analysis', subjectId: `user:${req.user.sub}`, limit: userLimit },
      { metric: 'prompt_evaluation', subjectId: 'global', limit: globalLimit }
    ]);
    if (!quota.allowed) {
      const globalLimitReached = quota.reason === 'global_limit';
      return res.status(429).json({
        error: globalLimitReached
          ? 'CodeArena has reached today\'s AI-analysis capacity. Please try again tomorrow.'
          : `Daily fair-use limit reached (${userLimit} complexity analyses). Try again tomorrow.`,
        success: false,
        limitReached: true,
        globalLimitReached,
        dailyLimit: globalLimitReached ? globalLimit : userLimit
      });
    }

    const prompt = `Analyze the time complexity of this ${language} solution and determine the optimal complexity for the problem.

## Problem:
${problemTitle || 'Coding Challenge'}
${problemDescription || ''}

## Solution:
\`\`\`${language}
${code}
\`\`\`

Respond with ONLY valid JSON (no markdown code blocks):
{
  "timeComplexity": "O(...)",
  "optimalComplexity": "O(...)",
  "explanation": "1-2 sentence explanation of why this is the time complexity",
  "wrongOptions": ["O(...)", "O(...)", "O(...)"]
}

Rules:
- timeComplexity: the actual time complexity of the submitted code
- optimalComplexity: the best known time complexity achievable for this problem
- Use standard Big-O notation: O(1), O(log n), O(n), O(n log n), O(n^2), O(n^3), O(2^n), O(n!)
- wrongOptions: exactly 3 plausible but incorrect Big-O complexities for the user's solution
- Never duplicate the correct answer in wrongOptions`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content?.[0]?.text;
    if (!content) {
      throw new Error('Empty response from AI');
    }

    const result = extractFirstJSON(content);
    if (!result) {
      throw new Error('Failed to parse complexity analysis');
    }

    if (!result.timeComplexity || !result.wrongOptions || result.wrongOptions.length < 3) {
      throw new Error('Invalid complexity analysis structure');
    }

    // Calculate complexity percentile if optimal complexity is available
    const percentile = result.optimalComplexity
      ? getComplexityPercentile(result.timeComplexity, result.optimalComplexity)
      : null;

    res.json({
      success: true,
      ...result,
      percentile
    });

  } catch (err) {
    logger.error('[COMPLEXITY QUIZ] Error:', err?.message || err);
    res.status(500).json({ error: 'Failed to analyze complexity', success: false });
  }
});

// ============================================
// RANK COMPARISON ANALYTICS (Pro Only)
// ============================================

/**
 * Get rank name from rating
 */
function getRankFromRating(rating) {
  if (rating >= 2200) return { name: 'Grandmaster', tier: 7 };
  if (rating >= 2000) return { name: 'Master', tier: 6 };
  if (rating >= 1800) return { name: 'Diamond', tier: 5 };
  if (rating >= 1600) return { name: 'Platinum', tier: 4 };
  if (rating >= 1400) return { name: 'Gold', tier: 3 };
  if (rating >= 1200) return { name: 'Silver', tier: 2 };
  return { name: 'Bronze', tier: 1 };
}

/**
 * GET /api/feedback/rank-comparison
 * Get comparison stats against other players at similar rating (Pro only)
 */
router.get('/rank-comparison', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Check cache first (6 hour cache)
    const cached = await db.getCachedAIFeedback(userId, 'rank_comparison');
    if (cached) {
      return res.json({
        success: true,
        cached: true,
        ...cached
      });
    }

    // Get user's current stats
    const userStats = await db.getUserStats(userId);
    const userRating = userStats?.rating || 1000;
    const userRank = getRankFromRating(userRating);

    // Define rating range (±150 for comparison)
    const ratingRange = 150;
    const minRating = userRating - ratingRange;
    const maxRating = userRating + ratingRange;

    // Get aggregated stats for users in the same rating range
    const peerStats = await db.all(`
      SELECT
        COUNT(DISTINCT u.id) as total_players,
        AVG(CASE WHEN (u.wins + u.losses) > 0 THEN (u.wins * 100.0 / (u.wins + u.losses)) ELSE 0 END) as avg_win_rate,
        AVG(u.total_battles) as avg_battles,
        AVG(u.wins) as avg_wins
      FROM users u
      WHERE u.rating BETWEEN ? AND ?
        AND u.id != ?
        AND u.total_battles > 0
    `, [minRating, maxRating, userId]);

    // Get practice stats for peers
    const peerPracticeStats = await db.all(`
      SELECT
        AVG(ps.problems_solved) as avg_problems_solved,
        AVG(ps.total_time_spent / NULLIF(ps.problems_solved, 0)) as avg_solve_time
      FROM practice_stats ps
      JOIN users u ON ps.user_id = u.id
      WHERE u.rating BETWEEN ? AND ?
        AND u.id != ?
        AND ps.problems_solved > 0
    `, [minRating, maxRating, userId]);

    // Get user's practice stats
    const userPracticeStats = await db.getPracticeStats(userId);

    // Get weekly activity for peers (last 7 days)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const peerWeeklyActivity = await db.all(`
      SELECT
        AVG(session_count) as avg_sessions_per_week
      FROM (
        SELECT
          user_id,
          COUNT(*) as session_count
        FROM coding_sessions cs
        JOIN users u ON cs.user_id = u.id
        WHERE u.rating BETWEEN ? AND ?
          AND u.id != ?
          AND cs.created_at >= ?
        GROUP BY user_id
      )
    `, [minRating, maxRating, userId, oneWeekAgo]);

    // Get user's weekly activity
    const userWeeklyActivity = await db.get(`
      SELECT COUNT(*) as session_count
      FROM coding_sessions
      WHERE user_id = ? AND created_at >= ?
    `, [userId, oneWeekAgo]);

    // Get top categories practiced at this rank
    const topCategories = await db.all(`
      SELECT
        pcs.category,
        SUM(pcs.problems_attempted) as total_attempts,
        SUM(pcs.problems_solved) as total_solved
      FROM problem_category_stats pcs
      JOIN users u ON pcs.user_id = u.id
      WHERE u.rating BETWEEN ? AND ?
      GROUP BY pcs.category
      ORDER BY total_attempts DESC
      LIMIT 5
    `, [minRating, maxRating]);

    // Calculate user's percentile within rank
    const usersAbove = await db.get(`
      SELECT COUNT(*) as count
      FROM users
      WHERE rating BETWEEN ? AND ?
        AND rating > ?
        AND total_battles > 0
    `, [minRating, maxRating, userRating]);

    const totalInRange = peerStats[0]?.total_players || 0;
    const percentile = totalInRange > 0
      ? Math.round(100 - ((usersAbove?.count || 0) / (totalInRange + 1)) * 100)
      : 50;

    // Calculate user stats
    const userWinRate = (userStats?.wins + userStats?.losses) > 0
      ? Math.round((userStats.wins / (userStats.wins + userStats.losses)) * 100)
      : 0;
    const userAvgSolveTime = userPracticeStats?.stats?.total_time_spent && userPracticeStats?.stats?.problems_solved
      ? Math.round(userPracticeStats.stats.total_time_spent / userPracticeStats.stats.problems_solved)
      : null;

    // Build comparison data
    const comparison = {
      userRank: userRank.name,
      userRating,
      ratingRange: { min: minRating, max: maxRating },
      totalPeers: totalInRange,
      percentile,
      stats: {
        winRate: {
          user: userWinRate,
          peerAvg: Math.round(peerStats[0]?.avg_win_rate || 0),
          comparison: userWinRate > (peerStats[0]?.avg_win_rate || 0) ? 'above' : 'below'
        },
        avgSolveTime: {
          user: userAvgSolveTime,
          peerAvg: Math.round(peerPracticeStats[0]?.avg_solve_time || 0) || null,
          comparison: userAvgSolveTime && peerPracticeStats[0]?.avg_solve_time
            ? (userAvgSolveTime < peerPracticeStats[0].avg_solve_time ? 'above' : 'below')
            : null
        },
        weeklyActivity: {
          user: userWeeklyActivity?.session_count || 0,
          peerAvg: Math.round(peerWeeklyActivity[0]?.avg_sessions_per_week || 0),
          comparison: (userWeeklyActivity?.session_count || 0) > (peerWeeklyActivity[0]?.avg_sessions_per_week || 0) ? 'above' : 'below'
        },
        totalBattles: {
          user: userStats?.total_battles || 0,
          peerAvg: Math.round(peerStats[0]?.avg_battles || 0)
        },
        problemsSolved: {
          user: userPracticeStats?.stats?.problems_solved || 0,
          peerAvg: Math.round(peerPracticeStats[0]?.avg_problems_solved || 0)
        }
      },
      topCategoriesAtRank: topCategories.map(c => ({
        category: c.category,
        solveRate: c.total_attempts > 0 ? Math.round((c.total_solved / c.total_attempts) * 100) : 0
      }))
    };

    // Cache for 6 hours
    await db.cacheAIFeedback(userId, 'rank_comparison', comparison, 6);

    res.json({
      success: true,
      cached: false,
      ...comparison
    });

  } catch (err) {
    logger.error('[RANK COMPARISON] Error:', err?.message || err);
    res.status(500).json({ error: 'Failed to get rank comparison', success: false });
  }
});

// ============================================
// WEEKLY PROGRESS CHART (Pro Only)
// ============================================

/**
 * GET /api/feedback/weekly-progress
 * Get user's weekly progress data for the past 4 weeks
 */
router.get('/weekly-progress', authMiddleware, proOnlyMiddleware, async (req, res) => {
  try {
    const userId = req.user.sub;

    // Check cache first (1 hour cache)
    const cached = await db.getCachedAIFeedback(userId, 'weekly_progress');
    if (cached) {
      return res.json({
        success: true,
        cached: true,
        ...cached
      });
    }

    // Get user's current rating
    const userStats = await db.getUserStats(userId);
    const currentRating = userStats?.rating || 1000;

    // Generate week boundaries for the past 4 weeks
    const now = new Date();
    const weeks = [];

    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (i * 7) - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      weeks.push({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        weekNum: 4 - i
      });
    }

    // Fetch battle data for each week
    const weeklyData = await Promise.all(weeks.map(async (week) => {
      // Get battles in this week
      const battles = await db.all(`
        SELECT
          COUNT(*) as battle_count,
          SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as wins
        FROM battles
        WHERE (winner_id = ? OR loser_id = ?)
          AND finished_at BETWEEN ? AND ?
          AND status = 'finished'
      `, [userId, userId, userId, week.start, week.end]);

      // Get practice sessions in this week
      const practice = await db.all(`
        SELECT COUNT(*) as practice_count
        FROM coding_sessions
        WHERE user_id = ?
          AND created_at BETWEEN ? AND ?
      `, [userId, week.start, week.end]);

      // Estimate rating for the week (use current rating minus changes)
      // This is a simplification - ideally we'd track rating history
      const battleCount = battles[0]?.battle_count || 0;
      const wins = battles[0]?.wins || 0;
      const losses = battleCount - wins;

      // Rough estimate: +25 per win, -20 per loss from current
      const estimatedChange = (3 - week.weekNum) * ((wins * 25) - (losses * 20));
      const estimatedRating = Math.max(0, currentRating - estimatedChange);

      return {
        rating: Math.round(estimatedRating),
        battles: battleCount,
        practice: practice[0]?.practice_count || 0,
        wins,
        weekStart: week.start
      };
    }));

    // Calculate totals
    const totalBattles = weeklyData.reduce((sum, w) => sum + w.battles, 0);
    const totalWins = weeklyData.reduce((sum, w) => sum + w.wins, 0);
    const totalPractice = weeklyData.reduce((sum, w) => sum + w.practice, 0);
    const totalLosses = totalBattles - totalWins;
    const winRate = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

    const progress = {
      weeks: weeklyData,
      totalBattles,
      totalPractice,
      winRate,
      currentRating
    };

    // Cache for 1 hour
    await db.cacheAIFeedback(userId, 'weekly_progress', progress, 1);

    res.json({
      success: true,
      cached: false,
      ...progress
    });

  } catch (err) {
    logger.error('[WEEKLY PROGRESS] Error:', err?.message || err);
    res.status(500).json({ error: 'Failed to get weekly progress', success: false });
  }
});

module.exports = router;
