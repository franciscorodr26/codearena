/**
 * Badge Checker Service
 *
 * Handles checking and awarding badges based on user achievements.
 * Called after battles, practice solves, rating changes, etc.
 *
 * Optimized to minimize DB queries:
 * - Fetches all needed stats in parallel
 * - Collects all qualifying badge slugs first
 * - Awards all badges in a single batch operation
 */

const db = require('../db');

/**
 * Check and award all applicable badges for a user
 * Returns array of newly awarded badges
 */
async function checkAndAwardBadges(userId, context = {}) {
  // Fetch all needed stats in parallel for efficiency
  const [stats, winStreak, practiceStats, weeklyCompletions, weeklyStreak, promptPracticeStats] = await Promise.all([
    db.getUserStats(userId),
    db.getUserWinStreak(userId),
    db.getPracticeStats(userId),
    db.getUserWeeklyCompletionCount(userId),
    db.getUserWeeklyStreak(userId),
    db.getPromptPracticeStats(userId).catch(() => null)
  ]);

  if (!stats) return [];

  // Collect all badge slugs to potentially award
  const slugsToAward = [];

  // Check each badge category (now just returns slugs, doesn't hit DB)
  slugsToAward.push(...getBattleBadgeSlugs(stats, context));
  slugsToAward.push(...getStreakBadgeSlugs(winStreak));
  slugsToAward.push(...getRankBadgeSlugs(stats));
  slugsToAward.push(...getPracticeBadgeSlugs(practiceStats));
  slugsToAward.push(...getWeeklyBadgeSlugs(weeklyCompletions, weeklyStreak));
  slugsToAward.push(...getPromptPracticeBadgeSlugs(promptPracticeStats));

  // Award all qualifying badges in one batch operation
  return await db.batchAwardBadges(userId, slugsToAward);
}

/**
 * Get battle milestone badge slugs (no DB calls)
 */
function getBattleBadgeSlugs(stats, context = {}) {
  const slugs = [];
  const wins = stats.wins || 0;

  // Battle win milestones
  const winMilestones = [
    { wins: 1, slug: 'first-blood' },
    { wins: 10, slug: 'battle-ready' },
    { wins: 50, slug: 'gladiator' },
    { wins: 100, slug: 'arena-champion' },
    { wins: 500, slug: 'legendary-warrior' }
  ];

  for (const milestone of winMilestones) {
    if (wins >= milestone.wins) {
      slugs.push(milestone.slug);
    }
  }

  // Speed badges - check if context includes solve time
  if (context.solveTime) {
    const solveTimeSeconds = context.solveTime;

    // Speed Demon: under 2 minutes (120 seconds)
    if (solveTimeSeconds < 120) {
      slugs.push('speed-demon');
    }

    // Lightning Strike: under 1 minute (60 seconds)
    if (solveTimeSeconds < 60) {
      slugs.push('lightning-strike');
    }
  }

  return slugs;
}

/**
 * Get win streak badge slugs (no DB calls)
 */
function getStreakBadgeSlugs(streak) {
  const slugs = [];

  const streakMilestones = [
    { streak: 3, slug: 'hot-streak' },
    { streak: 5, slug: 'on-fire' },
    { streak: 10, slug: 'unstoppable' },
    { streak: 15, slug: 'invincible' },
    { streak: 25, slug: 'godlike' }
  ];

  for (const milestone of streakMilestones) {
    if (streak >= milestone.streak) {
      slugs.push(milestone.slug);
    }
  }

  return slugs;
}

/**
 * Get rank achievement badge slugs (no DB calls)
 */
function getRankBadgeSlugs(stats) {
  const slugs = [];
  const rating = stats.rating || 1000;

  const rankMilestones = [
    { rating: 1200, slug: 'silver-tier' },
    { rating: 1400, slug: 'gold-tier' },
    { rating: 1600, slug: 'platinum-tier' },
    { rating: 1800, slug: 'diamond-tier' },
    { rating: 2000, slug: 'master-tier' },
    { rating: 2200, slug: 'grandmaster' }
  ];

  for (const milestone of rankMilestones) {
    if (rating >= milestone.rating) {
      slugs.push(milestone.slug);
    }
  }

  return slugs;
}

/**
 * Get practice mode badge slugs (no DB calls)
 */
function getPracticeBadgeSlugs(practiceStats) {
  const slugs = [];
  const solved = practiceStats?.problems_solved || 0;

  const practiceMilestones = [
    { solved: 10, slug: 'practice-rookie' },
    { solved: 50, slug: 'practice-adept' },
    { solved: 100, slug: 'practice-master' },
    { solved: 250, slug: 'problem-crusher' }
  ];

  for (const milestone of practiceMilestones) {
    if (solved >= milestone.solved) {
      slugs.push(milestone.slug);
    }
  }

  return slugs;
}

/**
 * Get weekly challenge badge slugs (no DB calls)
 */
function getWeeklyBadgeSlugs(completions, streak) {
  const slugs = [];

  const completionMilestones = [
    { count: 1, slug: 'weekly-warrior' },
    { count: 4, slug: 'consistent-coder' },
    { count: 12, slug: 'weekly-master' }
  ];

  for (const milestone of completionMilestones) {
    if (completions >= milestone.count) {
      slugs.push(milestone.slug);
    }
  }

  const streakMilestones = [
    { streak: 4, slug: 'streak-keeper' },
    { streak: 12, slug: 'streak-legend' }
  ];

  for (const milestone of streakMilestones) {
    if (streak >= milestone.streak) {
      slugs.push(milestone.slug);
    }
  }

  return slugs;
}

/**
 * Get prompt practice badge slugs (no DB calls)
 */
function getPromptPracticeBadgeSlugs(promptStats) {
  const slugs = [];
  const solved = promptStats?.stats?.challenges_solved || 0;

  const milestones = [
    { solved: 1, slug: 'prompt-novice' },
    { solved: 5, slug: 'prompt-crafter' },
    { solved: 10, slug: 'prompt-engineer' },
    { solved: 14, slug: 'prompt-master' }
  ];

  for (const milestone of milestones) {
    if (solved >= milestone.solved) {
      slugs.push(milestone.slug);
    }
  }

  return slugs;
}

/**
 * Check elite club badge (requires DB call for leaderboard rank)
 */
async function checkEliteClubBadge(userId) {
  const rank = await db.getUserLeaderboardRank(userId);
  if (rank && rank <= 100) {
    return await db.batchAwardBadges(userId, ['elite-club']);
  }
  return [];
}

/**
 * Quick check after a battle win
 * Context should include: { solveTime: seconds }
 */
async function checkAfterBattleWin(userId, context = {}) {
  const newBadges = await checkAndAwardBadges(userId, context);
  // Also check elite club (requires separate leaderboard query)
  const eliteBadge = await checkEliteClubBadge(userId);
  return [...newBadges, ...eliteBadge];
}

/**
 * Quick check after practice solve - only checks practice badges
 */
async function checkAfterPracticeSolve(userId) {
  const practiceStats = await db.getPracticeStats(userId);
  const slugs = getPracticeBadgeSlugs(practiceStats);
  return await db.batchAwardBadges(userId, slugs);
}

/**
 * Quick check after weekly challenge completion - only checks weekly badges
 */
async function checkAfterWeeklyComplete(userId) {
  const [completions, streak] = await Promise.all([
    db.getUserWeeklyCompletionCount(userId),
    db.getUserWeeklyStreak(userId)
  ]);
  const slugs = getWeeklyBadgeSlugs(completions, streak);
  return await db.batchAwardBadges(userId, slugs);
}

/**
 * Quick check after rating change - only checks rank badges
 */
async function checkAfterRatingChange(userId) {
  const stats = await db.getUserStats(userId);
  if (!stats) return [];

  const slugs = getRankBadgeSlugs(stats);
  const newBadges = await db.batchAwardBadges(userId, slugs);

  // Also check elite club
  const eliteBadge = await checkEliteClubBadge(userId);
  return [...newBadges, ...eliteBadge];
}

// Legacy function wrappers for backwards compatibility
// These now use the optimized internal functions
async function checkBattleBadges(userId, stats, context = {}) {
  const slugs = getBattleBadgeSlugs(stats, context);
  return await db.batchAwardBadges(userId, slugs);
}

async function checkStreakBadges(userId, stats) {
  const streak = await db.getUserWinStreak(userId);
  const slugs = getStreakBadgeSlugs(streak);
  return await db.batchAwardBadges(userId, slugs);
}

async function checkRankBadges(userId, stats) {
  const slugs = getRankBadgeSlugs(stats);
  const newBadges = await db.batchAwardBadges(userId, slugs);
  const eliteBadge = await checkEliteClubBadge(userId);
  return [...newBadges, ...eliteBadge];
}

async function checkPracticeBadges(userId) {
  return await checkAfterPracticeSolve(userId);
}

async function checkWeeklyBadges(userId) {
  return await checkAfterWeeklyComplete(userId);
}

module.exports = {
  checkAndAwardBadges,
  checkBattleBadges,
  checkStreakBadges,
  checkRankBadges,
  checkPracticeBadges,
  checkWeeklyBadges,
  checkAfterBattleWin,
  checkAfterPracticeSolve,
  checkAfterWeeklyComplete,
  checkAfterRatingChange
};
