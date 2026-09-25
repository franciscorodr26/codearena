/**
 * Reward Service - Handles XP, levels, and incentive rewards
 */

const db = require('../db');
const logger = require('../utils/logger');

// XP rewards for different actions
const XP_REWARDS = {
  // Battle rewards
  BATTLE_WIN: 100,
  BATTLE_WIN_RANKED: 150,
  BATTLE_LOSS: 25, // Participation reward
  BATTLE_FIRST_BLOOD: 50, // First to solve
  BATTLE_SPEED_BONUS: 25, // Solved in under 2 minutes

  // Practice rewards
  PRACTICE_SOLVE: 50,
  PRACTICE_SOLVE_HARD: 100,
  PRACTICE_SOLVE_MEDIUM: 75,
  PRACTICE_FIRST_TRY: 30, // Solved on first attempt

  // Streak rewards
  DAILY_LOGIN: 10,
  DAILY_STREAK_3: 50,
  DAILY_STREAK_7: 150,
  DAILY_STREAK_30: 500,

  // Challenge rewards
  CHALLENGE_COMPLETE: 100,
  CHALLENGE_TOP_10: 200,
  CHALLENGE_TOP_3: 300,
  CHALLENGE_WINNER: 500,

  // Miscellaneous
  FIRST_BATTLE: 100,
  FIRST_PRACTICE: 50,
  PROFILE_COMPLETE: 50
};

// Level thresholds (XP required for each level)
// Uses a smooth curve: level N requires N * 100 * 1.5^(N/10) XP
function getXpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(level * 100 * Math.pow(1.5, level / 10));
}

// Get level from XP
function getLevelFromXp(totalXp) {
  let level = 1;
  while (getXpForLevel(level + 1) <= totalXp) {
    level++;
    if (level >= 100) break; // Cap at level 100
  }
  return level;
}

// Get level progress (0-100%)
function getLevelProgress(totalXp) {
  const currentLevel = getLevelFromXp(totalXp);
  const currentLevelXp = getXpForLevel(currentLevel);
  const nextLevelXp = getXpForLevel(currentLevel + 1);
  const xpInLevel = totalXp - currentLevelXp;
  const xpNeeded = nextLevelXp - currentLevelXp;
  return Math.min(100, Math.floor((xpInLevel / xpNeeded) * 100));
}

// Level titles
const LEVEL_TITLES = {
  1: 'Novice Coder',
  5: 'Apprentice',
  10: 'Code Warrior',
  15: 'Algorithm Adept',
  20: 'Data Sage',
  25: 'Logic Master',
  30: 'Optimization Guru',
  40: 'Code Architect',
  50: 'Algorithm Legend',
  60: 'Grandmaster',
  75: 'Elite Coder',
  100: 'Code Arena Champion'
};

function getLevelTitle(level) {
  const thresholds = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const threshold of thresholds) {
    if (level >= threshold) {
      return LEVEL_TITLES[threshold];
    }
  }
  return 'Novice Coder';
}

/**
 * Award XP to a user
 * @param {number} userId - User ID
 * @param {number} xpAmount - Amount of XP to award
 * @param {string} reason - Reason for the award
 * @returns {Object} - Updated stats including level up info
 */
async function awardXp(userId, xpAmount, reason = 'unknown') {
  try {
    // Get current stats
    const stats = await db.get('SELECT total_xp, level FROM user_stats WHERE user_id = ?', [userId]);

    if (!stats) {
      // Initialize stats if not exists
      await db.run(`
        INSERT INTO user_stats (user_id, total_xp, level, updated_at, last_xp_earned_at)
        VALUES (?, ?, 1, datetime('now'), datetime('now'))
      `, [userId, xpAmount]);

      const initLevel = getLevelFromXp(xpAmount);
      // If the initial XP grant already exceeds level 1 thresholds, normalize the row.
      if (initLevel > 1) {
        await db.run(
          `UPDATE user_stats SET level = ? WHERE user_id = ?`,
          [initLevel, userId]
        );
      }

      return {
        xpAwarded: xpAmount,
        totalXp: xpAmount,
        level: initLevel,
        oldLevel: 1,
        levelUp: initLevel > 1,
        levelTitle: getLevelTitle(initLevel),
        progress: getLevelProgress(xpAmount),
        xpToNextLevel: getXpForLevel(initLevel + 1) - xpAmount,
        reason
      };
    }

    const oldLevel = stats.level || getLevelFromXp(stats.total_xp || 0);
    const newTotalXp = (stats.total_xp || 0) + xpAmount;
    const newLevel = getLevelFromXp(newTotalXp);
    const levelUp = newLevel > oldLevel;

    // Update stats
    await db.run(`
      UPDATE user_stats
      SET total_xp = ?,
          level = ?,
          last_xp_earned_at = datetime('now'),
          updated_at = datetime('now')
      WHERE user_id = ?
    `, [newTotalXp, newLevel, userId]);

    logger.info(`Awarded ${xpAmount} XP to user ${userId} for ${reason}. Total: ${newTotalXp}, Level: ${newLevel}`);

    return {
      xpAwarded: xpAmount,
      totalXp: newTotalXp,
      level: newLevel,
      oldLevel,
      levelUp,
      levelTitle: getLevelTitle(newLevel),
      progress: getLevelProgress(newTotalXp),
      xpToNextLevel: getXpForLevel(newLevel + 1) - newTotalXp,
      reason
    };
  } catch (error) {
    logger.error('Error awarding XP:', error);
    throw error;
  }
}

/**
 * Get user's reward stats
 * @param {number} userId - User ID
 * @returns {Object} - User's XP, level, and progress
 */
async function getRewardStats(userId) {
  try {
    const stats = await db.get(`
      SELECT total_xp, level, daily_streak, best_daily_streak, last_xp_earned_at
      FROM user_stats WHERE user_id = ?
    `, [userId]);

    if (!stats) {
      return {
        totalXp: 0,
        level: 1,
        levelTitle: getLevelTitle(1),
        progress: 0,
        xpToNextLevel: getXpForLevel(2),
        dailyStreak: 0,
        bestDailyStreak: 0
      };
    }

    const level = stats.level || getLevelFromXp(stats.total_xp || 0);

    return {
      totalXp: stats.total_xp || 0,
      level,
      levelTitle: getLevelTitle(level),
      progress: getLevelProgress(stats.total_xp || 0),
      xpToNextLevel: getXpForLevel(level + 1) - (stats.total_xp || 0),
      dailyStreak: stats.daily_streak || 0,
      bestDailyStreak: stats.best_daily_streak || 0,
      lastXpEarnedAt: stats.last_xp_earned_at
    };
  } catch (error) {
    logger.error('Error getting reward stats:', error);
    return {
      totalXp: 0,
      level: 1,
      levelTitle: getLevelTitle(1),
      progress: 0,
      xpToNextLevel: getXpForLevel(2),
      dailyStreak: 0,
      bestDailyStreak: 0
    };
  }
}

/**
 * Award battle XP
 * @param {number} userId - User ID
 * @param {boolean} won - Whether the user won
 * @param {boolean} ranked - Whether it was a ranked battle
 * @param {number} solveTime - Time to solve in seconds
 * @returns {Object} - XP awarded info
 */
async function awardBattleXp(userId, won, ranked = true, solveTime = null) {
  let totalXp = 0;
  const reasons = [];

  if (won) {
    totalXp += ranked ? XP_REWARDS.BATTLE_WIN_RANKED : XP_REWARDS.BATTLE_WIN;
    reasons.push(ranked ? 'Ranked Victory' : 'Battle Victory');

    // Speed bonus for fast solves (under 2 minutes)
    if (solveTime && solveTime < 120) {
      totalXp += XP_REWARDS.BATTLE_SPEED_BONUS;
      reasons.push('Speed Bonus');
    }
  } else {
    totalXp += XP_REWARDS.BATTLE_LOSS;
    reasons.push('Participation');
  }

  return awardXp(userId, totalXp, reasons.join(', '));
}

/**
 * Award practice XP
 * @param {number} userId - User ID
 * @param {string} difficulty - Problem difficulty
 * @param {boolean} firstTry - Whether solved on first attempt
 * @returns {Object} - XP awarded info
 */
async function awardPracticeXp(userId, difficulty = 'Easy', firstTry = false) {
  let totalXp = XP_REWARDS.PRACTICE_SOLVE;
  const reasons = ['Practice Complete'];

  if (difficulty === 'Hard') {
    totalXp = XP_REWARDS.PRACTICE_SOLVE_HARD;
    reasons[0] = 'Hard Problem Solved';
  } else if (difficulty === 'Medium') {
    totalXp = XP_REWARDS.PRACTICE_SOLVE_MEDIUM;
    reasons[0] = 'Medium Problem Solved';
  }

  if (firstTry) {
    totalXp += XP_REWARDS.PRACTICE_FIRST_TRY;
    reasons.push('First Try Bonus');
  }

  return awardXp(userId, totalXp, reasons.join(', '));
}

module.exports = {
  XP_REWARDS,
  getXpForLevel,
  getLevelFromXp,
  getLevelProgress,
  getLevelTitle,
  awardXp,
  getRewardStats,
  awardBattleXp,
  awardPracticeXp
};
