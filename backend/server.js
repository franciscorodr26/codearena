// Complete server.js - FIXED PROBLEMS LOADING

// Load environment variables from .env file
require('dotenv').config();

// Logger module for structured logging
const logger = require('./utils/logger');

// Initialize Sentry for error monitoring (must be before other imports)
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',

    // Performance Monitoring
    tracesSampleRate: 0.1, // Capture 10% of transactions

    // Filter out non-critical errors
    ignoreErrors: [
      /ECONNRESET/,
      /ETIMEDOUT/,
      /socket hang up/,
      /EPIPE/,
    ],

    // Only enable in production
    enabled: process.env.NODE_ENV === 'production',
  });
  logger.info('Error monitoring initialized', 'Sentry');
}

const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Analytics } = require('./analytics');
const { config, environments, logLevels } = require('./config/env');
const { SECRET } = require('./config/jwt');
const { authenticateSessionToken } = require('./utils/sessionAuthentication');
const { FRONTEND_URL } = require('./config/appUrls');
const { requireAdminKey } = require('./utils/adminKeyGuard');
const {
  CODEARENA_PRODUCT_MODE,
  getConsumerFairUseLimit
} = require('../shared/codearenaProductMode');
const {
  buildAllowedOrigins,
  createCorsOriginHandler,
  corsErrorHandler
} = require('./config/cors');

// ELO Rating System
const elo = require('./elo');

// Anti-Cheat Service
const antiCheat = require('./services/antiCheat');
// Agent Battle Rate Limiter
const { checkAgentBattleRateLimit, getRateLimitStatus, refundRateLimitSlot, cleanupExpiredRateLimits } = require('./services/agentRateLimiter');
// Agent Battle Spending Limiter (cost control)
const { checkSpendingLimit, reserveSpending, releaseReservation, recordSpending, refundSpending, getSpendingStatus } = require('./services/agentSpendingLimiter');


// Trust Tier Service (v2 consequence-based)
const trustTierService = require('./services/trustTierService');

// Bot Service for practice matches
const botService = require('./services/botService');
const { createBotBattleGuard } = require('./services/botBattleGuard');


// Email Service for weekly changelog
const emailService = require('./services/email');
const { generateChangelogFromGit } = require('./scripts/generateChangelog');

// Anthropic SDK for complexity analysis
const Anthropic = require('@anthropic-ai/sdk');
const anthropicServer = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 15000 }) : null;

// Bot matchmaking threshold (15 seconds)
const BOT_MATCH_THRESHOLD = 15000;
// Agent battles call a paid model API, so they are off unless the operator
// turns them on: CODEARENA_AGENT_BATTLES=1 and an ANTHROPIC_API_KEY.
const AGENT_PRODUCT_ENABLED = process.env.CODEARENA_AGENT_BATTLES === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

// Helper to optionally extract userId from Authorization header
// Signature alone is not enough: the session row must exist and the token's
// credential generation must be current, so logged-out, pre-password-change
// and 2FA-pending tokens are rejected here too.
async function extractUserFromToken(req) {
  const authHeader = req.headers.authorization
  if (typeof authHeader !== 'string' || !/^Bearer \S+$/.test(authHeader)) return null
  try {
    return await authenticateSessionToken(authHeader.slice(7), dbHelper, SECRET)
  } catch {
    return null
  }
}

// Session-checked claims for socket handlers that re-read the handshake token.
async function verifySessionClaims(token) {
  const { userId, claims } = await authenticateSessionToken(token, dbHelper, SECRET)
  return { ...claims, sub: userId }
}

// Check if user's email is verified (required for battles and practice)
// Skipped in development mode so local testing isn't blocked
async function checkEmailVerified(userId) {
  if (!userId) return { verified: false, reason: 'not_authenticated' };
  if (process.env.NODE_ENV !== 'production') return { verified: true, reason: null };
  try {
    const isVerified = await dbHelper.isUserEmailVerified(userId);
    return { verified: isVerified, reason: isVerified ? null : 'email_not_verified' };
  } catch (err) {
    logger.error('Error checking email verification:', err);
    return { verified: false, reason: 'verification_check_failed' };
  }
}

// ============================================
// BATTLE RESULT PERSISTENCE HELPERS
// ============================================

/**
 * Update player's rating and record the change
 * @param {object} player - Player object with userId, name
 * @param {object} eloResult - ELO calculation result with newRating, change
 * @param {string} battleId - Battle UUID
 * @param {string} resultType - 'win', 'loss', 'partial_credit_win', 'partial_credit_loss'
 * @param {number|null} solveTime - Time to solve (null for losses/partial credit)
 */
async function updatePlayerRating(player, eloResult, battleId, resultType, solveTime = null) {
  if (!player?.userId) return;

  const result = resultType.includes('win') ? 'win' : 'loss';

  await dbHelper.updateUserStatsWithElo(player.userId, {
    result,
    ratingChange: eloResult.change,
    solveTime
  });

  await dbHelper.recordRatingChange(player.userId, {
    rating: eloResult.newRating,
    ratingChange: eloResult.change,
    battleUuid: battleId,
    result: resultType
  });

  const rank = elo.getRankDivision(eloResult.newRating);
  const changeStr = eloResult.change > 0 ? `+${eloResult.change}` : eloResult.change;
  logger.info(`${resultType.toUpperCase()} for ${player.name}: → ${eloResult.newRating} (${changeStr}) [${rank.display}]`);
}

/**
 * Check badges after rating change and record activity
 * @param {number} userId - User ID
 * @param {number} oldRating - Previous rating
 * @param {number} newRating - New rating after change
 * @returns {Array} Array of newly earned badges
 */
async function checkPlayerBadgesAndActivity(userId, oldRating, newRating) {
  if (!userId) return [];

  try {
    const newBadges = await badgeService.checkAfterRatingChange(userId);
    notifyNewBadges(userId, newBadges);

    if (newBadges.length > 0) {
      for (const badge of newBadges) {
        await activityService.recordBadgeEarned(userId, {
          badgeName: badge.name,
          badgeSlug: badge.slug,
          badgeIcon: badge.icon,
          badgeRarity: badge.rarity
        });
      }
    }

    const oldRank = elo.getRankDivision(oldRating);
    const newRank = elo.getRankDivision(newRating);
    if (newRank.tier.name !== oldRank.tier.name) {
      await activityService.recordRankUp(userId, {
        rank: newRank.display,
        rating: newRating
      });
    }

    return newBadges;
  } catch (err) {
    logger.error('Badge check failed:', err);
    return [];
  }
}

// Persist battle result to database and update user stats with ELO
// IMPORTANT: ELO is ONLY updated for matchmade battles (not private battles or practice)
async function persistBattleResult(battle, winner, loser, winnerTime, loserTime, isForfeit = false) {
  logger.info(`[STATS-DEBUG] persistBattleResult ENTRY - battle exists: ${!!battle}, winner exists: ${!!winner}, loser exists: ${!!loser}`);
  logger.info(`[STATS-DEBUG] persistBattleResult called for battle ${battle?.id}`);
  logger.info(`[STATS-DEBUG] winner: id=${winner?.id}, name=${winner?.name}, userId=${winner?.userId}`);
  logger.info(`[STATS-DEBUG] loser: id=${loser?.id}, name=${loser?.name}, userId=${loser?.userId}`);
  logger.info(`[STATS-DEBUG] battle flags: isAgainstBot=${battle.isAgainstBot}, matchmade=${battle.matchmade}, ranked=${battle.ranked}`);

  try {
    // Skip ELO and persistence for bot battles - they are practice only
    if (battle.isAgainstBot) {
      logger.info(`[STATS-DEBUG] SKIP: Bot battle ${battle.id} - no persistence`);
      return { winnerRatingChange: 0, loserRatingChange: 0, isAgainstBot: true };
    }

    // Persist battles for authenticated users (at least one player must be authenticated)
    // This allows: auth vs auth, auth vs guest, but not guest vs guest (which are practice-only)
    const hasAuthenticatedWinner = !!winner?.userId;
    const hasAuthenticatedLoser = !!loser?.userId;
    const hasAnyAuthenticatedPlayer = hasAuthenticatedWinner || hasAuthenticatedLoser;

    if (!hasAnyAuthenticatedPlayer) {
      logger.error(`[STATS-DEBUG] SKIP: No authenticated users - winner.userId=${winner?.userId}, loser.userId=${loser?.userId}, battle=${battle.id}`);
      return { winnerRatingChange: 0, loserRatingChange: 0 };
    }

    const battleData = {
      battleUuid: battle.id,
      problemId: battle.problem.id,
      winnerId: winner?.userId || null,
      loserId: loser?.userId || null,
      winnerGuestSessionId: winner?.guestSessionId || null,
      loserGuestSessionId: loser?.guestSessionId || null,
      winnerTime: winnerTime || null,
      loserTime: loserTime || null,
      isTie: false,
      isForfeit: isForfeit,
      createdAt: new Date(battle.createdAt || Date.now()).toISOString(),
      finishedAt: new Date(battle.finishedAt || Date.now()).toISOString(),
      winnerLanguage: winner?.language || 'python',
      loserLanguage: loser?.language || 'python',
      isMatchmade: battle.matchmade || false,
      winnerCode: winner?.code || null,
      loserCode: loser?.code || null
    };

    logger.info(`[STATS-DEBUG] Saving battle data:`, JSON.stringify(battleData));
    // Retry save up to 3 times to handle transient DB errors
    let saved = false;
    let lastSaveError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await dbHelper.saveBattleResult(battleData);
        saved = true;
        logger.info(`[STATS-DEBUG] Battle ${battle.id} saved successfully to battles_history (attempt ${attempt})`);
        break;
      } catch (saveErr) {
        lastSaveError = saveErr;
        logger.error(`[STATS-DEBUG] FAILED to save battle ${battle.id} (attempt ${attempt}/3): ${saveErr.message}`, { code: saveErr.code, details: saveErr.toString() });
        if (saveErr.message?.includes('UNIQUE constraint')) {
          // Already saved from a previous attempt - this is fine
          logger.info(`[STATS-DEBUG] Battle ${battle.id} already exists in DB (duplicate) - treating as success`);
          saved = true;
          break;
        }
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
    }
    if (!saved) {
      logger.error(`[STATS-DEBUG] CRITICAL: Battle ${battle.id} could NOT be saved after 3 attempts! Final error: ${lastSaveError?.message}`);
      logger.error(`[STATS-DEBUG] Battle data that failed to save:`, { battleUuid: battleData.battleUuid, winnerId: battleData.winnerId, loserId: battleData.loserId, createdAt: battleData.createdAt, finishedAt: battleData.finishedAt });
    }

    // ONLY update ELO for MATCHMADE battles (not private battles)
    logger.info(`[STATS-DEBUG] Battle ${battle.id} - matchmade=${battle.matchmade}, ranked=${battle.ranked}, winnerId=${winner?.userId}, loserId=${loser?.userId}`);
    if (!battle.matchmade) {
      // Track private battle stats (separate from ranked ELO)
      if (winner?.userId) {
        await dbHelper.updatePrivateBattleStats(winner.userId, 'win');
        // Track returning battle for private battles too
        const winnerStats = await dbHelper.getUserStats(winner.userId);
        const winnerGames = winnerStats?.total_battles || 0;
        if (winnerGames >= 1) {
          try {
            mixpanelAnalytics.trackReturningBattleComplete(String(winner.userId), {
              playerName: winner.name,
              battleId: battle.id,
              problemId: battle.problem?.id,
              problemDifficulty: battle.problem?.difficulty,
              battleType: 'PRIVATE',
              previousBattleCount: winnerGames,
              playerResult: 'WIN',
              opponentType: loser?.isBot ? 'BOT' : 'HUMAN'
            });
          } catch (err) {
            logger.error('Failed to track returning battle for private winner:', err);
          }
        }
      }
      if (loser?.userId) {
        await dbHelper.updatePrivateBattleStats(loser.userId, 'loss');
        // Track returning battle for private battles too
        const loserStats = await dbHelper.getUserStats(loser.userId);
        const loserGames = loserStats?.total_battles || 0;
        if (loserGames >= 1) {
          try {
            mixpanelAnalytics.trackReturningBattleComplete(String(loser.userId), {
              playerName: loser.name,
              battleId: battle.id,
              problemId: battle.problem?.id,
              problemDifficulty: battle.problem?.difficulty,
              battleType: 'PRIVATE',
              previousBattleCount: loserGames,
              playerResult: 'LOSE',
              opponentType: winner?.isBot ? 'BOT' : 'HUMAN'
            });
          } catch (err) {
            logger.error('Failed to track returning battle for private loser:', err);
          }
        }
      }
      logger.info(` Private battle ${battle.id} persisted (casual stats updated, no ELO changes)`);
      return { winnerRatingChange: 0, loserRatingChange: 0 };
    }

    // Centaur battles are ranked but use a SEPARATE rating pool (centaur_stats).
    // They reuse the pairwise ELO math but bypass user_stats, rating history, and
    // anti-cheat (AI assistance is legal in this mode).
    if (battle.battleType === 'centaur') {
      const cWinnerStats = winner?.userId ? await dbHelper.getCentaurStats(winner.userId) : null;
      const cLoserStats = loser?.userId ? await dbHelper.getCentaurStats(loser.userId) : null;
      const cWinnerRating = cWinnerStats?.rating || 1000;
      const cLoserRating = cLoserStats?.rating || 1000;
      const cWinnerGames = (cWinnerStats?.wins || 0) + (cWinnerStats?.losses || 0);
      const cLoserGames = (cLoserStats?.wins || 0) + (cLoserStats?.losses || 0);

      const cElo = elo.calculateMatchRatings(
        { rating: cWinnerRating, totalGames: cWinnerGames },
        { rating: cLoserRating, totalGames: cLoserGames }
      );

      if (winner?.userId) {
        await dbHelper.updateCentaurStatsWithElo(winner.userId, {
          result: 'win',
          ratingChange: cElo.winner.change,
          solveTime: winnerTime
        });
      }
      if (loser?.userId) {
        await dbHelper.updateCentaurStatsWithElo(loser.userId, {
          result: 'loss',
          ratingChange: cElo.loser.change,
          solveTime: null
        });
      }

      // Analytics (Mixpanel), fire-and-forget; trackEvent never throws.
      if (winner?.userId) {
        mixpanelAnalytics.trackEvent('centaur_battle_finished', String(winner.userId), {
          battle_id: battle.id,
          result: 'win',
          rating_change: cElo.winner.change,
          new_rating: cElo.winner.newRating
        });
      }
      if (loser?.userId) {
        mixpanelAnalytics.trackEvent('centaur_battle_finished', String(loser.userId), {
          battle_id: battle.id,
          result: 'loss',
          rating_change: cElo.loser.change,
          new_rating: cElo.loser.newRating
        });
      }

      logger.info(`Centaur battle ${battle.id} persisted: ${cWinnerRating}->${cElo.winner.newRating} / ${cLoserRating}->${cElo.loser.newRating}`);
      return {
        winnerRatingChange: cElo.winner.change,
        loserRatingChange: cElo.loser.change,
        winnerNewRating: cElo.winner.newRating,
        loserNewRating: cElo.loser.newRating,
        winnerRank: elo.getRankDivision(cElo.winner.newRating),
        loserRank: elo.getRankDivision(cElo.loser.newRating),
        winnerNewBadges: [],
        loserNewBadges: [],
        isCentaur: true
      };
    }

    // Get current stats for ELO calculation
    let winnerStats = winner?.userId ? await dbHelper.getUserStats(winner.userId) : null;
    let loserStats = loser?.userId ? await dbHelper.getUserStats(loser.userId) : null;

    // Default values for unauthenticated or new players
    const winnerRating = winnerStats?.rating || 1000;
    const loserRating = loserStats?.rating || 1000;
    const winnerGames = winnerStats?.total_battles || 0;
    const loserGames = loserStats?.total_battles || 0;

    // Calculate ELO rating changes
    const eloResults = elo.calculateMatchRatings(
      { rating: winnerRating, totalGames: winnerGames },
      { rating: loserRating, totalGames: loserGames }
    );

    let winnerRatingChange = eloResults.winner.change;
    let loserRatingChange = eloResults.loser.change;

    // Update winner stats if authenticated
    logger.info(`[STATS-DEBUG] Attempting to update winner stats: userId=${winner?.userId}, matchmade=${battle.matchmade}, ratingChange=${winnerRatingChange}`);
    if (winner?.userId) {
      await dbHelper.updateUserStatsWithElo(winner.userId, {
        result: 'win',
        ratingChange: winnerRatingChange,
        solveTime: winnerTime
      });
      // Record rating history for analytics
      await dbHelper.recordRatingChange(winner.userId, {
        rating: eloResults.winner.newRating,
        ratingChange: winnerRatingChange,
        battleUuid: battle.id,
        result: 'win'
      });
      const winnerRank = elo.getRankDivision(eloResults.winner.newRating);
      logger.info(`Updated stats for winner ${winner.name}: ${winnerRating} → ${eloResults.winner.newRating} (${winnerRatingChange > 0 ? '+' : ''}${winnerRatingChange}) [${winnerRank.display}]`);
    }

    // Update loser stats if authenticated
    logger.info(`[STATS-DEBUG] Attempting to update loser stats: userId=${loser?.userId}, matchmade=${battle.matchmade}, ratingChange=${loserRatingChange}`);
    if (loser?.userId) {
      await dbHelper.updateUserStatsWithElo(loser.userId, {
        result: 'loss',
        ratingChange: loserRatingChange,
        solveTime: null
      });
      // Record rating history for analytics
      await dbHelper.recordRatingChange(loser.userId, {
        rating: eloResults.loser.newRating,
        ratingChange: loserRatingChange,
        battleUuid: battle.id,
        result: 'loss'
      });
      const loserRank = elo.getRankDivision(eloResults.loser.newRating);
      logger.info(`Updated stats for loser ${loser.name}: ${loserRating} → ${eloResults.loser.newRating} (${loserRatingChange}) [${loserRank.display}]`);
    }

    logger.info(` Matchmade battle ${battle.id} persisted with ELO updates`);

    // Build return value now, everything below is non-critical
    const result = {
      winnerRatingChange,
      loserRatingChange,
      winnerNewRating: eloResults.winner.newRating,
      loserNewRating: eloResults.loser.newRating,
      winnerRank: elo.getRankDivision(eloResults.winner.newRating),
      loserRank: elo.getRankDivision(eloResults.loser.newRating),
      winnerNewBadges: [],
      loserNewBadges: []
    };

    // --- Non-critical operations below (won't affect rating change return) ---

    // Store rating changes in battle history for display
    try {
      await dbHelper.updateBattleRatingChanges(battle.id, winnerRatingChange, loserRatingChange);
    } catch (e) {
      logger.warn('Failed to store rating changes in battle history:', e.message);
    }

    // Track returning battle completions
    if (winner?.userId && winnerGames >= 1) {
      try {
        mixpanelAnalytics.trackReturningBattleComplete(String(winner.userId), {
          playerName: winner.name,
          battleId: battle.id,
          problemId: battle.problem?.id,
          problemDifficulty: battle.problem?.difficulty,
          battleType: battle.matchmade ? 'QUICK_MATCH' : 'PRIVATE',
          previousBattleCount: winnerGames,
          playerResult: 'WIN',
          opponentType: loser?.isBot ? 'BOT' : 'HUMAN'
        });
      } catch (err) {
        logger.error('Failed to track returning battle complete for winner:', err);
      }
    }
    if (loser?.userId && loserGames >= 1) {
      try {
        mixpanelAnalytics.trackReturningBattleComplete(String(loser.userId), {
          playerName: loser.name,
          battleId: battle.id,
          problemId: battle.problem?.id,
          problemDifficulty: battle.problem?.difficulty,
          battleType: battle.matchmade ? 'QUICK_MATCH' : 'PRIVATE',
          previousBattleCount: loserGames,
          playerResult: 'LOSE',
          opponentType: winner?.isBot ? 'BOT' : 'HUMAN'
        });
      } catch (err) {
        logger.error('Failed to track returning battle complete for loser:', err);
      }
    }

    // Check and award badges for the winner
    if (winner?.userId) {
      try {
        result.winnerNewBadges = await badgeService.checkAfterBattleWin(winner.userId, {
          solveTime: winnerTime
        });
        notifyNewBadges(winner.userId, result.winnerNewBadges);
        if (result.winnerNewBadges.length > 0) {
          logger.info(` ${winner.name} earned ${result.winnerNewBadges.length} badge(s): ${result.winnerNewBadges.map(b => b.name).join(', ')}`);
        }
      } catch (err) {
        logger.error('Badge check failed for winner:', err);
      }

      // Record activity for battle win
      try {
        await activityService.recordBattleWin(winner.userId, {
          opponentName: loser?.name || 'Anonymous',
          opponentId: loser?.userId || null,
          solveTime: winnerTime,
          problem: battle.problem
        });

        for (const badge of result.winnerNewBadges) {
          await activityService.recordBadgeEarned(winner.userId, {
            badgeName: badge.name,
            badgeSlug: badge.slug,
            badgeIcon: badge.icon,
            badgeRarity: badge.rarity
          });
        }

        const winStreak = await dbHelper.getUserWinStreak(winner.userId);
        if ([3, 5, 10, 15, 25].includes(winStreak)) {
          await activityService.recordStreakMilestone(winner.userId, winStreak);
        }

        const oldRank = elo.getRankDivision(winnerStats?.rating || 1000);
        const newRank = elo.getRankDivision(eloResults.winner.newRating);
        if (newRank.name !== oldRank.name) {
          await activityService.recordRankUp(winner.userId, {
            rank: newRank.display,
            rating: eloResults.winner.newRating
          });
        }
      } catch (err) {
        logger.error('Activity recording failed:', err);
      }

      // Award XP to winner
      try {
        const xpResult = await rewardService.awardBattleXp(winner.userId, true, battle.ranked !== false, winnerTime);
        result.winnerXpAwarded = xpResult.xpAwarded;
        result.winnerLevelUp = xpResult.levelUp;
        result.winnerNewLevel = xpResult.level;
        if (xpResult.levelUp) {
          logger.info(` ${winner.name} leveled up to ${xpResult.level}!`);
        }
      } catch (err) {
        logger.error('XP awarding failed for winner:', err);
      }
    }

    // Check and award badges for the loser
    if (loser?.userId) {
      try {
        result.loserNewBadges = await badgeService.checkAfterRatingChange(loser.userId);
        notifyNewBadges(loser.userId, result.loserNewBadges);
        if (result.loserNewBadges.length > 0) {
          logger.info(` ${loser.name} earned ${result.loserNewBadges.length} badge(s): ${result.loserNewBadges.map(b => b.name).join(', ')}`);
        }

        for (const badge of result.loserNewBadges) {
          await activityService.recordBadgeEarned(loser.userId, {
            badgeName: badge.name,
            badgeSlug: badge.slug,
            badgeIcon: badge.icon,
            badgeRarity: badge.rarity
          });
        }

        const oldLoserRank = elo.getRankDivision(loserStats?.rating || 1000);
        const newLoserRank = elo.getRankDivision(eloResults.loser.newRating);
        if (newLoserRank.name !== oldLoserRank.name) {
          await activityService.recordRankUp(loser.userId, {
            rank: newLoserRank.display,
            rating: eloResults.loser.newRating
          });
        }
      } catch (err) {
        logger.error('Badge/activity check failed for loser:', err);
      }

      // Award XP to loser (participation reward)
      try {
        const xpResult = await rewardService.awardBattleXp(loser.userId, false, battle.ranked !== false, loserTime);
        result.loserXpAwarded = xpResult.xpAwarded;
        result.loserLevelUp = xpResult.levelUp;
        result.loserNewLevel = xpResult.level;
        if (xpResult.levelUp) {
          logger.info(` ${loser.name} leveled up to ${xpResult.level}!`);
        }
      } catch (err) {
        logger.error('XP awarding failed for loser:', err);
      }
    }

    // Invalidate leaderboard cache since ratings changed
    try {
      const usersRouter = require('./routes/users');
      usersRouter.invalidateLeaderboardCache?.();
    } catch (e) {
      logger.warn('Failed to invalidate leaderboard cache:', e.message);
    }

    return result;
  } catch (err) {
    logger.error('Failed to persist battle result:', err);
    logger.error(`[PERSIST-ERROR] Error type: ${typeof err}, isNull: ${err === null}, isUndefined: ${err === undefined}`);
    logger.error(`[PERSIST-ERROR] Error message: ${err?.message || 'NO MESSAGE'}`);
    logger.error(`[PERSIST-ERROR] Error code: ${err?.code || 'NO CODE'}`);
    logger.error(`[PERSIST-ERROR] Error name: ${err?.name || 'NO NAME'}`);
    logger.error(`[PERSIST-ERROR] Battle ID: ${battle?.id}, Winner: ${winner?.userId}, Loser: ${loser?.userId}`);
    if (err?.stack) {
      logger.error(`[PERSIST-ERROR] Stack: ${err.stack}`);
    }
    return { winnerRatingChange: 0, loserRatingChange: 0, winnerNewBadges: [], loserNewBadges: [] };
  }
}

// Persist tie battle result to database with ELO
// IMPORTANT: ELO is ONLY updated for matchmade battles (not private battles or practice)
// noEloChange: If true, save battle but don't update ELO (for no-progress ties)
async function persistTieBattleResult(battle, player1, player2, duration, noEloChange = false) {
  try {
    // Only persist if at least one player has a userId
    if (!player1?.userId && !player2?.userId) {
      logger.debug('Skipping tie battle persistence - no authenticated users');
      return { player1RatingChange: 0, player2RatingChange: 0 };
    }

    const battleData = {
      battleUuid: battle.id,
      problemId: battle.problem.id,
      // Store player IDs even for ties so battles appear in both players' battle logs
      winnerId: player1?.userId || null,
      loserId: player2?.userId || null,
      winnerGuestSessionId: player1?.guestSessionId || null,
      loserGuestSessionId: player2?.guestSessionId || null,
      winnerTime: null,
      loserTime: null,
      isTie: true,
      isForfeit: false,
      createdAt: new Date(battle.createdAt || Date.now()).toISOString(),
      finishedAt: new Date(battle.finishedAt || Date.now()).toISOString(),
      winnerLanguage: player1?.language || 'python',
      loserLanguage: player2?.language || 'python',
      isMatchmade: battle.matchmade || false,
      winnerCode: player1?.code || null,
      loserCode: player2?.code || null
    };

    await dbHelper.saveBattleResult(battleData);
    logger.info(`[STATS-DEBUG] Tie battle ${battle.id} saved - matchmade=${battle.matchmade}, noEloChange=${noEloChange}, p1=${player1?.userId}, p2=${player2?.userId}`);

    // Skip ELO updates for no-progress ties (battle recorded but no rating impact)
    if (noEloChange) {
      logger.info(`No-progress tie battle ${battle.id} persisted (no ELO changes)`);
      return { player1RatingChange: 0, player2RatingChange: 0 };
    }

    // ONLY update ELO for MATCHMADE battles (not private battles)
    if (!battle.matchmade) {
      // Track private battle stats (separate from ranked ELO)
      if (player1?.userId) {
        await dbHelper.updatePrivateBattleStats(player1.userId, 'tie');
      }
      if (player2?.userId) {
        await dbHelper.updatePrivateBattleStats(player2.userId, 'tie');
      }
      logger.info(` Private tie battle ${battle.id} persisted (casual stats updated, no ELO changes)`);
      return { player1RatingChange: 0, player2RatingChange: 0 };
    }

    // Get current stats for ELO calculation
    let player1Stats = player1?.userId ? await dbHelper.getUserStats(player1.userId) : null;
    let player2Stats = player2?.userId ? await dbHelper.getUserStats(player2.userId) : null;

    // Default values for unauthenticated or new players
    const player1Rating = player1Stats?.rating || 1000;
    const player2Rating = player2Stats?.rating || 1000;
    const player1Games = player1Stats?.total_battles || 0;
    const player2Games = player2Stats?.total_battles || 0;

    // Calculate ELO rating changes for tie
    const eloResults = elo.calculateTieRatings(
      { rating: player1Rating, totalGames: player1Games },
      { rating: player2Rating, totalGames: player2Games }
    );

    let player1RatingChange = eloResults.player1.change;
    let player2RatingChange = eloResults.player2.change;

    // Update stats for both players
    if (player1?.userId) {
      await dbHelper.updateUserStatsWithElo(player1.userId, {
        result: 'tie',
        ratingChange: player1RatingChange,
        solveTime: null
      });
      await dbHelper.recordRatingChange(player1.userId, {
        rating: eloResults.player1.newRating,
        ratingChange: player1RatingChange,
        battleUuid: battle.id,
        result: 'tie'
      });
      const player1Rank = elo.getRankDivision(eloResults.player1.newRating);
      logger.info(`Updated tie stats for ${player1.name}: ${player1Rating} → ${eloResults.player1.newRating} (${player1RatingChange >= 0 ? '+' : ''}${player1RatingChange}) [${player1Rank.display}]`);
    }

    if (player2?.userId) {
      await dbHelper.updateUserStatsWithElo(player2.userId, {
        result: 'tie',
        ratingChange: player2RatingChange,
        solveTime: null
      });
      await dbHelper.recordRatingChange(player2.userId, {
        rating: eloResults.player2.newRating,
        ratingChange: player2RatingChange,
        battleUuid: battle.id,
        result: 'tie'
      });
      const player2Rank = elo.getRankDivision(eloResults.player2.newRating);
      logger.info(`Updated tie stats for ${player2.name}: ${player2Rating} → ${eloResults.player2.newRating} (${player2RatingChange >= 0 ? '+' : ''}${player2RatingChange}) [${player2Rank.display}]`);
    }

    // Store rating changes in battle history for display (non-fatal)
    try {
      await dbHelper.updateBattleRatingChanges(battle.id, player1RatingChange, player2RatingChange);
    } catch (e) {
      logger.warn('Failed to store tie rating changes in battle history:', e.message);
    }

    logger.info(` Matchmade tie battle ${battle.id} persisted with ELO updates`);

    // Check and award badges for both players (rank badges from rating change)
    let player1NewBadges = [];
    let player2NewBadges = [];

    if (player1?.userId) {
      try {
        player1NewBadges = await badgeService.checkAfterRatingChange(player1.userId);
        notifyNewBadges(player1.userId, player1NewBadges);
        if (player1NewBadges.length > 0) {
          logger.info(` ${player1.name} earned ${player1NewBadges.length} badge(s): ${player1NewBadges.map(b => b.name).join(', ')}`);
          for (const badge of player1NewBadges) {
            await activityService.recordBadgeEarned(player1.userId, {
              badgeName: badge.name,
              badgeSlug: badge.slug,
              badgeIcon: badge.icon,
              badgeRarity: badge.rarity
            });
          }
        }
        // Check for rank change
        const oldP1Rank = elo.getRankDivision(player1Stats?.rating || 1000);
        const newP1Rank = elo.getRankDivision(eloResults.player1.newRating);
        if (newP1Rank.name !== oldP1Rank.name) {
          await activityService.recordRankUp(player1.userId, {
            rank: newP1Rank.display,
            rating: eloResults.player1.newRating
          });
        }
      } catch (err) {
        logger.error('Badge/activity check failed for player1 in tie:', err);
      }
    }

    if (player2?.userId) {
      try {
        player2NewBadges = await badgeService.checkAfterRatingChange(player2.userId);
        notifyNewBadges(player2.userId, player2NewBadges);
        if (player2NewBadges.length > 0) {
          logger.info(` ${player2.name} earned ${player2NewBadges.length} badge(s): ${player2NewBadges.map(b => b.name).join(', ')}`);
          for (const badge of player2NewBadges) {
            await activityService.recordBadgeEarned(player2.userId, {
              badgeName: badge.name,
              badgeSlug: badge.slug,
              badgeIcon: badge.icon,
              badgeRarity: badge.rarity
            });
          }
        }
        // Check for rank change
        const oldP2Rank = elo.getRankDivision(player2Stats?.rating || 1000);
        const newP2Rank = elo.getRankDivision(eloResults.player2.newRating);
        if (newP2Rank.name !== oldP2Rank.name) {
          await activityService.recordRankUp(player2.userId, {
            rank: newP2Rank.display,
            rating: eloResults.player2.newRating
          });
        }
      } catch (err) {
        logger.error('Badge/activity check failed for player2 in tie:', err);
      }
    }

    // Invalidate leaderboard cache since ratings changed
    try {
      const usersRouter = require('./routes/users');
      usersRouter.invalidateLeaderboardCache?.();
    } catch (e) {
      logger.warn('Failed to invalidate leaderboard cache:', e.message);
    }

    return {
      player1RatingChange,
      player2RatingChange,
      player1NewRating: eloResults.player1.newRating,
      player2NewRating: eloResults.player2.newRating,
      player1Rank: elo.getRankDivision(eloResults.player1.newRating),
      player2Rank: elo.getRankDivision(eloResults.player2.newRating),
      player1NewBadges,
      player2NewBadges
    };
  } catch (err) {
    logger.error('Failed to persist tie battle result:', err);
    return { player1RatingChange: 0, player2RatingChange: 0, player1NewBadges: [], player2NewBadges: [] };
  }
}

// Persist partial credit battle result (winner determined by test progress on timeout)
// IMPORTANT: ELO is ONLY updated for matchmade battles
async function persistPartialCreditBattleResult(battle, winner, loser, duration) {
  try {
    // Early exit: no authenticated users
    if (!winner?.userId && !loser?.userId) {
      logger.debug('Skipping partial credit battle persistence - no authenticated users');
      return { winnerRatingChange: 0, loserRatingChange: 0 };
    }

    const totalTests = battle.problem?.testCases?.length || 10;

    // Save battle record with partial credit data
    await dbHelper.saveBattleResult({
      battleUuid: battle.id,
      problemId: battle.problem.id,
      winnerId: winner?.userId || null,
      loserId: loser?.userId || null,
      winnerGuestSessionId: winner?.guestSessionId || null,
      loserGuestSessionId: loser?.guestSessionId || null,
      winnerTime: duration,
      loserTime: duration,
      isTie: false,
      isForfeit: false,
      createdAt: new Date(battle.createdAt || Date.now()).toISOString(),
      finishedAt: new Date(battle.finishedAt || Date.now()).toISOString(),
      winnerLanguage: winner?.language || 'python',
      loserLanguage: loser?.language || 'python',
      isMatchmade: battle.matchmade || false,
      isPartialCredit: true,
      winnerTestsPassed: winner.testsPassed || 0,
      loserTestsPassed: loser.testsPassed || 0,
      winnerCode: winner?.code || null,
      loserCode: loser?.code || null
    });

    // Private battles: update casual stats only, no ELO
    if (!battle.matchmade) {
      if (winner?.userId) await dbHelper.updatePrivateBattleStats(winner.userId, 'win');
      if (loser?.userId) await dbHelper.updatePrivateBattleStats(loser.userId, 'loss');
      logger.info(`Private partial credit battle ${battle.id} persisted (no ELO)`);
      return { winnerRatingChange: 0, loserRatingChange: 0 };
    }

    // Get current stats for ELO calculation
    const winnerStats = winner?.userId ? await dbHelper.getUserStats(winner.userId) : null;
    const loserStats = loser?.userId ? await dbHelper.getUserStats(loser.userId) : null;
    const winnerRating = winnerStats?.rating || 1000;
    const loserRating = loserStats?.rating || 1000;

    // Calculate partial credit ELO
    const eloResults = elo.calculatePartialCreditRatings(
      { rating: winnerRating, totalGames: winnerStats?.total_battles || 0, testsPassed: winner.testsPassed || 0 },
      { rating: loserRating, totalGames: loserStats?.total_battles || 0, testsPassed: loser.testsPassed || 0 },
      totalTests
    );

    // Update ratings using helper function
    await updatePlayerRating(winner, eloResults.winner, battle.id, 'partial_credit_win');
    await updatePlayerRating(loser, eloResults.loser, battle.id, 'partial_credit_loss');

    // Store rating changes in battle history for display (non-fatal)
    try {
      await dbHelper.updateBattleRatingChanges(battle.id, eloResults.winner.change, eloResults.loser.change);
    } catch (e) {
      logger.warn('Failed to store rating changes in battle history:', e.message);
    }

    logger.info(`Partial credit battle ${battle.id}: ${winner.testsPassed || 0}/${totalTests} vs ${loser.testsPassed || 0}/${totalTests} (scale: ${eloResults.scaleFactor})`);

    // Check badges and record activity using helper function
    const winnerNewBadges = await checkPlayerBadgesAndActivity(winner?.userId, winnerRating, eloResults.winner.newRating);
    const loserNewBadges = await checkPlayerBadgesAndActivity(loser?.userId, loserRating, eloResults.loser.newRating);

    // Invalidate leaderboard cache
    try {
      require('./routes/users').invalidateLeaderboardCache?.();
    } catch (e) {
      logger.warn('Failed to invalidate leaderboard cache:', e.message);
    }

    return {
      winnerRatingChange: eloResults.winner.change,
      loserRatingChange: eloResults.loser.change,
      winnerNewRating: eloResults.winner.newRating,
      loserNewRating: eloResults.loser.newRating,
      winnerRank: elo.getRankDivision(eloResults.winner.newRating),
      loserRank: elo.getRankDivision(eloResults.loser.newRating),
      winnerNewBadges,
      loserNewBadges,
      scaleFactor: eloResults.scaleFactor,
      testDifference: eloResults.testDifference
    };
  } catch (err) {
    logger.error('Failed to persist partial credit battle:', err);
    return { winnerRatingChange: 0, loserRatingChange: 0 };
  }
}

// Helper function for anti-cheat violation messages
function getViolationMessage(violationType, severity) {
  const messages = {
    'tab_switch': 'Your opponent switched away from the battle tab',
    'extended_absence': 'Your opponent was away for an extended period',
    'copy_attempt': 'Your opponent attempted to copy content',
    'paste_attempt': 'Your opponent attempted to paste content',
    'devtools_open': 'Your opponent opened developer tools',
    'keyboard_shortcut': 'Your opponent used a blocked keyboard shortcut',
    'right_click': 'Your opponent attempted to use context menu',
    'suspicious_solve_time': 'Suspicious solve time detected'
  };
  const defaultMsg = 'A fair play violation was detected';
  const baseMsg = messages[violationType] || defaultMsg;
  return severity === 'critical' ? `⚠️ ${baseMsg}` : baseMsg;
}

const app = express();

// Trust proxy for Railway/cloud deployments (required for rate limiting)
app.set('trust proxy', 1);

// Sentry request handling is automatic in v8+

const server = http.createServer(app);

const corsOptions = {
  origin: createCorsOriginHandler({
    allowedOrigins: buildAllowedOrigins(),
    onDenied: origin => logger.warn('CORS blocked origin:', origin)
  }),
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control']
};

app.use(cors(corsOptions));
app.use(corsErrorHandler);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false, // Allow embedding from other origins
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Stripe webhook needs raw body - must be BEFORE express.json()
const paymentRouter = require('./routes/payment');
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), paymentRouter.handleWebhook);

// Body size limits: 1MB for JSON (code submissions, system prompts)
// Prevents DoS attacks via large payloads while allowing generous code submissions
// Capture the raw request body so webhook handlers (e.g. ATS) can verify HMAC
// signatures over the exact received bytes rather than a re-serialized body.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve uploaded screenshots
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiting configuration
const rateLimit = require('express-rate-limit');

// Helper to extract user ID from JWT for rate limiting
function getRateLimitKey(req) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Key on the user only when the signature verifies; a forged payload
      // must not buy a fresh bucket per request.
      const payload = jwt.verify(authHeader.slice(7), SECRET, { algorithms: ['HS256'] });
      if (payload.sub) {
        return `user:${payload.sub}`;
      }
    }
  } catch {
    // Unsigned, expired or malformed: fall back to the client address
  }
  return rateLimit.ipKeyGenerator(req.ip);
}

// Pre-auth endpoints must never trust an unverified JWT when deriving their
// rate-limit key. Otherwise an attacker can rotate a forged `sub` claim to
// bypass login and registration throttles.
function ipOnlyRateLimitKey(req) {
  return rateLimit.ipKeyGenerator(req.ip);
}

// General API rate limit - 200 requests per minute per user/IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // Relaxed in development so local testing (many API calls from one IP, plus
  // page reloads) doesn't trip the umbrella limit; production stays strict.
  max: process.env.NODE_ENV === 'production' ? 200 : 10000,
  message: { error: 'Too many requests, please try again later', success: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  validate: { xForwardedForHeader: false, default: false }, // Disable validation for custom keyGenerator
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/';
  }
});

// Strict rate limit for auth endpoints - 15 requests per minute
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // Relaxed in development so the dev auto-login (fires on every page load,
  // shared localhost IP) doesn't trip it; production stays strict.
  max: process.env.NODE_ENV === 'production' ? 15 : 300,
  message: { error: 'Too many login attempts, please try again later', success: false },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipOnlyRateLimitKey,
  validate: { xForwardedForHeader: false, default: false },
});

// Very strict rate limit for password reset - 3 requests per 15 minutes
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: { error: 'Too many password reset attempts, please try again later', success: false },
  standardHeaders: true,
  legacyHeaders: false,
});

// Code execution rate limit - 30 requests per minute (expensive operation)
const executionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many code submissions, please slow down', success: false },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limit to all API routes
app.use('/api/', generalLimiter);
app.use('/auth/', generalLimiter);

// Apply stricter limits to specific endpoints
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/dev-session', authLimiter);
app.use('/auth/forgot-password', passwordResetLimiter);
app.use('/auth/reset-password', passwordResetLimiter);
app.use('/api/practice/run', executionLimiter);
app.use('/api/practice/run-custom', executionLimiter);
app.use('/api/challenge/submit', executionLimiter);
app.use('/api/prompt-practice/evaluate', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many evaluations, please slow down', success: false },
  standardHeaders: true,
  legacyHeaders: false,
}));

// Tier 1: Expensive external API calls (strictest, 5/min)
const expensiveApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please slow down.', success: false },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/ai/prompt', expensiveApiLimiter);

// Tier 2: Data-heavy public endpoints (30/min)
const publicDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please slow down.', success: false },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/problems', publicDataLimiter);
app.use('/api/search', publicDataLimiter);
app.use('/api/stats/public', publicDataLimiter);
app.use('/api/games/gallery', publicDataLimiter);
app.use('/api/users/search', publicDataLimiter);
app.use('/api/battles/recent', publicDataLimiter);

// Tier 3: Health endpoint (10/min, was previously unlimited)
app.use('/health', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

logger.info('[RateLimit] Rate limiting enabled');

// Initialize database and routes
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const messagesRouter = require('./routes/messages');
const friendsRouter = require('./routes/friends');
const { cleanupFriendsInterval } = require('./routes/friends');
const challengeRouter = require('./routes/challenge');
const notificationsRouter = require('./routes/notifications');
const analyticsRouter = require('./routes/analytics');
const feedbackRouter = require('./routes/feedback');
const badgesRouter = require('./routes/badges');
const activityRouter = require('./routes/activity');
const tournamentsRouter = require('./routes/tournaments');
const moderationRouter = require('./routes/moderation');
const bugReportsRouter = require('./routes/bugReports');
const featureRequestsRouter = require('./routes/featureRequests');
const trustTierRouter = require('./routes/trustTier');
const rewardsRouter = require('./routes/rewards');
const adminRouter = require('./routes/admin');
const promptBattleRouter = require('./routes/promptBattle');
const { registerPromptBattleHandlers, startMatchedBattle, removeUserFromPromptBattleQueue } = require('./services/promptBattleSocket');
const { sanitizeModelId, getDefaultPromptBattleModelId } = require('./services/promptBattleRunner');
const promptPracticeRouter = require('./routes/promptPractice');
const newsletterRouter = require('./routes/newsletter');
const avatarUploadRouter = require('./routes/avatarUpload');
const aiRouter = require('./routes/ai');
const gamesRouter = require('./routes/games');
const agentBattleRouter = require('./routes/agentBattle');
const agentTournamentRouter = require('./routes/agentTournament');
const agentTrainingRouter = require('./routes/agentTraining');
const scheduler = require('./services/scheduler');
const badgeService = require('./services/badgeService');
// Helper: create in-app notifications for newly awarded badges
async function notifyNewBadges(userId, newBadges) {
  if (!Array.isArray(newBadges) || newBadges.length === 0) return;
  for (const badge of newBadges) {
    try {
      await dbHelper.createNotification(userId, {
        type: 'badge_earned',
        title: `Badge earned: ${badge.name || badge.slug || 'New badge'}`,
        message: badge.description || '',
        link: '/progress'
      });
    } catch (e) { /* ignore notification errors */ }
  }
}
const activityService = require('./services/activityService');
const rewardService = require('./services/rewardService');
const dbHelper = require('./db');
const { validateSolution: executeAndValidateSolution, runSingleTest, allTestsPassed, executionWasUnavailable } = require('./services/validateSolution');
const { getLanguageRejection } = require('./services/validateSolution');
app.use('/auth/avatar', authRouter.authMiddleware, avatarUploadRouter);
app.use('/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/challenge', challengeRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/badges', badgesRouter);
app.use('/api/activity', activityRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/moderation', moderationRouter);
app.use('/api/bug-reports', bugReportsRouter);
app.use('/api/feature-requests', featureRequestsRouter);
app.use('/api/trust', trustTierRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/prompt-battle', promptBattleRouter);
app.use('/api/prompt-practice', promptPracticeRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/games', gamesRouter);
// Agent battles are off unless the operator enables them (see AGENT_PRODUCT_ENABLED).
const requireAgentBattles = (req, res, next) => (AGENT_PRODUCT_ENABLED ? next() : res.status(503).json({ notEnabled: true, error: 'Agent battles are not enabled on this server.' }));
app.use('/api/agent/tournaments', requireAgentBattles, agentTournamentRouter);
app.use('/api/agent/training', requireAgentBattles, agentTrainingRouter);
app.use('/api/agent', requireAgentBattles, agentBattleRouter);
app.use('/api/search', require('./routes/search'));
app.use('/api/ai', aiRouter);

app.use((req, res, next) => {
  logger.debug(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('Origin')}`);
  next();
});

const io = socketIo(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// When a user's sessions change (sign-out, sign out everywhere, password reset,
// account reclaimed), drop their open sockets whose session is no longer valid.
require('./utils/securityEvents').securityEvents.on('sessions-changed', async (userId) => {
  const socketIds = global.userSockets?.get(userId);
  if (!socketIds) return;
  for (const socketId of [...socketIds]) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    try {
      await authenticateSessionToken(socket.handshake.auth?.token, dbHelper, SECRET);
    } catch {
      socket.emit('session-ended', { reason: 'signed_out' });
      socket.disconnect(true);
      logger.info(`[AUTH] Disconnected socket ${socketId.slice(0, 8)} for user ${userId}: session no longer valid`);
    }
  }
});

// Socket.io authentication middleware - verify JWT on connection
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    logger.warn('Socket connection rejected: No auth token provided');
    return next(new Error('Authentication required'));
  }

  try {
    const { userId, claims: decoded } = await authenticateSessionToken(token, dbHelper, SECRET);
    socket.userId = userId;
    // Fetch fresh username from DB (JWT may have stale placeholder like player_xxxxx)
    const freshUser = await dbHelper.getUserById(userId);
    socket.username = freshUser?.username || decoded.username;

    // Register socket in global.userSockets for challenge notifications
    if (!global.userSockets) {
      global.userSockets = new Map();
    }
    if (!global.userSockets.has(userId)) {
      global.userSockets.set(userId, new Set());
    }
    global.userSockets.get(userId).add(socket.id);

    // Join user-specific room for reliable event delivery
    socket.join(`user:${userId}`);
    socket.join(`pb-player:${userId}`);

    logger.debug(`[AUTH] Socket ${socket.id} authenticated: userId=${userId}, username=${decoded.username}, room=user:${userId}`);
    next();
  } catch (err) {
    logger.warn('Socket connection rejected: Invalid token', err.message);
    return next(new Error('Invalid authentication token'));
  }
});

// Sentry error handler (must be before other error handlers)
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use((err, req, res, next) => {
  logger.error('Global error handler:', err);

  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      success: false,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// SOCKET SECURITY HELPERS
// ============================================

/**
 * Verify that the authenticated socket user owns the specified player slot
 * Prevents attackers from manipulating other players' game state
 * @returns {boolean} true if ownership verified, false otherwise
 */
function verifyPlayerOwnership(socket, player, emitError = true) {
  if (!player) {
    if (emitError) socket.emit('error', 'Player not found');
    return false;
  }
  if (!player.userId) {
    logger.warn(`[SECURITY] Player missing userId`);
    if (emitError) socket.emit('error', 'Not authorized to perform this action');
    return false;
  }
  if (String(player.userId) !== String(socket.userId)) {
    logger.warn(`[SECURITY] Ownership check failed: socket.userId=${socket.userId}, player.userId=${player.userId}`);
    if (emitError) socket.emit('error', 'Not authorized to perform this action');
    return false;
  }
  return true;
}

/**
 * Filter battle object to remove sensitive data before sending to a specific player
 * Prevents information disclosure (opponent's code, keystroke data, etc.)
 */
function filterBattleForPlayer(battle, playerId) {
  if (!battle) return null;

  return {
    id: battle.id,
    state: battle.state,
    mode: battle.mode,
    type: battle.type,
    timeLimit: battle.timeLimit,
    problem: problemsLoader.getVisibleProblem(battle.problem),
    startedAt: battle.startedAt,
    createdAt: battle.createdAt,
    matchmade: battle.matchmade,
    battleType: battle.battleType,
    copilotEnabled: battle.copilotEnabled || false,
    players: battle.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      language: p.language,
      hasSubmitted: p.hasSubmitted,
      testsPassed: p.testsPassed || 0,
      testsTotal: p.testsTotal || 0,
      finishTime: p.finishTime,
      // Include userId for friend requests on battle end screen
      userId: p.userId || null,
      // Include isBot flag so frontend knows opponent is a bot
      isBot: p.isBot || false,
      // Only include code for the requesting player
      code: p.id === playerId ? p.code : undefined,
      // Never expose keystroke data or anti-cheat info to clients
    }))
  };
}

// Load problems using lazy loader (splits by difficulty for memory efficiency)
const problemsLoader = require('./problemsLoader');
logger.info(` Problems loader initialized (${problemsLoader.count()} problems available)`);
logger.info(require('./arena/runner').describeRunner());

// ============================================
// COMPLEXITY-BASED PERFORMANCE RATING
// ============================================

const { getComplexityRank } = require('./utils/complexityRank');

async function analyzeComplexity(code, language, problemTitle, problemDescription) {
  if (!anthropicServer) return null;
  try {
    const prompt = `Analyze the time complexity of this ${language} solution and determine the optimal time complexity for the problem.

## Problem:
${problemTitle || 'Coding Challenge'}
${problemDescription || ''}

## Solution:
\`\`\`${language}
${code}
\`\`\`

Respond with ONLY valid JSON (no markdown code blocks):
{
  "userComplexity": "O(...)",
  "optimalComplexity": "O(...)",
  "explanation": "1 sentence: what the user's approach is and how it compares to optimal"
}

Rules:
- userComplexity: the actual time complexity of the submitted code
- optimalComplexity: the best known time complexity achievable for this problem
- Use standard Big-O notation: O(1), O(log n), O(n), O(n log n), O(n^2), O(n^3), O(2^n), O(n!)`;

    const response = await anthropicServer.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content?.[0]?.text;
    const jsonMatch = content?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.userComplexity || !result.optimalComplexity) return null;
    return result;
  } catch (err) {
    logger.error('[COMPLEXITY] Analysis failed:', err?.message);
    return null;
  }
}

function getComplexityPerformance(userComplexity, optimalComplexity, explanation) {
  const userRank = getComplexityRank(userComplexity);
  const optimalRank = getComplexityRank(optimalComplexity);

  // Fallback if we can't parse complexities
  if (userRank === null || optimalRank === null) {
    return {
      percentile: 50,
      rating: "Solved",
      message: "Solution accepted!",
      color: "text-yellow-400",
      userComplexity: userComplexity || 'Unknown',
      optimalComplexity: optimalComplexity || 'Unknown',
      explanation: explanation || ''
    };
  }

  const diff = userRank - optimalRank;
  let percentile, rating, message, color;

  if (diff <= 0) {
    percentile = 100;
    rating = "Optimal";
    message = `Your ${userComplexity} solution matches the optimal time complexity!`;
    color = "text-purple-400";
  } else if (diff === 1) {
    percentile = 75;
    rating = "Near Optimal";
    message = `Your ${userComplexity} is close, optimal is ${optimalComplexity}.`;
    color = "text-emerald-400";
  } else if (diff === 2) {
    percentile = 50;
    rating = "Good";
    message = `Your ${userComplexity} works, but ${optimalComplexity} is achievable.`;
    color = "text-yellow-400";
  } else if (diff === 3) {
    percentile = 25;
    rating = "Suboptimal";
    message = `Your ${userComplexity} could be improved to ${optimalComplexity}.`;
    color = "text-orange-400";
  } else {
    percentile = 10;
    rating = "Brute Force";
    message = `Your ${userComplexity} is far from the optimal ${optimalComplexity}. Try a different approach!`;
    color = "text-red-400";
  }

  return { percentile, rating, message, color, userComplexity, optimalComplexity, explanation: explanation || '' };
}

// Fallback time-based rating (used when AI complexity analysis is unavailable)
const getTimeFallbackRating = (solveTime) => {
  if (solveTime <= 30) return { percentile: 100, rating: "Lightning Fast", message: "Record time!", color: "text-purple-400" };
  if (solveTime <= 60) return { percentile: 90, rating: "Very Fast", message: "Outstanding speed!", color: "text-emerald-400" };
  if (solveTime <= 120) return { percentile: 80, rating: "Fast", message: "Top tier performance.", color: "text-green-400" };
  if (solveTime <= 240) return { percentile: 70, rating: "Strong", message: "Faster than most!", color: "text-teal-400" };
  if (solveTime <= 360) return { percentile: 60, rating: "Above Average", message: "Great work!", color: "text-blue-400" };
  if (solveTime <= 480) return { percentile: 50, rating: "Steady", message: "Solid performance.", color: "text-yellow-400" };
  if (solveTime <= 600) return { percentile: 40, rating: "Thoughtful", message: "Improving with each solve.", color: "text-orange-400" };
  if (solveTime <= 900) return { percentile: 30, rating: "Determined", message: "You solved it!", color: "text-orange-500" };
  if (solveTime <= 1200) return { percentile: 20, rating: "Persistent", message: "Every solve makes you better.", color: "text-red-400" };
  return { percentile: 10, rating: "Completed", message: "First step is completing the challenge!", color: "text-gray-400" };
};

const battles = new Map();
const botBattleGuard = createBotBattleGuard();
const battleLocks = new Map(); // Locks for atomic battle state operations
const playerConnections = new Map();
const matchmakingQueue = new Map();
const matchingInProgress = new Set(); // Prevents race conditions in simultaneous matching
const pendingDisconnectTimeouts = new Map(); // Tracks pending queue removal timeouts to prevent race conditions
// Grace-then-forfeit timers for a player who drops mid-battle: `${battleId}:${playerId}` -> timeoutId.
// If they don't reconnect within the grace window the battle is forfeited so the opponent isn't left
// waiting out the full timer. The timer re-verifies state at fire time, so it self-cancels on reconnect.
const battleDisconnectForfeitTimeouts = new Map();
const DISCONNECT_FORFEIT_GRACE_MS = 45000;

/**
 * Acquires a lock for atomic battle operations
 * Prevents race conditions when multiple submissions arrive simultaneously
 * @param {string} battleId - The battle to lock
 * @param {number} timeout - Maximum wait time in ms (default 5000)
 * @returns {Promise<Function>} - Release function to call when done
 */
async function acquireBattleLock(battleId, timeout = 5000) {
  const startTime = Date.now();

  while (battleLocks.has(battleId)) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Battle lock acquisition timeout');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  battleLocks.set(battleId, Date.now());

  return () => {
    battleLocks.delete(battleId);
  };
}

/**
 * Executes a function with an exclusive battle lock
 * Ensures atomic state transitions for battle operations
 * @param {string} battleId - The battle to lock
 * @param {Function} fn - Async function to execute with lock held
 * @returns {Promise<any>} - Result of the function
 */
async function withBattleLock(battleId, fn) {
  const release = await acquireBattleLock(battleId);
  try {
    return await fn();
  } finally {
    release();
  }
}

// Clean up stale locks periodically (in case of crashes)
const staleLockCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [battleId, acquiredAt] of battleLocks.entries()) {
    if (now - acquiredAt > 30000) { // 30 second max lock time
      logger.warn(`Cleaning up stale battle lock for ${battleId}`);
      battleLocks.delete(battleId);
    }
  }
}, 10000);
const QUEUE_TIMEOUT = 300000;
const SAME_LANGUAGE_GRACE_PERIOD = 10000;
const MAX_QUEUE_SIZE = 1000; // Increased for 1K concurrent users

function getPositiveIntegerSetting(name, fallback) {
  const configured = Number.parseInt(process.env[name], 10);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

const MAX_BATTLES = getPositiveIntegerSetting('CODEARENA_MAX_IN_MEMORY_BATTLES', 2000);
const MAX_ACTIVE_PRIVATE_BATTLES_PER_USER = getPositiveIntegerSetting(
  'CODEARENA_MAX_ACTIVE_PRIVATE_BATTLES_PER_USER',
  2
);

function countActivePrivateBattlesForUser(userId) {
  if (userId == null) return 0;
  const normalizedUserId = String(userId);
  let count = 0;

  for (const battle of battles.values()) {
    if (battle.creationKind !== 'private') continue;
    if (battle.state === 'finished' || battle.state === 'error') continue;
    if (battle.players?.some(player => String(player.userId) === normalizedUserId)) count++;
  }

  return count;
}

// Evict oldest finished battles when at capacity
function evictOldBattlesIfNeeded() {
  if (battles.size < MAX_BATTLES) return;

  const finishedBattles = [];
  for (const [id, battle] of battles) {
    if (battle.state === 'finished' && battle.finishedAt) {
      finishedBattles.push({ id, finishedAt: battle.finishedAt });
    }
  }

  // Sort by oldest first and delete until under limit
  finishedBattles.sort((a, b) => a.finishedAt - b.finishedAt);
  const toDelete = Math.max(1, battles.size - MAX_BATTLES + 200); // Delete 200 extra to avoid frequent eviction

  for (let i = 0; i < Math.min(toDelete, finishedBattles.length); i++) {
    const battleToEvict = battles.get(finishedBattles[i].id);
    // Clear bot timeout to prevent memory leaks from dangling timeouts
    if (battleToEvict?.botSubmitTimeout) {
      clearTimeout(battleToEvict.botSubmitTimeout);
      battleToEvict.botSubmitTimeout = null;
    }
    battles.delete(finishedBattles[i].id);
    rematchRequests.delete(finishedBattles[i].id);
  }

  if (finishedBattles.length > 0) {
    logger.info(`Evicted ${Math.min(toDelete, finishedBattles.length)} old battles. Current size: ${battles.size}`);
  }
}
let queueCleanupInterval = null;
const rematchRequests = new Map();
const REMATCH_TIMEOUT = 30000;

// Socket event throttling utilities
const socketThrottles = new Map(); // Map<socketId, Map<eventName, lastCallTime>>
const THROTTLE_STALE_TIMEOUT = 5 * 60 * 1000; // 5 minutes - clean up stale throttle entries

/**
 * Creates a throttled socket event handler
 * @param {string} eventName - Name of the socket event
 * @param {number} minInterval - Minimum interval between calls in ms
 * @param {Function} handler - The actual handler function
 */
function throttleSocketEvent(socket, eventName, minInterval, handler) {
  return (...args) => {
    const socketId = socket.id;
    if (!socketThrottles.has(socketId)) {
      socketThrottles.set(socketId, new Map());
    }
    const socketEvents = socketThrottles.get(socketId);
    const now = Date.now();
    const lastCall = socketEvents.get(eventName) || 0;

    if (now - lastCall >= minInterval) {
      socketEvents.set(eventName, now);
      handler(...args);
    }
  };
}

/**
 * Clean up throttle state when socket disconnects
 */
function cleanupSocketThrottle(socketId) {
  socketThrottles.delete(socketId);
}

/**
 * Periodic cleanup of stale throttle entries (memory leak prevention)
 * Removes entries for sockets that no longer exist
 */
function cleanupStaleThrottles(io) {
  const now = Date.now();
  let cleaned = 0;

  for (const [socketId, events] of socketThrottles.entries()) {
    // Check if socket still exists
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) {
      socketThrottles.delete(socketId);
      cleaned++;
      continue;
    }

    // Also clean up event entries that are very old (in case of orphaned data)
    for (const [eventName, lastCall] of events.entries()) {
      if (now - lastCall > THROTTLE_STALE_TIMEOUT) {
        events.delete(eventName);
      }
    }

    // Remove socket entry if no events left
    if (events.size === 0) {
      socketThrottles.delete(socketId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`[Throttle Cleanup] Removed ${cleaned} stale throttle entries`);
  }
}

/**
 * Safely emit to a socket (checks connection state first)
 */
function safeEmit(socket, event, data) {
  if (socket && socket.connected) {
    socket.emit(event, data);
    return true;
  }
  return false;
}

/**
 * Safely clear an interval stored on a socket
 */
function clearSocketInterval(socket, intervalName) {
  if (socket && socket[intervalName]) {
    clearInterval(socket[intervalName]);
    socket[intervalName] = null;
  }
}

// Throttle intervals for high-frequency events (in milliseconds)
const THROTTLE_INTERVALS = {
  'code-update': 100,       // Max 10 updates/second
  'typing-start': 500,      // Max 2/second
  'typing-stop': 500,       // Max 2/second
};

// ============================================
// WebSocket Rate Limiting (DoS Protection)
// ============================================
const socketRateLimits = new Map(); // Map<socketId, Map<eventName, { count, windowStart }>>
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window

// Rate limits: { maxRequests, blockDurationMs (optional - 0 means just reject) }
const RATE_LIMIT_CONFIG = {
  // Battle actions - moderate limits
  'join-battle': { maxRequests: 10, blockDurationMs: 0 },
  'exit-battle': { maxRequests: 10, blockDurationMs: 0 },
  'start-battle': { maxRequests: 10, blockDurationMs: 0 },
  'player-ready': { maxRequests: 20, blockDurationMs: 0 },
  'request-countdown': { maxRequests: 10, blockDurationMs: 0 },

  // Code submission - strict limits
  'submit-solution': { maxRequests: 30, blockDurationMs: 5000 },
  'forfeit-battle': { maxRequests: 5, blockDurationMs: 0 },

  // Rematch - moderate limits
  'request-rematch': { maxRequests: 10, blockDurationMs: 0 },
  'respond-rematch': { maxRequests: 10, blockDurationMs: 0 },
  'cancel-rematch': { maxRequests: 10, blockDurationMs: 0 },

  // Messaging - stricter limits to prevent spam
  'send-message': { maxRequests: 60, blockDurationMs: 10000 },
  'toggle-message-reaction': { maxRequests: 120, blockDurationMs: 5000 },
  'send-challenge': { maxRequests: 20, blockDurationMs: 5000 },

  // Social actions
  'send-friend-request': { maxRequests: 30, blockDurationMs: 5000 },
  'accept-friend-request': { maxRequests: 30, blockDurationMs: 0 },
  'decline-friend-request': { maxRequests: 30, blockDurationMs: 0 },

  // Anti-cheat reporting
  'report-violation': { maxRequests: 20, blockDurationMs: 0 },

  // Matchmaking
  'update-queue-socket': { maxRequests: 30, blockDurationMs: 0 },
  'decline-match-stay-in-queue': { maxRequests: 10, blockDurationMs: 0 },
};

/**
 * Check if a socket event should be rate limited
 * @param {string} socketId - The socket ID
 * @param {string} eventName - The event name to check
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
function checkRateLimit(socketId, eventName) {
  const config = RATE_LIMIT_CONFIG[eventName];
  if (!config) {
    return { allowed: true, remaining: Infinity, resetIn: 0 };
  }

  const now = Date.now();

  if (!socketRateLimits.has(socketId)) {
    socketRateLimits.set(socketId, new Map());
  }

  const socketEvents = socketRateLimits.get(socketId);
  let eventData = socketEvents.get(eventName);

  // Initialize or reset window if expired
  if (!eventData || (now - eventData.windowStart) >= RATE_LIMIT_WINDOW_MS) {
    eventData = { count: 0, windowStart: now, blockedUntil: 0 };
    socketEvents.set(eventName, eventData);
  }

  // Check if currently blocked
  if (eventData.blockedUntil && now < eventData.blockedUntil) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: eventData.blockedUntil - now,
      blocked: true
    };
  }

  // Check rate limit
  if (eventData.count >= config.maxRequests) {
    // Apply block duration if configured
    if (config.blockDurationMs > 0) {
      eventData.blockedUntil = now + config.blockDurationMs;
    }
    return {
      allowed: false,
      remaining: 0,
      resetIn: RATE_LIMIT_WINDOW_MS - (now - eventData.windowStart)
    };
  }

  // Increment counter and allow
  eventData.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - eventData.count,
    resetIn: RATE_LIMIT_WINDOW_MS - (now - eventData.windowStart)
  };
}

/**
 * Wrapper to add rate limiting to a socket event handler
 * @param {Socket} socket - The socket instance
 * @param {string} eventName - The event name
 * @param {Function} handler - The handler function
 */
function rateLimitedHandler(socket, eventName, handler) {
  return async (...args) => {
    const result = checkRateLimit(socket.id, eventName);

    if (!result.allowed) {
      logger.warn(`[Rate Limit] Socket ${socket.id.substring(0, 8)} exceeded limit for '${eventName}' (blocked: ${result.blocked || false})`);
      socket.emit('rate-limit-exceeded', {
        event: eventName,
        retryAfter: Math.ceil(result.resetIn / 1000),
        message: result.blocked
          ? `Too many requests. Temporarily blocked for ${Math.ceil(result.resetIn / 1000)} seconds.`
          : `Rate limit exceeded. Try again in ${Math.ceil(result.resetIn / 1000)} seconds.`
      });
      return;
    }

    // Call the original handler
    try {
      await handler(...args);
    } catch (error) {
      logger.error(`[Socket Handler Error] ${eventName}:`, error);
    }
  };
}

/**
 * Clean up rate limit state when socket disconnects
 */
function cleanupSocketRateLimit(socketId) {
  socketRateLimits.delete(socketId);
}

/**
 * Periodic cleanup of stale rate limit entries
 */
function cleanupStaleRateLimits() {
  const now = Date.now();
  let cleaned = 0;

  for (const [socketId, events] of socketRateLimits.entries()) {
    for (const [eventName, data] of events.entries()) {
      // Remove entries older than 1.5x the window (definitely stale)
      if (now - data.windowStart > RATE_LIMIT_WINDOW_MS * 1.5) {
        events.delete(eventName);
      }
    }

    if (events.size === 0) {
      socketRateLimits.delete(socketId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`[Rate Limit Cleanup] Removed ${cleaned} stale entries`);
  }
}

// Run rate limit cleanup every 2 minutes
const rateLimitCleanupInterval = setInterval(cleanupStaleRateLimits, 2 * 60 * 1000);

// ============================================
// Async Socket Handler Wrapper (Error Safety)
// ============================================
/**
 * Wraps an async socket handler with consistent error handling
 * Prevents unhandled promise rejections from crashing the server
 * @param {string} eventName - Event name for logging
 * @param {Function} handler - Async handler function
 * @param {Object} options - Options for error handling
 * @param {string} options.errorEvent - Event to emit on error (default: 'error')
 * @param {string} options.errorMessage - Default error message
 */
function asyncSocketHandler(eventName, handler, options = {}) {
  const { errorEvent = 'error', errorMessage = 'An error occurred' } = options;

  return async function(socket, ...args) {
    try {
      await handler(socket, ...args);
    } catch (error) {
      logger.error(`[Socket Handler Error] ${eventName}:`, {
        error: error.message,
        stack: error.stack,
        socketId: socket?.id?.substring(0, 8)
      });

      // Emit error to client if socket is still connected
      if (socket && socket.connected) {
        socket.emit(errorEvent, {
          error: errorMessage,
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  };
}

/**
 * Creates a safe async handler that can be used directly with socket.on()
 * Usage: socket.on('event', safeAsync(socket, async (data) => { ... }))
 */
function safeAsync(socket, handler, eventName = 'unknown') {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      logger.error(`[Async Handler Error] ${eventName}:`, {
        error: error.message,
        stack: error.stack,
        socketId: socket?.id?.substring(0, 8)
      });

      if (socket && socket.connected) {
        socket.emit('error', {
          error: 'An unexpected error occurred',
          event: eventName
        });
      }
    }
  };
}

const analytics = {
  battlesCreated: 0,
  battlesJoined: 0,
  battlesStarted: 0,
  battlesCompleted: 0,
  battlesAbandoned: 0,
  battlesForfeited: 0,
  totalBattleTime: 0,
  averageBattleDuration: 0,
  problemStats: {},
  languageStats: {
    javascript: 0,
    python: 0,
    java: 0,
    cpp: 0,
    go: 0,
    rust: 0
  },
  matchmakingStats: {
    queueJoins: 0,
    matchesFound: 0,
    timeouts: 0,
    averageWaitTime: 0,
    totalWaitTime: 0,
    sameLanguageMatches: 0,
    crossLanguageMatches: 0
  },
  rematchStats: {
    requested: 0,
    accepted: 0,
    declined: 0,
    expired: 0,
    cancelled: 0
  },
  performanceStats: {
    totalSolves: 0,
    averageSolveTime: 0,
    fastestSolveTime: Infinity,
    slowestSolveTime: 0,
    percentileDistribution: {
      100: 0,
      99: 0,
      75: 0,
      50: 0,
      25: 0
    }
  }
};

// Note: User feedback is now stored in the database (user_feedback table) for persistence across deployments
const mixpanelAnalytics = new Analytics({ test: config.environment === environments.development });

// Initialize problem stats for all problems (lazy - stats created on demand)
// Note: With lazy loading, we don't pre-initialize all problem stats
// Stats are created when a problem is first used

// Determine problem difficulty based on player rating
function getDifficultyForRating(rating) {
  if (!rating || rating < 1200) {
    return 'Easy';      // Bronze/Silver players get Easy
  } else if (rating < 1500) {
    return 'Medium';    // Gold/Platinum players get Medium
  } else {
    return 'Hard';      // Diamond+ players get Hard
  }
}

// FIXED: Enhanced getRandomProblem with proper validation, category, and rating-based difficulty
function getRandomProblem(category = null, playerRating = null) {
  try {
    // Determine difficulty based on rating
    const targetDifficulty = playerRating ? getDifficultyForRating(playerRating) : null;

    // Load problems - either by difficulty or all
    let allProblems;
    if (targetDifficulty && !category) {
      // Use difficulty-filtered problems when rating provided and no category override
      allProblems = problemsLoader.loadByDifficulty(targetDifficulty);
      logger.debug(` Loading ${targetDifficulty} problems for rating ${playerRating}`);
    } else {
      allProblems = problemsLoader.getAll();
    }

    if (!allProblems || allProblems.length === 0) {
      logger.error('CRITICAL ERROR: Problems array is empty. Length:', allProblems?.length);
      return null;
    }

    let validProblems = allProblems.filter(p =>
      p &&
      p.id &&
      p.title &&
      p.testCases &&
      Array.isArray(p.testCases) &&
      p.testCases.length > 0
    );

    // If category specified (e.g., 'SQL'), filter by category
    if (category) {
      validProblems = validProblems.filter(p => p.category === category);
      logger.debug(` Filtering by category: ${category}, found ${validProblems.length} problems`);
    } else {
      // For non-SQL battles, exclude SQL problems (they require different problem format)
      validProblems = validProblems.filter(p => p.category !== 'SQL');
    }

    if (validProblems.length === 0) {
      logger.error(`CRITICAL ERROR: No valid problems found after filtering${category ? ` for category: ${category}` : ''}${targetDifficulty ? ` [Difficulty: ${targetDifficulty}]` : ''}`);
      // Fallback: try loading all problems if difficulty filter was too restrictive
      if (targetDifficulty) {
        logger.warn(' Falling back to all problems');
        return getRandomProblem(category, null);
      }
      return null;
    }

    const randomIndex = Math.floor(Math.random() * validProblems.length);
    const problem = validProblems[randomIndex];

    const difficultyInfo = targetDifficulty ? ` [${targetDifficulty} for rating ${playerRating}]` : '';
    logger.info(` Selected problem: ${problem.id} - ${problem.title} (${validProblems.length} valid problems available)${category ? ` [Category: ${category}]` : ''}${difficultyInfo}`);

    return problem;
  } catch (error) {
    logger.error('CRITICAL ERROR in getRandomProblem:', error);
    return null;
  }
}

const validateBattleId = (battleId) => {
  if (!battleId || typeof battleId !== 'string') return false;
  // Accept UUID format or challenge battle format (challenge-{id}-{timestamp})
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const challengePattern = /^challenge-\d+-\d+$/;
  return uuidPattern.test(battleId) || challengePattern.test(battleId);
};

/**
 * Validate and sanitize player display name
 * Protects against XSS, control characters, and other injection attacks
 * @param {string} name - The player name to validate
 * @returns {boolean} - Whether the name is valid
 */
const validatePlayerName = (name) => {
  if (!name || typeof name !== 'string') return false;

  // Remove control characters (ASCII 0-31 and 127)
  const withoutControl = name.replace(/[\x00-\x1F\x7F]/g, '');

  // Trim whitespace
  const trimmed = withoutControl.trim();

  // Check length bounds
  if (trimmed.length < 1 || trimmed.length > 50) return false;

  // Ensure no significant content was stripped (prevents bypass attempts)
  if (trimmed !== name.trim()) return false;

  // Block dangerous HTML/script patterns (XSS prevention)
  const dangerousPatterns = [
    /<script/i,
    /<\/script/i,
    /javascript:/i,
    /on\w+\s*=/i,  // onclick=, onerror=, etc.
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<svg/i,
    /<img/i,
    /data:/i,
    /vbscript:/i
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) return false;
  }

  // Block null bytes and other problematic Unicode
  if (/\u0000|\uFFFD|\uFEFF/.test(trimmed)) return false;

  // Must contain at least one alphanumeric character
  if (!/[a-zA-Z0-9]/.test(trimmed)) return false;

  return true;
};

/**
 * Sanitize player name for safe display (use after validation)
 * Escapes HTML entities to prevent XSS when rendering
 * @param {string} name - The validated player name
 * @returns {string} - HTML-safe name
 */
const sanitizePlayerName = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .substring(0, 50);
};

const validateLanguage = (language) => {
  const validLanguages = ['javascript', 'python', 'java', 'c', 'cpp', 'go', 'rust', 'typescript', 'csharp', 'sql', 'prompt-battle'];
  return validLanguages.includes(language);
};

const validateFeedback = (feedbackData) => {
  const { rating, suggestion = '', email = '', playerName } = feedbackData;
  
  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return { valid: false, error: 'Rating must be between 1 and 5 stars' };
  }
  
  if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
    return { valid: false, error: 'Player name is required' };
  }
  
  if (suggestion && suggestion.length > 500) {
    return { valid: false, error: 'Suggestion cannot exceed 500 characters' };
  }
  
  if (email && email.trim().length > 0) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return { valid: false, error: 'Please enter a valid email address' };
    }
  }
  
  return { valid: true };
};

async function storeFeedback(feedbackData) {
  try {
    const dbEntry = {
      id: feedbackData.id || uuidv4(),
      battleId: feedbackData.battleId,
      playerId: feedbackData.playerId,
      playerName: feedbackData.playerName,
      rating: feedbackData.rating,
      suggestion: feedbackData.suggestion,
      email: feedbackData.email,
      winner: feedbackData.winner,
      problemId: feedbackData.problemId,
      standalone: feedbackData.standalone,
      timestamp: feedbackData.submittedAt || new Date().toISOString()
    };
    await dbHelper.saveUserFeedback(dbEntry);
    logger.info('Feedback stored to database:', dbEntry.id);
  } catch (error) {
    logger.error('Error storing feedback to database:', error);
  }
}

function updateAnalytics(event, data = {}) {
  try {
    switch(event) {
      case 'battle-created':
        analytics.battlesCreated++;
        break;
      case 'battle-joined':
        analytics.battlesJoined++;
        break;
      case 'battle-started':
        analytics.battlesStarted++;
        if (data.problemId && analytics.problemStats[data.problemId]) {
          analytics.problemStats[data.problemId].started++;
        }
        break;
      case 'battle-completed':
        analytics.battlesCompleted++;
        if (data.problemId && analytics.problemStats[data.problemId]) {
          analytics.problemStats[data.problemId].completed++;
        }
        if (data.duration && typeof data.duration === 'number') {
          analytics.totalBattleTime += data.duration;
          analytics.averageBattleDuration = analytics.totalBattleTime / analytics.battlesCompleted;
          if (data.problemId && analytics.problemStats[data.problemId]) {
            const problemStat = analytics.problemStats[data.problemId];
            problemStat.averageTime = ((problemStat.averageTime * (problemStat.completed - 1)) + data.duration) / problemStat.completed;
          }
        }
        if (data.solveTime && typeof data.solveTime === 'number') {
          analytics.performanceStats.totalSolves++;
          analytics.performanceStats.averageSolveTime = 
            ((analytics.performanceStats.averageSolveTime * (analytics.performanceStats.totalSolves - 1)) + data.solveTime) / 
            analytics.performanceStats.totalSolves;
          analytics.performanceStats.fastestSolveTime = Math.min(analytics.performanceStats.fastestSolveTime, data.solveTime);
          analytics.performanceStats.slowestSolveTime = Math.max(analytics.performanceStats.slowestSolveTime, data.solveTime);
          
          if (data.performanceData && data.performanceData.percentile) {
            analytics.performanceStats.percentileDistribution[data.performanceData.percentile]++;
          }
        }
        break;
      case 'battle-abandoned':
        analytics.battlesAbandoned++;
        break;
      case 'battle-forfeited':
        analytics.battlesForfeited++;
        break;
      case 'language-selected':
        if (data.language && analytics.languageStats[data.language] !== undefined) {
          analytics.languageStats[data.language]++;
        }
        break;
      case 'matchmaking-joined':
        analytics.matchmakingStats.queueJoins++;
        break;
      case 'match-found':
        analytics.matchmakingStats.matchesFound++;
        if (data.waitTime && typeof data.waitTime === 'number') {
          analytics.matchmakingStats.totalWaitTime += data.waitTime;
          analytics.matchmakingStats.averageWaitTime = 
            analytics.matchmakingStats.totalWaitTime / analytics.matchmakingStats.matchesFound;
        }
        if (data.sameLanguage) {
          analytics.matchmakingStats.sameLanguageMatches++;
        } else {
          analytics.matchmakingStats.crossLanguageMatches++;
        }
        break;
      case 'matchmaking-timeout':
        analytics.matchmakingStats.timeouts++;
        break;
      case 'rematch-requested':
        analytics.rematchStats.requested++;
        break;
      case 'rematch-accepted':
        analytics.rematchStats.accepted++;
        break;
      case 'rematch-declined':
        analytics.rematchStats.declined++;
        break;
      case 'rematch-expired':
        analytics.rematchStats.expired++;
        break;
      case 'rematch-cancelled':
        analytics.rematchStats.cancelled++;
        break;
    }
  } catch (error) {
    logger.error('Error updating analytics:', error);
  }
}

// Debounced queue position updates to prevent broadcast storms at scale
let queuePositionUpdatePending = false;
let queuePositionUpdateTimeout = null;
const QUEUE_POSITION_UPDATE_DEBOUNCE_MS = 2000;

function updateQueuePositions() {
  // Debounce: only update every 2 seconds max
  if (queuePositionUpdatePending) return;

  queuePositionUpdatePending = true;

  if (queuePositionUpdateTimeout) {
    clearTimeout(queuePositionUpdateTimeout);
  }

  queuePositionUpdateTimeout = setTimeout(() => {
    queuePositionUpdatePending = false;
    _doUpdateQueuePositions();
  }, QUEUE_POSITION_UPDATE_DEBOUNCE_MS);
}

function _doUpdateQueuePositions() {
  try {
    let position = 1;
    matchmakingQueue.forEach((player, playerId) => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket && socket.connected) {
        socket.emit('queue-position-update', {
          queuePosition: position,
          position, // Keep for backwards compatibility
          totalInQueue: matchmakingQueue.size
        });
      }
      position++;
    });
  } catch (error) {
    logger.error('Error updating queue positions:', error);
  }
}

// Legacy priority support remains dormant while consumer subscriptions are disabled.
const PRO_PRIORITY_BONUS_MS = 30000;

function findMatch(playerId, playerLanguage, playerRating = 1000, currentUserId = null, isRanked = true, joinAttempt = null) {
  try {
    const now = Date.now();
    const currentPlayer = matchmakingQueue.get(playerId);
    const preference = joinAttempt || (currentPlayer ? {
      battleType: currentPlayer.battleType,
      promptDurationMinutes: currentPlayer.promptDurationMinutes,
      promptModelId: currentPlayer.promptModelId
    } : { battleType: 'coding' });
    const normType = (t) => (t === 'prompt' ? 'prompt' : 'coding');
    const battleType = normType(preference.battleType);
    // Multi-type matchmaking (coding + prompt): accepted types default to the
    // single primary type, so single-select behavior is byte-for-byte unchanged.
    const srcAccepted = preference.acceptedTypes || currentPlayer?.acceptedTypes;
    const myTypes = (Array.isArray(srcAccepted) && srcAccepted.length ? srcAccepted : [battleType]).map(normType);
    const myCodingRating = preference.codingRating ?? currentPlayer?.codingRating ?? currentPlayer?.rating ?? playerRating;

    const currentPlayerActualWait = currentPlayer ? now - currentPlayer.queuedAt : 0;
    const currentPlayerWaitTime = currentPlayer?.isPro
      ? currentPlayerActualWait + PRO_PRIORITY_BONUS_MS
      : currentPlayerActualWait;
    const currentPlayerRating = currentPlayer?.rating || playerRating;
    const effectiveUserId = currentUserId || currentPlayer?.userId;
    const playerIsRanked = currentPlayer?.ranked !== undefined ? currentPlayer.ranked : isRanked;

    const ratingRange = elo.getMatchmakingRange(currentPlayerWaitTime);
    const isSQL = playerLanguage === 'sql';

    let bestMatch = null;
    let bestMatchScore = -Infinity;

    for (const [queuedPlayerId, queuedPlayer] of matchmakingQueue.entries()) {
      if (queuedPlayerId === playerId) continue;
      if (matchingInProgress.has(queuedPlayerId)) continue;

      const queuedBattleType = normType(queuedPlayer.battleType);
      const queuedTypes = (Array.isArray(queuedPlayer.acceptedTypes) && queuedPlayer.acceptedTypes.length
        ? queuedPlayer.acceptedTypes : [queuedBattleType]).map(normType);

      // Never match the same user/socket against themselves.
      if (effectiveUserId && queuedPlayer.userId && String(effectiveUserId) === String(queuedPlayer.userId)) continue;
      if (!effectiveUserId && currentPlayer?.socketId && queuedPlayer.socketId === currentPlayer.socketId) continue;

      // Opponent must have a live socket.
      if (queuedPlayer.socketId) {
        const queuedSocket = io.sockets.sockets.get(queuedPlayer.socketId);
        if (!queuedSocket || !queuedSocket.connected) continue;
      } else {
        continue;
      }

      // Resolve a battle type from the overlap of both players' accepted types,
      // checking each type's own compatibility. Priority prefers the rating-gated
      // coding first; prompt is the fallback and
      // requires matching duration + model. First compatible type wins.
      const sharedTypes = ['coding', 'prompt'].filter(t => myTypes.includes(t) && queuedTypes.includes(t));
      const queuedPlayerWaitTime = queuedPlayer.isPro
        ? (now - queuedPlayer.queuedAt) + PRO_PRIORITY_BONUS_MS
        : (now - queuedPlayer.queuedAt);
      const queuedPlayerRange = elo.getMatchmakingRange(queuedPlayerWaitTime);
      let resolvedType = null;
      let resolvedRatingDiff = 0;
      for (const t of sharedTypes) {
        if (t === 'prompt') {
          if (Number(queuedPlayer.promptDurationMinutes) === Number(preference.promptDurationMinutes)
            && String(queuedPlayer.promptModelId || '') === String(preference.promptModelId || '')) {
            resolvedType = 'prompt';
            break;
          }
        } else {
          const queuedPlayerIsRanked = queuedPlayer.ranked !== undefined ? queuedPlayer.ranked : true;
          if (playerIsRanked !== queuedPlayerIsRanked) continue;
          if (isSQL !== (queuedPlayer.language === 'sql')) continue;
          const myRating = myCodingRating;
          const queuedRating = queuedPlayer.codingRating ?? queuedPlayer.rating ?? 1000;
          const ratingDiff = Math.abs(myRating - queuedRating);
          if (ratingDiff <= ratingRange && ratingDiff <= queuedPlayerRange) {
            resolvedType = t;
            resolvedRatingDiff = ratingDiff;
            break;
          }
        }
      }
      if (!resolvedType) continue;

      let matchScore = 0;
      if (resolvedType === 'prompt') {
        matchScore = 1000000 + (now - queuedPlayer.queuedAt);
      } else {
        const sameLanguage = queuedPlayer.language === playerLanguage;
        const proBonus = queuedPlayer.isPro ? 1000 : 0;
        const langBonus = sameLanguage ? 500 : 0;
        matchScore = proBonus + langBonus - resolvedRatingDiff;
      }

      if (matchScore > bestMatchScore) {
        const sameLanguage = resolvedType === 'prompt' ? false : queuedPlayer.language === playerLanguage;
        bestMatch = { playerId: queuedPlayerId, ...queuedPlayer, sameLanguage, ratingDiff: resolvedRatingDiff, resolvedBattleType: resolvedType };
        bestMatchScore = matchScore;
      }
    }

    if (bestMatch) {
      if (battleType === 'coding') {
        const rank1 = elo.getRankDivision(currentPlayerRating);
        const rank2 = elo.getRankDivision(bestMatch.rating || 1000);
        const proLabel = bestMatch.isPro ? ' [PRO]' : '';
        const langLabel = bestMatch.sameLanguage ? 'same-language' : 'cross-language';
        logger.info(`Found ${langLabel} match: ${playerLanguage} vs ${bestMatch.language} [${rank1.display} ${currentPlayerRating}] vs [${rank2.display} ${bestMatch.rating || 1000}]${proLabel} (diff: ${bestMatch.ratingDiff})`);
      } else {
        logger.info(`Found prompt-battle quick match: ${preference.promptDurationMinutes}min model=${preference.promptModelId}`);
      }
      return bestMatch;
    }

    return null;
  } catch (error) {
    logger.error('Error finding match:', error);
    return null;
  }
}

function cleanupExpiredQueueEntries() {
  try {
    const now = Date.now();
    const expiredPlayers = [];
    
    for (const [playerId, player] of matchmakingQueue.entries()) {
  // Don't remove players with active socket connections
  const socket = io.sockets.sockets.get(player.socketId);
  if (socket && socket.connected) {
    continue; // Player is connected - keep them in queue
  }
  
  // Only timeout disconnected players
  const activityTime = player.lastActivity || player.queuedAt;
  if (now - activityTime >= QUEUE_TIMEOUT) {
    expiredPlayers.push({ playerId, player });
  }
}
    
    for (const { playerId, player } of expiredPlayers) {
      matchmakingQueue.delete(playerId);
      updateAnalytics('matchmaking-timeout');
      
      try {
        const socket = io.sockets.sockets.get(player.socketId);
        if (socket && socket.connected) {
          socket.emit('matchmaking-timeout');
        }
      } catch (socketError) {
        logger.error('Error notifying player of timeout:', socketError);
      }
    }
    
    if (expiredPlayers.length > 0) {
      logger.debug(`Cleaned up ${expiredPlayers.length} expired queue entries`);
      updateQueuePositions();
    }

    // Clean up stale matchingInProgress entries (safety net)
    // Players should only be in matchingInProgress briefly during battle creation
    // If they're still there after 30 seconds, something went wrong
    for (const playerId of matchingInProgress) {
      // Check if player is actually in any active battle
      let isInBattle = false;
      for (const battle of battles.values()) {
        if (battle.players?.some(p => p.id === playerId)) {
          isInBattle = true;
          break;
        }
      }
      // Remove from matchingInProgress if not in queue AND not in any battle
      if (!matchmakingQueue.has(playerId) && !isInBattle) {
        matchingInProgress.delete(playerId);
        logger.debug(`[Matchmaking] Cleaned up stale matchingInProgress entry: ${playerId}`);
      }
    }
  } catch (error) {
    logger.error('Error in queue cleanup:', error);
  }
}

function removePlayerFromQueue(socketId) {
  try {
    for (const [playerId, player] of matchmakingQueue.entries()) {
      if (player.socketId === socketId) {
        matchmakingQueue.delete(playerId);
        logger.debug(`Removed player ${playerId} from queue`);
        updateQueuePositions();
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error('Error removing player from queue:', error);
    return false;
  }
}

// Safely claim two players for matching - prevents race conditions
function claimPlayersForMatch(playerId1, playerId2) {
  // Check if either player is already being matched
  if (matchingInProgress.has(playerId1) || matchingInProgress.has(playerId2)) {
    logger.warn(' Race condition prevented - one player already being matched');
    return false;
  }

  // Check if both players are still in queue
  if (!matchmakingQueue.has(playerId1) || !matchmakingQueue.has(playerId2)) {
    logger.warn(' One or both players no longer in queue');
    return false;
  }

  // Atomically claim both players
  matchingInProgress.add(playerId1);
  matchingInProgress.add(playerId2);

  // Remove from queue
  matchmakingQueue.delete(playerId1);
  matchmakingQueue.delete(playerId2);

  return true;
}

// Release players from matching state (called on error)
function releaseMatchClaim(playerId1, playerId2) {
  matchingInProgress.delete(playerId1);
  matchingInProgress.delete(playerId2);
}

// Complete the match - removes from matchingInProgress
function completeMatch(playerId1, playerId2) {
  matchingInProgress.delete(playerId1);
  matchingInProgress.delete(playerId2);
}

// Helper function to get authoritative username from database
async function resolveUsername(userId, fallbackName) {
  if (!userId) return sanitizePlayerName(fallbackName) || 'Player';
  try {
    const user = await dbHelper.getUserById(userId);
    if (user && user.username) {
      return sanitizePlayerName(user.username);
    }
  } catch (err) {
    logger.warn(`Failed to lookup username for userId ${userId}:`, err.message);
  }
  return sanitizePlayerName(fallbackName) || 'Player';
}

// FIXED: Complete createMatchedBattle with proper problem validation and userId for leaderboard
// Now async to support database username lookups
async function createMatchedBattle(match, newPlayer, newPlayerId, language, newPlayerUserId = null, newPlayerRating = null, isRanked = true, timeLimit = 600) {
  try {
    // Prevent same user from battling themselves
    if (newPlayerUserId && match.userId && String(newPlayerUserId) === String(match.userId)) {
      logger.warn(`[SECURITY] Blocked self-match: userId ${newPlayerUserId} tried to battle themselves`);
      return null;
    }

    const battleId = uuidv4();

    // If both players selected SQL, use SQL problems; otherwise use regular problems
    const isSQLBattle = match.language === 'sql' && language === 'sql';
    const problemCategory = isSQLBattle ? 'SQL' : null;

    // Use average of both players' ratings for difficulty selection
    const matchRating = match.rating || 1000;
    const otherRating = newPlayerRating || 1000;
    const avgRating = Math.floor((matchRating + otherRating) / 2);
    const problem = getRandomProblem(problemCategory, avgRating);

    if (!problem || !problem.id || !problem.title || !problem.testCases) {
      logger.error('CRITICAL: Failed to get valid problem for matched battle');
      return null;
    }

    const waitTime = Date.now() - match.queuedAt;
    const matchedLanguage = match.sameLanguage ? match.language : null;

    // FIXED: Look up authoritative usernames from database to prevent stale name issues
    const [player1Name, player2Name] = await Promise.all([
      resolveUsername(match.userId, match.playerName),
      resolveUsername(newPlayerUserId, newPlayer)
    ]);

    const battle = {
      id: battleId,
      problem: problem,
      players: [
        {
          id: match.playerId,
          name: player1Name,
          userId: match.userId || null,
          socketId: match.socketId,
          ready: false,
          code: '',
          language: match.language,
          submitted: false,
          submittedAt: null
        },
        {
          id: newPlayerId,
          name: player2Name,
          userId: newPlayerUserId || null,
          socketId: null,
          ready: false,
          code: '',
          language: language,
          submitted: false,
          submittedAt: null
        }
      ],
      state: 'waiting',
      createdAt: Date.now(),
      timeLimit: timeLimit,
      matchmade: isRanked,  // Only ranked matches affect ELO
      sameLanguage: match.sameLanguage || false,
      ranked: isRanked,
      battleType: 'coding',
      copilotEnabled: false
    };
    
    evictOldBattlesIfNeeded();
    battles.set(battleId, battle);
    logger.info(` Created matched battle ${battleId} with problem: ${problem.id} - ${problem.title}`);
    
    updateAnalytics('battle-created');
    updateAnalytics('battle-joined');
    updateAnalytics('match-found', { waitTime, sameLanguage: battle.sameLanguage });
    cleanupBattle(battleId);
    
    return {
      battleId,
      battle,
      waitTime,
      sameLanguage: battle.sameLanguage,
      matchedLanguage: matchedLanguage
    };
  } catch (error) {
    logger.error('Error creating matched battle:', error);
    return null;
  }
}

/**
 * Start a prompt-engineering battle from unified Quick Match queue (two human entries).
 */
async function startPromptQuickMatchFromQueue(waitingEntry, joiningName, joiningPlayerId, joiningUserId, joiningSocketId, io) {
  const modelId = sanitizeModelId(waitingEntry.promptModelId)
  if (!modelId) {
    logger.error('[QUICK-MATCH] Prompt battle: no valid model on queue entry')
    return null
  }
  const durationMin = Number(waitingEntry.promptDurationMinutes) || 5
  const playerA = {
    userId: String(waitingEntry.userId),
    username: waitingEntry.playerName,
    socketId: waitingEntry.socketId,
    modelId
  }
  const playerB = {
    userId: String(joiningUserId),
    username: joiningName,
    socketId: joiningSocketId,
    modelId
  }
  const started = await startMatchedBattle(playerA, playerB, durationMin, io)
  if (!started?.success || !started.roomCode) return null

  const [player1Name, player2Name] = await Promise.all([
    resolveUsername(waitingEntry.userId, waitingEntry.playerName),
    resolveUsername(joiningUserId, joiningName)
  ])
  const waitTime = Date.now() - waitingEntry.queuedAt
  return {
    battleType: 'prompt',
    roomCode: started.roomCode,
    waitTime,
    player1Name,
    player2Name
  }
}

// Create a battle against a bot for practice (no ELO changes)
// selectedDifficulty: optional user-selected difficulty (easy, medium, hard, grandmaster)
async function createBotBattle(humanPlayerId, humanPlayer, selectedDifficulty = null) {
  try {
    const humanUserId = humanPlayer?.userId
    const onExpiredBattle = (expiredBattleId) => {
      dbHelper.deleteBattleSnapshot(expiredBattleId).catch(error => {
        logger.warn(`[BOT] Failed to delete expired snapshot ${expiredBattleId}:`, error?.message || error)
      })
    }
    const initialCapacity = botBattleGuard.canCreate(humanUserId, battles, Date.now(), onExpiredBattle)
    if (!initialCapacity.allowed) {
      const message = initialCapacity.reason === 'global_active_limit'
        ? 'Bot battles are at capacity right now. Please try again shortly.'
        : initialCapacity.reason === 'user_active_limit'
          ? 'Finish or leave your current bot battle before starting another.'
          : 'Authentication is required to start a bot battle.'
      return { errorCode: initialCapacity.reason, message }
    }

    const dailyLimit = getConsumerFairUseLimit('botBattlesPerDay')
    const dailyQuota = await dbHelper.tryConsumeConsumerDailyUsage([
      { metric: 'bot_battle_creation', subjectId: `user:${humanUserId}`, limit: dailyLimit }
    ])
    if (!dailyQuota.allowed) {
      return {
        errorCode: 'daily_limit',
        message: `You've reached today's fair-use limit of ${dailyLimit} bot battles. Try again tomorrow.`
      }
    }

    // Re-check after the awaited quota operation. Concurrent requests for the
    // same user can both pass the first check, but only one may claim a slot.
    const finalCapacity = botBattleGuard.canCreate(humanUserId, battles, Date.now(), onExpiredBattle)
    if (!finalCapacity.allowed) {
      const message = finalCapacity.reason === 'global_active_limit'
        ? 'Bot battles are at capacity right now. Please try again shortly.'
        : 'Finish or leave your current bot battle before starting another.'
      return { errorCode: finalCapacity.reason, message }
    }

    const battleId = uuidv4();
    const playerRating = humanPlayer.rating || 1000;
    const bot = botService.createBotPlayer(playerRating, humanPlayer.language, selectedDifficulty);

    // Select problem based on language (SQL battles get SQL problems)
    // Also use player's rating for difficulty selection
    const isSQLBattle = humanPlayer.language === 'sql';
    const problemCategory = isSQLBattle ? 'SQL' : null;
    const problem = getRandomProblem(problemCategory, playerRating);

    if (!problem || !problem.id || !problem.title || !problem.testCases) {
      logger.error('CRITICAL: Failed to get valid problem for bot battle');
      return { errorCode: 'problem_unavailable', message: 'No suitable coding problem is available right now.' };
    }

    const battle = {
      id: battleId,
      problem: problem,
      players: [
        {
          id: humanPlayerId,
          name: sanitizePlayerName(humanPlayer.playerName),
          userId: humanPlayer.userId || null,
          socketId: humanPlayer.socketId,
          ready: false,
          code: '',
          language: humanPlayer.language,
          submitted: false,
          submittedAt: null,
          isBot: false
        },
        {
          id: bot.id,
          name: bot.name,
          userId: null,
          socketId: null,
          ready: true, // Bots are always ready
          code: '',
          language: humanPlayer.language,
          submitted: false,
          submittedAt: null,
          isBot: true,
          botDifficulty: bot.difficulty,
          botRating: bot.rating,
          isSelectableDifficulty: bot.isSelectableDifficulty || false
        }
      ],
      state: 'waiting',
      createdAt: Date.now(),
      timeLimit: 600, // 10 minutes for bot battles
      isAgainstBot: true,
      matchmade: false, // Bot battles don't affect ELO
      botSelectedDifficulty: selectedDifficulty // Track if user selected difficulty
    };

    evictOldBattlesIfNeeded();
    battles.set(battleId, battle);
    logger.info(`Created bot battle ${battleId} with problem: ${problem.id} - ${problem.title} (Bot: ${bot.name}, Difficulty: ${bot.difficulty})`);

    updateAnalytics('bot-battle-created');

    return { battleId, battle, bot };
  } catch (error) {
    logger.error('Error creating bot battle:', error);
    return { errorCode: 'creation_failed', message: 'Failed to create bot battle' };
  }
}

function authorizeBotBattleStart(socket, battle) {
  if (!battle?.isAgainstBot || battle.botStartAuthorized) return true

  const startLimit = botBattleGuard.checkStart(socket.userId, battle.id)
  if (!startLimit.allowed) {
    socket.emit('bot-battle-error', {
      message: startLimit.reason === 'authentication_required'
        ? 'Authentication is required to start a bot battle.'
        : 'Too many bot battle start attempts. Please wait a moment and try again.',
      code: startLimit.reason,
      retryAfter: Math.ceil((startLimit.retryAfterMs || 0) / 1000)
    })
    return false
  }

  battle.botStartAuthorized = true
  return true
}

// Schedule the bot's solution submission
function scheduleBotSubmission(battle) {
  const bot = battle.players.find(p => p.isBot);
  if (!bot) {
    logger.error('No bot found in battle for scheduling submission');
    return;
  }

  // Use selectable tiers if the bot was created with user-selected difficulty
  const useSelectableTiers = bot.isSelectableDifficulty || false;
  const solveTime = botService.getBotSolveTime(bot.botDifficulty, battle.problem.difficulty || 'Medium', useSelectableTiers);

  // For user-selected difficulty, simulate the outcome
  if (useSelectableTiers) {
    const outcome = botService.simulateBotOutcome(bot.botDifficulty);
    battle.botSimulatedOutcome = outcome;
    logger.info(`Bot ${bot.name} outcome simulated: ${outcome.outcome} (${outcome.reason || 'normal win'})`);

    // If bot outcome is 'giveup' (should not happen with giveUpRate=0), treat as slow loss instead
    if (outcome.outcome === 'giveup') {
      logger.info(`Bot ${bot.name} giveup outcome overridden - treating as slow loss instead`);
      const extendedTime = Math.max(solveTime * 2, 300); // At least 5 minutes
      battle.botSubmitTimeout = setTimeout(async () => {
        await submitBotSolution(battle.id, bot.id);
      }, extendedTime * 1000);
      return;
    }

    // If bot will lose by being slow, extend solve time significantly
    if (outcome.outcome === 'lose' && outcome.reason === 'Bot was too slow to solve') {
      // Bot takes much longer, giving human time to win
      const extendedTime = Math.max(solveTime * 2, 300); // At least 5 minutes
      battle.botSubmitTimeout = setTimeout(async () => {
        await submitBotSolution(battle.id, bot.id);
      }, extendedTime * 1000);
      logger.info(`Bot ${bot.name} (slow loss) will submit in ${extendedTime} seconds`);
      return;
    }
  }

  logger.info(`Bot ${bot.name} will submit solution in ${solveTime} seconds`);

  battle.botSubmitTimeout = setTimeout(async () => {
    await submitBotSolution(battle.id, bot.id);
  }, solveTime * 1000);
}

// Submit the bot's solution
async function submitBotSolution(battleId, botId) {
  try {
    const battle = battles.get(battleId);
    if (!battle || battle.state !== 'coding' || battle.winner) {
      logger.debug(`Bot submission skipped - battle ${battleId} not in valid state`);
      return;
    }

    const bot = battle.players.find(p => p.id === botId);
    if (!bot) {
      logger.error(`Bot ${botId} not found in battle ${battleId}`);
      return;
    }

    // Check if this bot was simulated to lose by incorrect solution
    const simulatedOutcome = battle.botSimulatedOutcome;
    if (simulatedOutcome && simulatedOutcome.outcome === 'lose' && simulatedOutcome.reason === 'Bot submitted incorrect solution') {
      // Bot intentionally fails - emit a failed submission to frontend
      logger.info(`Bot ${bot.name} submitting intentionally incorrect solution (simulated loss)`);

      // Create fake failed test results
      const fakeFailedResults = battle.problem.testCases.map((tc, index) => ({
        testCase: index + 1,
        passed: index > 0, // First test fails, rest "pass" to show partial progress
        expected: tc.expected,
        actual: index === 0 ? 'Wrong answer' : tc.expected,
        error: index === 0 ? 'Assertion failed' : null
      }));

      io.to(battleId).emit('opponent-submitted', {
        playerId: botId,
        passed: false,
        testResults: fakeFailedResults.slice(0, 3) // Only show first 3
      });

      logger.info(`Bot ${bot.name} failed tests as simulated in battle ${battleId}`);
      return;
    }

    // Try bot's language first, then fall back to human's language
    const human = battle.players.find(p => !p.isBot);
    let solution = botService.getBotSolution(battle.problem.id, bot.language);

    // If no solution in bot's language, try human's language (more likely to have solutions)
    if (!solution && human && human.language !== bot.language) {
      solution = botService.getBotSolution(battle.problem.id, human.language);
      if (solution) {
        logger.info(`Bot using solution in ${human.language} instead of ${bot.language}`);
        bot.language = human.language; // Update bot's language to match
      }
    }

    if (!solution) {
      // No solution available - bot keeps "working" silently, letting human finish or timer expire
      logger.info(`No bot solution for problem ${battle.problem.id} in any language - bot will keep working (not quit)`);
      return;
    }

    // Bot solutions use the same paid Judge0 capacity as player submissions.
    // Reserve from the durable global quota before entering the executor; any
    // database/quota failure therefore fails closed without making a paid call.
    if (battle.botExecutionQuotaPending || battle.botExecutionQuotaConsumed) {
      logger.debug(`Bot execution already reserved for battle ${battleId}`)
      return
    }
    battle.botExecutionQuotaPending = true
    const globalCodeLimit = getConsumerFairUseLimit('globalCodeExecutionsPerDay')
    let executionQuota
    try {
      executionQuota = await dbHelper.tryConsumeConsumerDailyUsage([
        { metric: 'code_execution', subjectId: 'global', limit: globalCodeLimit }
      ])
    } finally {
      battle.botExecutionQuotaPending = false
    }
    if (!executionQuota?.allowed) {
      logger.warn(`[BOT] Global code execution quota unavailable; skipping Judge0 for battle ${battleId}`)
      io.to(battleId).emit('bot-submission-unavailable', {
        message: 'The bot code runner is at capacity. You can keep solving this battle.'
      })
      return
    }
    battle.botExecutionQuotaConsumed = true

    logger.info(`Bot ${bot.name} submitting solution for battle ${battleId}`);

    const testResults = await executeAndValidateSolution(
      solution,
      battle.problem.testCases,
      bot.language,
      battle.problem.id
    );

    const allPassed = allTestsPassed(testResults);

    // Use lock to prevent race condition with human submission
    let botWon = false;
    await withBattleLock(battleId, async () => {
      // Re-fetch battle inside lock to get latest state
      const currentBattle = battles.get(battleId);
      if (!currentBattle || currentBattle.state !== 'coding' || currentBattle.winner) {
        return;
      }

      if (allPassed) {
        bot.submitted = true;
        bot.submittedAt = Date.now();
        bot.code = solution;
        currentBattle.winner = botId;
        currentBattle.state = 'finished';
        currentBattle.finishedAt = Date.now();
        botWon = true;

        // Clear any pending bot timeout to prevent duplicate events
        if (currentBattle.botSubmitTimeout) {
          clearTimeout(currentBattle.botSubmitTimeout);
          currentBattle.botSubmitTimeout = null;
        }
      }
    });

    if (botWon) {
      const currentBattle = battles.get(battleId);
      const human = currentBattle?.players.find(p => !p.isBot);
      const battleDuration = (currentBattle.finishedAt - currentBattle.startedAt) / 1000;

      // Split into visible and hidden test results
      const botVisibleCount = problemsLoader.visibleCount(battle.problem);
      const botVisibleResults = testResults.slice(0, botVisibleCount);
      const botHiddenResults = testResults.slice(botVisibleCount);

      logger.info(`Bot ${bot.name} won battle ${battleId} in ${Math.floor(battleDuration)}s`);

      io.to(battleId).emit('battle-finished', {
        winner: botId,
        winnerName: bot.name,
        loser: human?.id || null,
        loserName: human?.name || 'Unknown',
        testResults: botVisibleResults,
        winnerTestResults: botVisibleResults,
        winnerHiddenTests: { passed: botHiddenResults.filter(r => r.passed).length, total: botHiddenResults.length },
        loserTestResults: human?.lastTestResults || [],
        loserHiddenTests: human?.lastHiddenTests || null,
        finishedAt: currentBattle.finishedAt,
        forfeit: false,
        winReason: 'solution',
        isAgainstBot: true,
        ratingChanges: null // No rating changes for bot battles
      });
    } else if (!allPassed) {
      logger.debug(`Bot solution did not pass all tests`);
    }
  } catch (error) {
    logger.error('Error in bot solution submission:', error);
  }
}

// FIXED: Complete createRematchBattle with proper problem validation
async function createRematchBattle(originalBattle, players) {
  try {
    const newBattleId = uuidv4();

    // Check if all players are using SQL
    const isSQLBattle = players.every(p => p.language === 'sql');
    const problemCategory = isSQLBattle ? 'SQL' : null;

    // Use average player rating for difficulty selection
    let avgRating = null;
    const playerRatings = await Promise.all(
      players.filter(p => p.userId).map(async (p) => {
        const stats = await dbHelper.getUserStats(p.userId);
        return stats?.rating || 1000;
      })
    );
    if (playerRatings.length > 0) {
      avgRating = Math.floor(playerRatings.reduce((a, b) => a + b, 0) / playerRatings.length);
    }
    const problem = getRandomProblem(problemCategory, avgRating);

    if (!problem || !problem.id || !problem.title || !problem.testCases) {
      logger.error('CRITICAL: Failed to get valid problem for rematch');
      return null;
    }
    
    const newBattle = {
      id: newBattleId,
      problem: problem,
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        language: p.language || 'python',
        socketId: p.socketId,
        userId: p.userId,
        ready: false,
        code: '',
        submitted: false,
        submittedAt: null,
        hasSubmitted: false,
        testsPassed: 0,
        testsTotal: 0,
        finishTime: null
      })),
      state: 'waiting',
      createdAt: Date.now(),
      timeLimit: originalBattle.timeLimit || 600,
      ranked: originalBattle.ranked || false,
      matchmade: originalBattle.matchmade || false,
      sameLanguage: originalBattle.sameLanguage || false
    };
    
    evictOldBattlesIfNeeded();
    battles.set(newBattleId, newBattle);
    logger.info(` Created rematch battle ${newBattleId} with problem: ${problem.id} - ${problem.title}`);
    
    updateAnalytics('battle-created');
    updateAnalytics('battle-joined');
    cleanupBattle(newBattleId);
    
    return newBattle;
  } catch (error) {
    logger.error('Error creating rematch battle:', error);
    return null;
  }
}

function cleanupExpiredRematches() {
  try {
    const now = Date.now();
    const expiredRematches = [];
    
    for (const [battleId, rematchData] of rematchRequests.entries()) {
      if (now > rematchData.expiresAt) {
        expiredRematches.push({ battleId, rematchData });
      }
    }
    
    for (const { battleId } of expiredRematches) {
      rematchRequests.delete(battleId);
      updateAnalytics('rematch-expired');
      io.to(battleId).emit('rematch-expired');
    }
    
    if (expiredRematches.length > 0) {
      logger.debug(`Cleaned up ${expiredRematches.length} expired rematch requests`);
    }
  } catch (error) {
    logger.error('Error in rematch cleanup:', error);
  }
}

// Battle cleanup delay - 2 minutes after finish (optimized for 1K users)
const BATTLE_CLEANUP_DELAY_MS = 2 * 60 * 1000;
// Cleanup thresholds for different battle states
const ABANDONED_BATTLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes for waiting/ready battles (down from 30)
const MAX_BATTLE_LIFETIME_MS = 1 * 60 * 60 * 1000; // 1 hour absolute max lifetime (down from 2)
const STALE_CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // Run cleanup every 2 minutes (more aggressive)

function cleanupBattle(battleId) {
  setTimeout(async () => {
    try {
      const battle = battles.get(battleId);
      if (battle && battle.state === 'finished') {
        // Clear bot timeout to prevent memory leaks from dangling timeouts
        if (battle.botSubmitTimeout) {
          clearTimeout(battle.botSubmitTimeout);
          battle.botSubmitTimeout = null;
          logger.debug(`Cleared bot timeout during battle cleanup: ${battleId}`);
        }
        battles.delete(battleId);
        rematchRequests.delete(battleId);
        // Delete battle snapshot from persistence
        await dbHelper.deleteBattleSnapshot(battleId);
        logger.debug(`Cleaned up battle: ${battleId}`);
      }
    } catch (error) {
      logger.error('Error cleaning up battle:', error);
    }
  }, BATTLE_CLEANUP_DELAY_MS);
}

// Periodic cleanup for stale/abandoned battles that never finished
function cleanupStaleBattles() {
  try {
    const now = Date.now();
    const reasons = { finished: 0, abandoned: 0, expired: 0, disconnected: 0, botExpired: 0 };
    reasons.botExpired = botBattleGuard.pruneExpiredBattles(battles, now, (battleId) => {
      dbHelper.deleteBattleSnapshot(battleId).catch(err => {
        logger.error(`Failed to delete expired bot battle snapshot ${battleId}:`, err?.message || err)
      })
    });
    let cleanedCount = reasons.botExpired;

    for (const [battleId, battle] of battles.entries()) {
      const age = now - (battle.createdAt || 0);
      let shouldDelete = false;
      let reason = '';

      // 1. Finished battles older than 5 minutes
      if (battle.state === 'finished' && battle.finishedAt) {
        const finishedAge = now - battle.finishedAt;
        if (finishedAge > BATTLE_CLEANUP_DELAY_MS) {
          shouldDelete = true;
          reason = 'finished';
          reasons.finished++;
        }
      }
      // 2. Waiting/ready battles abandoned for 30+ minutes
      else if ((battle.state === 'waiting' || battle.state === 'ready') && age > ABANDONED_BATTLE_THRESHOLD_MS) {
        shouldDelete = true;
        reason = 'abandoned';
        reasons.abandoned++;
      }
      // 3. Any battle older than the absolute max lifetime, except a live coding
      // battle with a connected player, which can legitimately exceed it (60-minute
      // battles plus waiting-room time); its own timer expiry (+grace) governs instead
      else if (age > MAX_BATTLE_LIFETIME_MS) {
        const hasConnectedPlayer = battle.players?.some(p => p.socketId !== null);
        const timerExpiryAge = battle.state === 'coding' && battle.serverStartTime
          ? (battle.serverStartTime - (battle.createdAt || 0)) + ((battle.timeLimit || 600) * 1000) + (15 * 60 * 1000)
          : 0;
        if (battle.state !== 'coding' || !hasConnectedPlayer || age > Math.max(MAX_BATTLE_LIFETIME_MS, timerExpiryAge)) {
          shouldDelete = true;
          reason = 'expired';
          reasons.expired++;
        }
      }
      // 4. Coding battles where all players disconnected (no active sockets) for 30+ minutes
      else if (battle.state === 'coding' && age > ABANDONED_BATTLE_THRESHOLD_MS) {
        const hasConnectedPlayer = battle.players?.some(p => p.socketId !== null);
        if (!hasConnectedPlayer) {
          shouldDelete = true;
          reason = 'disconnected';
          reasons.disconnected++;
        }
      }

      if (shouldDelete) {
        // Clear bot timeout to prevent memory leaks from dangling timeouts
        if (battle.botSubmitTimeout) {
          clearTimeout(battle.botSubmitTimeout);
          battle.botSubmitTimeout = null;
          logger.debug(`Cleared bot timeout during stale battle cleanup: ${battleId}`);
        }

        // Persist coding/expired/disconnected battles that were never formally finished
        // This ensures all battles a player participates in appear in their battle log
        if ((reason === 'expired' || reason === 'disconnected') && battle.state === 'coding' && !battle.isAgainstBot) {
          const player1 = battle.players?.[0];
          const player2 = battle.players?.[1];
          if (player1?.userId || player2?.userId) {
            // Persist as a tie since no one won
            persistTieBattleResult(battle, player1, player2, battle.timeLimit || 600, true).catch(err => {
              logger.error(`Failed to persist abandoned battle ${battleId}:`, err?.message || err);
            });
            logger.info(`Persisted abandoned ${reason} battle ${battleId} as tie before cleanup`);
          }
        }

        battles.delete(battleId);
        rematchRequests.delete(battleId);
        // Delete battle snapshot from persistence (async, don't await)
        dbHelper.deleteBattleSnapshot(battleId).catch(err => {
          logger.error(`Failed to delete snapshot for ${battleId}:`, err?.message || err);
        });
        cleanedCount++;
        logger.debug(`Cleaned up stale battle ${battleId} (${reason})`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Stale battle cleanup: removed ${cleanedCount} battles (finished: ${reasons.finished}, abandoned: ${reasons.abandoned}, expired: ${reasons.expired}, disconnected: ${reasons.disconnected}, bot expired: ${reasons.botExpired}). Remaining: ${battles.size}`);
    }
  } catch (error) {
    logger.error('Error in stale battle cleanup:', error);
  }
}

// Start periodic cleanup interval
const staleBattleCleanupInterval = setInterval(cleanupStaleBattles, STALE_CLEANUP_INTERVAL_MS);
// Run once on startup to clean any stale battles from previous session
setTimeout(cleanupStaleBattles, 10000); // Wait 10s for server to initialize

// ============================================
// TOURNAMENT STATUS SCHEDULER
// ============================================
const TOURNAMENT_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

async function processTournamentStatusUpdates() {
  try {
    const updates = await dbHelper.getTournamentsNeedingUpdate();

    // Open registration for upcoming tournaments
    if (updates.toOpen && updates.toOpen.length > 0) {
      for (const tournament of updates.toOpen) {
        await dbHelper.updateTournamentStatus(tournament.id, 'registration_open');
        logger.info(`[Tournament] Opened registration for: ${tournament.name}`);
      }
    }

    // Close registration for tournaments past deadline
    if (updates.toClose && updates.toClose.length > 0) {
      for (const tournament of updates.toClose) {
        await dbHelper.updateTournamentStatus(tournament.id, 'registration_closed');
        logger.info(`[Tournament] Closed registration for: ${tournament.name}`);
      }
    }

    // Open check-in window for tournaments 10 min before start
    if (updates.toCheckIn && updates.toCheckIn.length > 0) {
      for (const tournament of updates.toCheckIn) {
        await dbHelper.openTournamentCheckIn(tournament.id);
        logger.info(`[Tournament] Opened check-in for: ${tournament.name}`);
      }
    }

    // Process tournaments past start time
    if (updates.toStartOrCancel && updates.toStartOrCancel.length > 0) {
      for (const tournament of updates.toStartOrCancel) {
        const minParticipants = tournament.min_players || 2;

        // If using check-in system, check checked_in_count; otherwise use participant_count
        const eligibleCount = tournament.status === 'check_in_open'
          ? (tournament.checked_in_count || 0)
          : (tournament.participant_count || 0);

        if (eligibleCount >= minParticipants) {
          try {
            // Remove non-checked-in if check-in was open
            if (tournament.status === 'check_in_open') {
              await dbHelper.startTournamentWithCheckedIn(tournament.id);
              logger.info(`[Tournament] Started with ${eligibleCount} checked-in players: ${tournament.name}`);
            }

            // Generate bracket FIRST (before final status change)
            await dbHelper.generateBracket(tournament.id);

            // Only update status to in_progress if not already done by startTournamentWithCheckedIn
            if (tournament.status !== 'check_in_open') {
              await dbHelper.updateTournamentStatus(tournament.id, 'in_progress');
            }
            logger.info(`[Tournament] Bracket generated for: ${tournament.name}`);
          } catch (bracketError) {
            logger.error(`[Tournament] Failed to start ${tournament.name}:`, bracketError.message);
            await dbHelper.cancelTournament(tournament.id, 'Failed to generate bracket');
          }
        } else {
          // Cancel tournament - insufficient participants
          await dbHelper.cancelTournament(tournament.id, `Insufficient participants (${eligibleCount}/${minParticipants})`);
          logger.info(`[Tournament] Cancelled (insufficient participants): ${tournament.name}`);
        }
      }
    }
  } catch (error) {
    logger.error('[Tournament] Error in status update:', error?.message || error);
  }
}

// Start tournament status scheduler
const tournamentStatusInterval = setInterval(processTournamentStatusUpdates, TOURNAMENT_CHECK_INTERVAL_MS);
// Run once on startup after a short delay
setTimeout(processTournamentStatusUpdates, 15000);

// Cleanup old tournament match ready entries (memory leak prevention)
// Entries older than 30 minutes are removed
function cleanupTournamentMatchReady() {
  if (!global.tournamentMatchReady) return;

  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  let cleaned = 0;

  for (const [matchKey, data] of global.tournamentMatchReady.entries()) {
    // If entry has a timestamp and it's old, remove it
    // Otherwise just remove if it's been sitting for a while
    if (data.createdAt && data.createdAt < thirtyMinutesAgo) {
      global.tournamentMatchReady.delete(matchKey);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`[Tournament] Cleaned up ${cleaned} stale match ready entries`);
  }
}

// Run tournament match ready cleanup every 10 minutes
const tournamentMatchReadyCleanupInterval = setInterval(cleanupTournamentMatchReady, 10 * 60 * 1000);

function validateSolution(code, testCases, language = 'python', problemId = 'two-sum') {
  if (!testCases || !Array.isArray(testCases)) {
    return [];
  }
  
  if (!code || typeof code !== 'string') {
    return testCases.map(testCase => ({
      ...testCase,
      actual: "No code provided",
      passed: false
    }));
  }
  
  try {
    let cleanCode = code;
    if (language === 'python') {
      cleanCode = code.replace(/^\s*#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '').replace(/'''[\s\S]*?'''/g, '').trim();
    } else {
      cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    }
    
    const codeLines = cleanCode.split('\n').filter(line => line.trim().length > 0);
    const hasMinimumCode = codeLines.length >= 3;
    const hasReturnStatement = /return/.test(cleanCode);
    const hasMinimumLength = cleanCode.length >= 50;
    
    let problemSpecificValidation = true;
    let algorithmScore = 0;
    
    switch(problemId) {
      case 'two-sum':
        const hasLoop = /for|while|\.map|\.forEach|\.reduce|range\(|enumerate/.test(cleanCode);
        const hasTarget = /target/.test(cleanCode);
        const hasArrayAccess = /\[|\]|\.get\(|\.at\(/.test(cleanCode);
        const hasHashMap = /map|Map|dict|HashMap|{}|\{/.test(cleanCode) || /set|Set/.test(cleanCode);
        if (hasLoop) algorithmScore += 1;
        if (hasTarget) algorithmScore += 1;
        if (hasArrayAccess) algorithmScore += 1;
        if (hasHashMap) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 3;
        break;
        
      case 'palindrome-number':
        const hasStringConversion = /str|String|toString|string/.test(cleanCode);
        const hasMathOperations = /%|\/\/|\/|Math\.floor|div/.test(cleanCode);
        const hasComparison = /==|===|!=|!==/.test(cleanCode);
        const hasLoop2 = /for|while|\.map|\.forEach/.test(cleanCode);
        if (hasStringConversion || hasMathOperations) algorithmScore += 1;
        if (hasComparison) algorithmScore += 1;
        if (hasLoop2) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;
        
      case 'valid-parentheses':
        const hasStackStructure = /\[\]|push|pop|append|stack|Array|Vec|vector|list/.test(cleanCode);
        const hasCharIteration = /for|while|\.map|\.forEach|char|charAt|chars/.test(cleanCode);
        const hasBracketMatching = /\{|\}|\(|\)|\[|\]/.test(cleanCode);
        const hasConditions = /if|match|switch|case/.test(cleanCode);
        if (hasStackStructure) algorithmScore += 1;
        if (hasCharIteration) algorithmScore += 1;
        if (hasBracketMatching) algorithmScore += 1;
        if (hasConditions) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 3;
        break;

      case 'reverse-integer':
        const hasReverse = /reverse|rev|split|join|slice/.test(cleanCode);
        const hasMath = /Math|abs|floor|%|\//.test(cleanCode);
        const hasNumber = /parseInt|Number|int/.test(cleanCode);
        if (hasReverse || hasMath) algorithmScore += 1;
        if (hasNumber || hasMath) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'fizz-buzz':
        const hasFizz = /fizz|Fizz/i.test(cleanCode);
        const hasBuzz = /buzz|Buzz/i.test(cleanCode);
        const hasModulo = /%|mod/.test(cleanCode);
        const hasLoop3 = /for|while|range/.test(cleanCode);
        if (hasFizz && hasBuzz) algorithmScore += 2;
        if (hasModulo) algorithmScore += 1;
        if (hasLoop3) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 3;
        break;

      case 'merge-sorted-arrays':
        const hasMerge = /merge|concat|sort|sorted/.test(cleanCode);
        const hasArrayOps = /push|append|insert|\+/.test(cleanCode);
        const hasPointers = /i|j|k|index|pointer/.test(cleanCode);
        if (hasMerge || hasArrayOps) algorithmScore += 1;
        if (hasPointers) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'maximum-subarray':
        const hasMax = /max|Max|maximum/.test(cleanCode);
        const hasSum = /sum|total|current/.test(cleanCode);
        const hasLoop4 = /for|while/.test(cleanCode);
        if (hasMax) algorithmScore += 1;
        if (hasSum) algorithmScore += 1;
        if (hasLoop4) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'contains-duplicate':
        const hasSet = /set|Set|dict|Map|HashMap/.test(cleanCode);
        const hasLoop5 = /for|while|any|some/.test(cleanCode);
        const hasCheck = /in|has|contains|includes/.test(cleanCode);
        if (hasSet) algorithmScore += 1;
        if (hasLoop5) algorithmScore += 1;
        if (hasCheck) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'best-time-stock':
        const hasMin = /min|Min|minimum|lowest/.test(cleanCode);
        const hasProfit = /profit|max|diff|gain/.test(cleanCode);
        const hasLoop6 = /for|while/.test(cleanCode);
        if (hasMin) algorithmScore += 1;
        if (hasProfit) algorithmScore += 1;
        if (hasLoop6) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'valid-anagram':
        const hasSorted = /sort|sorted/.test(cleanCode);
        const hasCount = /count|Counter|freq|frequency/.test(cleanCode);
        const hasMap = /map|Map|dict|HashMap/.test(cleanCode);
        if (hasSorted) algorithmScore += 2;
        if (hasCount || hasMap) algorithmScore += 2;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'missing-number':
        const hasSum2 = /sum|total/.test(cleanCode);
        const hasFormula = /\*|\/|range/.test(cleanCode);
        const hasXor = /\^|xor/.test(cleanCode);
        if (hasSum2 && hasFormula) algorithmScore += 2;
        if (hasXor) algorithmScore += 2;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'single-number':
        const hasXor2 = /\^|xor/.test(cleanCode);
        const hasLoop7 = /for|while|reduce/.test(cleanCode);
        if (hasXor2) algorithmScore += 2;
        if (hasLoop7) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'climbing-stairs':
        const hasFib = /fib|fibonacci/.test(cleanCode);
        const hasDp = /dp|memo|cache/.test(cleanCode);
        const hasLoop8 = /for|while/.test(cleanCode);
        if (hasFib || hasDp) algorithmScore += 1;
        if (hasLoop8) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'move-zeroes':
        const hasZero = /0|zero/.test(cleanCode);
        const hasSwap = /swap|exchange|temp/.test(cleanCode);
        const hasLoop9 = /for|while/.test(cleanCode);
        if (hasZero) algorithmScore += 1;
        if (hasSwap || hasLoop9) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'reverse-string':
        const hasReverse2 = /reverse|rev/.test(cleanCode);
        const hasSwap2 = /swap|temp/.test(cleanCode);
        const hasPointers2 = /left|right|start|end|i|j/.test(cleanCode);
        if (hasReverse2 || hasSwap2) algorithmScore += 1;
        if (hasPointers2) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'first-unique-character':
        const hasMap2 = /map|Map|dict|HashMap|Counter/.test(cleanCode);
        const hasLoop10 = /for|while/.test(cleanCode);
        const hasCount2 = /count|freq/.test(cleanCode);
        if (hasMap2) algorithmScore += 1;
        if (hasLoop10) algorithmScore += 1;
        if (hasCount2) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'linked-list-cycle':
        const hasSlow = /slow|fast|turtle|hare/.test(cleanCode);
        const hasWhile = /while|loop/.test(cleanCode);
        const hasNext = /next|\.next/.test(cleanCode);
        if (hasSlow) algorithmScore += 1;
        if (hasWhile) algorithmScore += 1;
        if (hasNext) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'valid-palindrome':
        const hasClean = /clean|filter|replace|lower|upper/.test(cleanCode);
        const hasReverse3 = /reverse|rev/.test(cleanCode);
        const hasPointers3 = /left|right|start|end|i|j/.test(cleanCode);
        if (hasClean) algorithmScore += 1;
        if (hasReverse3 || hasPointers3) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      case 'binary-search':
        const hasMid = /mid|middle|center/.test(cleanCode);
        const hasWhile2 = /while|loop/.test(cleanCode);
        const hasBinary = /left|right|low|high|start|end/.test(cleanCode);
        if (hasMid) algorithmScore += 1;
        if (hasWhile2) algorithmScore += 1;
        if (hasBinary) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'product-array-except-self':
        const hasProduct = /product|prod|multiply|\*/.test(cleanCode);
        const hasLeft = /left|right|prefix|suffix/.test(cleanCode);
        const hasLoop11 = /for|while/.test(cleanCode);
        if (hasProduct) algorithmScore += 1;
        if (hasLeft) algorithmScore += 1;
        if (hasLoop11) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 2;
        break;

      case 'longest-substring':
        const hasWindow = /window|slide|substring/.test(cleanCode);
        const hasSet2 = /set|Set|Map|dict/.test(cleanCode);
        const hasMax2 = /max|Max|longest/.test(cleanCode);
        if (hasWindow || hasSet2) algorithmScore += 1;
        if (hasMax2) algorithmScore += 1;
        problemSpecificValidation = algorithmScore >= 1;
        break;

      default:
        const hasBasicStructure = /for|while|if|==|!=/.test(cleanCode);
        problemSpecificValidation = hasBasicStructure;
    }
    
    const isValidSolution = hasMinimumCode && 
                           hasReturnStatement && 
                           hasMinimumLength &&
                           problemSpecificValidation;
    
    return testCases.map((testCase) => ({
      ...testCase,
      actual: isValidSolution ? testCase.expected : "Solution does not contain required algorithm components",
      passed: isValidSolution
    }));
  } catch (error) {
    logger.error('Validation error:', error);
    return testCases.map(testCase => ({
      ...testCase,
      actual: "Error validating solution",
      passed: false
    }));
  }
}

let timerSyncInterval = null;
function initializeTimerSystem() {
  timerSyncInterval = setInterval(async () => {
    for (const [battleId, battle] of battles) {
      if (battle.state === 'coding' && battle.serverStartTime) {
        const elapsed = (Date.now() - battle.serverStartTime) / 1000;
        const timeRemaining = Math.max(0, battle.timeLimit - elapsed);
        
        io.to(battleId).emit('timer-sync', { 
          timeRemaining,
          serverTime: Date.now()
        });
        
        if (timeRemaining <= 0 && battle.state === 'coding') {
          // M6 fix: wrap timeout finalization in withBattleLock so it cannot race
          // with submit-solution / forfeit-battle / report-violation finalizers
          // that also mutate battle.winner and persist results.
          try {
            await withBattleLock(battleId, async () => {
              // Re-check inside the lock: another finalizer (e.g. submit-solution
              // that ran while we were waiting on the lock) may have already
              // moved the battle to 'finished'. If so, bail out.
              const current = battles.get(battleId);
              if (!current || current.state !== 'coding') {
                return;
              }

              // Clear bot timeout if battle is ending due to timer expiry
              if (battle.isAgainstBot && battle.botSubmitTimeout) {
                clearTimeout(battle.botSubmitTimeout);
                battle.botSubmitTimeout = null;
                logger.info(`Cleared bot timeout - battle ${battleId} ended due to timer expiry`);
              }

              battle.state = 'finished';
              battle.finishedAt = Date.now();

              if (!battle.winner) {
                const player1 = battle.players[0];
                const player2 = battle.players[1];

            // Get test progress for both players (default to 0 if never submitted)
            const p1Tests = player1?.testsPassed || 0;
            const p2Tests = player2?.testsPassed || 0;
            const totalTests = battle.problem?.testCases?.length || 10;

            // Case 1: Both have zero progress - true tie with NO ELO change
            if (p1Tests === 0 && p2Tests === 0) {
              updateAnalytics('battle-completed', {
                problemId: battle.problem.id,
                duration: battle.timeLimit,
                result: 'tie_no_progress'
              });

              logger.info(`Battle ${battle.id} ended in tie - neither player made progress`);

              // Still persist the battle for history tracking (no ELO changes)
              let tieResult = { player1RatingChange: 0, player2RatingChange: 0 };
              if (player1?.userId || player2?.userId) {
                try {
                  // Pass noEloChange flag to record battle without affecting ratings
                  tieResult = await persistTieBattleResult(battle, player1, player2, battle.timeLimit, true);
                } catch (err) {
                  logger.error('Failed to persist no-progress tie battle:', err);
                }
              }

              io.to(battleId).emit('battle-tie', {
                message: 'Time limit reached! Neither player passed any tests - it\'s a tie!',
                finishedAt: battle.finishedAt,
                tie: true,
                noProgress: true,
                ratingChanges: {
                  player1: { change: 0, newRating: null, newRank: null },
                  player2: { change: 0, newRating: null, newRank: null }
                }
              });
            }
            // Case 2: Same non-zero progress - regular tie with ELO
            else if (p1Tests === p2Tests) {
              updateAnalytics('battle-completed', {
                problemId: battle.problem.id,
                duration: battle.timeLimit,
                result: 'tie'
              });

              let tieResult = { player1RatingChange: 0, player2RatingChange: 0, player1NewBadges: [], player2NewBadges: [] };

              if (player1?.userId || player2?.userId) {
                try {
                  tieResult = await persistTieBattleResult(battle, player1, player2, battle.timeLimit);
                } catch (err) {
                  logger.error('Failed to persist tie battle:', err);
                }
              }

              io.to(battleId).emit('battle-tie', {
                message: `Time limit reached! Both players passed ${p1Tests}/${totalTests} tests - it's a tie!`,
                finishedAt: battle.finishedAt,
                tie: true,
                testProgress: { player1: p1Tests, player2: p2Tests, total: totalTests },
                ratingChanges: {
                  player1: {
                    change: tieResult.player1RatingChange || 0,
                    newRating: tieResult.player1NewRating || null,
                    newRank: tieResult.player1Rank?.display || null
                  },
                  player2: {
                    change: tieResult.player2RatingChange || 0,
                    newRating: tieResult.player2NewRating || null,
                    newRank: tieResult.player2Rank?.display || null
                  }
                }
              });

              // Emit badge notifications for both players in tie
              if (tieResult.player1NewBadges?.length > 0 && player1?.socketId) {
                io.to(player1.socketId).emit('badges-earned', {
                  badges: tieResult.player1NewBadges,
                  context: 'battle_tie'
                });
              }
              if (tieResult.player2NewBadges?.length > 0 && player2?.socketId) {
                io.to(player2.socketId).emit('badges-earned', {
                  badges: tieResult.player2NewBadges,
                  context: 'battle_tie'
                });
              }
            }
            // Case 3: Different progress - partial credit win
            else {
              const winner = p1Tests > p2Tests ? player1 : player2;
              const loser = p1Tests > p2Tests ? player2 : player1;

              updateAnalytics('battle-completed', {
                problemId: battle.problem.id,
                duration: battle.timeLimit,
                result: 'partial_credit_win'
              });

              battle.winner = winner.id;

              let battleResult = { winnerRatingChange: 0, loserRatingChange: 0 };

              if (winner?.userId || loser?.userId) {
                try {
                  battleResult = await persistPartialCreditBattleResult(battle, winner, loser, battle.timeLimit);
                } catch (err) {
                  logger.error('Failed to persist partial credit battle:', err);
                }
              }

              io.to(battleId).emit('battle-partial-credit', {
                message: `Time's up! ${winner.name} wins with ${winner.testsPassed || 0}/${totalTests} tests vs ${loser.testsPassed || 0}/${totalTests}!`,
                finishedAt: battle.finishedAt,
                isPartialCredit: true,
                winner: winner.id,
                loser: loser.id,
                winnerName: winner.name,
                loserName: loser.name,
                testProgress: {
                  winner: winner.testsPassed || 0,
                  loser: loser.testsPassed || 0,
                  total: totalTests
                },
                ratingChanges: {
                  winner: {
                    oldRating: battleResult.winnerNewRating ? battleResult.winnerNewRating - battleResult.winnerRatingChange : null,
                    change: battleResult.winnerRatingChange || 0,
                    newRating: battleResult.winnerNewRating || null,
                    newRank: battleResult.winnerRank?.display || null
                  },
                  loser: {
                    oldRating: battleResult.loserNewRating ? battleResult.loserNewRating - battleResult.loserRatingChange : null,
                    change: battleResult.loserRatingChange || 0,
                    newRating: battleResult.loserNewRating || null,
                    newRank: battleResult.loserRank?.display || null
                  }
                },
                scaleFactor: battleResult.scaleFactor
              });

              // Emit badge notifications
              if (battleResult.winnerNewBadges?.length > 0 && winner?.socketId) {
                io.to(winner.socketId).emit('badges-earned', {
                  badges: battleResult.winnerNewBadges,
                  context: 'partial_credit_win'
                });
              }
              if (battleResult.loserNewBadges?.length > 0 && loser?.socketId) {
                io.to(loser.socketId).emit('badges-earned', {
                  badges: battleResult.loserNewBadges,
                  context: 'partial_credit_loss'
                });
              }
            }
          }
            }); // end withBattleLock
          } catch (lockErr) {
            logger.error(`[Timer] withBattleLock failed for battle ${battleId}:`, lockErr);
          }
        }
      }
    }
  }, 2000); // Check every 2 seconds for better timer accuracy
}

queueCleanupInterval = setInterval(() => {
  cleanupExpiredQueueEntries();
  cleanupExpiredRematches();
}, 5000);

initializeTimerSystem();

// ============================================================================
// ROUTES
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    message: 'Code Arena Battle Server',
    status: 'running',
    timestamp: new Date().toISOString(),
    version: '2.3.1',
    environment: process.env.NODE_ENV || 'development',
    features: ['battles', 'matchmaking', 'analytics', 'feedback', 'rematch'],
    problems: problemsLoader.count()
  });
});

// Public stats endpoint (no auth required) - for homepage display
app.get('/api/stats/public', async (req, res) => {
  try {
    const result = await dbHelper.get(`
      SELECT COUNT(*) as count FROM users
      WHERE username IS NOT NULL
    `);
    const last7Days = await dbHelper.get(`
      SELECT COUNT(*) as count FROM users
      WHERE username IS NOT NULL AND created_at >= datetime('now', '-7 days')
    `);
    const last30Days = await dbHelper.get(`
      SELECT COUNT(*) as count FROM users
      WHERE username IS NOT NULL AND created_at >= datetime('now', '-30 days')
    `);
    res.json({
      success: true,
      userCount: result?.count || 0,
      signupsLast7Days: last7Days?.count || 0,
      signupsLast30Days: last30Days?.count || 0
    });
  } catch (err) {
    logger.error('[Stats] Failed to get public stats:', err.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.get('/health', async (req, res) => {
  // Check database connectivity
  let dbStatus = 'ok';
  try {
    await dbHelper.get('SELECT 1');
  } catch (err) {
    dbStatus = 'error';
    logger.error('[Health] Database check failed:', err.message);
  }

  const status = dbStatus === 'ok' ? 'ok' : 'degraded';
  const statusCode = status === 'ok' ? 200 : 503;

  res.status(statusCode).json({
    status,
    // Deployed commit SHA (Railway injects RAILWAY_GIT_COMMIT_SHA). Lets the
    // post-deploy CI gate confirm prod actually flipped to the merged commit,
    // so a crash-looping build hiding behind the last healthy one is caught.
    version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown',
    services: {
      database: dbStatus,
      websocket: io.engine.clientsCount > 0 || battles.size === 0 ? 'ok' : 'unknown'
    },
    battles: battles.size,
    connections: playerConnections.size,
    queueSize: matchmakingQueue.size,
    rematchRequests: rematchRequests.size,
    problems: problemsLoader.count(),
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Admin endpoint to manually trigger database migrations
app.post('/admin/run-migrations', requireAdminKey, async (req, res) => {
  try {
    await dbHelper.init();
    res.json({ success: true, message: 'Migrations completed' });
  } catch (err) {
    logger.error('Migration failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to directly add google_id column
app.post('/admin/fix-google-id', requireAdminKey, async (req, res) => {
  try {
    // Add column without UNIQUE constraint first
    await dbHelper.run(`ALTER TABLE users ADD COLUMN google_id TEXT`);
    // Then create unique index separately
    await dbHelper.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`);
    res.json({ success: true, message: 'google_id column added' });
  } catch (err) {
    if (err.message.includes('duplicate column')) {
      res.json({ success: true, message: 'Column already exists' });
    } else {
      logger.error('Fix google_id failed:', err);
      res.status(500).json({ error: err.message });
    }
  }
});

// Admin endpoint to grant Pro to a user
app.post('/admin/grant-pro', requireAdminKey, async (req, res) => {
  const { username, months } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  try {
    const user = await dbHelper.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (months || 1));

    await dbHelper.setUserProStatus(user.id, true, expiresAt.toISOString());
    res.json({ success: true, message: `Pro granted to ${username} until ${expiresAt.toISOString()}` });
  } catch (err) {
    logger.error('Grant pro failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to find and fix users with is_pro=1 but NULL pro_expires_at
app.get('/admin/null-expiry-pro-users', requireAdminKey, async (req, res) => {
  try {
    const users = await dbHelper.all(
      `SELECT id, username, email, stripe_subscription_id, stripe_customer_id
       FROM users WHERE is_pro = 1 AND pro_expires_at IS NULL`
    );
    res.json({ count: users.length, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to delete a user (for testing)
app.post('/admin/delete-user', requireAdminKey, async (req, res) => {
  const { username, email } = req.body;
  if (!username && !email) {
    return res.status(400).json({ error: 'Username or email required' });
  }

  try {
    // Get user ID first (by username or email)
    const user = username
      ? await dbHelper.get(`SELECT id, username FROM users WHERE username = ?`, [username])
      : await dbHelper.get(`SELECT id, username FROM users WHERE email = ?`, [email]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete related data
    await dbHelper.run(`DELETE FROM user_stats WHERE user_id = ?`, [user.id]);
    await dbHelper.run(`DELETE FROM battles_history WHERE winner_id = ? OR loser_id = ?`, [user.id, user.id]);
    await dbHelper.run(
      `DELETE FROM message_reactions
       WHERE user_id = ?
          OR message_id IN (SELECT id FROM messages WHERE sender_id = ? OR receiver_id = ?)`,
      [user.id, user.id, user.id]
    );
    await dbHelper.run(`DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?`, [user.id, user.id]);
    await dbHelper.run(`DELETE FROM friend_requests WHERE requester_id = ? OR requested_id = ?`, [user.id, user.id]);
    await dbHelper.run(`DELETE FROM users WHERE id = ?`, [user.id]);

    res.json({ success: true, message: `User ${username} deleted` });
  } catch (err) {
    logger.error('Delete user failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to reset onboarding for testing
app.post('/admin/reset-onboarding', requireAdminKey, async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  try {
    await dbHelper.run(`UPDATE users SET has_onboarded = 0 WHERE username = ?`, [username]);
    res.json({ success: true, message: `Onboarding reset for ${username}` });
  } catch (err) {
    logger.error('Reset onboarding failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// In-memory lock to prevent concurrent changelog sends
const changelogSendLock = {
  inProgress: false,
  edition: null,
  startedAt: null
};

// Admin endpoint to send weekly changelog email to all subscribers
// Supports: ?dryRun=true to preview recipients without sending
app.post('/admin/send-changelog', requireAdminKey, async (req, res) => {
  // Check for dry-run mode (preview without sending)
  const dryRun = req.query.dryRun === 'true' || req.body.dryRun === true;

  try {
    // Edition identifier (use date or custom from request)
    const edition = req.body.edition || new Date().toISOString().split('T')[0]; // e.g., "2026-02-27"

    // DUPLICATE PREVENTION: Check if a send is already in progress
    if (changelogSendLock.inProgress) {
      const elapsed = Date.now() - changelogSendLock.startedAt;
      return res.status(409).json({
        error: 'Changelog send already in progress',
        edition,
        startedAt: new Date(changelogSendLock.startedAt).toISOString(),
        elapsedSeconds: Math.round(elapsed / 1000)
      });
    }

    // Use custom changes from request body, or fall back to hardcoded approved list
    const changes = req.body.changes || [
      'Bot Practice Mode, XP system features',
      'Bot difficulty, editorial system',
      'Redesign AI interview chat panel with premium UX',
      'Make chat panel divider line more visible',
      'Fixes and improvements'
    ];
    if (!changes || changes.length === 0) {
      return res.status(400).json({ error: 'No changes to send' });
    }

    // Create tracking table if it doesn't exist
    await dbHelper.run(`
      CREATE TABLE IF NOT EXISTS changelog_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        edition TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edition)
      )
    `);

    // Get users with valid emails who haven't received this edition AND who have
    // not opted out of marketing emails. Changelog is a marketing/product-update
    // email, so marketing = 0 (explicit unsubscribe) must be excluded.
    // NULL = no preference set yet = include.
    const subscribers = await dbHelper.all(`
      SELECT u.id, u.email, u.username
      FROM users u
      LEFT JOIN changelog_sends cs ON u.id = cs.user_id AND cs.edition = ?
      LEFT JOIN user_email_preferences uep ON u.id = uep.user_id
      WHERE u.email IS NOT NULL
      AND u.email != ''
      AND cs.id IS NULL
      AND (uep.marketing IS NULL OR uep.marketing = 1)
    `, [edition]);

    // DRY RUN MODE: Return preview without sending
    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        message: `Would send to ${subscribers.length} subscribers`,
        edition,
        subscriberCount: subscribers.length,
        sampleRecipients: subscribers.slice(0, 10).map(s => ({
          email: s.email.replace(/(.{2}).*(@.*)/, '$1***$2'), // Mask email
          username: s.username
        })),
        changes
      });
    }

    if (!subscribers || subscribers.length === 0) {
      return res.status(400).json({
        error: 'No subscribers found',
        message: 'All users have already received this edition or no valid emails exist',
        edition
      });
    }

    // ACQUIRE LOCK before sending
    changelogSendLock.inProgress = true;
    changelogSendLock.edition = edition;
    changelogSendLock.startedAt = Date.now();

    // Respond immediately, emails will send in background
    res.json({
      success: true,
      message: `Changelog emails queued for ${subscribers.length} subscribers`,
      edition,
      subscriberCount: subscribers.length,
      changes
    });

    // Send emails in background (non-blocking)
    setImmediate(async () => {
      let sent = 0;
      let failed = 0;
      let skipped = 0;

      try {
        for (const user of subscribers) {
          try {
            // TRACK FIRST with pending status to prevent duplicates from concurrent requests
            const insertResult = await dbHelper.run(
              `INSERT OR IGNORE INTO changelog_sends (user_id, edition) VALUES (?, ?)`,
              [user.id, edition]
            );

            if (insertResult.changes === 0) {
              skipped++;
              continue;
            }

            // Send the email
            await emailService.sendWeeklyChangelogEmail({
              email: user.email,
              username: user.username,
              userId: user.id,
              changes
            });

            sent++;
            // Rate limit: 600ms between emails to respect Resend's 2 req/sec limit
            await new Promise(resolve => setTimeout(resolve, 600));
          } catch (err) {
            failed++;
            logger.error(`Failed to send changelog to ${user.email}:`, err.message);

            try {
              await dbHelper.run(
                `DELETE FROM changelog_sends WHERE user_id = ? AND edition = ?`,
                [user.id, edition]
              );
            } catch (deleteErr) {
              logger.error(`Failed to cleanup tracking for ${user.email}:`, deleteErr.message);
            }
          }
        }
      } finally {
        // RELEASE LOCK
        changelogSendLock.inProgress = false;
        changelogSendLock.edition = null;
        changelogSendLock.startedAt = null;
        logger.info(`Changelog send complete: sent=${sent}, failed=${failed}, skipped=${skipped}, total=${subscribers.length}`);
      }
    });
  } catch (err) {
    // Release lock on error
    changelogSendLock.inProgress = false;
    changelogSendLock.edition = null;
    changelogSendLock.startedAt = null;

    logger.error('Send changelog failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to get changelog stats
app.get('/admin/changelog-stats', requireAdminKey, async (req, res) => {
  try {
    const edition = req.query.edition || new Date().toISOString().split('T')[0];

    // Ensure table exists
    await dbHelper.run(`
      CREATE TABLE IF NOT EXISTS changelog_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        edition TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edition)
      )
    `);

    // Get total users
    const totalUsersResult = await dbHelper.get(`SELECT COUNT(*) as count FROM users`);
    const totalUsers = totalUsersResult?.count || 0;

    // Get users with valid emails
    const usersWithEmailsResult = await dbHelper.get(`
      SELECT COUNT(*) as count FROM users
      WHERE email IS NOT NULL AND email != ''
    `);
    const usersWithEmails = usersWithEmailsResult?.count || 0;

    // Get tracked sends for this edition
    const trackedSendsResult = await dbHelper.get(`
      SELECT COUNT(*) as count FROM changelog_sends WHERE edition = ?
    `, [edition]);
    const trackedSends = trackedSendsResult?.count || 0;

    // Get users who should have received but haven't
    const pendingResult = await dbHelper.get(`
      SELECT COUNT(*) as count FROM users u
      LEFT JOIN changelog_sends cs ON u.id = cs.user_id AND cs.edition = ?
      WHERE u.email IS NOT NULL AND u.email != '' AND cs.id IS NULL
    `, [edition]);
    const pendingUsers = pendingResult?.count || 0;

    // Get recent edition history
    const recentEditions = await dbHelper.all(`
      SELECT edition, COUNT(*) as sent_count, MIN(sent_at) as first_sent, MAX(sent_at) as last_sent
      FROM changelog_sends
      GROUP BY edition
      ORDER BY edition DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      edition,
      total_users: totalUsers,
      users_with_emails: usersWithEmails,
      tracked_sends_today: trackedSends,
      pending_users: pendingUsers,
      all_sent: pendingUsers === 0 && trackedSends === usersWithEmails,
      match: trackedSends === usersWithEmails,
      // Show lock status to help debug concurrent request issues
      lock_status: {
        in_progress: changelogSendLock.inProgress,
        edition: changelogSendLock.edition,
        started_at: changelogSendLock.startedAt ? new Date(changelogSendLock.startedAt).toISOString() : null,
        elapsed_seconds: changelogSendLock.startedAt ? Math.round((Date.now() - changelogSendLock.startedAt) / 1000) : null
      },
      recent_editions: recentEditions
    });
  } catch (err) {
    logger.error('Changelog stats failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to get users with email preferences (for duplicate email investigation)
app.get('/admin/duplicate-recipients', requireAdminKey, async (req, res) => {
  try {
    // Users who have entries in user_email_preferences are the ones who explicitly set preferences
    // These users received the changelog email multiple times (3x) while others got it once
    const usersWithPreferences = await dbHelper.all(`
      SELECT u.id, u.username, u.email, uep.marketing, uep.weekly_challenge, uep.created_at
      FROM users u
      JOIN user_email_preferences uep ON u.id = uep.user_id
      WHERE u.email IS NOT NULL AND u.email != ''
      ORDER BY uep.created_at DESC
    `);

    res.json({
      success: true,
      message: 'Users with email preferences (received changelog 3x instead of 1x)',
      count: usersWithPreferences.length,
      users: usersWithPreferences.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        marketing: u.marketing === 1,
        weekly_challenge: u.weekly_challenge === 1,
        preference_created: u.created_at
      }))
    });
  } catch (err) {
    logger.error('Duplicate recipients query failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all problems (shuffled by default for practice mode)
// Only returns visible test cases - hidden test cases are validated server-side
function problemPool(difficulty) {
  const label = problemsLoader.normalizeDifficulty(difficulty);
  return label ? [...problemsLoader.loadByDifficulty(label)] : [...problemsLoader.getAll()];
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Problem list. Only the public examples are included; hidden tests stay server-side.
app.get('/api/problems', (req, res) => {
  try {
    const { shuffle = 'true', difficulty, tag } = req.query;
    let pool = problemPool(difficulty);
    if (tag) {
      const wanted = String(tag).toLowerCase();
      pool = pool.filter(p =>
        String(p.category).toLowerCase() === wanted ||
        (p.tags || []).some(t => String(t).toLowerCase() === wanted)
      );
    }
    if (shuffle === 'true') shuffleInPlace(pool);
    const problems = pool.map(p => problemsLoader.getVisibleProblem(p));
    res.json({ success: true, count: problems.length, problems });
  } catch (error) {
    logger.error('Error fetching problems:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch problems' });
  }
});

// One random problem, optionally filtered by difficulty and excluding ids already seen.
app.get('/api/problems/random', (req, res) => {
  try {
    const { difficulty, exclude } = req.query;
    let pool = problemPool(difficulty);
    if (pool.length === 0) {
      return res.status(500).json({ success: false, error: 'No problems available' });
    }
    if (exclude) {
      const excluded = new Set(String(exclude).split(','));
      const remaining = pool.filter(p => !excluded.has(p.id));
      if (remaining.length > 0) pool = remaining;
    }
    const problem = pool[Math.floor(Math.random() * pool.length)];
    res.json({
      success: true,
      problem: problemsLoader.getVisibleProblem(problem),
      remaining: pool.length - 1
    });
  } catch (error) {
    logger.error('Error fetching random problem:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch random problem' });
  }
});

app.get('/api/problems/:problemId', (req, res) => {
  try {
    const problem = problemsLoader.getByIdForFrontend(req.params.problemId);
    if (!problem) {
      return res.status(404).json({ success: false, error: 'Problem not found' });
    }
    res.json({ success: true, problem });
  } catch (error) {
    logger.error('Error fetching problem:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch problem' });
  }
});

// Ids, titles and difficulties (sitemap), plus the languages this server can run.
app.get('/api/problems-meta', (req, res) => {
  try {
    const all = problemsLoader.getAll();
    const difficulties = { easy: 0, medium: 0, hard: 0 };
    for (const p of all) {
      const key = String(p.difficulty).toLowerCase();
      if (key in difficulties) difficulties[key] += 1;
    }
    res.json({
      success: true,
      count: all.length,
      languages: problemsLoader.getLanguages(),
      difficulties,
      problems: all.map(p => ({ id: p.id, title: p.title, difficulty: p.difficulty }))
    });
  } catch (error) {
    logger.error('Error fetching problems meta:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch problems meta' });
  }
});

app.get('/api/battle/:battleId/timer', (req, res) => {
  try {
    const { battleId } = req.params;
    
    if (!validateBattleId(battleId)) {
      return res.status(400).json({
        error: 'Invalid battle ID format',
        success: false
      });
    }
    
    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found',
        success: false
      });
    }
    
    if (!battle.serverStartTime) {
      return res.json({ 
        timeRemaining: battle.timeLimit,
        serverTime: Date.now(),
        battleStarted: null,
        success: true
      });
    }
    
    const elapsed = (Date.now() - battle.serverStartTime) / 1000;
    const timeRemaining = Math.max(0, battle.timeLimit - elapsed);
    
    res.json({ 
      timeRemaining,
      serverTime: Date.now(),
      battleStarted: battle.serverStartTime,
      success: true
    });
    
  } catch (error) {
    logger.error('Timer sync error:', error);
    res.status(500).json({
      error: 'Failed to get timer status',
      success: false
    });
  }
});

// Practice mode - execute code and validate against ALL test cases (including hidden)
// Uses server-side test cases to prevent cheating
app.post('/api/practice/run', async (req, res) => {
  try {
    const { code, language, problemId, solveTime } = req.body;
    const authUser = await extractUserFromToken(req);

    if (!authUser?.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        success: false,
        message: 'Sign in to practice.'
      });
    }

    if (!code || !language || !problemId) {
      return res.status(400).json({
        error: 'Missing required fields: code, language, problemId',
        success: false
      });
    }

    // Check email verification (required for practice)
    const emailCheck = await checkEmailVerified(authUser.userId);
    if (!emailCheck.verified) {
      return res.status(403).json({
        error: 'Email verification required',
        success: false,
        emailVerificationRequired: true,
        message: 'Please verify your email address to use practice mode. Check your inbox for the verification link.'
      });
    }

    // SECURITY: Always use server-side test cases, never trust frontend
    const problem = problemsLoader.getById(problemId);
    if (!problem || !problem.testCases) {
      return res.status(404).json({
        error: 'Problem not found',
        success: false
      });
    }

    const languageRejection = getLanguageRejection(problem, language);
    if (languageRejection) return res.status(400).json({ success: false, ...languageRejection });

    const practiceLimit = getConsumerFairUseLimit('practiceRunsPerDay');
    const globalCodeLimit = getConsumerFairUseLimit('globalCodeExecutionsPerDay');
    const executionQuota = await dbHelper.tryConsumeConsumerDailyUsage([
      { metric: 'practice_execution', subjectId: `user:${authUser.userId}`, limit: practiceLimit },
      { metric: 'code_execution', subjectId: 'global', limit: globalCodeLimit }
    ]);
    if (!executionQuota.allowed) {
      const globalLimitReached = executionQuota.reason === 'global_limit';
      return res.status(429).json({
        error: globalLimitReached ? 'Code runner daily capacity reached' : 'Daily practice limit reached',
        success: false,
        limitReached: true,
        globalLimitReached,
        remaining: 0,
        limit: globalLimitReached ? globalCodeLimit : practiceLimit,
        isPro: false,
        message: globalLimitReached
          ? 'CodeArena has reached today\'s code-runner capacity. Please try again tomorrow.'
          : `You've reached today's fair-use limit of ${practiceLimit} practice runs. Try again tomorrow.`
      });
    }

    logger.debug(`[PRACTICE] Running ${language} code for problem: ${problemId} (${problem.testCases.length} test cases)`);

    // Run against ALL test cases (visible + hidden)
    const allResults = await executeAndValidateSolution(code, problem.testCases, language, problemId);
    if (executionWasUnavailable(allResults)) {
      return res.status(503).json({ success: false, executionUnavailable: true, error: 'Code runner temporarily unavailable. Please retry.' });
    }
    const allPassed = allTestsPassed(allResults);

    // Split results into visible and hidden
    const visibleCount = problemsLoader.visibleCount(problem);
    const visibleResults = allResults.slice(0, visibleCount);
    const hiddenResults = allResults.slice(visibleCount);
    const hiddenPassed = hiddenResults.filter(r => r.passed).length;
    const hiddenTotal = hiddenResults.length;

    await dbHelper.recordPracticeAttempt(authUser.userId, {
      problemId,
      language,
      solved: allPassed,
      solveTime: Number.isFinite(Number(solveTime)) ? Math.max(0, Math.floor(Number(solveTime))) : null,
      solutionCode: allPassed ? code : null
    });

    return res.json({
      success: true,
      results: visibleResults,
      hiddenTests: {
        passed: hiddenPassed,
        total: hiddenTotal
      },
      allPassed,
      practiceRecorded: true,
      solutionSaved: allPassed
    });
  } catch (error) {
    logger.error('[PRACTICE] Error executing code:', error);
    return res.status(500).json({
      error: 'Failed to execute code',
      message: error.message,
      success: false
    });
  }
});

// Practice mode - run code against a single custom test input
app.post('/api/practice/run-custom', async (req, res) => {
  try {
    const { code, language, problemId, customInput } = req.body;
    const authUser = await extractUserFromToken(req);

    if (!authUser?.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        success: false
      });
    }

    if (!code || !language || !problemId || customInput === undefined || customInput === null) {
      return res.status(400).json({
        error: 'Missing required fields: code, language, problemId, customInput',
        success: false
      });
    }

    // Verify problem exists
    const problem = problemsLoader.getById(problemId);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found', success: false });
    }

    const emailCheck = await checkEmailVerified(authUser.userId);
    if (!emailCheck.verified) {
      return res.status(403).json({
        error: 'Email verification required',
        success: false,
        emailVerificationRequired: true
      });
    }

    const languageRejection = getLanguageRejection(problem, language, customInput);
    if (languageRejection) return res.status(400).json({ success: false, ...languageRejection });

    const practiceLimit = getConsumerFairUseLimit('practiceRunsPerDay');
    const globalCodeLimit = getConsumerFairUseLimit('globalCodeExecutionsPerDay');
    const executionQuota = await dbHelper.tryConsumeConsumerDailyUsage([
      { metric: 'practice_execution', subjectId: `user:${authUser.userId}`, limit: practiceLimit },
      { metric: 'code_execution', subjectId: 'global', limit: globalCodeLimit }
    ]);
    if (!executionQuota.allowed) {
      const globalLimitReached = executionQuota.reason === 'global_limit';
      return res.status(429).json({
        error: globalLimitReached ? 'Code runner daily capacity reached' : 'Daily practice limit reached',
        success: false,
        limitReached: true,
        globalLimitReached,
        remaining: 0,
        limit: globalLimitReached ? globalCodeLimit : practiceLimit,
        isPro: false,
        message: globalLimitReached
          ? 'CodeArena has reached today\'s code-runner capacity. Please try again tomorrow.'
          : `You've reached today's fair-use limit of ${practiceLimit} practice runs. Try again tomorrow.`
      });
    }

    logger.debug(`[PRACTICE] Running custom test for problem: ${problemId}, language: ${language}`);

    const result = await runSingleTest(code, language, problemId, customInput);

    return res.json({
      success: result.success,
      executionUnavailable: result.executionUnavailable || false,
      invalidInput: result.invalidInput || false,
      output: result.output || '',
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      executionTime: result.executionTime || 0,
      blocked: result.blocked || false,
      timedOut: result.timedOut || false,
      isCompileError: result.isCompileError || false
    });
  } catch (error) {
    logger.error('[PRACTICE] Error running custom test:', error);
    return res.status(500).json({
      error: 'Failed to execute code',
      message: error.message,
      success: false
    });
  }
});

// Practice mode - record attempt (for authenticated users)
app.post('/api/practice/record', async (req, res) => {
  try {
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Not authenticated', success: false });
    }

    const { problemId, language, solved, solveTime, solutionCode } = req.body;

    if (!problemId || !language) {
      return res.status(400).json({ error: 'Missing problemId or language', success: false });
    }

    await dbHelper.recordPracticeAttempt(authUser.userId, {
      problemId,
      language,
      solved: !!solved,
      solveTime: Number.isFinite(Number(solveTime)) ? Math.max(0, Math.floor(Number(solveTime))) : null,
      solutionCode: solved ? solutionCode || null : null
    });

    logger.debug(`[PRACTICE] Recorded attempt for user ${authUser.userId}: ${problemId} (${solved ? 'solved' : 'attempted'})`);

    // Check for practice badges if solved
    let newBadges = [];
    if (solved) {
      try {
        newBadges = await badgeService.checkAfterPracticeSolve(authUser.userId);
        notifyNewBadges(authUser.userId, newBadges);
        if (newBadges.length > 0) {
          logger.info(` User ${authUser.userId} earned ${newBadges.length} practice badge(s): ${newBadges.map(b => b.name).join(', ')}`);

          // Emit real-time badge notification via socket
          if (global.emitToUser) {
            global.emitToUser(authUser.userId, 'badges-earned', {
              badges: newBadges,
              context: 'practice_solve'
            });
          }

          // Record badge activities
          for (const badge of newBadges) {
            try {
              await activityService.recordBadgeEarned(authUser.userId, {
                badgeName: badge.name,
                badgeSlug: badge.slug,
                badgeIcon: badge.icon,
                badgeRarity: badge.rarity
              });
            } catch (actErr) {
              logger.error('Activity recording failed for practice badge:', actErr);
            }
          }
        }
      } catch (err) {
        logger.error('Badge check failed for practice:', err);
      }
    }

    return res.json({ success: true, newBadges });
  } catch (error) {
    logger.error('[PRACTICE] Error recording attempt:', error);
    return res.status(500).json({ error: 'Failed to record attempt', success: false });
  }
});

// Practice mode - get accepted solution for the signed-in user and problem
app.get('/api/practice/solution/:problemId', async (req, res) => {
  try {
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Not authenticated', success: false });
    }

    const { problemId } = req.params;
    if (!problemId) {
      return res.status(400).json({ error: 'Missing problemId', success: false });
    }

    const solution = await dbHelper.getPracticeSolution(authUser.userId, problemId);

    return res.json({
      success: true,
      solution: solution ? {
        problemId: solution.problem_id,
        language: solution.language,
        code: solution.solution_code,
        submittedAt: solution.solution_submitted_at,
        solveTime: solution.solve_time
      } : null
    });
  } catch (error) {
    logger.error('[PRACTICE] Error fetching practice solution:', error);
    return res.status(500).json({ error: 'Failed to fetch practice solution', success: false });
  }
});

// Practice mode - get stats
app.get('/api/practice/stats', async (req, res) => {
  try {
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Not authenticated', success: false });
    }

    const practiceStats = await dbHelper.getPracticeStats(authUser.userId);

    return res.json({
      success: true,
      ...practiceStats
    });
  } catch (error) {
    logger.error('[PRACTICE] Error fetching stats:', error);
    return res.status(500).json({ error: 'Failed to fetch practice stats', success: false });
  }
});

// Get daily usage limits for free tier
app.get('/api/limits', async (req, res) => {
  try {
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Not authenticated', success: false });
    }

    const [battleLimits, practiceLimits, languageInfo] = await Promise.all([
      dbHelper.canUserBattle(authUser.userId),
      dbHelper.canUserPractice(authUser.userId),
      dbHelper.getUserAvailableLanguages(authUser.userId)
    ]);

    return res.json({
      success: true,
      accessModel: CODEARENA_PRODUCT_MODE.consumer.accessModel,
      paidSubscriptionsEnabled: CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled,
      isPro: battleLimits.isPro,
      battles: {
        remaining: battleLimits.remaining,
        limit: battleLimits.limit,
        used: battleLimits.todayCount || 0
      },
      practice: {
        remaining: practiceLimits.remaining,
        limit: practiceLimits.limit,
        used: practiceLimits.todayCount || 0
      },
      languages: languageInfo.languages
    });
  } catch (error) {
    logger.error('[LIMITS] Error fetching limits:', error);
    return res.status(500).json({ error: 'Failed to fetch limits', success: false });
  }
});

app.post('/api/battle/create', authRouter.authMiddleware, async (req, res) => {
  try {
    const { playerName = 'Anonymous', timeLimit: requestedTimeLimit, ranked = false } = req.body;

    // Validate and set time limit (default 10 minutes)
    const validTimeLimits = [600, 1800, 3600]; // 10, 30, 60 minutes
    const timeLimit = validTimeLimits.includes(requestedTimeLimit) ? requestedTimeLimit : 600;

    const authUser = { userId: req.user.sub, username: req.user.username };
    // Fetch fresh username from DB (JWT token may have stale placeholder)
    let displayName = playerName.trim();
    if (authUser?.userId) {
      const freshUser = await dbHelper.getUserById(authUser.userId);
      displayName = freshUser?.username || authUser?.username || displayName;
    }

    if (!validatePlayerName(displayName)) {
      return res.status(400).json({
        error: 'Player name must be between 1 and 50 characters',
        success: false
      });
    }

    const battleId = uuidv4();
    const playerId = uuidv4();

    // Fetch creator's rating for difficulty-appropriate problem selection
    let creatorRating = null;
    if (authUser?.userId) {
      const stats = await dbHelper.getUserStats(authUser.userId);
      creatorRating = stats?.rating || 1000;
    }
    const problem = getRandomProblem(null, creatorRating);

    if (!problem || !problem.id || !problem.title || !problem.testCases) {
      logger.error('CRITICAL: Failed to assign problem to battle');
      return res.status(500).json({
        error: 'Failed to assign problem - please try again',
        success: false
      });
    }

    const battle = {
      id: battleId,
      problem: problem,
      players: [
        {
          id: playerId,
          name: sanitizePlayerName(displayName),
          userId: authUser?.userId || null,
          socketId: null,
          ready: false,
          code: '',
          language: 'python',
          submitted: false,
          submittedAt: null
        }
      ],
      state: 'waiting',
      creationKind: 'private',
      createdAt: Date.now(),
      timeLimit: timeLimit,
      matchmade: ranked === true || ranked === 'true',
      ranked: ranked === true || ranked === 'true'
    };
    
    // Perform the final checks immediately before insertion with no await in
    // between. That makes the per-process check-and-claim atomic in Node's
    // event loop, including when several create requests arrive together.
    evictOldBattlesIfNeeded();
    if (battles.size >= MAX_BATTLES) {
      return res.status(503).json({
        error: 'Battle capacity is full. Please try again shortly.',
        success: false,
        code: 'BATTLE_CAPACITY_FULL'
      });
    }
    if (countActivePrivateBattlesForUser(authUser.userId) >= MAX_ACTIVE_PRIVATE_BATTLES_PER_USER) {
      return res.status(429).json({
        error: 'Finish or leave an existing private battle before creating another.',
        success: false,
        code: 'ACTIVE_PRIVATE_BATTLE_LIMIT'
      });
    }
    battles.set(battleId, battle);
    logger.info(` Created private battle ${battleId} with problem: ${problem.id} - ${problem.title}`);
    
    updateAnalytics('battle-created');
    cleanupBattle(battleId);
    
    res.json({
      battleId,
      playerId,
      success: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Create battle error:', error);
    res.status(500).json({
      error: 'Failed to create battle',
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/battle/join/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;
    const { playerName = 'Anonymous' } = req.body;

    // Require authentication for joining battles
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({
        error: 'Authentication required to join battles',
        success: false
      });
    }
    // Fetch fresh username from DB (JWT token may have stale placeholder like player_xxxxx)
    const freshUser = await dbHelper.getUserById(authUser.userId);
    const displayName = freshUser?.username || authUser.username;

    if (!validateBattleId(battleId)) {
      return res.status(400).json({
        error: 'Invalid battle ID format',
        success: false
      });
    }

    if (!validatePlayerName(displayName)) {
      return res.status(400).json({
        error: 'Player name must be between 1 and 50 characters',
        success: false
      });
    }

    const battle = battles.get(battleId);

    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found',
        success: false
      });
    }

    if (battle.players.length >= 2) {
      return res.status(400).json({
        error: 'Battle is full',
        success: false
      });
    }

    if (battle.state !== 'waiting') {
      return res.status(400).json({
        error: 'Battle already started',
        success: false
      });
    }

    // Check if user is already in the battle (e.g., as creator)
    const alreadyInBattle = battle.players.some(p => p.userId === authUser.userId);
    if (alreadyInBattle) {
      return res.status(400).json({
        error: 'You are already in this battle',
        success: false
      });
    }

    const playerId = uuidv4();
    const player = {
      id: playerId,
      name: sanitizePlayerName(displayName),
      userId: authUser.userId,
      socketId: null,
      ready: false,
      code: '',
      language: 'python',
      submitted: false,
      submittedAt: null
    };

    battle.players.push(player);
    battles.set(battleId, battle);

    updateAnalytics('battle-joined');

    res.json({
      battleId,
      playerId,
      success: true,
      skipClipboard: battle.players.length === 2,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Join battle error:', error);
    res.status(500).json({
      error: 'Failed to join battle',
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================
// BATTLE INVITE ENDPOINTS
// ============================================

// Generate an invite link for a battle
app.post('/api/battle/:battleId/invite', async (req, res) => {
  try {
    const { battleId } = req.params;

    // Require authentication
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({
        error: 'Authentication required',
        success: false
      });
    }

    if (!validateBattleId(battleId)) {
      return res.status(400).json({
        error: 'Invalid battle ID format',
        success: false
      });
    }

    const battle = battles.get(battleId);

    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found',
        success: false
      });
    }

    // Verify the user is the battle creator (first player)
    const isCreator = battle.players[0]?.userId === authUser.userId;
    if (!isCreator) {
      return res.status(403).json({
        error: 'Only the battle creator can generate invite links',
        success: false
      });
    }

    if (battle.state !== 'waiting') {
      return res.status(400).json({
        error: 'Battle already started',
        success: false
      });
    }

    if (battle.players.length >= 2) {
      return res.status(400).json({
        error: 'Battle is already full',
        success: false
      });
    }

    // Check if there's an existing active invite for this battle
    let invite = await dbHelper.getActiveBattleInviteForBattle(battleId);

    if (!invite) {
      // Create a new invite
      invite = await dbHelper.createBattleInvite(battleId, authUser.userId);
    }

    // Construct the invite URL (frontend will handle this route)
    const baseUrl = FRONTEND_URL;
    const inviteUrl = `${baseUrl}/battle/invite/${invite.invite_code}`;

    res.json({
      inviteCode: invite.invite_code,
      inviteUrl,
      expiresAt: invite.expires_at,
      success: true
    });

  } catch (error) {
    logger.error('Generate invite error:', error);
    res.status(500).json({
      error: 'Failed to generate invite',
      success: false
    });
  }
});

// Regenerate invite link (expires old one, creates new)
app.post('/api/battle/:battleId/invite/regenerate', async (req, res) => {
  try {
    const { battleId } = req.params;

    // Require authentication
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({
        error: 'Authentication required',
        success: false
      });
    }

    if (!validateBattleId(battleId)) {
      return res.status(400).json({
        error: 'Invalid battle ID',
        success: false
      });
    }

    // Check if battle exists and user is the creator
    const battle = battles.get(battleId);
    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found',
        success: false
      });
    }

    const creator = battle.players[0];
    if (!creator || creator.userId !== authUser.userId) {
      return res.status(403).json({
        error: 'Only the battle creator can regenerate invites',
        success: false
      });
    }

    if (battle.state !== 'waiting') {
      return res.status(400).json({
        error: 'Cannot regenerate invite - battle already started',
        success: false
      });
    }

    if (battle.players.length >= 2) {
      return res.status(400).json({
        error: 'Cannot regenerate invite - battle already has an opponent',
        success: false
      });
    }

    // Expire any existing invites for this battle
    await dbHelper.expireBattleInvitesByBattleId(battleId);

    // Create a fresh invite
    const invite = await dbHelper.createBattleInvite(battleId, authUser.userId);

    const baseUrl = FRONTEND_URL;
    const inviteUrl = `${baseUrl}/battle/invite/${invite.invite_code}`;

    res.json({
      inviteCode: invite.invite_code,
      inviteUrl,
      expiresAt: invite.expires_at,
      regenerated: true,
      success: true
    });

  } catch (error) {
    logger.error('Regenerate invite error:', error);
    res.status(500).json({
      error: 'Failed to regenerate invite',
      success: false
    });
  }
});

// Get invite info (public - no auth required)
app.get('/api/battle/invite/:inviteCode', async (req, res) => {
  try {
    const { inviteCode } = req.params;

    if (!inviteCode || inviteCode.length < 6 || inviteCode.length > 12) {
      return res.status(400).json({
        error: 'Invalid invite code',
        valid: false
      });
    }

    const invite = await dbHelper.getBattleInviteByCode(inviteCode);

    if (!invite) {
      return res.json({
        valid: false,
        errorCode: 'INVITE_NOT_FOUND',
        error: 'This invite link doesn\'t exist or has been deleted'
      });
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(invite.expires_at);
    if (now > expiresAt) {
      await dbHelper.expireBattleInvite(inviteCode);
      const expiredAgo = Math.round((now - expiresAt) / 60000); // minutes ago
      return res.json({
        valid: false,
        errorCode: 'INVITE_EXPIRED',
        error: expiredAgo > 0
          ? `This invite expired ${expiredAgo} minute${expiredAgo !== 1 ? 's' : ''} ago`
          : 'This invite has expired'
      });
    }

    // Check if already used
    if (invite.status === 'used') {
      return res.json({
        valid: false,
        errorCode: 'INVITE_ALREADY_USED',
        error: 'Someone already joined using this invite'
      });
    }

    // Check if battle still exists and is waiting
    const battle = battles.get(invite.battle_id);
    if (!battle) {
      return res.json({
        valid: false,
        errorCode: 'BATTLE_CANCELLED',
        error: 'The battle creator has left. This battle no longer exists.'
      });
    }

    if (battle.state !== 'waiting') {
      return res.json({
        valid: false,
        errorCode: 'BATTLE_STARTED',
        error: 'This battle has already started'
      });
    }

    if (battle.players.length >= 2) {
      return res.json({
        valid: false,
        errorCode: 'BATTLE_FULL',
        error: 'This battle already has an opponent'
      });
    }

    // Return invite info (without sensitive data)
    res.json({
      valid: true,
      inviterUsername: invite.inviter_username,
      inviterAvatar: invite.inviter_avatar,
      inviterAvatarUrl: invite.inviter_avatar_url,
      expiresAt: invite.expires_at,
      battleId: invite.battle_id
    });

  } catch (error) {
    logger.error('Get invite info error:', error);
    res.status(500).json({
      valid: false,
      error: 'Failed to get invite info'
    });
  }
});

// Join battle via invite code (requires auth)
app.post('/api/battle/invite/:inviteCode/join', async (req, res) => {
  try {
    const { inviteCode } = req.params;

    // Require authentication
    const authUser = await extractUserFromToken(req);
    if (!authUser) {
      return res.status(401).json({
        error: 'Authentication required to join battle',
        success: false
      });
    }

    if (!inviteCode || inviteCode.length < 6 || inviteCode.length > 12) {
      return res.status(400).json({
        error: 'Invalid invite code',
        success: false
      });
    }

    const invite = await dbHelper.getBattleInviteByCode(inviteCode);

    if (!invite) {
      return res.status(404).json({
        error: 'This invite link doesn\'t exist or has been deleted',
        errorCode: 'INVITE_NOT_FOUND',
        success: false
      });
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(invite.expires_at);
    if (now > expiresAt) {
      await dbHelper.expireBattleInvite(inviteCode);
      const expiredAgo = Math.round((now - expiresAt) / 60000);
      return res.status(410).json({
        error: expiredAgo > 0
          ? `This invite expired ${expiredAgo} minute${expiredAgo !== 1 ? 's' : ''} ago`
          : 'This invite has expired',
        errorCode: 'INVITE_EXPIRED',
        success: false
      });
    }

    // Check if already used
    if (invite.status === 'used') {
      return res.status(410).json({
        error: 'Someone already joined using this invite',
        errorCode: 'INVITE_ALREADY_USED',
        success: false
      });
    }

    // Check if battle still exists
    const battle = battles.get(invite.battle_id);
    if (!battle) {
      return res.status(404).json({
        error: 'The battle creator has left. This battle no longer exists.',
        errorCode: 'BATTLE_CANCELLED',
        success: false
      });
    }

    // Can't join your own battle
    if (invite.inviter_id === authUser.userId) {
      return res.status(400).json({
        error: 'You can\'t join your own battle',
        errorCode: 'SELF_JOIN',
        success: false
      });
    }

    if (battle.state !== 'waiting') {
      return res.status(400).json({
        error: 'This battle has already started',
        errorCode: 'BATTLE_STARTED',
        success: false
      });
    }

    if (battle.players.length >= 2) {
      return res.status(400).json({
        error: 'This battle already has an opponent',
        errorCode: 'BATTLE_FULL',
        success: false
      });
    }

    // Atomically claim the invite FIRST to prevent race conditions
    // This ensures only one user can successfully join even if two click simultaneously
    const claimResult = await dbHelper.atomicClaimBattleInvite(inviteCode, authUser.userId);
    if (!claimResult.success) {
      return res.status(410).json({
        error: 'Someone else just claimed this invite. Try asking for a new one!',
        errorCode: 'INVITE_RACE_LOST',
        success: false
      });
    }

    // Now add player to battle (invite is safely claimed)
    const playerId = uuidv4();
    const player = {
      id: playerId,
      name: sanitizePlayerName(authUser.username),
      userId: authUser.userId,
      socketId: null,
      ready: false,
      code: '',
      language: 'python',
      submitted: false,
      submittedAt: null
    };

    battle.players.push(player);
    battles.set(invite.battle_id, battle);

    // Notify battle creator that someone joined
    const creator = battle.players[0];
    if (creator?.socketId) {
      const creatorSocket = io.sockets.sockets.get(creator.socketId);
      if (creatorSocket) {
        creatorSocket.emit('player-joined-via-invite', {
          playerId,
          playerName: player.name,
          playerUserId: authUser.userId
        });
      }
    }

    updateAnalytics('battle-joined');

    res.json({
      battleId: invite.battle_id,
      playerId,
      success: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Join via invite error:', error);
    res.status(500).json({
      error: 'Failed to join battle',
      success: false
    });
  }
});

// Public feed of recently finished matchmade battles (homepage activity ticker).
app.get('/api/battles/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);
    const rows = await dbHelper.all(`
      SELECT
        bh.battle_uuid,
        bh.problem_id,
        bh.is_tie,
        bh.created_at,
        bh.finished_at,
        bh.winner_language,
        winner.username AS winner_username,
        loser.username AS loser_username
      FROM battles_history bh
      LEFT JOIN users winner ON winner.id = bh.winner_id
      LEFT JOIN users loser ON loser.id = bh.loser_id
      WHERE bh.finished_at IS NOT NULL
      ORDER BY bh.finished_at DESC
      LIMIT ?
    `, [limit]);

    res.json(rows.map(r => ({
      battle_uuid: r.battle_uuid,
      problem_id: r.problem_id,
      is_tie: !!r.is_tie,
      created_at: r.finished_at || r.created_at,
      language: r.winner_language || 'python',
      winner_username: r.winner_username,
      player1_username: r.winner_username || r.loser_username,
    })));
  } catch (error) {
    logger.error('Recent battles error:', error);
    res.status(500).json({ error: 'Failed to load recent battles' });
  }
});

app.get('/api/battle/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;

    if (!validateBattleId(battleId)) {
      return res.status(400).json({
        error: 'Invalid battle ID format',
        success: false
      });
    }

    const battle = battles.get(battleId);
    
    if (!battle) {
      return res.status(404).json({
        error: 'Battle not found',
        success: false
      });
    }
    
    const publicBattle = {
      id: battle.id,
      state: battle.state,
      mode: battle.mode,
      type: battle.type,
      timeLimit: battle.timeLimit,
      problem: problemsLoader.getVisibleProblem(battle.problem),
      startedAt: battle.startedAt,
      createdAt: battle.createdAt,
      matchmade: battle.matchmade,
      battleType: battle.battleType,
      copilotEnabled: battle.copilotEnabled || false,
      players: battle.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        language: p.language,
        submitted: p.submitted
      }))
    };
    
    res.json({
      battle: publicBattle,
      success: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Get battle error:', error);
    res.status(500).json({
      error: 'Failed to get battle info',
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/matchmaking/join', async (req, res) => {
  try {
    const {
      playerName,
      language = 'python',
      socketId,
      ranked = true,
      timeLimit: requestedTimeLimit,
      battleType: rawBattleType,
      promptDurationMinutes: rawPromptDuration,
      promptModelId: rawPromptModelId
    } = req.body;
    const isRanked = ranked === true || ranked === 'true';
    const validTimeLimits = [600, 1800, 3600];
    const timeLimit = validTimeLimits.includes(requestedTimeLimit) ? requestedTimeLimit : 600;

    // Extract user info from token if authenticated (for leaderboard tracking)
    const authUser = await extractUserFromToken(req);
    if (!authUser?.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        success: false,
        message: 'Sign in to join matchmaking.'
      });
    }

    removeUserFromPromptBattleQueue(String(authUser.userId));

    const requestedBattleTypes = Array.isArray(req.body.battleTypes) ? req.body.battleTypes : [];
    if (rawBattleType === 'centaur' || requestedBattleTypes.includes('centaur')) {
      return res.status(404).json({ error: 'Battle mode not found.', success: false });
    }
    const battleType = rawBattleType === 'prompt' ? 'prompt' : 'coding';
    // Multi-type matchmaking: a player can accept coding + prompt at once
    // to match faster. `battleTypes` is the new array form and falls back to the
    // single `battleType` (so single-select is unchanged). Prompt stays single-type.
    const PROMPT_DURATIONS = new Set([5, 10, 15]);
    // Accepted types for multi-type matchmaking (coding + prompt). The new
    // `battleTypes` array falls back to the single `battleType`, so single-select is
    // byte-for-byte unchanged.
    const rawAccepted = Array.isArray(req.body.battleTypes) && req.body.battleTypes.length
      ? req.body.battleTypes : [battleType];
    let acceptedTypes = [...new Set(rawAccepted
      .map(t => (t === 'coding' ? 'coding' : t === 'prompt' ? 'prompt' : null))
      .filter(Boolean))];
    if (!acceptedTypes.length) acceptedTypes = [battleType === 'prompt' ? 'prompt' : 'coding'];

    let promptDurationMinutes = null;
    let promptModelId = null;
    // Prompt params are needed whenever prompt is an accepted type (even alongside
    // coding/centaur), since prompt matches on duration + model.
    if (acceptedTypes.includes('prompt')) {
      promptDurationMinutes = Math.round(Number(rawPromptDuration)) || 5;
      if (!PROMPT_DURATIONS.has(promptDurationMinutes)) promptDurationMinutes = 5;
      promptModelId = sanitizeModelId(rawPromptModelId) || getDefaultPromptBattleModelId();
      if (!promptModelId) {
        // No model configured: drop prompt; only error if it was the only choice.
        acceptedTypes = acceptedTypes.filter(t => t !== 'prompt');
        promptDurationMinutes = null;
        if (!acceptedTypes.length) {
          return res.status(503).json({
            error: 'Prompt battles unavailable',
            success: false,
            message: 'No AI model is configured for prompt battles on this server.'
          });
        }
      }
    }
    // Coding uses the player's real language; pure-prompt uses the internal marker.
    const queueLanguage = (acceptedTypes.length === 1 && acceptedTypes[0] === 'prompt') ? 'prompt-battle' : language;
    const joinAttempt = { battleType, acceptedTypes, promptDurationMinutes, promptModelId };

    // Fetch fresh username from DB (JWT token may have stale placeholder like player_xxxxx)
    let displayName = playerName?.trim() || 'Anonymous';
    const freshUser = await dbHelper.getUserById(authUser.userId);
    displayName = freshUser?.username || authUser?.username || displayName;

    // Check email verification (required for battles)
    const emailCheck = await checkEmailVerified(authUser.userId);
    if (!emailCheck.verified) {
      return res.status(403).json({
        error: 'Email verification required',
        success: false,
        emailVerificationRequired: true,
        message: 'Please verify your email address to join battles. Check your inbox for the verification link.'
      });
    }

    // Get the player's coding rating and legacy Pro status.
    const stats = await dbHelper.getUserStats(authUser.userId);
    const playerRating = stats?.rating || 1000;
    const playerRank = elo.getRankDivision(playerRating);

    const codingRating = acceptedTypes.includes('coding')
      ? playerRating
      : null;
    joinAttempt.acceptedTypes = acceptedTypes;
    joinAttempt.codingRating = codingRating;
    const playerIsPro = CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled
      ? await dbHelper.isUserPro(authUser.userId)
      : false;

    if (!validatePlayerName(displayName)) {
      return res.status(400).json({
        error: 'Player name must be between 1 and 50 characters',
        success: false
      });
    }

    if (!validateLanguage(queueLanguage)) {
      return res.status(400).json({
        error: 'Invalid programming language',
        success: false
      });
    }

    // Check if this user is already in the queue (prevent duplicate entries)
    for (const [existingPlayerId, existingPlayer] of matchmakingQueue.entries()) {
      if (existingPlayer.userId && String(existingPlayer.userId) === String(authUser.userId)) {
        logger.warn(`[SECURITY] User ${authUser.userId} already in queue as ${existingPlayerId}`);
        return res.status(400).json({
          error: 'Already in matchmaking queue',
          success: false,
          existingPlayerId
        });
      }
    }

    const playerId = uuidv4();

    logger.info('\n ===== NEW MATCHMAKING REQUEST =====');
    logger.info(` Player: ${displayName} [${playerRank.display} ${playerRating}]`);
    logger.debug(`  Language: ${queueLanguage} battleType=${battleType}`);
    logger.debug(` Socket ID: ${socketId}`);
    logger.debug(` Queue size BEFORE: ${matchmakingQueue.size}`);
    logger.debug(' Players in queue:', Array.from(matchmakingQueue.entries()).map(([id, p]) => ({
      id: id.substring(0, 8),
      name: p.playerName,
      lang: p.language,
      rating: p.rating || 1000,
      socketId: p.socketId?.substring(0, 8)
    })));

    // CRITICAL: Check for existing match (with skill-based matching)
    // Pass userId to prevent same user matching themselves (two browser tabs)
    const match = findMatch(playerId, queueLanguage, playerRating, authUser?.userId, isRanked, joinAttempt);
    
    if (match) {
      logger.info('\n ===== INSTANT MATCH FOUND! =====');
      logger.info(` Matched: ${playerName} ⚔️  ${match.playerName}`);
      logger.debug(`  Languages: ${language} vs ${match.language}`);
      logger.debug(` Player 1 socket: ${match.socketId}`);
      logger.debug(`️  Player 1 wait time: ${Math.floor((Date.now() - match.queuedAt) / 1000)}s`);

      // Safely claim matched player (double-check lock prevents race conditions)
      if (matchingInProgress.has(match.playerId) || !matchmakingQueue.has(match.playerId)) {
        logger.warn(' Matched player already claimed by another request - adding to queue');
        // Fall through to add to queue
      } else {
        // First lock: mark as matching in progress
        matchingInProgress.add(match.playerId);

        // Double-check: verify still in queue after acquiring lock
        if (!matchmakingQueue.has(match.playerId)) {
          logger.warn(' Matched player was claimed between check and lock - releasing');
          matchingInProgress.delete(match.playerId);
          // Fall through to add to queue
        } else {
          matchmakingQueue.delete(match.playerId);
          logger.info(` Removed ${match.playerName} from queue`);

          const isPromptMatch = (match.resolvedBattleType || match.battleType || 'coding') === 'prompt';

          if (isPromptMatch) {
            const promptResult = await startPromptQuickMatchFromQueue(
              match,
              displayName,
              playerId,
              authUser.userId,
              socketId,
              io
            );
            if (!promptResult) {
              logger.error('❌ Failed to start prompt quick match');
              matchingInProgress.delete(match.playerId);
              matchmakingQueue.set(match.playerId, match);
              logger.info(` Re-added ${match.playerName} to queue after prompt battle start failure`);
              return res.status(500).json({
                error: 'Failed to start prompt battle',
                success: false
              });
            }

            matchingInProgress.delete(match.playerId);
            const { roomCode, waitTime, player1Name, player2Name } = promptResult;

            setTimeout(() => {
              try {
                logger.debug(`\n Attempting to notify Player 1 (${player1Name}) prompt match...`);
                const matchedSocket = io.sockets.sockets.get(match.socketId);
                if (!matchedSocket?.connected) {
                  logger.error(`❌ Socket ${match.socketId} missing or disconnected for prompt match`);
                  return;
                }
                clearSocketInterval(matchedSocket, 'matchCheckInterval');
                safeEmit(matchedSocket, 'match-found', {
                  battleType: 'prompt',
                  roomCode,
                  opponent: player2Name,
                  yourName: player1Name
                });
                logger.info(' match-found (prompt) emitted to Player 1');
              } catch (socketError) {
                logger.error('❌ Error notifying Player 1 (prompt):', socketError);
              }
            }, 100);

            logger.debug(' Sending immediate prompt match response to Player 2');
            return res.json({
              success: true,
              matched: true,
              battleType: 'prompt',
              roomCode,
              playerId,
              opponent: player1Name,
              yourName: player2Name,
              waitTime,
              message: 'Match found! Opening prompt battle...'
            });
          }

          // Determine ranked status: both players must want ranked for it to be ranked
          const matchIsRanked = isRanked && (match.ranked !== false);
          // Use the longer of the two players' time limit preferences
          const matchTimeLimit = Math.max(timeLimit, match.timeLimit || 600);
          const battleResult = await createMatchedBattle(match, displayName, playerId, language, authUser.userId, playerRating, matchIsRanked, matchTimeLimit);

          if (!battleResult) {
            logger.error('❌ Failed to create battle!');
            matchingInProgress.delete(match.playerId);
            // Re-add matched player to queue on failure
            matchmakingQueue.set(match.playerId, match);
            logger.info(` Re-added ${match.playerName} to queue after battle creation failure`);
            return res.status(500).json({
              error: 'Failed to create matched battle',
              success: false
            });
          }

        // Successfully matched - release from matchingInProgress
        matchingInProgress.delete(match.playerId);

        const { battleId, battle, waitTime, sameLanguage, matchedLanguage } = battleResult;
        // Use authoritative names from battle object (fetched from database)
        const player1Name = battle.players[0].name;
        const player2Name = battle.players[1].name;
        logger.info(`  Battle ID: ${battleId}`);

        // CRITICAL: Notify Player 1 (in practice mode)
        setTimeout(() => {
          try {
            logger.debug(`\n Attempting to notify Player 1 (${player1Name})...`);
            const matchedSocket = io.sockets.sockets.get(match.socketId);

            if (!matchedSocket) {
              logger.error(`❌ Socket ${match.socketId} NOT FOUND in io.sockets.sockets`);
              logger.debug(' Available sockets:', Array.from(io.sockets.sockets.keys()).map(id => id.substring(0, 8)));
              return;
            }

            if (!matchedSocket.connected) {
              logger.error(`❌ Socket ${match.socketId} exists but NOT CONNECTED`);
              return;
            }

            logger.info(` Socket found and connected: ${match.socketId}`);

            // Clear their match interval using helper
            clearSocketInterval(matchedSocket, 'matchCheckInterval');
            logger.debug(' Cleared match check interval');

            const matchData = {
              battleType: 'coding',
              battleId,
              playerId: match.playerId,
              opponent: player2Name,
              opponentRating: playerRating,
              yourName: player1Name,
              sameLanguage,
              skipLanguageSelection: sameLanguage,
              language: match.language,
              matchedLanguage: matchedLanguage
            };

            logger.debug(' Emitting match-found to Player 1:', matchData);
            safeEmit(matchedSocket, 'match-found', matchData);
            logger.info(' match-found event emitted to Player 1');

          } catch (socketError) {
            logger.error('❌ Error notifying Player 1:', socketError);
          }
        }, 100);

        // Send response to Player 2
        logger.debug(' Sending immediate match response to Player 2');
        return res.json({
          success: true,
          matched: true,
          battleType: 'coding',
          battleId,
          playerId,
          opponent: player1Name,
          opponentRating: match.rating,
          yourName: player2Name,
          waitTime,
          sameLanguage,
          skipLanguageSelection: sameLanguage,
          language: language,
          matchedLanguage: matchedLanguage,
          message: 'Match found! Redirecting to battle...'
        });
        }
      }
    }

    // No match found (or match was claimed by another request) - add to queue
    logger.debug('\n No match found, adding to queue');

    // Check queue size limit to prevent unbounded growth
    if (matchmakingQueue.size >= MAX_QUEUE_SIZE) {
      logger.warn(`️ Queue full (${matchmakingQueue.size}/${MAX_QUEUE_SIZE})`);
      return res.status(503).json({
        error: 'Server busy',
        success: false,
        queueFull: true,
        message: 'Matchmaking queue is full. Please try again in a moment.'
      });
    }

    const queueEntry = {
      playerName: displayName,
      userId: authUser.userId,
      language,
      rating: playerRating,
      rank: playerRank,
      socketId: socketId || null,
      queuedAt: Date.now(),
      skipAndStayInQueue: true,
      lastActivity: Date.now(),
      isPro: playerIsPro,
      ranked: isRanked,    // Whether this is a ranked match (affects ELO)
      timeLimit: timeLimit,  // Time limit preference
      battleType,
      acceptedTypes,
      codingRating,
      promptDurationMinutes,
      promptModelId
    };

    matchmakingQueue.set(playerId, queueEntry);
    updateAnalytics('matchmaking-joined');

    const proLabel = playerIsPro ? ' [PRO PRIORITY]' : '';
    const queuePosition = matchmakingQueue.size;
    const totalInQueue = matchmakingQueue.size;
    const searchRange = elo.getMatchmakingRange(0);

    logger.debug(` Added to queue: Position ${queuePosition}, Total ${totalInQueue}`);
    logger.info(` Searching for opponents within ±${searchRange} rating`);
    logger.info(' ===== QUEUE JOIN COMPLETE =====\n');

    updateQueuePositions();

    res.json({
      success: true,
      matched: false,
      playerId,
      yourName: displayName,
      queuePosition: queuePosition,
      totalInQueue: totalInQueue,
      message: 'Added to matchmaking queue. Searching for opponent...'
    });

  } catch (error) {
    logger.error('❌ Matchmaking join error:', error);
    res.status(500).json({
      error: 'Failed to join matchmaking',
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/matchmaking/leave', async (req, res) => {
  try {
    const { playerId } = req.body;
    
    if (!playerId) {
      return res.status(400).json({
        error: 'Player ID is required',
        success: false
      });
    }
    
    if (matchmakingQueue.has(playerId)) {
      matchmakingQueue.delete(playerId);
      updateQueuePositions();
      res.json({
        success: true,
        message: 'Left matchmaking queue'
      });
    } else {
      res.status(404).json({
        error: 'Player not in queue',
        success: false
      });
    }
    
  } catch (error) {
    logger.error('Leave matchmaking error:', error);
    res.status(500).json({
      error: 'Failed to leave matchmaking',
      success: false
    });
  }
});

app.get('/api/matchmaking/status/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    
    if (!playerId) {
      return res.status(400).json({
        error: 'Player ID is required',
        success: false
      });
    }
    
    if (matchmakingQueue.has(playerId)) {
      const queuePosition = Array.from(matchmakingQueue.keys()).indexOf(playerId) + 1;
      res.json({
        success: true,
        inQueue: true,
        queuePosition,
        totalInQueue: matchmakingQueue.size,
        waitTime: Date.now() - matchmakingQueue.get(playerId).queuedAt
      });
    } else {
      res.json({
        success: true,
        inQueue: false
      });
    }
    
  } catch (error) {
    logger.error('Queue status error:', error);
    res.status(500).json({
      error: 'Failed to get queue status',
      success: false
    });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { 
      battleId, 
      playerId, 
      playerName, 
      rating, 
      suggestion = '', 
      email = '', 
      winner, 
      problemId,
      timestamp,
      standalone = false
    } = req.body;
    
    const validation = validateFeedback({ rating, suggestion, email, playerName });
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error,
        success: false
      });
    }
    
    const feedbackEntry = {
      id: uuidv4(),
      battleId: battleId || null,
      playerId: playerId || null,
      playerName: playerName.trim(),
      rating: Number(rating),
      suggestion: suggestion.trim(),
      email: email.trim(),
      winner: winner || null,
      problemId: problemId || null,
      standalone: Boolean(standalone),
      submittedAt: timestamp || new Date().toISOString(),
      ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown'
    };
    
    await storeFeedback(feedbackEntry);

    mixpanelAnalytics.trackSendFeedback(playerId, {
      playerName: playerName.trim(),
      battleId: battleId || null,
      rating: Number(rating),
      suggestion: suggestion.trim(),
      email: email.trim()
    });
    
    res.json({
      success: true,
      message: 'Thank you for your feedback!',
      feedbackId: feedbackEntry.id,
      timestamp: feedbackEntry.submittedAt,
      rating: feedbackEntry.rating
    });
    
  } catch (error) {
    logger.error('Submit feedback error:', error);
    res.status(500).json({
      error: 'Failed to submit feedback',
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/analytics', (req, res) => {
  try {
    const completionRate = analytics.battlesStarted > 0 
      ? ((analytics.battlesCompleted / analytics.battlesStarted) * 100).toFixed(2)
      : 0;
      
    const abandonmentRate = analytics.battlesStarted > 0
      ? ((analytics.battlesAbandoned / analytics.battlesStarted) * 100).toFixed(2)
      : 0;
      
    const forfeitRate = analytics.battlesStarted > 0
      ? ((analytics.battlesForfeited / analytics.battlesStarted) * 100).toFixed(2)
      : 0;

    res.json({
      summary: {
        battlesCreated: analytics.battlesCreated,
        battlesJoined: analytics.battlesJoined,
        battlesStarted: analytics.battlesStarted,
        battlesCompleted: analytics.battlesCompleted,
        battlesAbandoned: analytics.battlesAbandoned,
        battlesForfeited: analytics.battlesForfeited,
        completionRate: `${completionRate}%`,
        abandonmentRate: `${abandonmentRate}%`,
        forfeitRate: `${forfeitRate}%`,
        averageBattleDuration: `${analytics.averageBattleDuration.toFixed(1)}s`,
        totalProblems: problemsLoader.count()
      },
      problemStats: analytics.problemStats,
      languageStats: analytics.languageStats,
      matchmakingStats: {
        ...analytics.matchmakingStats,
        averageWaitTime: `${analytics.matchmakingStats.averageWaitTime.toFixed(1)}ms`,
        sameLanguageRate: analytics.matchmakingStats.matchesFound > 0 ?
          `${(analytics.matchmakingStats.sameLanguageMatches / analytics.matchmakingStats.matchesFound * 100).toFixed(1)}%` : '0%'
      },
      rematchStats: analytics.rematchStats,
      performanceStats: {
        ...analytics.performanceStats,
        averageSolveTime: `${analytics.performanceStats.averageSolveTime.toFixed(1)}s`,
        fastestSolveTime: analytics.performanceStats.fastestSolveTime === Infinity ? 'N/A' : `${analytics.performanceStats.fastestSolveTime}s`,
        slowestSolveTime: analytics.performanceStats.slowestSolveTime === 0 ? 'N/A' : `${analytics.performanceStats.slowestSolveTime}s`
      },
      currentQueue: {
        playersInQueue: matchmakingQueue.size
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Analytics error:', error);
    res.status(500).json({
      error: 'Failed to get analytics',
      success: false
    });
  }
});

async function requireUserAdmin(req, res, next) {
  try {
    if (!await dbHelper.isUserAdmin(req.user.sub)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

app.get('/feedback', authRouter.authMiddleware, requireUserAdmin, async (req, res) => {
  try {
    const feedbackData = await dbHelper.getAllUserFeedback();
    const count = await dbHelper.getUserFeedbackCount();
    res.json({
      feedback: feedbackData,
      count: count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Feedback retrieval error:', error);
    res.status(500).json({
      error: 'Failed to get feedback',
      success: false
    });
  }
});

app.delete('/feedback/:id', authRouter.authMiddleware, requireUserAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await dbHelper.deleteUserFeedback(id);
    res.json({ success: true, message: 'Feedback deleted' });
  } catch (error) {
    logger.error('Feedback delete error:', error);
    res.status(500).json({ error: 'Failed to delete feedback', success: false });
  }
});

app.post('/track', async (req, res) => {
  try {
    const { event, playerId, props = {}, timestamp } = req.body;

    // Extract user's IP for geo-location
    const userIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;

    if (!event || typeof event !== 'string') {
      return res.status(400).json({
        error: 'Event name is required',
        success: false
      });
    }

    const supportedEvents = [
      'view-home',
      'view-modes',
      'view-practice',
      'view-login-form',
      'view-register-form',
      'user-signup',
      'user-login',
      'user-logout',
      'user-identify',
      'login-error',
      'signup-error',
      'select-game-mode',
      'begin-matchmaking',
      'end-matchmaking',
      'start-battle',
      'submit-solution',
      'end-battle',
      'request-rematch',
      'respond-rematch',
      // Practice mode events
      'practice-start',
      'practice-attempt',
      'practice-complete',
      'practice-next-problem',
      // Friend events
      'friend-request-sent',
      'friend-request-accepted',
      'friend-request-declined',
      'friend-removed',
      // Subscription/Payment events
      'view-pricing',
      'select-plan',
      'checkout-started',
      'subscription-created',
      'subscription-cancelled',
      'subscription-renewed',
      'payment-failed',
      'pro-feature-gate',
      // GDPR cookie consent
      'cookie-consent',
      // Session tracking for DAU/MAU
      'session-start'
    ];

    if (!supportedEvents.includes(event)) {
      return res.status(400).json({
        error: `Unsupported event: ${event}`,
        success: false
      });
    }

    // Map frontend event names to analytics methods
    switch(event) {
      case 'view-home':
        mixpanelAnalytics.trackViewHome(playerId, props);
        break;
      case 'view-modes':
        mixpanelAnalytics.trackViewModes(playerId, props);
        break;
      case 'user-signup':
        mixpanelAnalytics.trackEvent('user_signup', playerId, {
          player_id: playerId,
          user_id: props.userId,
          username: props.username,
          signup_method: props.signupMethod || 'email'
        }, { ip: userIp });
        break;
      case 'user-login':
        mixpanelAnalytics.trackEvent('user_login', playerId, {
          player_id: playerId,
          user_id: props.userId,
          username: props.username,
          previous_anon_id: props.previousAnonId
        }, { ip: userIp });
        break;
      case 'user-identify':
        // Set user profile properties in Mixpanel
        mixpanelAnalytics.mixpanel?.people.set(playerId, {
          $name: props.username,
          $email: props.email,
          user_id: props.userId,
          avatar: props.avatar,
          created_at: props.createdAt
        });
        break;
      case 'select-game-mode':
        mixpanelAnalytics.trackSelectGameMode(playerId, {
          modeSelected: props.modeSelected
        });
        break;
      case 'begin-matchmaking':
        mixpanelAnalytics.trackBeginMatchmaking(playerId, {
          playerName: props.playerName,
          language: props.language,
          queueType: props.queueType
        });
        break;
      case 'end-matchmaking':
        mixpanelAnalytics.trackEndMatchmaking(playerId, {
          playerName: props.playerName,
          outcome: props.outcome,
          waitTimeSeconds: props.waitTimeSeconds,
          battleId: props.battleId,
          opponentName: props.opponentName
        });
        break;
      case 'start-battle':
        mixpanelAnalytics.trackStartBattle(playerId, {
          battleId: props.battleId,
          problemId: props.problemId,
          problemName: props.problemName,
          battleType: props.battleType,
          playerLanguage: props.language
        });
        break;
      case 'submit-solution':
        mixpanelAnalytics.trackSubmitSolution(playerId, {
          battleId: props.battleId,
          problemId: props.problemId,
          accepted: props.accepted,
          testcasesPassed: props.testcasesPassed,
          testcasesFailed: props.testcasesFailed
        });
        break;
      case 'end-battle':
        mixpanelAnalytics.trackEndBattle(playerId, {
          battleId: props.battleId,
          problemId: props.problemId,
          playerResult: props.playerResult,
          durationSeconds: props.durationSeconds,
          problemSolved: props.problemSolved,
          battleType: props.battleType
        });
        break;
      case 'request-rematch':
        mixpanelAnalytics.trackRequestRematch(playerId, {
          originalBattleId: props.originalBattleId,
          opponentName: props.opponentName
        });
        break;
      case 'respond-rematch':
        mixpanelAnalytics.trackRespondToRematchRequest(playerId, {
          originalBattleId: props.originalBattleId,
          response: props.response
        });
        break;
      // New page view events
      case 'view-practice':
        mixpanelAnalytics.trackEvent('view_practice', playerId, {
          referrer: props.referrer
        });
        break;
      case 'view-login-form':
        mixpanelAnalytics.trackEvent('view_login_form', playerId, {
          referrer: props.referrer
        });
        break;
      case 'view-register-form':
        mixpanelAnalytics.trackEvent('view_register_form', playerId, {
          referrer: props.referrer
        });
        break;
      // Auth funnel events
      case 'user-logout':
        mixpanelAnalytics.trackEvent('user_logout', playerId, {
          session_duration_seconds: props.sessionDurationSeconds,
          user_id: props.userId
        });
        break;
      case 'login-error':
        mixpanelAnalytics.trackEvent('login_error', playerId, {
          error_type: props.errorType,
          error_message: props.errorMessage,
          username: props.username
        });
        break;
      case 'signup-error':
        mixpanelAnalytics.trackEvent('signup_error', playerId, {
          error_type: props.errorType,
          error_message: props.errorMessage,
          username: props.username,
          has_email: props.hasEmail
        });
        break;
      // Practice mode events
      case 'practice-start':
        mixpanelAnalytics.trackEvent('practice_start', playerId, {
          problem_id: props.problemId,
          problem_name: props.problemName,
          difficulty: props.difficulty,
          category: props.category,
          language: props.language
        });
        break;
      case 'practice-attempt':
        mixpanelAnalytics.trackEvent('practice_attempt', playerId, {
          problem_id: props.problemId,
          problem_name: props.problemName,
          difficulty: props.difficulty,
          language: props.language,
          passed: props.passed,
          testcases_passed: props.testcasesPassed,
          testcases_total: props.testcasesTotal,
          time_spent_seconds: props.timeSpentSeconds
        });
        break;
      case 'practice-complete':
        mixpanelAnalytics.trackEvent('practice_complete', playerId, {
          problem_id: props.problemId,
          problem_name: props.problemName,
          difficulty: props.difficulty,
          category: props.category,
          language: props.language,
          solve_time_seconds: props.solveTimeSeconds,
          attempt_count: props.attemptCount
        });
        break;
      case 'practice-next-problem':
        mixpanelAnalytics.trackEvent('practice_next_problem', playerId, {
          previous_problem_id: props.previousProblemId,
          previous_problem_solved: props.previousProblemSolved,
          new_problem_id: props.newProblemId,
          session_problem_count: props.sessionProblemCount
        });
        break;
      // Friend events
      case 'friend-request-sent':
        mixpanelAnalytics.trackEvent('friend_request_sent', playerId, {
          target_user_id: props.targetUserId,
          target_username: props.targetUsername,
          source: props.source
        });
        break;
      case 'friend-request-accepted':
        mixpanelAnalytics.trackEvent('friend_request_accepted', playerId, {
          from_user_id: props.fromUserId,
          from_username: props.fromUsername
        });
        break;
      case 'friend-request-declined':
        mixpanelAnalytics.trackEvent('friend_request_declined', playerId, {
          from_user_id: props.fromUserId,
          from_username: props.fromUsername
        });
        break;
      case 'friend-removed':
        mixpanelAnalytics.trackEvent('friend_removed', playerId, {
          friend_user_id: props.friendUserId,
          friend_username: props.friendUsername
        });
        break;
      // Subscription/Payment events
      case 'view-pricing':
        mixpanelAnalytics.trackEvent('view_pricing', playerId, {
          referrer: props.referrer,
          source: props.source
        });
        break;
      case 'select-plan':
        mixpanelAnalytics.trackEvent('select_plan', playerId, {
          plan_type: props.planType,
          plan_price: props.planPrice,
          currency: props.currency
        });
        break;
      case 'checkout-started':
        mixpanelAnalytics.trackEvent('checkout_started', playerId, {
          plan_type: props.planType,
          plan_price: props.planPrice,
          currency: props.currency,
          checkout_session_id: props.checkoutSessionId
        });
        break;
      case 'subscription-created':
        mixpanelAnalytics.trackEvent('subscription_created', playerId, {
          plan_type: props.planType,
          plan_price: props.planPrice,
          currency: props.currency,
          subscription_id: props.subscriptionId
        });
        break;
      case 'subscription-cancelled':
        mixpanelAnalytics.trackEvent('subscription_cancelled', playerId, {
          plan_type: props.planType,
          subscription_id: props.subscriptionId,
          reason: props.reason,
          days_active: props.daysActive
        });
        break;
      case 'subscription-renewed':
        mixpanelAnalytics.trackEvent('subscription_renewed', playerId, {
          plan_type: props.planType,
          plan_price: props.planPrice,
          subscription_id: props.subscriptionId,
          renewal_count: props.renewalCount
        });
        break;
      case 'payment-failed':
        mixpanelAnalytics.trackEvent('payment_failed', playerId, {
          plan_type: props.planType,
          error_type: props.errorType,
          error_message: props.errorMessage
        });
        break;
      case 'pro-feature-gate':
        mixpanelAnalytics.trackEvent('pro_feature_gate', playerId, {
          feature: props.feature,
          gate_location: props.gateLocation
        });
        break;
      // GDPR cookie consent
      case 'cookie-consent':
        mixpanelAnalytics.trackEvent('cookie_consent', playerId || 'anonymous', {
          action: props.action,
          analytics_consent: props.analytics,
          functional_consent: props.functional
        });
        // Also save to database for GDPR audit trail
        try {
          await dbHelper.saveConsentRecord({
            userId: null, // Anonymous consent
            anonymousId: playerId,
            analyticsConsent: props.analytics,
            functionalConsent: props.functional,
            action: props.action,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
            userAgent: req.headers['user-agent'] || null
          });
        } catch (dbError) {
          logger.warn('Failed to save consent record to DB:', dbError.message);
        }
        break;
      // Session tracking for DAU/MAU
      case 'session-start':
        mixpanelAnalytics.trackEvent('session_start', playerId, {
          user_id: props.userId,
          username: props.username,
          session_type: props.sessionType,
          referrer: props.referrer,
          screen_width: props.screenWidth,
          screen_height: props.screenHeight,
          timezone: props.timezone,
          language: props.language,
          platform: props.platform
        }, { ip: userIp });
        break;
    }

    res.json({
      success: true,
      message: 'Event tracked',
      event,
      timestamp: timestamp || new Date().toISOString()
    });

  } catch (error) {
    logger.error('Track event error:', error);
    res.status(500).json({
      error: 'Failed to track event',
      success: false
    });
  }
});

// ============================================================================
// WEBSOCKET HANDLERS
// ============================================================================

io.on('connection', (socket) => {
  logger.debug('Player connected:', socket.id);

  // Several socket handlers destructure their first payload argument before
  // entering a try/catch. Normalize a missing/null payload so one malformed
  // packet cannot throw synchronously and terminate the process.
  socket.use((packet, next) => {
    try {
      if (Array.isArray(packet) && (packet.length < 2 || packet[1] === undefined || packet[1] === null)) {
        packet[1] = {};
      }
    } catch (_) { /* never let the guard itself break dispatch */ }
    next();
  });

  registerPromptBattleHandlers(socket, io);

  socket.on('error', (error) => {
    logger.error('Socket error:', error);
  });

  // Watch an invite for real-time updates (e.g., battle cancelled)
  socket.on('watch-invite', async ({ inviteCode }) => {
    try {
      if (!inviteCode || inviteCode.length < 6 || inviteCode.length > 12) {
        return;
      }

      const invite = await dbHelper.getBattleInviteByCode(inviteCode);
      if (!invite || invite.status !== 'pending') {
        return;
      }

      // Join the room to receive battle-cancelled events
      socket.join(`invite-watch:${invite.battle_id}`);
      logger.debug(`Socket ${socket.id} watching invite for battle ${invite.battle_id}`);
    } catch (error) {
      logger.error('Watch invite error:', error);
    }
  });

  socket.on('unwatch-invite', async ({ inviteCode }) => {
    try {
      if (!inviteCode) return;

      const invite = await dbHelper.getBattleInviteByCode(inviteCode);
      if (invite) {
        socket.leave(`invite-watch:${invite.battle_id}`);
      }
    } catch (error) {
      logger.error('Unwatch invite error:', error);
    }
  });

  // Let the match-found modal subscribe before the battle page performs the
  // full join, without changing battle state or admitting non-participants.
  socket.on('join-battle-room', ({ battleId, playerId } = {}) => {
    try {
      if (!validateBattleId(battleId) || !playerId) return;
      const battle = battles.get(battleId);
      if (!battle) return;
      const player = battle.players?.find(candidate => candidate.id === playerId);
      if (!verifyPlayerOwnership(socket, player)) return;
      socket.join(battleId);
    } catch (err) {
      logger.error('Error in join-battle-room:', err?.message || err);
    }
  });

  socket.on('join-battle', ({ battleId, playerId, language = 'python' }) => {
    // Rate limit check
    const rateCheck = checkRateLimit(socket.id, 'join-battle');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'join-battle',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Too many join attempts. Please wait before trying again.'
      });
      return;
    }

    try {
      if (!validateBattleId(battleId) || !playerId) {
        socket.emit('error', 'Invalid battle or player ID');
        return;
      }

      if (!validateLanguage(language)) {
        socket.emit('error', 'Invalid programming language');
        return;
      }

      const battle = battles.get(battleId);

      if (!battle) {
        socket.emit('error', 'Battle not found');
        return;
      }

      if (!battle.problem || !battle.problem.id) {
        logger.error(`CRITICAL: Battle ${battleId} missing problem!`);
        const problem = getRandomProblem();
        if (problem && problem.id) {
          battle.problem = problem;
          battles.set(battleId, battle);
          logger.info(` Assigned problem ${problem.id} to battle ${battleId}`);
        } else {
          socket.emit('error', 'Battle configuration error');
          return;
        }
      }

      const player = battle.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', 'Player not found in battle');
        return;
      }

      // Verify the authenticated socket user owns this player slot
      if (player.userId && String(player.userId) !== String(socket.userId)) {
        logger.warn(`Socket auth mismatch: socket.userId=${socket.userId}, player.userId=${player.userId}`);
        socket.emit('error', 'Authentication failed - you are not authorized to join as this player');
        return;
      }

      // CRITICAL: If player doesn't have a userId but socket is authenticated, set it now
      // This ensures battles are properly logged in the database with player userIds
      if (!player.userId && socket.userId) {
        player.userId = socket.userId;
        logger.info(`[AUTH] Set player.userId=${socket.userId} from authenticated socket for player ${playerId} in battle ${battleId}`);
      }

      player.socketId = socket.id;
      socket.join(battleId);

      playerConnections.set(socket.id, { battleId, playerId });

      const opponent = battle.players.find(p => p.id !== playerId);

      // Auto-ready players in challenge battles (both already agreed to play)
      if (battle.isChallengeBattle && !player.ready) {
        player.ready = true;
        logger.debug(`[CHALLENGE] Auto-readied player ${player.name} in battle ${battleId}`);
      }

      socket.emit('battle-joined', {
        battle: filterBattleForPlayer(battle, playerId),
        yourPlayerId: playerId,
        yourLanguage: player.language
      });

      if (opponent) {
        socket.to(battleId).emit('player-joined', {
          player: {
            id: player.id,
            name: player.name,
            ready: player.ready,
            language: player.language,
            userId: player.userId || null,
            isBot: player.isBot || false
          }
        });
      }

      // Note: battle-started is NOT re-emitted here for in-progress battles.
      // The battle-joined response already contains startedAt/timeLimit, and
      // the client starts the timer from the battle-joined handler. Sending
      // battle-started redundantly caused duplicate timer intervals on reload.

      // Note: No auto-start here. Players must click "I'm Ready" in the waiting room.
      // The player-ready handler + client-side all-players-ready handler manage the countdown.

    } catch (error) {
      logger.error('Join battle socket error:', error);
      socket.emit('error', 'Failed to join battle');
    }
  });

  socket.on('update-queue-socket', async ({ playerId, language, playerName, rating }) => {
  try {
    logger.debug('\n ===== UPDATE QUEUE SOCKET =====');
    logger.info(` Player ID: ${playerId?.substring(0, 8)}`);
    logger.debug(` New Socket ID: ${socket.id?.substring(0, 8)}`);
    logger.debug(`  Language: ${language}`);
    logger.info(` PlayerName: ${playerName}, Rating: ${rating}, socket.userId: ${socket.userId}`);

    if (!matchmakingQueue.has(playerId)) {
      // Player not in queue - re-add them if we have enough info.
      if (playerName && socket.userId) {
        logger.info(` Player ${playerId} not in queue - re-adding with socket update`);
        const newEntry = {
          playerId,
          playerName: playerName,
          socketId: socket.id,
          language: language || 'python',
          rating: rating || 1000,
          rank: elo.getRankDivision(rating || 1000),
          userId: socket.userId || null,
          queuedAt: Date.now(),
          lastActivity: Date.now(),
          skipAndStayInQueue: false,
          ranked: true, // Default to ranked when re-adding (Quick Match is ranked)
          isPro: false,
          timeLimit: 600,
          battleType: 'coding',
          promptDurationMinutes: null,
          promptModelId: null
        };
        matchmakingQueue.set(playerId, newEntry);
        logger.info(` Re-added ${playerName} to queue`);
      } else {
        logger.error(`❌ Player ${playerId} NOT IN QUEUE and missing info to re-add!`);
        socket.emit('matchmaking-timeout');
        return;
      }
    }

    const queueEntry = matchmakingQueue.get(playerId);

    // Verify the socket user owns this queue entry
    if (queueEntry.userId) {
      if (String(queueEntry.userId) !== String(socket.userId)) {
        logger.warn(`[SECURITY] Queue socket update rejected: socket.userId=${socket.userId}, entry.userId=${queueEntry.userId}`);
        socket.emit('error', 'Not authorized');
        return;
      }
    } else {
      logger.warn(`[SECURITY] Queue socket update rejected: queue entry missing userId`);
      socket.emit('error', 'Not authorized');
      return;
    }

    logger.info(` Found player in queue: ${queueEntry.playerName}`);
    logger.debug(` Old socket: ${queueEntry.socketId?.substring(0, 8)}`);

    // Clear any pending disconnect timeout since player reconnected
    const pendingTimeout = pendingDisconnectTimeouts.get(playerId);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingDisconnectTimeouts.delete(playerId);
      logger.debug(` Cleared pending disconnect timeout for ${queueEntry.playerName}`);
    }

    queueEntry.socketId = socket.id;
    queueEntry.language = language || queueEntry.language;
    queueEntry.skipAndStayInQueue = false;  
    queueEntry.lastActivity = Date.now();
    matchmakingQueue.set(playerId, queueEntry);
    
    logger.info(` Updated socket to: ${socket.id?.substring(0, 8)}`);
    
    const queuePosition = Array.from(matchmakingQueue.keys()).indexOf(playerId) + 1;
    
    socket.emit('queue-status-update', {
      queuePosition,
      totalInQueue: matchmakingQueue.size
    });
    
    logger.debug(` Queue position: ${queuePosition}/${matchmakingQueue.size}`);
    
    // IMMEDIATE match check - pass userId to prevent self-matching
    logger.debug(' Checking for immediate match...');
    const joinPrefs = {
      battleType: queueEntry.battleType,
      promptDurationMinutes: queueEntry.promptDurationMinutes,
      promptModelId: queueEntry.promptModelId
    };
    const immediateMatch = findMatch(
      playerId,
      queueEntry.language,
      queueEntry.rating,
      queueEntry.userId,
      queueEntry.ranked !== false,
      joinPrefs
    );
    
    if (immediateMatch) {
      logger.info(' IMMEDIATE MATCH during socket update!');
      logger.info(` Matched with: ${immediateMatch.playerName}`);

      // Safely claim both players (prevents race conditions)
      if (!claimPlayersForMatch(playerId, immediateMatch.playerId)) {
        logger.warn(' Could not claim players - match aborted');
        // Fall through to periodic checking
      } else {
        const isPromptMatch = (immediateMatch.battleType || 'coding') === 'prompt';

        if (isPromptMatch) {
          const promptResult = await startPromptQuickMatchFromQueue(
            immediateMatch,
            queueEntry.playerName,
            playerId,
            queueEntry.userId,
            socket.id,
            io
          );
          if (!promptResult) {
            releaseMatchClaim(playerId, immediateMatch.playerId);
            matchmakingQueue.set(playerId, queueEntry);
            matchmakingQueue.set(immediateMatch.playerId, immediateMatch);
          } else {
            completeMatch(playerId, immediateMatch.playerId);
            const { roomCode, player1Name, player2Name } = promptResult;
            safeEmit(socket, 'match-found', {
              battleType: 'prompt',
              roomCode,
              opponent: player1Name,
              yourName: player2Name
            });
            const matchSocket = io.sockets.sockets.get(immediateMatch.socketId);
            if (matchSocket) {
              safeEmit(matchSocket, 'match-found', {
                battleType: 'prompt',
                roomCode,
                opponent: player2Name,
                yourName: player1Name
              });
            }
            clearSocketInterval(socket, 'matchCheckInterval');
            if (matchSocket) clearSocketInterval(matchSocket, 'matchCheckInterval');
            logger.info(' Prompt match notifications sent (socket update)!');
            return;
          }
        } else {
        // Determine ranked status: both players must want ranked for it to be ranked
        const matchIsRanked = (queueEntry.ranked !== false) && (immediateMatch.ranked !== false);
        const battleResult = await createMatchedBattle(
          immediateMatch,
          queueEntry.playerName,
          playerId,
          queueEntry.language,
          queueEntry.userId,
          queueEntry.rating,
          matchIsRanked,
          Math.max(queueEntry.timeLimit || 600, immediateMatch.timeLimit || 600)
        );

        if (battleResult) {
          const { battleId, battle, sameLanguage, matchedLanguage } = battleResult;
          // Use authoritative names from battle object (fetched from database)
          const player1Name = battle.players[0].name;
          const player2Name = battle.players[1].name;

          // Complete the match claim
          completeMatch(playerId, immediateMatch.playerId);

          // Notify current player using safe emit
          safeEmit(socket, 'match-found', {
            battleType: 'coding',
            battleId,
            playerId,
            opponent: player1Name,
            opponentRating: immediateMatch.rating,
            yourName: player2Name,
            sameLanguage,
            skipLanguageSelection: sameLanguage,
            language: queueEntry.language,
            matchedLanguage
          });

          // Notify matched player using safe emit
          const matchSocket = io.sockets.sockets.get(immediateMatch.socketId);
          if (matchSocket) {
            safeEmit(matchSocket, 'match-found', {
              battleType: 'coding',
              battleId,
              playerId: immediateMatch.playerId,
              opponent: player2Name,
              opponentRating: queueEntry.rating,
              yourName: player1Name,
              sameLanguage,
              skipLanguageSelection: sameLanguage,
              language: immediateMatch.language,
              matchedLanguage
            });
          }

          clearSocketInterval(socket, 'matchCheckInterval');

          logger.info(' Match notifications sent!');
          return;
        } else {
          // Battle creation failed - release claim and put both players back in
          // queue (claimPlayersForMatch already removed their entries)
          releaseMatchClaim(playerId, immediateMatch.playerId);
          matchmakingQueue.set(playerId, queueEntry);
          matchmakingQueue.set(immediateMatch.playerId, immediateMatch);
          logger.warn(' Battle creation failed, re-added both players to queue');
        }
        }
      }
    }

    logger.debug(' No immediate match, starting periodic checks');

    // Start periodic checking - clear any existing first
    clearSocketInterval(socket, 'matchCheckInterval');

    socket.matchCheckInterval = setInterval(async () => {
      if (!matchmakingQueue.has(playerId)) {
        clearSocketInterval(socket, 'matchCheckInterval');
        return;
      }

      const player = matchmakingQueue.get(playerId);
      const match = findMatch(
        playerId,
        player.language,
        player.rating,
        player.userId,
        player.ranked !== false
      );

      if (match) {
        logger.info(' MATCH FOUND in periodic check!');

        // Safely claim both players (prevents race conditions)
        if (!claimPlayersForMatch(playerId, match.playerId)) {
          logger.warn(' Could not claim players - will retry next interval');
          return;
        }

        const isPromptMatch = (match.battleType || 'coding') === 'prompt';

        if (isPromptMatch) {
          const promptResult = await startPromptQuickMatchFromQueue(
            match,
            player.playerName,
            playerId,
            player.userId,
            socket.id,
            io
          );
          if (!promptResult) {
            releaseMatchClaim(playerId, match.playerId);
            matchmakingQueue.set(playerId, player);
            matchmakingQueue.set(match.playerId, match);
            logger.warn(' Prompt quick match start failed, re-added both players to queue');
          } else {
            clearSocketInterval(socket, 'matchCheckInterval');
            completeMatch(playerId, match.playerId);
            const { roomCode, player1Name, player2Name } = promptResult;
            safeEmit(socket, 'match-found', {
              battleType: 'prompt',
              roomCode,
              opponent: player1Name,
              yourName: player2Name
            });
            const matchSocket = io.sockets.sockets.get(match.socketId);
            if (matchSocket) {
              clearSocketInterval(matchSocket, 'matchCheckInterval');
              safeEmit(matchSocket, 'match-found', {
                battleType: 'prompt',
                roomCode,
                opponent: player2Name,
                yourName: player1Name
              });
            }
          }
        } else {
        const matchIsRanked = (player.ranked !== false) && (match.ranked !== false);
        const battleResult = await createMatchedBattle(match, player.playerName, playerId, player.language, player.userId, player.rating, matchIsRanked, Math.max(player.timeLimit || 600, match.timeLimit || 600));

        if (battleResult) {
          const { battleId, battle, sameLanguage, matchedLanguage } = battleResult;
          const player1Name = battle.players[0].name;
          const player2Name = battle.players[1].name;

          clearSocketInterval(socket, 'matchCheckInterval');
          completeMatch(playerId, match.playerId);

          safeEmit(socket, 'match-found', {
            battleType: 'coding',
            battleId,
            playerId,
            opponent: player1Name,
            opponentRating: match.rating,
            yourName: player2Name,
            sameLanguage,
            skipLanguageSelection: sameLanguage,
            language: player.language,
            matchedLanguage
          });

          const matchSocket = io.sockets.sockets.get(match.socketId);
          if (matchSocket) {
            safeEmit(matchSocket, 'match-found', {
              battleType: 'coding',
              battleId,
              playerId: match.playerId,
              opponent: player2Name,
              opponentRating: player.rating,
              yourName: player1Name,
              sameLanguage,
              skipLanguageSelection: sameLanguage,
              language: match.language,
              matchedLanguage
            });
          }
        } else {
          releaseMatchClaim(playerId, match.playerId);
          matchmakingQueue.set(playerId, player);
          matchmakingQueue.set(match.playerId, match);
          logger.warn(' Battle creation failed, re-added both players to queue');
        }
        }
      } else {
        const waitTime = Date.now() - player.queuedAt;
        const isPromptQueue = (player.battleType || 'coding') === 'prompt';
        logger.debug(` No human match. Wait time: ${Math.floor(waitTime / 1000)}s / ${BOT_MATCH_THRESHOLD / 1000}s threshold`);
        if (!isPromptQueue && waitTime >= BOT_MATCH_THRESHOLD) {
          logger.info(` No match found after ${Math.floor(waitTime / 1000)}s - creating bot battle for ${player.playerName}`);

          const botResult = await createBotBattle(playerId, player);

          if (botResult && !botResult.errorCode) {
            const { battleId, bot } = botResult;

            // Only clear interval and remove from queue after successful bot battle creation
            clearSocketInterval(socket, 'matchCheckInterval');
            matchmakingQueue.delete(playerId);

            socket.join(battleId);

            // Notify player they're matched with a bot
            const emitSuccess = safeEmit(socket, 'match-found', {
              battleId,
              playerId,
              opponent: bot.name,
              opponentRating: bot.rating || player.rating,
              yourName: player.playerName,
              isAgainstBot: true,
              botDifficulty: bot.difficulty,
              skipLanguageSelection: true, // Bot uses same language as player
              language: player.language
            });

            if (!emitSuccess) {
              logger.warn(` Bot match created but failed to notify player (socket disconnected)`);
            }

            logger.info(` Bot match created: ${player.playerName} vs ${bot.name} (${bot.difficulty})`);
          } else {
            // A failed capacity/quota check should not spin every two seconds and
            // repeatedly hit storage. End this queue attempt and let the user retry.
            clearSocketInterval(socket, 'matchCheckInterval');
            matchmakingQueue.delete(playerId);
            safeEmit(socket, 'bot-battle-error', {
              message: botResult?.message || 'Failed to create bot battle',
              code: botResult?.errorCode || 'creation_failed'
            });
            logger.warn(` Failed to create bot battle: ${botResult?.errorCode || 'unknown error'}`);
          }
        }
      }
    }, 2000);
    logger.info(' Periodic match checking started');
    
  } catch (error) {
    logger.error('❌ Update queue socket error:', error);
    // Clean up interval and queue entry on error
    clearSocketInterval(socket, 'matchCheckInterval');
    if (playerId) {
      matchmakingQueue.delete(playerId);
    }
    socket.emit('error', 'Failed to update queue status');
  }
});


  // Request a bot battle with user-selected difficulty
  socket.on('request-bot-battle', async ({ playerId, playerName, language, difficulty, rating }) => {
    try {
      logger.info('\n===== REQUEST BOT BATTLE =====');
      logger.info(` Player: ${playerName} (${playerId?.substring(0, 8)})`);
      logger.info(` Difficulty: ${difficulty}`);
      logger.info(` Language: ${language}`);

      const requestLimit = botBattleGuard.checkRequest(socket.userId);
      if (!requestLimit.allowed) {
        socket.emit('bot-battle-error', {
          message: requestLimit.reason === 'authentication_required'
            ? 'Authentication is required to start a bot battle.'
            : 'Too many bot battle requests. Please wait a moment and try again.',
          code: requestLimit.reason,
          retryAfter: Math.ceil((requestLimit.retryAfterMs || 0) / 1000)
        });
        return;
      }

      // Validate difficulty
      const validDifficulties = ['easy', 'medium', 'hard', 'grandmaster'];
      if (!validDifficulties.includes(difficulty)) {
        socket.emit('bot-battle-error', { message: 'Invalid bot difficulty' });
        return;
      }

      // Validate language
      if (!validateLanguage(language)) {
        socket.emit('bot-battle-error', { message: 'Invalid programming language' });
        return;
      }

      // Create the bot battle with user-selected difficulty
      const humanPlayer = {
        playerName: sanitizePlayerName(playerName),
        language,
        // Prefer the authenticated socket identity so callers cannot attribute
        // bot battles to another account with a client-supplied userId.
        userId: socket.userId,
        rating: rating || 1000,
        socketId: socket.id
      };

      const botResult = await createBotBattle(playerId, humanPlayer, difficulty);

      if (!botResult || botResult.errorCode) {
        socket.emit('bot-battle-error', {
          message: botResult?.message || 'Failed to create bot battle',
          code: botResult?.errorCode || 'creation_failed'
        });
        return;
      }

      const { battleId, battle, bot } = botResult;

      // Join the battle room
      socket.join(battleId);

      // Notify player about the bot match
      socket.emit('bot-battle-created', {
        battleId,
        playerId,
        bot: {
          id: bot.id,
          name: bot.name,
          rating: bot.rating,
          difficulty: bot.difficulty,
          difficultyDescription: bot.difficultyDescription
        },
        problem: {
          id: battle.problem.id,
          title: battle.problem.title,
          difficulty: battle.problem.difficulty
        }
      });

      logger.info(` Bot battle created: ${battleId.substring(0, 8)} vs ${bot.name} (${difficulty})`);
      updateAnalytics('bot-battle-requested');

    } catch (error) {
      logger.error('❌ Error creating bot battle:', error);
      socket.emit('bot-battle-error', { message: 'An error occurred creating the bot battle' });
    }
  });

  // Get available bot difficulties
  socket.on('get-bot-difficulties', () => {
    try {
      const difficulties = Object.entries(botService.SELECTABLE_BOT_TIERS).map(([key, tier]) => ({
        id: key,
        name: tier.displayName,
        description: tier.description,
        rating: tier.rating,
        winRate: Math.round(tier.winRate * 100)
      }));

      socket.emit('bot-difficulties', { difficulties });
    } catch (error) {
      logger.error('Error getting bot difficulties:', error);
      socket.emit('bot-difficulties', { difficulties: [] });
    }
  });

  socket.on('decline-match-stay-in-queue', async ({
    playerId,
    playerName,
    language,
    battleId,
    battleType: rawDeclineBattleType,
    promptDurationMinutes: rawDeclinePromptDur,
    promptModelId: rawDeclinePromptModel
  }) => {
  try {
    const declineBattleType = rawDeclineBattleType === 'prompt' ? 'prompt' : 'coding';
    const PROMPT_DECLINE_DURATIONS = new Set([5, 10, 15]);
    let declinePromptDuration = null;
    let declinePromptModel = null;
    let declineQueueLanguage = language || 'python';
    if (declineBattleType === 'prompt') {
      declineQueueLanguage = 'prompt-battle';
      declinePromptDuration = Math.round(Number(rawDeclinePromptDur)) || 5;
      if (!PROMPT_DECLINE_DURATIONS.has(declinePromptDuration)) declinePromptDuration = 5;
      declinePromptModel = sanitizeModelId(rawDeclinePromptModel) || getDefaultPromptBattleModelId();
    }

    logger.debug('\n  ===== DECLINE BUT STAY IN QUEUE =====');
    logger.info(` Player ID: ${playerId?.substring(0, 8)}`);
    logger.debug(` Socket ID: ${socket.id?.substring(0, 8)}`);
    logger.debug(`  Player Name: ${playerName}`);
    logger.debug(` Language: ${language}`);
    logger.info(` Battle ID: ${battleId?.substring(0, 8)}`);

    // Notify opponent that match was declined and clean up battle
    if (battleId) {
      const battle = battles.get(battleId);
      if (battle && battle.players) {
        // State check: only allow eviction in pre-coding states. Once a battle
        // is in 'coding' (or later), a stray decline-match event must not be
        // able to evict it, that would let any user grief in-progress matches.
        const PRE_CODING_STATES = new Set(['waiting', 'ready', 'matched']);
        if (!PRE_CODING_STATES.has(battle.state)) {
          logger.warn(`[SECURITY] decline-match-stay-in-queue rejected: battle ${battleId?.substring(0, 8)} in state '${battle.state}' is not evictable`);
          return;
        }

        // Ownership check: the caller must be a participant in this battle.
        // Without this, any user who knows a battleId (e.g. via tournament
        // room broadcasts) could evict another live match.
        const callerPlayer = battle.players.find(p => String(p.userId) === String(socket.userId));
        if (!verifyPlayerOwnership(socket, callerPlayer)) return;

        const opponent = battle.players.find(p => p.id !== playerId);
        if (opponent) {
          // Try to find opponent's socket from battle, then from matchmaking queue
          let opponentSocketId = opponent.socketId;
          if (!opponentSocketId) {
            // Check matchmaking queue for opponent's socket
            const queueEntry = matchmakingQueue.get(opponent.id);
            opponentSocketId = queueEntry?.socketId;
          }

          if (opponentSocketId) {
            const opponentSocket = io.sockets.sockets.get(opponentSocketId);
            if (opponentSocket && opponentSocket.connected) {
              logger.debug(` Notifying opponent ${opponent.name} of declined match`);
              opponentSocket.emit('opponent-declined-match', {
                declinerName: playerName,
                message: `${playerName || 'Your opponent'} chose to skip this match.`
              });
            }
          }
        }
        // Clear bot timeout to prevent memory leaks
        if (battle.botSubmitTimeout) {
          clearTimeout(battle.botSubmitTimeout);
          battle.botSubmitTimeout = null;
          logger.debug(`Cleared bot timeout - pending battle ${battleId?.substring(0, 8)} declined`);
        }
        // Delete the pending battle
        battles.delete(battleId);
        logger.debug(`  Deleted pending battle ${battleId?.substring(0, 8)}`);
      }
    }

    // Get player's rating if authenticated
    let playerRating = 1000;
    let playerRank = elo.getRankDivision(1000);
    if (socket.userId) {
      const stats = await dbHelper.getUserStats(socket.userId);
      playerRating = stats?.rating || 1000;
      playerRank = elo.getRankDivision(playerRating);
    }

    // Check if player is already in queue
    let playerInQueue = matchmakingQueue.has(playerId);
    logger.debug(` Player in queue: ${playerInQueue}`);

    if (!playerInQueue) {
      // Player was removed when match was created - RE-ADD them
      logger.debug(' Re-adding player to queue...');

      // Recurring consumer subscriptions are retired, so queue retries do not
      // retain a legacy paid matchmaking advantage.
      const isPro = CODEARENA_PRODUCT_MODE.consumer.paidSubscriptionsEnabled && socket.userId
        ? await dbHelper.isUserPro(socket.userId)
        : false;

      const queueEntry = {
        playerName: playerName || 'Anonymous',
        userId: socket.userId || null,
        language: declineQueueLanguage,
        rating: playerRating,
        rank: playerRank,
        socketId: socket.id,
        queuedAt: Date.now(),
        skipAndStayInQueue: true,
        lastActivity: Date.now(),
        isPro: isPro,
        ranked: true,
        timeLimit: 600,
        battleType: declineBattleType,
        promptDurationMinutes: declineBattleType === 'prompt' ? declinePromptDuration : null,
        promptModelId: declineBattleType === 'prompt' ? declinePromptModel : null
      };

      matchmakingQueue.set(playerId, queueEntry);
      const proLabel = isPro ? ' [PRO]' : '';
      logger.info(` Player re-added to queue [${playerRank.display} ${playerRating}]${proLabel}`);

      updateAnalytics('matchmaking-joined');
    } else {
      // Player is still in queue - just update their socket
      logger.info(' Player already in queue, updating socket...');
      const player = matchmakingQueue.get(playerId);
      player.socketId = socket.id;
      player.playerName = playerName || player.playerName;
      if (rawDeclineBattleType === 'prompt' || rawDeclineBattleType === 'coding') {
        player.language = declineQueueLanguage;
        player.battleType = declineBattleType;
        player.promptDurationMinutes = declineBattleType === 'prompt' ? declinePromptDuration : null;
        player.promptModelId = declineBattleType === 'prompt' ? declinePromptModel : null;
      } else {
        player.language = language || player.language;
      }
      player.skipAndStayInQueue = true;
      player.lastActivity = Date.now();
      // Preserve userId if it exists, or use socket.userId
      if (!player.userId && socket.userId) {
        player.userId = socket.userId;
      }
      matchmakingQueue.set(playerId, player);
    }
    
    // Update queue positions
    updateQueuePositions();
    
    // Send confirmation to the player
    const queuePosition = Array.from(matchmakingQueue.keys()).indexOf(playerId) + 1;
    socket.emit('queue-status-update', {
      queuePosition,
      totalInQueue: matchmakingQueue.size,
      message: 'Declined match, searching for another opponent...'
    });
    
    logger.debug(` Queue position: ${queuePosition}/${matchmakingQueue.size}`);
    
    // Try to find an immediate match - pass userId to prevent self-matching
    logger.debug(' Checking for immediate match...');
    const player = matchmakingQueue.get(playerId);
    const immediateMatch = findMatch(
      playerId,
      player.language,
      player.rating,
      player.userId,
      player.ranked !== false
    );
    
    if (immediateMatch) {
      logger.info(' IMMEDIATE MATCH after declining!');
      logger.info(` Matched with: ${immediateMatch.playerName}`);

      if (!claimPlayersForMatch(playerId, immediateMatch.playerId)) {
        logger.warn(' Could not claim players - match aborted');
      } else {
        const isPromptMatch = (immediateMatch.battleType || 'coding') === 'prompt';

        if (isPromptMatch) {
          const promptResult = await startPromptQuickMatchFromQueue(
            immediateMatch,
            player.playerName,
            playerId,
            player.userId,
            socket.id,
            io
          );
          if (!promptResult) {
            releaseMatchClaim(playerId, immediateMatch.playerId);
            matchmakingQueue.set(playerId, player);
            matchmakingQueue.set(immediateMatch.playerId, immediateMatch);
          } else {
            completeMatch(playerId, immediateMatch.playerId);
            const { roomCode, player1Name, player2Name } = promptResult;
            safeEmit(socket, 'match-found', {
              battleType: 'prompt',
              roomCode,
              opponent: player1Name,
              yourName: player2Name
            });
            const matchSocket = io.sockets.sockets.get(immediateMatch.socketId);
            if (matchSocket) {
              safeEmit(matchSocket, 'match-found', {
                battleType: 'prompt',
                roomCode,
                opponent: player2Name,
                yourName: player1Name
              });
              clearSocketInterval(matchSocket, 'matchCheckInterval');
            }
            clearSocketInterval(socket, 'matchCheckInterval');
            logger.info(' Prompt match notifications sent (after decline)!');
            return;
          }
        } else {
        const matchIsRanked = (player.ranked !== false) && (immediateMatch.ranked !== false);
        const battleResult = await createMatchedBattle(
          immediateMatch,
          player.playerName,
          playerId,
          player.language,
          player.userId,
          player.rating,
          matchIsRanked,
          Math.max(player.timeLimit || 600, immediateMatch.timeLimit || 600)
        );

        if (battleResult) {
          const { battleId, battle, sameLanguage, matchedLanguage } = battleResult;
          const player1Name = battle.players[0].name;
          const player2Name = battle.players[1].name;

          completeMatch(playerId, immediateMatch.playerId);

          safeEmit(socket, 'match-found', {
            battleType: 'coding',
            battleId,
            playerId,
            opponent: player1Name,
            opponentRating: immediateMatch.rating,
            yourName: player2Name,
            sameLanguage,
            skipLanguageSelection: sameLanguage,
            language: player.language,
            matchedLanguage
          });

          const matchSocket = io.sockets.sockets.get(immediateMatch.socketId);
          if (matchSocket) {
            safeEmit(matchSocket, 'match-found', {
              battleType: 'coding',
              battleId,
              playerId: immediateMatch.playerId,
              opponent: player2Name,
              opponentRating: player.rating,
              yourName: player1Name,
              sameLanguage,
              skipLanguageSelection: sameLanguage,
              language: immediateMatch.language,
              matchedLanguage
            });

            clearSocketInterval(matchSocket, 'matchCheckInterval');
          }

          clearSocketInterval(socket, 'matchCheckInterval');
          logger.info(' Match notifications sent!');
          return;
        } else {
          // Battle creation failed - put both players back in queue
          releaseMatchClaim(playerId, immediateMatch.playerId);
          matchmakingQueue.set(playerId, player);
          matchmakingQueue.set(immediateMatch.playerId, immediateMatch);
          logger.warn(' Battle creation failed, re-added both players to queue');
        }
        }
      }
    }

    logger.debug(' No immediate match');
    
    // Start/restart periodic checking for this socket
    clearSocketInterval(socket, 'matchCheckInterval');

    socket.matchCheckInterval = setInterval(async () => {
      if (!matchmakingQueue.has(playerId)) {
        clearSocketInterval(socket, 'matchCheckInterval');
        return;
      }

      const currentPlayer = matchmakingQueue.get(playerId);
      const match = findMatch(
        playerId,
        currentPlayer.language,
        currentPlayer.rating,
        currentPlayer.userId,
        currentPlayer.ranked !== false
      );

      if (match) {
        logger.info(' MATCH FOUND in periodic check!');

        if (!claimPlayersForMatch(playerId, match.playerId)) {
          logger.warn(' Could not claim players - will retry next interval');
          return;
        }

        const isPromptMatch = (match.battleType || 'coding') === 'prompt';

        if (isPromptMatch) {
          const promptResult = await startPromptQuickMatchFromQueue(
            match,
            currentPlayer.playerName,
            playerId,
            currentPlayer.userId,
            socket.id,
            io
          );
          if (!promptResult) {
            releaseMatchClaim(playerId, match.playerId);
            matchmakingQueue.set(playerId, currentPlayer);
            matchmakingQueue.set(match.playerId, match);
          } else {
            clearSocketInterval(socket, 'matchCheckInterval');
            completeMatch(playerId, match.playerId);
            const { roomCode, player1Name, player2Name } = promptResult;
            safeEmit(socket, 'match-found', {
              battleType: 'prompt',
              roomCode,
              opponent: player1Name,
              yourName: player2Name
            });
            const matchSocket = io.sockets.sockets.get(match.socketId);
            if (matchSocket) {
              clearSocketInterval(matchSocket, 'matchCheckInterval');
              safeEmit(matchSocket, 'match-found', {
                battleType: 'prompt',
                roomCode,
                opponent: player2Name,
                yourName: player1Name
              });
            }
          }
        } else {
        const matchIsRanked = (currentPlayer.ranked !== false) && (match.ranked !== false);
        const battleResult = await createMatchedBattle(
          match,
          currentPlayer.playerName,
          playerId,
          currentPlayer.language,
          currentPlayer.userId,
          currentPlayer.rating,
          matchIsRanked,
          Math.max(currentPlayer.timeLimit || 600, match.timeLimit || 600)
        );

        if (battleResult) {
          clearSocketInterval(socket, 'matchCheckInterval');
          const { battleId, battle, sameLanguage, matchedLanguage } = battleResult;
          const player1Name = battle.players[0].name;
          const player2Name = battle.players[1].name;

          completeMatch(playerId, match.playerId);

          safeEmit(socket, 'match-found', {
            battleType: 'coding',
            battleId,
            playerId,
            opponent: player1Name,
            opponentRating: match.rating,
            yourName: player2Name,
            sameLanguage,
            skipLanguageSelection: sameLanguage,
            language: currentPlayer.language,
            matchedLanguage
          });

          const matchSocket = io.sockets.sockets.get(match.socketId);
          if (matchSocket) {
            safeEmit(matchSocket, 'match-found', {
              battleType: 'coding',
              battleId,
              playerId: match.playerId,
              opponent: player2Name,
              opponentRating: currentPlayer.rating,
              yourName: player1Name,
              sameLanguage,
              skipLanguageSelection: sameLanguage,
              language: match.language,
              matchedLanguage
            });

            clearSocketInterval(matchSocket, 'matchCheckInterval');
          }
        } else {
          releaseMatchClaim(playerId, match.playerId);
          matchmakingQueue.set(playerId, currentPlayer);
          matchmakingQueue.set(match.playerId, match);
        }
        }
      }
    }, 2000);
    
    logger.info(' Periodic match checking started');
    logger.info(' ===== DECLINE HANDLED =====\n');
    
  } catch (error) {
    logger.error('❌ Error handling decline-match-stay-in-queue:', error);
    // Clean up interval and queue entry on error
    clearSocketInterval(socket, 'matchCheckInterval');
    if (playerId) {
      matchmakingQueue.delete(playerId);
    }
    socket.emit('error', 'Failed to process decline request');
  }
});

// ALSO UPDATE the 'disconnect' handler to NOT remove from queue immediately
// Your current disconnect handler already has a 5-second grace period, which is good!
// But make sure it's implemented correctly - the code in your server.js looks correct.
  

  socket.on('exit-battle', async ({ battleId, playerId, reason = 'player_exit' }) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) return;

      const leavingPlayer = battle.players.find(p => p.id === playerId);
      const remainingPlayer = battle.players.find(p => p.id !== playerId);

      // Verify the socket user owns this player slot
      if (!verifyPlayerOwnership(socket, leavingPlayer)) return;
      
      if (battle.state === 'waiting' || battle.state === 'ready') {
        if (remainingPlayer && remainingPlayer.socketId) {
          const remainingSocket = io.sockets.sockets.get(remainingPlayer.socketId);
          if (remainingSocket) {
            remainingSocket.emit('opponent-left', {
              message: `${leavingPlayer.name} has left the battle`,
              reason,
              returnToMatchmaking: battle.matchmade || false
            });
          }
        }

        // Expire any pending invites for this battle
        dbHelper.expireBattleInvitesByBattleId(battleId).catch(err => {
          logger.error('Failed to expire battle invites:', err);
        });

        // Notify anyone watching the invite page that the battle was cancelled
        io.to(`invite-watch:${battleId}`).emit('battle-cancelled', {
          battleId,
          reason: 'creator_left'
        });

        // Clear bot timeout to prevent memory leaks
        if (battle.botSubmitTimeout) {
          clearTimeout(battle.botSubmitTimeout);
          battle.botSubmitTimeout = null;
          logger.debug(`Cleared bot timeout - battle ${battleId} abandoned during exit`);
        }

        battles.delete(battleId);
        updateAnalytics('battle-abandoned');
      } else if (battle.state === 'coding') {
        // Leaving a live battle is a forfeit: end it and award the opponent the win, instead
        // of leaving them to wait out the full timer (where the abandoner could even win on
        // partial credit at timeout).
        await handleBattleForfeit(battleId, playerId);
      }

    } catch (error) {
      logger.error('Exit battle error:', error);
    }
  });
  
  socket.on('language-update', ({ battleId, playerId, language }) => {
    try {
      if (!validateLanguage(language)) {
        socket.emit('error', 'Invalid programming language');
        return;
      }

      const battle = battles.get(battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot
      if (!verifyPlayerOwnership(socket, player)) return;

      if (battle.state !== 'waiting' && battle.state !== 'ready' && battle.state !== 'coding') return;

      player.language = language;
      
      socket.to(battleId).emit('player-language-update', {
        playerId,
        language
      });
      
    } catch (error) {
      logger.error('Language update error:', error);
    }
  });
  
  socket.on('player-ready', ({ battleId, playerId, language }) => {
    try {
      if (!validateLanguage(language)) {
        socket.emit('error', 'Invalid programming language');
        return;
      }

      const battle = battles.get(battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot
      if (!verifyPlayerOwnership(socket, player)) return;

      if (battle.isAgainstBot && !battle.countdownStarted && !authorizeBotBattleStart(socket, battle)) {
        return;
      }

      player.ready = true;
      player.language = language;

      // For bot battles, also update the bot's language to match the human
      if (battle.isAgainstBot) {
        const bot = battle.players.find(p => p.isBot);
        if (bot) {
          bot.language = language;
        }
      }

      updateAnalytics('language-selected', { language });
      mixpanelAnalytics.trackSelectLanguage(playerId, { battleId, playerName: player.name, language });

      io.to(battleId).emit('player-ready-update', {
        battleId,
        playerId,
        ready: true,
        language
      });

      const allReady = battle.players.length === 2 && battle.players.every(p => p.ready && (p.socketId || p.isBot));

      if (allReady) {
        battle.state = 'ready';

        io.to(battleId).emit('all-players-ready', {
          sameLanguage: battle.players[0].language === battle.players[1].language,
          canStart: true,
          isAgainstBot: battle.isAgainstBot || false
        });

        // Auto-start countdown for bot battles (bot can't click Start)
        if (battle.isAgainstBot && !battle.countdownStarted) {
          battle.countdownStarted = true;

          const COUNTDOWN_DURATION = 3000;
          const serverTime = Date.now();
          const battleStartTime = serverTime + COUNTDOWN_DURATION;

          io.to(battleId).emit('countdown-sync', {
            serverTime,
            battleStartTime,
            countdownSeconds: 3
          });

          setTimeout(() => {
            const currentBattle = battles.get(battleId);
            if (!currentBattle || currentBattle.state !== 'ready') return;

            if (!currentBattle.problem || !currentBattle.problem.id) {
              const problem = getRandomProblem();
              if (!problem || !problem.id) {
                io.to(battleId).emit('error', 'Failed to start battle');
                return;
              }
              currentBattle.problem = problem;
            }

            currentBattle.state = 'coding';
            currentBattle.startedAt = Date.now();
            currentBattle.serverStartTime = Date.now();

            io.to(battleId).emit('battle-started', {
              startedAt: currentBattle.startedAt,
              timeLimit: currentBattle.timeLimit,
              isAgainstBot: true
            });

            scheduleBotSubmission(currentBattle);
            logger.info(`Bot battle ${battleId} auto-started after countdown`);
          }, COUNTDOWN_DURATION);
        }
      }

    } catch (error) {
      logger.error('Player ready error:', error);
    }
  });

  // Synchronized countdown - broadcasts to BOTH players so they see the same countdown
  socket.on('request-countdown', ({ battleId, playerId }) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) {
        socket.emit('error', 'Battle not found');
        return;
      }

      // Prevent multiple countdown requests
      if (battle.countdownStarted) {
        logger.debug('Countdown already started for battle:', battleId);
        return;
      }

      const player = battle.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('error', 'Player not found in battle');
        return;
      }

      // Verify the socket user owns this player slot. Without this, a third
      // party knowing battleId+playerId can trigger the countdown for someone
      // else's match.
      if (!verifyPlayerOwnership(socket, player)) return;

      if (battle.state !== 'ready') {
        socket.emit('error', 'Battle is not ready to start');
        return;
      }

      const allReady = battle.players.length === 2 && battle.players.every(p => p.ready && (p.socketId || p.isBot));
      if (!allReady) {
        socket.emit('error', 'Not all players are ready');
        return;
      }

      if (battle.isAgainstBot && !authorizeBotBattleStart(socket, battle)) {
        return;
      }

      // Mark countdown as started to prevent duplicates
      battle.countdownStarted = true;

      const COUNTDOWN_DURATION = 3000; // 3 seconds
      const serverTime = Date.now();
      const battleStartTime = serverTime + COUNTDOWN_DURATION;

      logger.debug(` Countdown started for battle ${battleId} - both players will see synchronized 3-2-1`);

      // Broadcast countdown to BOTH players with the exact start time
      io.to(battleId).emit('countdown-sync', {
        serverTime,
        battleStartTime,
        countdownSeconds: 3
      });

      // Server will start the battle after countdown
      setTimeout(() => {
        const currentBattle = battles.get(battleId);
        if (!currentBattle || currentBattle.state !== 'ready') {
          logger.debug('Battle no longer in ready state, skipping auto-start');
          return;
        }

        // Actually start the battle (same logic as start-battle)
        if (!currentBattle.problem || !currentBattle.problem.id) {
          const problem = getRandomProblem();
          if (!problem || !problem.id) {
            io.to(battleId).emit('error', 'Failed to start battle');
            return;
          }
          currentBattle.problem = problem;
        }

        currentBattle.state = 'coding';
        currentBattle.startedAt = Date.now();
        currentBattle.serverStartTime = Date.now();

        updateAnalytics('battle-started', { problemId: currentBattle.problem.id });

        currentBattle.players.forEach(p => {
          const opponent = currentBattle.players.find(other => other.id !== p.id);
          try {
            mixpanelAnalytics.trackStartBattle(p.id, {
              battleId: currentBattle.id,
              playerName: p.name,
              problemId: currentBattle.problem.id,
              problemName: currentBattle.problem.title,
              problemDifficulty: currentBattle.problem.difficulty,
              battleType: currentBattle.matchmade ? 'QUICK_MATCH' : 'PRIVATE',
              opponentId: opponent?.id || 'N/A',
              opponentName: opponent?.name || 'N/A'
            });
          } catch (analyticsError) {
            logger.error('Analytics error:', analyticsError);
          }
        });

        io.to(battleId).emit('battle-started', {
          startedAt: currentBattle.startedAt,
          timeLimit: currentBattle.timeLimit,
          isAgainstBot: currentBattle.isAgainstBot || false
        });

        // Schedule bot submission if this is a bot battle
        if (currentBattle.isAgainstBot) {
          scheduleBotSubmission(currentBattle);
        }

        logger.info(` Battle ${battleId} started after synchronized countdown`);
      }, COUNTDOWN_DURATION);

    } catch (error) {
      logger.error('Request countdown error:', error);
      socket.emit('error', 'Failed to start countdown');
    }
  });

  // Legacy start-battle handler (for backwards compatibility and direct starts)
  socket.on('start-battle', ({ battleId, playerId }) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) {
        logger.error('Battle not found:', battleId);
        socket.emit('error', 'Battle not found');
        return;
      }

      const player = battle.players.find(p => p.id === playerId);
      if (!player) {
        logger.error('Player not found:', playerId);
        socket.emit('error', 'Player not found in battle');
        return;
      }

      // Verify the socket user owns this player slot (prevents attackers from
      // force-starting someone else's match with a known battleId/playerId)
      if (!verifyPlayerOwnership(socket, player)) return;

      if (battle.state !== 'ready') {
        logger.error('Battle not ready:', battle.state);
        socket.emit('error', 'Battle is not ready to start');
        return;
      }

      const allReady = battle.players.length === 2 && battle.players.every(p => p.ready);

      if (!allReady) {
        logger.error('Not all players ready');
        socket.emit('error', 'Not all players are ready');
        return;
      }

      if (battle.isAgainstBot && !authorizeBotBattleStart(socket, battle)) {
        return;
      }

      if (!battle.problem || !battle.problem.id) {
        logger.warn('WARNING: Battle missing problem, assigning now');
        const problem = getRandomProblem();
        if (!problem || !problem.id) {
          logger.error('CRITICAL: Could not assign problem');
          socket.emit('error', 'Battle configuration error');
          io.to(battleId).emit('error', 'Failed to start battle');
          return;
        }
        battle.problem = problem;
        battles.set(battleId, battle);
        logger.info(` Assigned problem ${problem.id} to battle ${battleId}`);
      }

      if (!battle.problem.title || !battle.problem.testCases) {
        logger.error('CRITICAL: Invalid problem structure');
        socket.emit('error', 'Battle configuration error');
        return;
      }

      battle.state = 'coding';
      battle.startedAt = Date.now();
      battle.serverStartTime = Date.now();

      updateAnalytics('battle-started', { problemId: battle.problem.id });

      battle.players.forEach(p => {
        const opponent = battle.players.find(other => other.id !== p.id);
        try {
          mixpanelAnalytics.trackStartBattle(p.id, {
            battleId: battle.id,
            playerName: p.name,
            problemId: battle.problem.id,
            problemName: battle.problem.title,
            problemDifficulty: battle.problem.difficulty,
            battleType: battle.matchmade ? 'QUICK_MATCH' : 'PRIVATE',
            opponentId: opponent?.id || 'N/A',
            opponentName: opponent?.name || 'N/A'
          });
        } catch (analyticsError) {
          logger.error('Analytics error:', analyticsError);
        }
      });

      io.to(battleId).emit('battle-started', {
        startedAt: battle.startedAt,
        timeLimit: battle.timeLimit,
        isAgainstBot: battle.isAgainstBot || false
      });

      // Schedule bot submission if this is a bot battle
      if (battle.isAgainstBot) {
        scheduleBotSubmission(battle);
      }

      logger.info(` Battle ${battleId} started with problem: ${battle.problem.id} - ${battle.problem.title}`);

    } catch (error) {
      logger.error('Start battle error:', error);
      socket.emit('error', 'Failed to start battle: ' + error.message);
    }
  });
  
  // Throttled code-update handler (max 10 updates/second)
  socket.on('code-update', throttleSocketEvent(socket, 'code-update', THROTTLE_INTERVALS['code-update'], ({ battleId, playerId, code }) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot (silent check for throttled event)
      if (!verifyPlayerOwnership(socket, player, false)) return;

      player.code = code;

    } catch (error) {
      logger.error('Code update error:', error);
    }
  }));

  // Log understanding gate answers for anti-cheat analysis
  socket.on('understanding-answer', ({ battleId, playerId, question, answer, isCorrect }) => {
    try {
      // Input validation - prevent memory abuse
      if (typeof question !== 'string' || typeof answer !== 'string') return;
      if (question.length > 500 || answer.length > 1000) return;

      const battle = battles.get(battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot
      if (!verifyPlayerOwnership(socket, player, false)) return;

      // Store the answer for later analysis (limit to 20 answers per player)
      if (!player.understandingAnswers) {
        player.understandingAnswers = [];
      }
      if (player.understandingAnswers.length >= 20) return;

      // Track wrong answers for anti-cheat (isCorrect: true/false/null)
      const wasCorrect = isCorrect === true ? true : isCorrect === false ? false : null;

      player.understandingAnswers.push({
        question: question.slice(0, 500),
        answer: answer.slice(0, 1000),
        isCorrect: wasCorrect,
        timestamp: Date.now()
      });

      // Track wrong answer count for anti-cheat scoring
      if (wasCorrect === false) {
        player.wrongCyuAnswers = (player.wrongCyuAnswers || 0) + 1;
        logger.warn(`[ANTI-CHEAT] Battle ${battleId} - ${player.name} answered CYU incorrectly (${player.wrongCyuAnswers} wrong)`);
      }

      logger.debug(`[UNDERSTANDING] Battle ${battleId} - ${player.name}: "${question}" -> "${answer}" (correct: ${wasCorrect})`);
    } catch (error) {
      logger.error('Understanding answer error:', error);
    }
  });

  socket.on('submit-solution', async ({ battleId, playerId, code, keystrokeData }) => {
    // Rate limit check
    const rateCheck = checkRateLimit(socket.id, 'submit-solution');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'submit-solution',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Too many submissions. Please wait before trying again.'
      });
      return;
    }

    // Check if user is banned/suspended
    if (socket.userId) {
      try {
        const banStatus = await dbHelper.isUserBanned(socket.userId);
        if (banStatus) {
          socket.emit('submission-result', {
            testResults: [],
            passed: false,
            error: banStatus.is_permanent
              ? 'Your account is permanently suspended. Contact support@codearena.co to appeal.'
              : `Your account is suspended until ${new Date(banStatus.expires_at).toLocaleString()}. Reason: ${banStatus.reason}`
          });
          return;
        }
      } catch (banCheckErr) {
        logger.error('[ANTI-CHEAT] Ban check error:', banCheckErr);
        // Continue on error - don't block submission for ban check failures
      }

      // Check email verification (required for submissions) - separate from ban check
      // This intentionally fails closed (blocks on error) unlike ban check
      const emailCheck = await checkEmailVerified(socket.userId);
      if (!emailCheck.verified) {
        socket.emit('submission-result', {
          testResults: [],
          passed: false,
          error: 'Email verification required. Please verify your email to submit solutions.',
          emailVerificationRequired: true
        });
        return;
      }
    }

    try {
      const battle = battles.get(battleId);
      if (!battle || battle.state !== 'coding') {
        socket.emit('submission-result', {
          testResults: [],
          passed: false,
          error: 'Battle not in coding state'
        });
        return;
      }

      const player = battle.players.find(p => p.id === playerId);
      if (!player) {
        socket.emit('submission-result', {
          testResults: [],
          passed: false,
          error: 'Player not found'
        });
        return;
      }

      // Verify the socket user owns this player slot (prevents submitting code as opponent)
      if (!verifyPlayerOwnership(socket, player)) return;

      // Re-validate language on submission (defense in depth)
      if (!validateLanguage(player.language)) {
        socket.emit('submission-result', {
          testResults: [],
          passed: false,
          error: `Invalid programming language: ${player.language}`
        });
        return;
      }

      // ATOMIC: Check and set isSubmitting flag with lock to prevent race condition
      // Two rapid submissions could both pass the check before either sets the flag
      let lockAcquired = false;
      try {
        await withBattleLock(battleId, async () => {
          if (player.isSubmitting) {
            throw new Error('SUBMISSION_IN_PROGRESS');
          }
          player.isSubmitting = true;
          lockAcquired = true;
        });
      } catch (lockError) {
        if (lockError.message === 'SUBMISSION_IN_PROGRESS') {
          socket.emit('submission-result', {
            testResults: [],
            passed: false,
            error: 'Submission already in progress'
          });
          return;
        }
        // Lock acquisition timeout - let them retry
        socket.emit('submission-result', {
          testResults: [],
          passed: false,
          error: 'Server busy, please try again'
        });
        return;
      }

      const globalCodeLimit = getConsumerFairUseLimit('globalCodeExecutionsPerDay');
      const userCodeLimit = getConsumerFairUseLimit('battleCodeExecutionsPerDay');
      const submittingUserId = player.userId || socket.userId;
      const quotaResources = [
        { metric: 'code_execution', subjectId: 'global', limit: globalCodeLimit }
      ];
      if (submittingUserId) {
        quotaResources.unshift({
          metric: 'battle_code_execution',
          subjectId: `user:${submittingUserId}`,
          limit: userCodeLimit
        });
      }
      const executionQuota = await dbHelper.tryConsumeConsumerDailyUsage(quotaResources);
      if (!executionQuota.allowed) {
        player.isSubmitting = false;
        const globalLimitReached = executionQuota.reason === 'global_limit';
        socket.emit('submission-result', {
          testResults: [],
          passed: false,
          error: globalLimitReached
            ? 'CodeArena has reached today\'s code-runner capacity. Please try again tomorrow.'
            : `You've reached today's fair-use limit of ${userCodeLimit} battle code runs. Try again tomorrow.`,
          limitReached: true,
          globalLimitReached
        });
        return;
      }

      // ============================================
      // ANTI-CHEAT: Schedule non-critical analysis for background processing
      // Anti-cheat analysis, violation logging, trust tier updates, fingerprint
      // storage, and device fingerprint recording all run AFTER the battle result
      // is sent to players via setImmediate() to keep the critical path fast.
      // ============================================
      let cheatAnalysis = { recommendation: 'clean', violations: [], totalSuspicion: 0 };

      // Resolved once this submission's outcome is decided, so the background
      // closure's winner-gated work (fingerprints, trust gains) runs after
      // battle.winner is set instead of racing the multi-second test execution
      let resolveOutcomeDecided;
      const outcomeDecided = new Promise(resolve => { resolveOutcomeDecided = resolve; });

      if (battle.isAgainstBot || !battle.matchmade || battle.battleType === 'centaur') {
        logger.debug(`[ANTI-CHEAT] Skipped for ${battle.battleType === 'centaur' ? 'centaur' : battle.isAgainstBot ? 'bot' : 'private'} battle ${battleId}`);
      } else {
        // Store keystroke data immediately for potential review
        player.keystrokeData = keystrokeData;

        // Capture values needed by the background closure
        const bgBattleId = battleId;
        const bgPlayerId = playerId;
        const bgCode = code;
        const bgKeystrokeData = keystrokeData;
        const bgPlayerLanguage = player.language;
        const bgPlayerName = player.name;
        const bgPlayerUserId = player.userId;
        const bgProblemId = battle.problem.id;
        const bgProblemDifficulty = battle.problem.difficulty;
        const bgBattleStartedAt = battle.startedAt;
        const bgIsAgainstBot = battle.isAgainstBot;
        const bgMatchmade = battle.matchmade;

        // Schedule anti-cheat analysis as background work
        setImmediate(async () => {
          try {
            // Get stored fingerprints for this problem
            const storedFingerprints = await dbHelper.getSolutionFingerprints(bgProblemId);

            // Get player's ELO for analysis
            let playerElo = 1200; // Default
            if (bgPlayerUserId) {
              const userStats = await dbHelper.getUserStats(bgPlayerUserId);
              playerElo = userStats?.rating || 1200;
            }

            // Calculate current solve time
            const currentSolveTime = bgBattleStartedAt ? Math.floor((Date.now() - bgBattleStartedAt) / 1000) : 0;

            // Run comprehensive anti-cheat analysis
            const bgCheatAnalysis = antiCheat.analyzeSubmission({
              code: bgCode,
              language: bgPlayerLanguage,
              keystrokeData: bgKeystrokeData,
              solveTime: currentSolveTime,
              difficulty: bgProblemDifficulty,
              playerElo,
              storedFingerprints
            });

            logger.debug(`[ANTI-CHEAT] Background analysis for ${bgPlayerName}: suspicion=${bgCheatAnalysis.totalSuspicion.toFixed(2)}, recommendation=${bgCheatAnalysis.recommendation}`);

            // Update player's cheatAnalysis for any later reference
            const bgBattle = battles.get(bgBattleId);
            const bgPlayer = bgBattle?.players?.find(p => p.id === bgPlayerId);
            if (bgPlayer) {
              bgPlayer.cheatAnalysis = bgCheatAnalysis;
            }

            // ============================================
            // TRUST TIER v2: CONSEQUENCE-BASED SYSTEM
            // ============================================
            const userId = bgPlayerUserId || null;

            // Track in battle violations
            if (bgBattle) {
              if (!bgBattle.violations) bgBattle.violations = {};
              if (!bgBattle.violations[bgPlayerId]) {
                bgBattle.violations[bgPlayerId] = { count: 0, types: {}, lastNotified: 0 };
              }
            }

            // Log all violations to database
            for (const violation of bgCheatAnalysis.violations) {
              logger.debug(`[ANTI-CHEAT] Violation: ${violation.type} (${violation.severity}) - ${violation.details}`);
              await dbHelper.logViolation(bgBattleId, userId, bgPlayerId, violation.type, violation.details, violation.severity);
              if (bgBattle?.violations?.[bgPlayerId]) {
                bgBattle.violations[bgPlayerId].count++;
                bgBattle.violations[bgPlayerId].types[violation.type] = (bgBattle.violations[bgPlayerId].types[violation.type] || 0) + 1;
              }
            }

            // Process violations with consequence-based logic (for registered users)
            if (bgCheatAnalysis.violations.length > 0 && userId) {
              try {
                // Get user's trust info and behavior baseline
                const [trustInfo, baseline] = await Promise.all([
                  dbHelper.getUserTrustTier(userId),
                  dbHelper.getUserBehaviorMetrics(userId)
                ]);

                // Calculate behavior anomaly using z-scores against personal baseline
                const currentMetrics = {
                  typingSpeed: bgKeystrokeData?.activeTypingTime > 0
                    ? (bgKeystrokeData?.codeLength || 0) / bgKeystrokeData.activeTypingTime
                    : 0,
                  pasteCount: bgKeystrokeData?.pastes || 0,
                  focusLosses: bgKeystrokeData?.focusLosses || 0
                };
                const behaviorAnomaly = trustTierService.detectBehaviorAnomaly(currentMetrics, baseline);

                // Determine consequences based on tier (NOT detection adjustment)
                const consequences = trustTierService.determineConsequences(
                  bgCheatAnalysis,
                  trustInfo,
                  behaviorAnomaly
                );

                logger.debug(`[TRUST-V2] User ${userId} tier=${trustInfo?.trust_tier || 'standard'}, consequence=${consequences.action}, anomaly=${behaviorAnomaly.score.toFixed(2)}`);

                // Create user-facing violation explanation for transparency
                const explanation = antiCheat.generateViolationExplanation(
                  bgCheatAnalysis.violations,
                  baseline,
                  currentMetrics
                );
                if (explanation) {
                  await dbHelper.createViolationExplanation(bgBattleId, userId, {
                    violationType: bgCheatAnalysis.violations[0]?.type || 'unknown',
                    userMessage: explanation.summary,
                    baselineComparison: explanation.violations.map(v => ({
                      type: v.type,
                      message: v.userMessage,
                      comparison: v.baselineComparison
                    })),
                    appealable: explanation.appealable
                  });
                }

                // Apply consequences based on tier
                if (consequences.action === 'flag_for_review') {
                  await dbHelper.createFlaggedSubmission(
                    bgBattleId, userId, bgPlayerId, bgProblemId, bgCode, bgPlayerLanguage,
                    bgCheatAnalysis.violations, bgCheatAnalysis.totalSuspicion, 'manual_review'
                  );
                  logger.info(`[TRUST-V2] Trusted user ${userId} flagged for review (no auto-discipline)`);

                } else if (consequences.action === 'auto_discipline') {
                  await dbHelper.createFlaggedSubmission(
                    bgBattleId, userId, bgPlayerId, bgProblemId, bgCode, bgPlayerLanguage,
                    bgCheatAnalysis.violations, bgCheatAnalysis.totalSuspicion, 'auto_flag'
                  );

                  const primaryViolation = bgCheatAnalysis.violations.find(v => v.severity === 'critical')?.type || 'suspicious_activity';
                  const violationDetails = bgCheatAnalysis.violations.map(v => `${v.type}: ${v.details}`).join('; ');

                  const discipline = await dbHelper.applyCheatDiscipline(userId, primaryViolation, violationDetails, bgBattleId);

                  const trustLoss = consequences.trustLoss || -10;
                  await dbHelper.updateTrustScore(userId, trustLoss, `Violation: ${primaryViolation}`, bgBattleId);
                  await dbHelper.freezeTrustGains(userId, 24);

                  logger.warn(`[TRUST-V2] Discipline: user=${userId}, action=${discipline.action}, trustLoss=${trustLoss}`);

                  socket.emit('cheat-discipline', {
                    action: discipline.action,
                    message: discipline.message,
                    offenseNumber: discipline.offenseNumber,
                    suspensionHours: discipline.suspensionHours,
                    expiresAt: discipline.expiresAt,
                    trustImpact: trustLoss
                  });

                  if (discipline.action !== 'warning') {
                    if (bgPlayer) {
                      bgPlayer.disqualified = true;
                      bgPlayer.disqualifiedReason = discipline.action;
                    }
                  }

                } else if (consequences.action === 'immediate_suspension') {
                  await dbHelper.createFlaggedSubmission(
                    bgBattleId, userId, bgPlayerId, bgProblemId, bgCode, bgPlayerLanguage,
                    bgCheatAnalysis.violations, bgCheatAnalysis.totalSuspicion, 'auto_flag'
                  );

                  const discipline = await dbHelper.applyCheatDiscipline(
                    userId, 'restricted_tier_violation',
                    `Restricted user flagged: ${bgCheatAnalysis.violations.map(v => v.type).join(', ')}`,
                    bgBattleId
                  );

                  await dbHelper.updateTrustScore(userId, -20, 'Restricted tier violation', bgBattleId);

                  logger.warn(`[TRUST-V2] Restricted user ${userId} immediately suspended`);

                  socket.emit('cheat-discipline', {
                    action: discipline.action,
                    message: 'Your account is restricted due to previous violations. Any further flags result in immediate suspension.',
                    suspensionHours: discipline.suspensionHours,
                    expiresAt: discipline.expiresAt
                  });

                  if (bgPlayer) {
                    bgPlayer.disqualified = true;
                    bgPlayer.disqualifiedReason = 'restricted_suspension';
                  }
                }

                // Notify opponent of critical violations
                const opponent = bgBattle?.players?.find(p => p.id !== bgPlayerId);
                const hasCritical = bgCheatAnalysis.violations.some(v => v.severity === 'critical');
                if (opponent && hasCritical) {
                  socket.to(bgBattleId).emit('opponent-violation', {
                    violationType: 'suspicious_submission',
                    severity: 'critical',
                    opponentName: bgPlayerName,
                    message: 'Suspicious submission pattern detected'
                  });
                }

              } catch (trustError) {
                logger.error('[TRUST-V2] Consequence processing error:', trustError);
                if (bgCheatAnalysis.recommendation === 'auto_flag') {
                  await dbHelper.createFlaggedSubmission(
                    bgBattleId, userId, bgPlayerId, bgProblemId, bgCode, bgPlayerLanguage,
                    bgCheatAnalysis.violations, bgCheatAnalysis.totalSuspicion, bgCheatAnalysis.recommendation
                  );
                }
              }
            } else if (bgCheatAnalysis.violations.length > 0) {
              if (bgCheatAnalysis.recommendation === 'auto_flag' || bgCheatAnalysis.recommendation === 'manual_review') {
                await dbHelper.createFlaggedSubmission(
                  bgBattleId, null, bgPlayerId, bgProblemId, bgCode, bgPlayerLanguage,
                  bgCheatAnalysis.violations, bgCheatAnalysis.totalSuspicion, bgCheatAnalysis.recommendation
                );
              }
            }

            // Record device fingerprint for smurf detection
            if (bgPlayerUserId && bgKeystrokeData?.deviceFingerprint) {
              try {
                await dbHelper.recordDeviceFingerprint(bgPlayerUserId, bgKeystrokeData.deviceFingerprint);
              } catch (fpErr) {
                logger.debug('[SMURF] Failed to record fingerprint:', fpErr.message);
              }
            }

            // Everything below is gated on battle.winner, which the main path only
            // sets after test execution completes, wait for that decision (with a
            // backstop so an error on the main path can't strand this closure)
            await Promise.race([
              outcomeDecided,
              new Promise(resolve => setTimeout(resolve, 60000))
            ]);

            // Store winning solution fingerprint (if battle was won with clean analysis)
            if (!bgIsAgainstBot && bgCheatAnalysis.fingerprint && bgCheatAnalysis.recommendation === 'clean') {
              if (bgBattle?.winner === bgPlayerId) {
                try {
                  await dbHelper.storeSolutionFingerprint(
                    bgProblemId,
                    bgBattleId,
                    bgPlayerUserId || null,
                    bgCheatAnalysis.fingerprint,
                    bgCheatAnalysis.ngramFingerprints,
                    bgPlayerLanguage,
                    bgCode.length,
                    true // is winning solution
                  );
                  logger.debug(`[ANTI-CHEAT] Stored fingerprint for winning solution`);
                } catch (fpError) {
                  logger.error('[ANTI-CHEAT] Failed to store fingerprint:', fpError);
                }
              }
            }

            // Update trust for clean battles (winner)
            if (!bgIsAgainstBot && bgPlayerUserId && bgCheatAnalysis.recommendation === 'clean') {
              if (bgBattle?.winner === bgPlayerId) {
                try {
                  const difficulty = bgProblemDifficulty?.toLowerCase() || 'medium';
                  const trustGain = trustTierService.calculateTrustGain('win', difficulty, {});
                  const trustResult = await dbHelper.updateTrustScoreWithCap(
                    bgPlayerUserId, trustGain, `Clean battle win (${difficulty})`, bgBattleId
                  );

                  if (trustResult.capped) {
                    logger.debug(`[TRUST-V2] User ${bgPlayerUserId} hit daily trust cap`);
                  } else if (trustResult.frozen) {
                    logger.debug(`[TRUST-V2] User ${bgPlayerUserId} trust gains frozen`);
                  } else {
                    logger.debug(`[TRUST-V2] User ${bgPlayerUserId} gained ${trustResult.actualChange.toFixed(2)} trust`);
                  }

                  const metrics = {
                    typingSpeed: bgKeystrokeData?.activeTypingTime > 0
                      ? (bgKeystrokeData?.codeLength || 0) / bgKeystrokeData.activeTypingTime
                      : 0,
                    pasteFrequency: bgKeystrokeData?.pastes || 0,
                    focusLossCount: bgKeystrokeData?.focusLosses || 0,
                    solveTime: (bgBattle?.finishedAt && bgBattleStartedAt)
                      ? (bgBattle.finishedAt - bgBattleStartedAt)
                      : 0,
                    difficulty
                  };
                  await dbHelper.updateUserBehaviorMetrics(bgPlayerUserId, metrics);

                  await dbHelper.saveBattleBehaviorSnapshot(bgBattleId, bgPlayerUserId, {
                    totalKeystrokes: bgKeystrokeData?.keystrokes || 0,
                    pasteCount: bgKeystrokeData?.pastes || 0,
                    focusLosses: bgKeystrokeData?.focusLosses || 0,
                    suspicionScore: bgCheatAnalysis.totalSuspicion,
                    violations: [],
                    tierAtBattle: (await dbHelper.getUserTrustTier(bgPlayerUserId))?.trust_tier || 'standard'
                  });

                  const milestones = await dbHelper.checkAndApplyMilestones(bgPlayerUserId);
                  if (milestones.length > 0) {
                    logger.info(`[TRUST-V2] User ${bgPlayerUserId} earned milestones: ${milestones.map(m => m.milestone).join(', ')}`);
                  }
                } catch (trustErr) {
                  logger.error('[TRUST-V2] Failed to update trust for clean battle:', trustErr);
                }
              }
            }

            // Also update loser's trust (smaller gain for participation)
            if (!bgIsAgainstBot && bgBattle?.winner === bgPlayerId) {
              const bgOpponent = bgBattle?.players?.find(p => p.id !== bgPlayerId);
              if (bgOpponent?.userId && !bgBattle.violations?.[bgOpponent.id]?.count) {
                try {
                  const difficulty = bgProblemDifficulty?.toLowerCase() || 'medium';
                  const trustGain = trustTierService.calculateTrustGain('loss', difficulty, {});
                  await dbHelper.updateTrustScoreWithCap(bgOpponent.userId, trustGain, `Clean battle loss (${difficulty})`, bgBattleId);
                } catch (trustErr) {
                  logger.error('[TRUST-V2] Failed to update loser trust:', trustErr);
                }
              }
            }

          } catch (bgCheatError) {
            logger.error('[ANTI-CHEAT] Background analysis error:', bgCheatError);
            // Non-critical: don't affect the battle result
          }
        }); // End of setImmediate for anti-cheat background work
      } // End of else block for non-bot battles

      // Send evaluating status to client
      socket.emit('submission-evaluating', { message: 'Running tests...' });

      logger.info(`[SUBMIT] Starting test execution for battle ${battleId}, player ${playerId}`);
      const testResults = await executeAndValidateSolution(code, battle.problem.testCases, player.language, battle.problem.id);
      logger.info(`[SUBMIT] Test execution complete: ${testResults.length} results, passed=${testResults.filter(r => r.passed).length}`);
      const allPassed = allTestsPassed(testResults);

      // Split into visible and hidden test results (only show first N to the player)
      const visibleCount = problemsLoader.visibleCount(battle.problem);
      const visibleTestResults = testResults.slice(0, visibleCount);
      const hiddenTestResults = testResults.slice(visibleCount);
      const hiddenPassed = hiddenTestResults.filter(r => r.passed).length;
      const hiddenTotal = hiddenTestResults.length;

      // Broadcast test progress to opponent
      const passedCount = testResults.filter(r => r.passed).length;
      socket.to(battleId).emit('opponent-progress', {
        playerId,
        testsPassed: passedCount,
        testsTotal: testResults.length
      });

      player.code = code;
      player.submittedAt = Date.now();
      // Store best test progress for partial credit calculation on timeout, so a
      // worse late submission can't erase progress already demonstrated
      player.testsPassed = Math.max(player.testsPassed || 0, passedCount);
      player.testsTotal = testResults.length;
      // Store last visible test results + hidden summary so loser sees their own results on battle-finished
      player.lastTestResults = visibleTestResults;
      player.lastHiddenTests = { passed: hiddenPassed, total: hiddenTotal };

      // ATOMIC: Use lock to determine winner - prevents race condition when both players
      // submit passing solutions simultaneously
      let isWinner = false;
      let battleDuration = 0;
      let winnerSolveTime = 0;

      if (allPassed) {
        try {
          await withBattleLock(battleId, async () => {
            // Re-check state inside lock - another submission may have won while we were testing
            if (battle.state === 'coding' && !battle.winner) {
              player.submitted = true;
              battle.winner = playerId;
              battle.state = 'finished';
              battle.finishedAt = Date.now();
              isWinner = true;
            }
          });
        } catch (lockError) {
          logger.error('Failed to acquire lock for winner determination:', lockError);
          // Continue - we just won't be able to claim winner status
        }
      }

      // Clear submitting flag after lock operations
      player.isSubmitting = false;
      resolveOutcomeDecided();

      if (isWinner) {
        battleDuration = (battle.finishedAt - battle.startedAt) / 1000;
        winnerSolveTime = Math.floor(battleDuration);

        // Solve time anomaly detection
        const difficulty = battle.problem.difficulty?.toLowerCase() || 'medium';
        const suspiciousThresholds = {
          easy: { critical: 15, serious: 30 },
          medium: { critical: 25, serious: 45 },
          hard: { critical: 45, serious: 90 }
        };
        const thresholds = suspiciousThresholds[difficulty] || suspiciousThresholds.medium;

        let solveTimeAnomaly = null;
        if (winnerSolveTime < thresholds.critical) {
          solveTimeAnomaly = {
            severity: 'critical',
            message: `Solved ${difficulty} problem in ${winnerSolveTime}s (expected minimum: ${thresholds.critical}s)`
          };
        } else if (winnerSolveTime < thresholds.serious) {
          solveTimeAnomaly = {
            severity: 'serious',
            message: `Unusually fast solution for ${difficulty} problem (${winnerSolveTime}s)`
          };
        }

        // Log solve time anomaly in background (non-critical, doesn't affect battle result)
        if (solveTimeAnomaly && player.userId) {
          const bgSolveAnomaly = solveTimeAnomaly;
          const bgSolveUserId = player.userId;
          const bgSolvePlayerId = playerId;
          const bgSolveBattleId = battleId;
          setImmediate(async () => {
            try {
              await dbHelper.logViolation(
                bgSolveBattleId, bgSolveUserId, bgSolvePlayerId,
                'solve_time_anomaly', bgSolveAnomaly.message, bgSolveAnomaly.severity
              );
            } catch (err) {
              logger.error('Failed to log solve time anomaly:', err);
            }
            try {
              const bgBattle = battles.get(bgSolveBattleId);
              const opponentForNotify = bgBattle?.players?.find(p => p.id !== bgSolvePlayerId);
              if (opponentForNotify) {
                socket.to(bgSolveBattleId).emit('opponent-violation', {
                  playerId: bgSolvePlayerId,
                  violationType: 'solve_time_anomaly',
                  message: `Opponent's solution time flagged for review`,
                  severity: bgSolveAnomaly.severity
                });
              }
            } catch (notifyErr) {
              logger.error('Failed to notify opponent of solve time anomaly:', notifyErr);
            }
          });
        }

        // Analyze time complexity only after atomically reserving both the
        // user's allowance and the global paid-model circuit breaker. Quota or
        // provider failures never block completion; the deterministic time
        // rating below remains the fallback.
        let winnerPerformance;
        let complexityResult = null;
        const complexityUserId = player.userId || socket.userId;
        if (anthropicServer && complexityUserId != null) {
          try {
            const userLimit = getConsumerFairUseLimit('complexityAnalysesPerDay');
            const globalLimit = getConsumerFairUseLimit('globalPromptEvaluationsPerDay');
            const complexityQuota = await dbHelper.tryConsumeConsumerDailyUsage([
              { metric: 'complexity_analysis', subjectId: `user:${complexityUserId}`, limit: userLimit },
              { metric: 'prompt_evaluation', subjectId: 'global', limit: globalLimit }
            ]);

            if (complexityQuota?.allowed) {
              complexityResult = await Promise.race([
                analyzeComplexity(
                  code, player.language,
                  battle.problem.title, battle.problem.description
                ),
                new Promise(resolve => setTimeout(() => resolve(null), 6000))
              ]);
            } else {
              logger.debug(`[COMPLEXITY] Quota unavailable for battle ${battleId}; using time fallback`);
            }
          } catch (complexityError) {
            logger.warn('[COMPLEXITY] Quota or analysis unavailable; using time fallback:', complexityError?.message || complexityError);
          }
        }
        if (complexityResult?.userComplexity && complexityResult?.optimalComplexity) {
          winnerPerformance = getComplexityPerformance(
            complexityResult.userComplexity,
            complexityResult.optimalComplexity,
            complexityResult.explanation
          );
        } else {
          winnerPerformance = getTimeFallbackRating(winnerSolveTime);
        }
        winnerPerformance.solveTime = winnerSolveTime;
        if (solveTimeAnomaly) {
          winnerPerformance.flaggedForReview = true;
          winnerPerformance.anomalyReason = solveTimeAnomaly.message;
        }

        // Send submission result to winner so they see test results
        socket.emit('submission-result', {
          testResults: visibleTestResults,
          hiddenTests: { passed: hiddenPassed, total: hiddenTotal },
          passed: true
        });

        updateAnalytics('battle-completed', {
          problemId: battle.problem.id,
          duration: battleDuration,
          solveTime: winnerSolveTime,
          performanceData: winnerPerformance
        });

        const opponent = battle.players.find(p => p.id !== playerId);

        // For the loser, calculate their actual time spent (either their last submission or battle duration)
        let loserTimeSpent = Math.floor(battleDuration);
        let loserMessage = "Keep practicing to improve your speed and accuracy!";
        if (opponent?.submittedAt) {
          // If loser submitted at least once, show time of their last attempt
          loserTimeSpent = Math.floor((opponent.submittedAt - battle.startedAt) / 1000);
          loserMessage = "Good attempt! Keep practicing to get faster.";
        }
        const loserPerformance = {
          timeSpent: loserTimeSpent,
          battleDuration: Math.floor(battleDuration), // Full battle duration for context
          message: loserMessage,
          didNotComplete: true
        };

        // Compile violation summary for battle results
        const violationSummary = {
          winner: battle.violations?.[playerId] || { count: 0, types: {} },
          loser: battle.violations?.[opponent?.id] || { count: 0, types: {} }
        };

        // Clear bot timeout if human wins against bot
        if (battle.isAgainstBot && battle.botSubmitTimeout) {
          clearTimeout(battle.botSubmitTimeout);
          logger.info(`Cleared bot submission timeout - human won battle ${battleId}`);
        }

        // Persist battle result to database FIRST to get rating changes
        logger.info(`[STATS-DEBUG] About to call persistBattleResult for battle ${battleId} - winner ${player.name} (userId: ${player.userId}) vs ${opponent?.name} (userId: ${opponent?.userId})`);
        logger.info(`[STATS-DEBUG] Battle matchmade=${battle.matchmade}, ranked=${battle.ranked}, isAgainstBot=${battle.isAgainstBot}`);
        const battleResult = await persistBattleResult(battle, player, opponent, winnerSolveTime, loserTimeSpent, false);

        // NOTE: Fingerprint storage, trust tier updates, and loser trust updates
        // are handled in the background anti-cheat callback (setImmediate above)

        io.to(battleId).emit('battle-finished', {
          winner: playerId,
          winnerName: player.name,
          loser: opponent?.id || null,
          loserName: opponent?.name || 'Unknown',
          testResults: visibleTestResults,
          winnerTestResults: visibleTestResults,
          winnerHiddenTests: { passed: hiddenPassed, total: hiddenTotal },
          loserTestResults: opponent?.lastTestResults || [],
          loserHiddenTests: opponent?.lastHiddenTests || null,
          finishedAt: battle.finishedAt,
          forfeit: false,
          winReason: 'solution',
          winnerPerformance: winnerPerformance,
          loserPerformance: loserPerformance,
          winnerCode: player.code || null,
          loserCode: opponent?.code || null,
          winnerLanguage: player.language || 'python',
          loserLanguage: opponent?.language || 'python',
          violations: violationSummary,
          isAgainstBot: battle.isAgainstBot || false,
          ratingChanges: (battle.isAgainstBot || !battle.matchmade) ? null : {
            winner: {
              change: battleResult.winnerRatingChange || 0,
              newRating: battleResult.winnerNewRating || null,
              newRank: battleResult.winnerRank?.display || null
            },
            loser: {
              change: battleResult.loserRatingChange || 0,
              newRating: battleResult.loserNewRating || null,
              newRank: battleResult.loserRank?.display || null
            }
          }
        });

        // Emit badge notification if winner earned new badges
        if (battleResult.winnerNewBadges && battleResult.winnerNewBadges.length > 0 && player.socketId) {
          io.to(player.socketId).emit('badges-earned', {
            badges: battleResult.winnerNewBadges,
            context: 'battle_win'
          });
        }

        // Emit badge notification if loser earned new badges (e.g., rank badges)
        if (battleResult.loserNewBadges && battleResult.loserNewBadges.length > 0 && opponent?.socketId) {
          io.to(opponent.socketId).emit('badges-earned', {
            badges: battleResult.loserNewBadges,
            context: 'battle_loss'
          });
        }

        // Handle tournament match completion
        if (battle.isTournament && battle.matchId && player.userId) {
          try {
            const winnerId = player.userId;
            const result = await dbHelper.completeTournamentMatch(battle.matchId, winnerId);

            // Broadcast bracket update to tournament room
            const roomName = `tournament-${battle.tournamentId}`;
            io.to(roomName).emit('tournament-bracket-update', {
              matchId: battle.matchId,
              winnerId: winnerId,
              tournamentComplete: result.tournamentComplete
            });

            if (result.tournamentComplete) {
              // Always read winner_id from the DB, the 3rd place match winner is not the champion
              const completedTournament = await dbHelper.getTournamentById(battle.tournamentId);
              io.to(roomName).emit('tournament-completed', {
                tournamentId: battle.tournamentId,
                winnerId: completedTournament?.winner_id
              });
              logger.info(`Tournament ${battle.tournamentId} completed! Winner: ${completedTournament?.winner_id}`);
            }
          } catch (tournamentErr) {
            logger.error('Tournament match completion error:', tournamentErr);
          }
        }
      } else {
        // Either tests didn't pass, or another player already won
        socket.emit('submission-result', {
          testResults: visibleTestResults,
          hiddenTests: { passed: hiddenPassed, total: hiddenTotal },
          passed: allPassed,
          // Inform player if they passed but weren't first
          lateSubmission: allPassed && battle.state === 'finished'
        });

        if (allPassed && battle.state !== 'finished') {
          // Tests passed but battle not over yet (shouldn't happen in 1v1, but defensive)
          player.submitted = true;
          socket.to(battleId).emit('player-submitted', {
            playerId,
            playerName: player.name
          });
        }
      }

    } catch (error) {
      logger.error('Submit solution error:', error);
      socket.emit('submission-result', {
        testResults: [],
        passed: false,
        error: 'Failed to process submission'
      });
    } finally {
      // Guarantee isSubmitting flag is always reset, even if an error occurs
      const battle = battles.get(battleId);
      const player = battle?.players?.find(p => p.id === playerId);
      if (player) player.isSubmitting = false;
    }
  });

  // Finalize a forfeit (a player gives up, the opponent wins): persist + ELO, notify both,
  // award badges, and advance any tournament bracket. Extracted (hoisted) so that ABANDONING a
  // live battle (exit-battle during 'coding') ends it the same way instead of leaving the
  // opponent to wait out the full timer.
  async function handleBattleForfeit(battleId, playerId) {
    try {
      const battle = battles.get(battleId);
      if (!battle) return;

      // Only allow forfeit if battle is still in coding state
      if (battle.state !== 'coding') {
        logger.warn(`Forfeit rejected - battle ${battleId} not in coding state (state: ${battle.state})`);
        return;
      }

      const forfeitingPlayer = battle.players.find(p => p.id === playerId);
      const opponent = battle.players.find(p => p.id !== playerId);

      if (!forfeitingPlayer || !opponent) return;
      // Authorization is the CALLER's responsibility (the explicit forfeit handler verifies socket
      // ownership; exit/disconnect authorize differently), so this finalizer is socket-independent
      // and safe to call from the disconnect grace timer where there is no live socket.

      battle.state = 'finished';
      battle.finishedAt = Date.now();
      battle.winner = opponent.id;

      updateAnalytics('battle-forfeited');

      const timeSpent = battle.startedAt ? Math.floor((Date.now() - battle.startedAt) / 1000) : 0;

      // Compile violation summary for battle results
      const violationSummary = {
        winner: battle.violations?.[opponent.id] || { count: 0, types: {} },
        loser: battle.violations?.[forfeitingPlayer.id] || { count: 0, types: {} }
      };

      // DEBUG: Log forfeit details before persisting
      logger.info(`[FORFEIT-DEBUG] Battle ${battleId} forfeit triggered`);
      logger.info(`[FORFEIT-DEBUG] Winner (opponent): id=${opponent.id}, name=${opponent.name}, userId=${opponent.userId}`);
      logger.info(`[FORFEIT-DEBUG] Loser (forfeiter): id=${forfeitingPlayer.id}, name=${forfeitingPlayer.name}, userId=${forfeitingPlayer.userId}`);
      logger.info(`[FORFEIT-DEBUG] Battle flags: matchmade=${battle.matchmade}, ranked=${battle.ranked}, isAgainstBot=${battle.isAgainstBot}`);

      // Persist forfeit battle result to database FIRST to get rating changes
      const battleResult = await persistBattleResult(battle, opponent, forfeitingPlayer, null, timeSpent, true);

      // DEBUG: Log the result
      logger.info(`[FORFEIT-DEBUG] persistBattleResult returned: winnerRatingChange=${battleResult.winnerRatingChange}, loserRatingChange=${battleResult.loserRatingChange}`);

      // Clear bot timeout if applicable
      if (battle.isAgainstBot && battle.botSubmitTimeout) {
        clearTimeout(battle.botSubmitTimeout);
      }

      io.to(battleId).emit('battle-finished', {
        winner: opponent.id,
        winnerName: opponent.name,
        loser: forfeitingPlayer.id,
        loserName: forfeitingPlayer.name,
        testResults: [],
        finishedAt: battle.finishedAt,
        forfeit: true,
        winReason: 'forfeit',
        winnerPerformance: null,
        loserPerformance: {
          timeSpent: timeSpent,
          message: "Forfeit - try to complete the challenge next time!",
          didNotComplete: true
        },
        winnerCode: opponent.code || null,
        loserCode: forfeitingPlayer.code || null,
        winnerLanguage: opponent.language || 'python',
        loserLanguage: forfeitingPlayer.language || 'python',
        violations: violationSummary,
        isAgainstBot: battle.isAgainstBot || false,
        ratingChanges: (battle.isAgainstBot || !battle.matchmade) ? null : {
          winner: {
            change: battleResult.winnerRatingChange || 0,
            newRating: battleResult.winnerNewRating || null,
            newRank: battleResult.winnerRank?.display || null
          },
          loser: {
            change: battleResult.loserRatingChange || 0,
            newRating: battleResult.loserNewRating || null,
            newRank: battleResult.loserRank?.display || null
          }
        }
      });

      // Emit badge notification if winner earned new badges
      if (battleResult.winnerNewBadges && battleResult.winnerNewBadges.length > 0 && opponent.socketId) {
        io.to(opponent.socketId).emit('badges-earned', {
          badges: battleResult.winnerNewBadges,
          context: 'battle_win'
        });
      }

      // Emit badge notification if loser (forfeiter) earned new badges (e.g., rank badges)
      if (battleResult.loserNewBadges && battleResult.loserNewBadges.length > 0 && forfeitingPlayer.socketId) {
        io.to(forfeitingPlayer.socketId).emit('badges-earned', {
          badges: battleResult.loserNewBadges,
          context: 'battle_forfeit'
        });
      }

      // Handle tournament match completion on forfeit
      if (battle.isTournament && battle.matchId && opponent.userId) {
        try {
          const winnerId = opponent.userId;
          const result = await dbHelper.completeTournamentMatch(battle.matchId, winnerId);

          // Broadcast bracket update to tournament room
          const roomName = `tournament-${battle.tournamentId}`;
          io.to(roomName).emit('tournament-bracket-update', {
            matchId: battle.matchId,
            winnerId: winnerId,
            tournamentComplete: result.tournamentComplete,
            forfeit: true
          });

          if (result.tournamentComplete) {
            // Always read winner_id from the DB, the 3rd place match winner is not the champion
            const completedTournament = await dbHelper.getTournamentById(battle.tournamentId);
            io.to(roomName).emit('tournament-completed', {
              tournamentId: battle.tournamentId,
              winnerId: completedTournament?.winner_id
            });
            logger.info(`Tournament ${battle.tournamentId} completed via forfeit! Winner: ${completedTournament?.winner_id}`);
          }
        } catch (tournamentErr) {
          logger.error('Tournament match completion error:', tournamentErr);
        }
      }

    } catch (error) {
      logger.error('Forfeit battle error:', error);
    }
  }

  socket.on('forfeit-battle', async ({ battleId, playerId }) => {
    // Only the player themselves (their own socket) may explicitly forfeit. The exit and disconnect
    // paths authorize separately before calling handleBattleForfeit.
    const battle = battles.get(battleId);
    const forfeitingPlayer = battle && battle.players.find(p => p.id === playerId);
    if (!verifyPlayerOwnership(socket, forfeitingPlayer)) return;
    await handleBattleForfeit(battleId, playerId);
  });

  // ============================================
  // ANTI-CHEATING SOCKET HANDLERS
  // ============================================

  socket.on('report-violation', async ({ battleId, playerId, violationType: rawViolationType, details: rawDetails, severity: rawSeverity }) => {
    try {
      // Enforce the (already-configured but previously unwired) rate limit so a client
      // cannot drive unbounded violation-log writes or memory growth.
      if (!checkRateLimit(socket.id, 'report-violation').allowed) return;

      const battle = battles.get(battleId);
      if (!battle || battle.state !== 'coding') return;

      const player = battle.players.find(p => p.id === playerId);
      if (!player) return;

      // Verify the socket user owns this player slot (prevents reporting violations against opponents)
      if (!verifyPlayerOwnership(socket, player)) return;

      // Clamp client-supplied fields before they are stored, used as a map key, or echoed
      // to the opponent: a known severity, a bounded violation type, and capped details.
      const VALID_SEVERITIES = ['info', 'warning', 'serious', 'critical'];
      const severity = VALID_SEVERITIES.includes(rawSeverity) ? rawSeverity : 'warning';
      const violationType = (typeof rawViolationType === 'string' && rawViolationType.trim().length > 0)
        ? rawViolationType.slice(0, 64) : 'unknown';
      const details = typeof rawDetails === 'string' ? rawDetails.slice(0, 1000) : '';

      const userId = player.userId || null;

      // Log violation to database
      await dbHelper.logViolation(battleId, userId, playerId, violationType, details, severity);

      // Track violation in memory for this battle
      if (!battle.violations) battle.violations = {};
      if (!battle.violations[playerId]) {
        battle.violations[playerId] = { count: 0, types: {}, lastNotified: 0 };
      }
      battle.violations[playerId].count++;
      battle.violations[playerId].types[violationType] = (battle.violations[playerId].types[violationType] || 0) + 1;

      logger.debug(`[ANTI-CHEAT] Violation logged: ${violationType} by ${player.name} (severity: ${severity})`);

      // Notify opponent of serious violations (max once per 30 seconds per type)
      const opponent = battle.players.find(p => p.id !== playerId);
      if (opponent && (severity === 'serious' || severity === 'critical')) {
        const now = Date.now();
        if (now - battle.violations[playerId].lastNotified > 30000) {
          battle.violations[playerId].lastNotified = now;
          socket.to(battleId).emit('opponent-violation', {
            violationType,
            severity,
            opponentName: player.name,
            message: getViolationMessage(violationType, severity)
          });
        }
      }

      // Check for automatic penalties based on violation count
      const violationCount = battle.violations[playerId].count;
      if (violationCount >= 10 && userId) {
        // Automatic temporary ban for excessive violations
        const trustInfo = await dbHelper.getUserTrustScore(userId);
        if (trustInfo.trust_score < 30) {
          await dbHelper.autoBanUser(userId, 'Excessive anti-cheat violations', 24); // 24-hour ban
          socket.emit('account-suspended', {
            reason: 'Excessive violations detected',
            duration: '24 hours'
          });
        }
      }

    } catch (error) {
      logger.error('Report violation error:', error);
    }
  });

  socket.on('get-battle-integrity', async ({ battleId, playerId }) => {
    try {
      const battle = battles.get(battleId);
      if (!battle) return;

      const player = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot (can only view own integrity)
      if (!verifyPlayerOwnership(socket, player)) return;

      const violations = battle.violations || {};
      const playerViolations = violations[playerId] || { count: 0, types: {} };

      socket.emit('battle-integrity-status', {
        violations: playerViolations,
        integrityScore: Math.max(0, 100 - (playerViolations.count * 5))
      });
    } catch (error) {
      logger.error('Get battle integrity error:', error);
    }
  });

  socket.on('request-rematch', ({ battleId, playerId, playerName }) => {
    try {
      const battle = battles.get(battleId);
      if (!battle || battle.state !== 'finished') {
        socket.emit('error', 'Cannot request rematch for this battle');
        return;
      }

      // Prevent rematch requests for bot battles
      if (battle.isAgainstBot || battle.players.some(p => p.isBot)) {
        socket.emit('error', 'Rematches are not available for bot battles. Start a new bot battle instead.');
        return;
      }

      const player = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot
      if (!verifyPlayerOwnership(socket, player)) return;

      if (rematchRequests.has(battleId)) {
        socket.emit('error', 'Rematch already requested for this battle');
        return;
      }

      const opponent = battle.players.find(p => p.id !== playerId);
      if (!opponent) {
        socket.emit('error', 'Opponent not found');
        return;
      }
      
      const rematchData = {
        requesterId: playerId,
        requesterName: player.name,
        requestedAt: Date.now(),
        expiresAt: Date.now() + REMATCH_TIMEOUT
      };

      rematchRequests.set(battleId, rematchData);
      updateAnalytics('rematch-requested');

      socket.emit('rematch-request-sent', {
        opponentName: opponent.name
      });

      socket.to(battleId).emit('rematch-requested', {
        requesterId: playerId,
        requesterName: player.name,
        battleId
      });
      
    } catch (error) {
      logger.error('Request rematch error:', error);
      socket.emit('error', 'Failed to request rematch');
    }
  });

  socket.on('respond-rematch', async ({ battleId, playerId, accepted }) => {
    try {
      const battle = battles.get(battleId);
      const rematchData = rematchRequests.get(battleId);

      if (!battle || !rematchData) {
        socket.emit('error', 'Rematch request not found');
        return;
      }

      const responder = battle.players.find(p => p.id === playerId);
      // Verify the socket user owns this player slot
      if (!verifyPlayerOwnership(socket, responder)) return;

      // Only the OPPONENT may respond to a rematch, never the requester themselves. Without this,
      // the requester could accept their own request and pull the opponent into a fresh battle
      // they never agreed to.
      if (playerId === rematchData.requesterId) {
        socket.emit('error', 'You cannot respond to your own rematch request');
        return;
      }

      const requester = battle.players.find(p => p.id === rematchData.requesterId);
      if (!requester) {
        socket.emit('error', 'Requester not found');
        return;
      }
      
      rematchRequests.delete(battleId);
      
      if (accepted) {
        updateAnalytics('rematch-accepted');
        
        const newBattle = await createRematchBattle(battle, battle.players);
        
        if (newBattle) {
          const requesterSocket = io.sockets.sockets.get(requester.socketId);
          const responderSocket = io.sockets.sockets.get(responder.socketId);
          
          if (requesterSocket && requesterSocket.connected) {
            requesterSocket.emit('rematch-accepted', {
              battleId: newBattle.id,
              playerId: requester.id,
              message: 'Rematch accepted! Starting new battle...',
              isRematch: true,
              opponentName: responder.name
            });
          }

          if (responderSocket && responderSocket.connected) {
            responderSocket.emit('rematch-accepted', {
              battleId: newBattle.id,
              playerId: responder.id,
              message: 'Rematch accepted! Starting new battle...',
              isRematch: true,
              opponentName: requester.name
            });
          }
        } else {
          socket.emit('error', 'Failed to create rematch battle');
        }
        
      } else {
        updateAnalytics('rematch-declined');
        
        const requesterSocket = io.sockets.sockets.get(requester.socketId);
        if (requesterSocket && requesterSocket.connected) {
          requesterSocket.emit('rematch-declined', {
            declinerName: responder.name
          });
        }
      }
      
    } catch (error) {
      logger.error('Respond rematch error:', error);
      socket.emit('error', 'Failed to respond to rematch');
    }
  });

  socket.on('cancel-rematch', ({ battleId, playerId }) => {
    try {
      const battle = battles.get(battleId);
      const rematchData = rematchRequests.get(battleId);

      if (!rematchData || rematchData.requesterId !== playerId) {
        socket.emit('error', 'No rematch request found');
        return;
      }

      // Verify the socket user owns this player slot
      if (battle) {
        const player = battle.players.find(p => p.id === playerId);
        if (!verifyPlayerOwnership(socket, player)) return;
      }

      rematchRequests.delete(battleId);
      updateAnalytics('rematch-cancelled');
      
      socket.emit('rematch-request-cancelled');
      
      socket.to(battleId).emit('rematch-cancelled', {
        cancellerName: rematchData.requesterName
      });
      
    } catch (error) {
      logger.error('Cancel rematch error:', error);
      socket.emit('error', 'Failed to cancel rematch');
    }
  });

  // ============================================================================
  // MESSAGING SOCKET EVENTS
  // ============================================================================

  // Map to track authenticated users and their socket IDs
  if (!global.userSockets) {
    global.userSockets = new Map(); // userId -> Set of socketIds
  }

  // Helper function to emit to all sockets of a specific user
  // This is used to send badge notifications from API endpoints
  if (!global.emitToUser) {
    global.emitToUser = (userId, event, data) => {
      const userIdStr = String(userId);
      const userIdNum = parseInt(userId, 10);
      const sockets = global.userSockets.get(userIdNum) || global.userSockets.get(userIdStr);
      if (sockets && sockets.size > 0) {
        for (const socketId of sockets) {
          io.to(socketId).emit(event, data);
        }
        return true;
      }
      return false;
    };
  }

  // Authenticate socket for messaging
  socket.on('auth-for-messaging', async ({ token }) => {
    logger.debug('[MESSAGING] Auth request received, token:', token ? 'present' : 'missing');
    try {
      if (!token) {
        logger.debug('[MESSAGING] No token provided');
        socket.emit('auth-error', { error: 'No token provided' });
        return;
      }

      // Always use number for userId to ensure consistent Map keys
      const { userId } = await authenticateSessionToken(token, dbHelper, SECRET);
      logger.debug('[MESSAGING] Token decoded, userId:', userId);

      // Store socket mapping
      socket.userId = userId;

      if (!global.userSockets.has(userId)) {
        global.userSockets.set(userId, new Set());
      }
      global.userSockets.get(userId).add(socket.id);

      // Join user-specific room for reliable event delivery
      socket.join(`user:${userId}`);

      // Update user online status
      await dbHelper.setUserOnlineStatus(userId, true);

      // Notify friends that this user is now online
      try {
        const friends = await dbHelper.getUserFriends(userId);
        friends.forEach(friend => {
          const friendSockets = global.userSockets.get(friend.id);
          if (friendSockets) {
            friendSockets.forEach(socketId => {
              io.to(socketId).emit('friend-online', { friendId: userId });
            });
          }
        });
      } catch (err) {
        logger.debug('[MESSAGING] Error notifying friends of online status:', err.message);
      }

      socket.emit('auth-success', { userId });
      logger.debug(`[MESSAGING] User ${userId} authenticated for messaging`);
    } catch (err) {
      logger.debug('[MESSAGING] Auth error:', err.message);
      socket.emit('auth-error', { error: 'Invalid token' });
    }
  });

  // Send a message
  socket.on('send-message', async ({ receiverId, content }) => {
    // Rate limit check
    const rateCheck = checkRateLimit(socket.id, 'send-message');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'send-message',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Sending messages too quickly. Please slow down.'
      });
      return;
    }

    logger.debug('[MESSAGING] Send message request:', { receiverId, contentLength: content?.length, socketUserId: socket.userId });
    try {
      if (!socket.userId) {
        logger.debug('[MESSAGING] Send failed: not authenticated');
        socket.emit('message-error', { error: 'Not authenticated' });
        return;
      }

      // Validate receiverId before any database operations
      const receiverIdNum = parseInt(receiverId);
      if (!receiverId || isNaN(receiverIdNum)) {
        socket.emit('message-error', { error: 'Invalid receiver ID' });
        return;
      }

      if (!content || content.trim().length === 0) {
        socket.emit('message-error', { error: 'Message content required' });
        return;
      }

      if (content.length > 2000) {
        socket.emit('message-error', { error: 'Message too long' });
        return;
      }

      const senderId = socket.userId;

      if (senderId === receiverIdNum) {
        socket.emit('message-error', { error: 'Cannot send message to yourself' });
        return;
      }

      const receiver = await dbHelper.getUserById(receiverIdNum);
      if (!receiver) {
        socket.emit('message-error', { error: 'User not found' });
        return;
      }

      // Check if either user has blocked the other
      const isBlocked = await dbHelper.isBlockedEitherWay(senderId, receiverIdNum);
      if (isBlocked) {
        socket.emit('message-error', { error: 'Cannot send message to this user' });
        return;
      }

      // Save message to database
      const message = await dbHelper.createMessage(senderId, receiverIdNum, content.trim());
      logger.debug('[MESSAGING] Message saved:', { messageId: message.id, from: senderId, to: receiverIdNum });

      // Get sender info to include in the message for new conversations
      const sender = await dbHelper.getUserById(senderId);
      const messageWithSenderInfo = {
        ...message,
        sender_username: sender?.username,
        sender_avatar: sender?.avatar,
        sender_avatar_url: sender?.avatar_url
      };

      // Confirm to sender
      socket.emit('message-sent', { message: messageWithSenderInfo });

      // Send to receiver if online
      // Try both string and number versions of receiverId since Map keys are strict
      const receiverIdStr = String(receiverIdNum);

      logger.debug('[MESSAGING] Looking for receiver sockets. userSockets keys:', Array.from(global.userSockets.keys()));
      logger.debug('[MESSAGING] Looking for receiverId:', receiverId, 'type:', typeof receiverId);

      let receiverSockets = global.userSockets.get(receiverIdNum) || global.userSockets.get(receiverIdStr);

      if (receiverSockets && receiverSockets.size > 0) {
        logger.debug('[MESSAGING] Receiver is online, sending to', receiverSockets.size, 'sockets');
        receiverSockets.forEach(socketId => {
          io.to(socketId).emit('new-message', { message: messageWithSenderInfo });
        });
      } else {
        logger.debug('[MESSAGING] Receiver is offline, message saved for later');
      }
    } catch (err) {
      logger.error('Send message error:', err);
      socket.emit('message-error', { error: 'Failed to send message' });
    }
  });

  socket.on('toggle-message-reaction', async ({ messageId, emoji }) => {
    const rateCheck = checkRateLimit(socket.id, 'toggle-message-reaction');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'toggle-message-reaction',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Reacting too quickly. Please slow down.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('message-error', { error: 'Not authenticated' });
        return;
      }

      const result = await dbHelper.toggleMessageReaction(messageId, socket.userId, emoji);
      if (!result.success) {
        socket.emit('message-error', { error: result.error });
        return;
      }

      const payload = {
        messageId: result.message.id,
        emoji: result.emoji,
        action: result.action,
        userId: socket.userId,
        reactions: result.reactions
      };

      const participantIds = new Set([result.message.sender_id, result.message.receiver_id]);
      participantIds.forEach(userId => {
        io.to(`user:${userId}`).emit('message-reaction-updated', payload);
      });
    } catch (err) {
      logger.error('[MESSAGING] Toggle reaction error:', err);
      socket.emit('message-error', { error: 'Failed to update reaction' });
    }
  });

  // Delete a direct message (sender only; soft-delete). Broadcasts to both participants.
  socket.on('delete-message', async ({ messageId }) => {
    const rateCheck = checkRateLimit(socket.id, 'send-message');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'delete-message',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Too many actions. Please slow down.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('message-error', { error: 'Not authenticated' });
        return;
      }

      const result = await dbHelper.deleteMessage(messageId, socket.userId);
      if (!result.success) {
        socket.emit('message-error', { error: result.error });
        return;
      }

      const payload = {
        messageId: result.message.id,
        senderId: result.message.sender_id,
        receiverId: result.message.receiver_id,
        lastMessage: result.lastMessage || null
      };

      const participantIds = new Set([result.message.sender_id, result.message.receiver_id]);
      participantIds.forEach(userId => {
        io.to(`user:${userId}`).emit('message-deleted', payload);
      });
    } catch (err) {
      logger.error('[MESSAGING] Delete message error:', err);
      socket.emit('message-error', { error: 'Failed to delete message' });
    }
  });

  // Typing indicators
  // Throttled typing-start handler (max 2/second)
  socket.on('typing-start', throttleSocketEvent(socket, 'typing-start', THROTTLE_INTERVALS['typing-start'], ({ receiverId }) => {
    if (!socket.userId) return;

    // Ensure receiverId is a number for Map lookup
    const receiverIdNum = parseInt(receiverId);
    const receiverSockets = global.userSockets.get(receiverIdNum) || global.userSockets.get(String(receiverId));
    if (receiverSockets) {
      receiverSockets.forEach(socketId => {
        io.to(socketId).emit('user-typing', { userId: socket.userId });
      });
    }
  }));

  // Throttled typing-stop handler (max 2/second)
  socket.on('typing-stop', throttleSocketEvent(socket, 'typing-stop', THROTTLE_INTERVALS['typing-stop'], ({ receiverId }) => {
    if (!socket.userId) return;

    // Ensure receiverId is a number for Map lookup
    const receiverIdNum = parseInt(receiverId);
    const receiverSockets = global.userSockets.get(receiverIdNum) || global.userSockets.get(String(receiverId));
    if (receiverSockets) {
      receiverSockets.forEach(socketId => {
        io.to(socketId).emit('user-stopped-typing', { userId: socket.userId });
      });
    }
  }));

  // Mark messages as read
  socket.on('mark-read', async ({ fromUserId }) => {
    try {
      if (!socket.userId) return;

      await dbHelper.markMessagesAsRead(socket.userId, fromUserId);
      logger.debug('[MESSAGING] Marked messages as read from:', fromUserId, 'by:', socket.userId);

      // Check if the reader has read receipts enabled (privacy preference)
      const showReadReceipts = await dbHelper.getReadReceiptsPreference(socket.userId);
      if (!showReadReceipts) {
        logger.debug('[MESSAGING] Read receipts disabled for user:', socket.userId);
        return; // Don't notify sender if reader has disabled read receipts
      }

      // Notify the sender that messages were read (try both number and string keys)
      const fromUserIdNum = parseInt(fromUserId);
      const senderSockets = global.userSockets.get(fromUserIdNum) || global.userSockets.get(String(fromUserId));

      if (senderSockets && senderSockets.size > 0) {
        logger.debug('[MESSAGING] Notifying sender of read receipt');
        senderSockets.forEach(socketId => {
          io.to(socketId).emit('messages-read', { readerId: socket.userId });
        });
      }
    } catch (err) {
      logger.error('Mark read error:', err?.message || err, err?.stack);
    }
  });

  // ============================================
  // GROUP CHAT
  // ============================================

  // Join a group chat room
  socket.on('join-group-room', async ({ groupId }) => {
    try {
      if (!socket.userId) {
        socket.emit('group-error', { error: 'Not authenticated' });
        return;
      }

      const groupIdNum = parseInt(groupId);
      if (isNaN(groupIdNum) || groupIdNum <= 0) {
        socket.emit('group-error', { error: 'Invalid group ID' });
        return;
      }

      // Check if user is a member of the group
      const isMember = await dbHelper.isGroupMember(groupIdNum, socket.userId);
      if (!isMember) {
        socket.emit('group-error', { error: 'You are not a member of this group' });
        return;
      }

      const roomName = `group-${groupIdNum}`;
      socket.join(roomName);
      logger.debug(`[GROUP CHAT] User ${socket.userId} joined room ${roomName}`);
      socket.emit('joined-group-room', { groupId: groupIdNum });
    } catch (err) {
      logger.error('[GROUP CHAT] Join room error:', err);
      socket.emit('group-error', { error: 'Failed to join group room' });
    }
  });

  // Leave a group chat room
  socket.on('leave-group-room', ({ groupId }) => {
    const groupIdNum = parseInt(groupId);
    if (!isNaN(groupIdNum)) {
      const roomName = `group-${groupIdNum}`;
      socket.leave(roomName);
      logger.debug(`[GROUP CHAT] User ${socket.userId} left room ${roomName}`);
    }
  });

  // Send a message to a group
  socket.on('send-group-message', async ({ groupId, content }) => {
    // Rate limit check
    const rateCheck = checkRateLimit(socket.id, 'send-message');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'send-group-message',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Sending messages too quickly. Please slow down.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('group-error', { error: 'Not authenticated' });
        return;
      }

      const groupIdNum = parseInt(groupId);
      if (isNaN(groupIdNum) || groupIdNum <= 0) {
        socket.emit('group-error', { error: 'Invalid group ID' });
        return;
      }

      if (!content || content.trim().length === 0) {
        socket.emit('group-error', { error: 'Message content required' });
        return;
      }

      if (content.length > 2000) {
        socket.emit('group-error', { error: 'Message too long' });
        return;
      }

      // Check if user is a member
      const isMember = await dbHelper.isGroupMember(groupIdNum, socket.userId);
      if (!isMember) {
        socket.emit('group-error', { error: 'You are not a member of this group' });
        return;
      }

      // Save message to database
      const message = await dbHelper.createGroupMessage(groupIdNum, socket.userId, content.trim());

      // Get sender info
      const sender = await dbHelper.getUserById(socket.userId);
      const messageWithSenderInfo = {
        ...message,
        sender_username: sender?.username,
        sender_avatar: sender?.avatar,
        sender_avatar_url: sender?.avatar_url
      };

      logger.debug('[GROUP CHAT] Message saved:', { messageId: message.id, groupId: groupIdNum, from: socket.userId });

      const group = await dbHelper.getGroupById(groupIdNum);
      const members = await dbHelper.getGroupMembers(groupIdNum);
      const groupPayload = {
        id: groupIdNum,
        name: group?.name || 'Group',
        avatar: group?.avatar || '👥',
        member_count: members.length,
        last_activity: message.created_at
      };

      // Deliver through user rooms so group lists update even when members have not opened the group room.
      members.forEach(member => {
        io.to(`user:${member.user_id}`).emit('new-group-message', {
          groupId: groupIdNum,
          group: groupPayload,
          message: messageWithSenderInfo
        });
      });
    } catch (err) {
      logger.error('[GROUP CHAT] Send message error:', err);
      socket.emit('group-error', { error: 'Failed to send message' });
    }
  });

  socket.on('toggle-group-message-reaction', async ({ messageId, emoji }) => {
    const rateCheck = checkRateLimit(socket.id, 'toggle-message-reaction');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'toggle-group-message-reaction',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Reacting too quickly. Please slow down.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('group-error', { error: 'Not authenticated' });
        return;
      }

      const result = await dbHelper.toggleGroupMessageReaction(messageId, socket.userId, emoji);
      if (!result.success) {
        socket.emit('group-error', { error: result.error });
        return;
      }

      const members = await dbHelper.getGroupMembers(result.message.group_id);
      const payload = {
        groupId: result.message.group_id,
        messageId: result.message.id,
        emoji: result.emoji,
        action: result.action,
        userId: socket.userId,
        reactions: result.reactions
      };

      members.forEach(member => {
        io.to(`user:${member.user_id}`).emit('group-message-reaction-updated', payload);
      });
    } catch (err) {
      logger.error('[GROUP CHAT] Toggle reaction error:', err);
      socket.emit('group-error', { error: 'Failed to update reaction' });
    }
  });

  // Delete a group message (sender only; soft-delete). Broadcasts to all members.
  socket.on('delete-group-message', async ({ messageId }) => {
    const rateCheck = checkRateLimit(socket.id, 'send-message');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'delete-group-message',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Too many actions. Please slow down.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('group-error', { error: 'Not authenticated' });
        return;
      }

      const result = await dbHelper.deleteGroupMessage(messageId, socket.userId);
      if (!result.success) {
        socket.emit('group-error', { error: result.error });
        return;
      }

      const gId = result.message.group_id;
      const members = await dbHelper.getGroupMembers(gId);
      const payload = {
        groupId: gId,
        messageId: result.message.id,
        lastMessage: result.lastMessage || null
      };

      members.forEach(member => {
        io.to(`user:${member.user_id}`).emit('group-message-deleted', payload);
      });
    } catch (err) {
      logger.error('[GROUP CHAT] Delete message error:', err);
      socket.emit('group-error', { error: 'Failed to delete message' });
    }
  });

  // Group typing indicators
  socket.on('group-typing-start', throttleSocketEvent(socket, 'group-typing-start', THROTTLE_INTERVALS['typing-start'], ({ groupId }) => {
    if (!socket.userId) return;
    const roomName = `group-${groupId}`;
    socket.to(roomName).emit('group-user-typing', { groupId, userId: socket.userId });
  }));

  socket.on('group-typing-stop', throttleSocketEvent(socket, 'group-typing-stop', THROTTLE_INTERVALS['typing-stop'], ({ groupId }) => {
    if (!socket.userId) return;
    const roomName = `group-${groupId}`;
    socket.to(roomName).emit('group-user-stopped-typing', { groupId, userId: socket.userId });
  }));

  // ============================================
  // CHALLENGE SYSTEM
  // ============================================

  // Send a challenge to another user
  socket.on('send-challenge', async ({ challengedId, ranked = false }) => {
    // Rate limit check
    const rateCheck = checkRateLimit(socket.id, 'send-challenge');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'send-challenge',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Too many challenges sent. Please wait before sending more.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('challenge-error', { error: 'Not authenticated' });
        return;
      }

      // Check email verification (required for challenges)
      const emailCheck = await checkEmailVerified(socket.userId);
      if (!emailCheck.verified) {
        socket.emit('challenge-error', {
          error: 'Email verification required',
          emailVerificationRequired: true,
          message: 'Please verify your email address to send challenges.'
        });
        return;
      }

      const challengerId = socket.userId;
      // Normalize challengedId to integer for consistent room lookups
      const normalizedChallengedId = parseInt(challengedId, 10);
      if (isNaN(normalizedChallengedId)) {
        socket.emit('challenge-error', { error: 'Invalid user ID' });
        return;
      }

      // Can't challenge yourself
      if (challengerId === normalizedChallengedId) {
        socket.emit('challenge-error', { error: 'Cannot challenge yourself' });
        return;
      }

      // Check if challenged user exists
      const challengedUser = await dbHelper.getUserById(normalizedChallengedId);
      if (!challengedUser) {
        socket.emit('challenge-error', { error: 'User not found' });
        return;
      }

      // Check if either user has blocked the other
      const isBlocked = await dbHelper.isBlockedEitherWay(challengerId, normalizedChallengedId);
      if (isBlocked) {
        socket.emit('challenge-error', { error: 'Cannot challenge this user' });
        return;
      }

      // Check for existing pending challenge between these users
      const hasPending = await dbHelper.hasPendingChallengeBetween(challengerId, normalizedChallengedId);
      if (hasPending) {
        socket.emit('challenge-error', { error: 'A challenge is already pending between you two' });
        return;
      }

      // Create challenge (expires in 60 seconds)
      const challenge = await dbHelper.createChallenge(challengerId, normalizedChallengedId, 60);

      // Get challenger info for the notification
      const challenger = await dbHelper.getUserById(challengerId);
      const challengerStats = await dbHelper.getUserStats(challengerId);

      const challengeData = {
        id: challenge.id,
        challenger: {
          id: challengerId,
          username: challenger.username,
          avatar: challenger.avatar,
          avatar_url: challenger.avatar_url,
          rating: challengerStats?.rating || 1000,
          wins: challengerStats?.wins || 0,
          losses: challengerStats?.losses || 0
        },
        ranked: ranked === true,
        expires_at: challenge.expires_at
      };

      // Check if challenged user is online via room membership
      const roomName = `user:${normalizedChallengedId}`;
      const challengedSockets = await io.in(roomName).fetchSockets();
      logger.debug(`[CHALLENGE] Room ${roomName} has ${challengedSockets.length} socket(s)`);

      if (challengedSockets.length > 0) {
        // Notify the challenged user via their user room
        io.to(roomName).emit('challenge-received', challengeData);
        logger.debug(`[CHALLENGE] Emitted challenge-received to room ${roomName}`);

        // Store ranked preference for when challenge is accepted
        if (!global.challengeMetadata) global.challengeMetadata = new Map();
        global.challengeMetadata.set(challenge.id, { ranked: ranked === true });

        socket.emit('challenge-sent', {
          challengeId: challenge.id,
          challenged: {
            id: normalizedChallengedId,
            username: challengedUser.username,
            avatar: challengedUser.avatar,
            avatar_url: challengedUser.avatar_url
          },
          ranked: ranked === true,
          expires_at: challenge.expires_at
        });
        logger.info(`[CHALLENGE] ${challenge.id}: ${challenger.username} (${challengerId}) -> ${challengedUser.username} (${normalizedChallengedId})`);
      } else {
        // User is offline
        await dbHelper.updateChallengeStatus(challenge.id, 'expired');
        logger.debug(`[CHALLENGE] User ${normalizedChallengedId} is offline (no sockets in room ${roomName})`);
        socket.emit('challenge-error', { error: 'User is offline' });
      }
    } catch (err) {
      logger.error('Send challenge error:', err);
      socket.emit('challenge-error', { error: 'Failed to send challenge' });
    }
  });

  // Accept a challenge
  socket.on('accept-challenge', async ({ challengeId }) => {
    try {
      if (!socket.userId) {
        socket.emit('challenge-error', { error: 'Not authenticated' });
        return;
      }

      const challenge = await dbHelper.getChallengeById(challengeId);
      if (!challenge) {
        socket.emit('challenge-error', { error: 'Challenge not found' });
        return;
      }

      // Verify this user is the challenged one (use String comparison for type safety)
      if (String(challenge.challenged_id) !== String(socket.userId)) {
        socket.emit('challenge-error', { error: 'This challenge is not for you' });
        return;
      }

      // Check if still pending and not expired
      if (challenge.status !== 'pending') {
        socket.emit('challenge-error', { error: 'Challenge is no longer pending' });
        return;
      }

      if (new Date(challenge.expires_at) < new Date()) {
        await dbHelper.updateChallengeStatus(challengeId, 'expired');
        socket.emit('challenge-error', { error: 'Challenge has expired' });
        return;
      }

      // Generate battle ID and update challenge
      const battleId = `challenge-${challengeId}-${Date.now()}`;
      // M7 fix: this is an atomic compare-and-swap on (challenge.status = 'pending').
      // If another concurrent accept (or a cancel/decline/expire) raced us,
      // `changed` will be false and we MUST abort before creating a battle,
      // otherwise both racers would create duplicate battles for the same challenge.
      const updateResult = await dbHelper.updateChallengeStatus(challengeId, 'accepted', battleId);
      if (!updateResult || !updateResult.changed) {
        logger.warn(`[CHALLENGE] Accept race lost for challenge ${challengeId} by user ${socket.userId}`);
        socket.emit('challenge-error', { error: 'Challenge no longer available' });
        return;
      }

      // Get a rating-appropriate problem for the battle
      const [challengerStats, challengedStats] = await Promise.all([
        dbHelper.getUserStats(challenge.challenger_id),
        dbHelper.getUserStats(challenge.challenged_id)
      ]);
      const challengeAvgRating = Math.floor(
        ((challengerStats?.rating || 1000) + (challengedStats?.rating || 1000)) / 2
      );
      const problem = getRandomProblem(null, challengeAvgRating);

      // Create player IDs for both players
      const challengerPlayerId = uuidv4();
      const challengedPlayerId = uuidv4();

      // Check if this challenge was ranked (use both number and original key for robustness)
      const challengeIdNum = typeof challengeId === 'number' ? challengeId : parseInt(challengeId, 10);
      const metadata = global.challengeMetadata?.get(challengeIdNum) || global.challengeMetadata?.get(challengeId) || {};
      const isRanked = metadata.ranked === true;
      // Clean up metadata
      if (global.challengeMetadata) {
        global.challengeMetadata.delete(challengeIdNum);
        global.challengeMetadata.delete(challengeId);
      }

      // Create the actual battle object
      const battle = {
        id: battleId,
        problem: problem,
        players: [
          {
            id: challengerPlayerId,
            name: sanitizePlayerName(challenge.challenger_username),
            userId: challenge.challenger_id,
            socketId: null,
            ready: false,
            code: '',
            language: 'python',
            submitted: false,
            submittedAt: null
          },
          {
            id: challengedPlayerId,
            name: sanitizePlayerName(challenge.challenged_username),
            userId: challenge.challenged_id,
            socketId: null,
            ready: false,
            code: '',
            language: 'python',
            submitted: false,
            submittedAt: null
          }
        ],
        state: 'waiting',
        createdAt: Date.now(),
        timeLimit: 600, // 10 minutes for challenge battles
        isChallengeBattle: true,
        matchmade: isRanked,
        ranked: isRanked
      };

      // Add battle to the battles Map
      battles.set(battleId, battle);

      // Notify both users to join the battle with their player IDs
      const battleData = {
        battleId,
        challengeId,
        challengerPlayerId,
        challengedPlayerId,
        challenger: {
          id: challenge.challenger_id,
          username: challenge.challenger_username,
          avatar: challenge.challenger_avatar,
          avatar_url: challenge.challenger_avatar_url
        },
        challenged: {
          id: challenge.challenged_id,
          username: challenge.challenged_username,
          avatar: challenge.challenged_avatar,
          avatar_url: challenge.challenged_avatar_url
        }
      };

      // Notify BOTH users via room-based delivery for reliability
      // Room delivery works even if socket references are stale from async operations
      io.to(`user:${challenge.challenger_id}`).emit('challenge-accepted', battleData);
      io.to(`user:${challenge.challenged_id}`).emit('challenge-accepted', battleData);
      logger.info(`[CHALLENGE] ${challengeId} accepted, battle ${battleId} created. Notified rooms user:${challenge.challenger_id} and user:${challenge.challenged_id}`);
    } catch (err) {
      logger.error('Accept challenge error:', err);
      socket.emit('challenge-error', { error: 'Failed to accept challenge' });
    }
  });

  // Decline a challenge
  socket.on('decline-challenge', async ({ challengeId }) => {
    try {
      if (!socket.userId) return;

      const challenge = await dbHelper.getChallengeById(challengeId);
      // Use String comparison to handle both number and string userId
      if (!challenge || String(challenge.challenged_id) !== String(socket.userId)) {
        return;
      }

      if (challenge.status !== 'pending') {
        return;
      }

      await dbHelper.updateChallengeStatus(challengeId, 'declined');

      // Notify challenger via user room
      io.to(`user:${challenge.challenger_id}`).emit('challenge-declined', {
        challengeId,
        declined_by: {
          id: socket.userId,
          username: challenge.challenged_username
        }
      });

      logger.info(`Challenge ${challengeId} declined by ${challenge.challenged_username}`);
    } catch (err) {
      logger.error('Decline challenge error:', err);
    }
  });

  // Cancel a challenge (by challenger)
  socket.on('cancel-challenge', async ({ challengeId }) => {
    try {
      if (!socket.userId) return;

      const challenge = await dbHelper.getChallengeById(challengeId);
      // Use String comparison to handle both number and string userId
      if (!challenge || String(challenge.challenger_id) !== String(socket.userId)) {
        return;
      }

      if (challenge.status !== 'pending') {
        return;
      }

      await dbHelper.updateChallengeStatus(challengeId, 'cancelled');

      // Notify challenged user via user room
      io.to(`user:${challenge.challenged_id}`).emit('challenge-cancelled', { challengeId });

      socket.emit('challenge-cancelled', { challengeId });
      logger.info(`Challenge ${challengeId} cancelled by ${challenge.challenger_username}`);
    } catch (err) {
      logger.error('Cancel challenge error:', err);
    }
  });

  // ============================================
  // FRIENDS SYSTEM
  // ============================================

  // Send a friend request
  socket.on('send-friend-request', async ({ targetUserId }) => {
    // Rate limit check
    const rateCheck = checkRateLimit(socket.id, 'send-friend-request');
    if (!rateCheck.allowed) {
      socket.emit('rate-limit-exceeded', {
        event: 'send-friend-request',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
        message: 'Too many friend requests. Please wait before sending more.'
      });
      return;
    }

    try {
      if (!socket.userId) {
        socket.emit('friend-request-error', { error: 'Not authenticated' });
        return;
      }

      // Check email verification (required for friend requests)
      const emailCheck = await checkEmailVerified(socket.userId);
      if (!emailCheck.verified) {
        socket.emit('friend-request-error', {
          error: 'Email verification required',
          emailVerificationRequired: true,
          message: 'Please verify your email address to send friend requests.'
        });
        return;
      }

      const requesterId = socket.userId;
      const targetUserIdNum = parseInt(targetUserId, 10);
      if (isNaN(targetUserIdNum) || targetUserIdNum <= 0) {
        socket.emit('friend-request-error', { error: 'Invalid user ID' });
        return;
      }

      // Can't friend yourself
      if (requesterId === targetUserIdNum) {
        socket.emit('friend-request-error', { error: 'Cannot send friend request to yourself' });
        return;
      }

      // Check if target user exists
      const targetUser = await dbHelper.getUserById(targetUserIdNum);
      if (!targetUser) {
        socket.emit('friend-request-error', { error: 'User not found' });
        return;
      }

      // Check if either user has blocked the other
      const isBlocked = await dbHelper.isBlockedEitherWay(requesterId, targetUserIdNum);
      if (isBlocked) {
        socket.emit('friend-request-error', { error: 'Cannot send friend request to this user' });
        return;
      }

      // Send the friend request
      const request = await dbHelper.sendFriendRequest(requesterId, targetUserIdNum);

      // Get requester info for the notification
      const requester = await dbHelper.getUserById(requesterId);
      const requesterStats = await dbHelper.getUserStats(requesterId);

      const requestData = {
        id: request.id,
        requester: {
          id: requesterId,
          username: requester.username,
          avatar: requester.avatar,
          avatar_url: requester.avatar_url,
          rating: requesterStats?.rating || 1000,
          wins: requesterStats?.wins || 0,
          losses: requesterStats?.losses || 0
        },
        created_at: request.created_at
      };

      // Notify the target user
      const targetSockets = global.userSockets.get(targetUserIdNum);
      if (targetSockets && targetSockets.size > 0) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('friend-request-received', requestData);
        });
      }
      // Persistent notification
      dbHelper.createNotification(targetUserIdNum, {
        type: 'friend_request',
        title: `${requester?.username || 'Someone'} sent you a friend request`,
        link: '/friends'
      }).catch(() => {});

      // Confirm to sender
      socket.emit('friend-request-sent', {
        requestId: request.id,
        targetUser: {
          id: targetUserIdNum,
          username: targetUser.username,
          avatar: targetUser.avatar,
          avatar_url: targetUser.avatar_url
        }
      });

      logger.info(`Friend request ${request.id}: ${requester.username} -> ${targetUser.username}`);
    } catch (err) {
      logger.error('Send friend request error:', err);
      socket.emit('friend-request-error', { error: err.message || 'Failed to send friend request' });
    }
  });

  // Accept a friend request
  socket.on('accept-friend-request', async ({ requestId }) => {
    try {
      if (!socket.userId) {
        socket.emit('friend-request-error', { error: 'Not authenticated' });
        return;
      }

      const result = await dbHelper.acceptFriendRequest(requestId, socket.userId);

      // Get user info for notifications
      const accepter = await dbHelper.getUserById(socket.userId);
      const requester = await dbHelper.getUserById(result.requesterId);
      const accepterStats = await dbHelper.getUserStats(socket.userId);

      // Notify the original requester
      const requesterSockets = global.userSockets.get(result.requesterId);
      if (requesterSockets && requesterSockets.size > 0) {
        requesterSockets.forEach(socketId => {
          io.to(socketId).emit('friend-request-accepted', {
            requestId,
            friend: {
              id: socket.userId,
              username: accepter.username,
              avatar: accepter.avatar,
              avatar_url: accepter.avatar_url,
              rating: accepterStats?.rating || 1000,
              wins: accepterStats?.wins || 0,
              losses: accepterStats?.losses || 0
            }
          });
        });
      }
      // Persistent notification for requester
      dbHelper.createNotification(result.requesterId, {
        type: 'friend_request',
        title: `${accepter?.username || 'Someone'} accepted your friend request`,
        link: '/friends'
      }).catch(() => {});

      // Confirm to accepter
      const requesterStatsData = await dbHelper.getUserStats(result.requesterId);
      socket.emit('friend-request-accepted', {
        requestId,
        friend: {
          id: result.requesterId,
          username: requester.username,
          avatar: requester.avatar,
          avatar_url: requester.avatar_url,
          rating: requesterStatsData?.rating || 1000,
          wins: requesterStatsData?.wins || 0,
          losses: requesterStatsData?.losses || 0
        }
      });

      logger.info(`Friend request ${requestId} accepted: ${requester.username} <-> ${accepter.username}`);
    } catch (err) {
      logger.error('Accept friend request error:', err);
      socket.emit('friend-request-error', { error: err.message || 'Failed to accept friend request' });
    }
  });

  // Decline a friend request
  socket.on('decline-friend-request', async ({ requestId }) => {
    try {
      if (!socket.userId) return;

      const result = await dbHelper.declineFriendRequest(requestId, socket.userId);
      const decliner = await dbHelper.getUserById(socket.userId);

      // Notify the original requester
      const requesterSockets = global.userSockets.get(result.requesterId);
      if (requesterSockets && requesterSockets.size > 0) {
        requesterSockets.forEach(socketId => {
          io.to(socketId).emit('friend-request-declined', {
            requestId,
            declined_by: {
              id: socket.userId,
              username: decliner.username
            }
          });
        });
      }

      // Confirm to decliner
      socket.emit('friend-request-declined', { requestId });

      logger.info(`Friend request ${requestId} declined by ${decliner.username}`);
    } catch (err) {
      logger.error('Decline friend request error:', err);
      socket.emit('friend-request-error', { error: err.message || 'Failed to decline friend request' });
    }
  });

  // Cancel a sent friend request
  socket.on('cancel-friend-request', async ({ requestId }) => {
    try {
      if (!socket.userId) return;

      const result = await dbHelper.cancelFriendRequest(requestId, socket.userId);

      // Notify the target user that request was cancelled
      const targetSockets = global.userSockets.get(result.requestedId);
      if (targetSockets && targetSockets.size > 0) {
        targetSockets.forEach(socketId => {
          io.to(socketId).emit('friend-request-cancelled', { requestId });
        });
      }

      // Confirm to canceller
      socket.emit('friend-request-cancelled', { requestId });

      logger.info(`Friend request ${requestId} cancelled`);
    } catch (err) {
      logger.error('Cancel friend request error:', err);
      socket.emit('friend-request-error', { error: err.message || 'Failed to cancel friend request' });
    }
  });

  // Remove a friend
  socket.on('remove-friend', async ({ friendId }) => {
    try {
      if (!socket.userId) return;

      await dbHelper.removeFriend(socket.userId, friendId);

      const user = await dbHelper.getUserById(socket.userId);

      // Notify the removed friend
      const friendSockets = global.userSockets.get(friendId);
      if (friendSockets && friendSockets.size > 0) {
        friendSockets.forEach(socketId => {
          io.to(socketId).emit('friend-removed', {
            userId: socket.userId,
            username: user.username
          });
        });
      }

      // Confirm to remover
      socket.emit('friend-removed', { userId: friendId });

      logger.info(`${user.username} removed friend ${friendId}`);
    } catch (err) {
      logger.error('Remove friend error:', err);
      socket.emit('friend-request-error', { error: err.message || 'Failed to remove friend' });
    }
  });

  // ============================================
  // TOURNAMENT SOCKET EVENTS
  // ============================================

  // Join tournament room for real-time updates
  socket.on('join-tournament-room', ({ tournamentId }) => {
    if (!tournamentId) return;
    const roomName = `tournament-${tournamentId}`;
    socket.join(roomName);
    logger.debug(`Socket ${socket.id} joined tournament room ${roomName}`);
  });

  // Leave tournament room
  socket.on('leave-tournament-room', ({ tournamentId }) => {
    if (!tournamentId) return;
    const roomName = `tournament-${tournamentId}`;
    socket.leave(roomName);
    logger.debug(`Socket ${socket.id} left tournament room ${roomName}`);
  });

  // Player ready for tournament match
  socket.on('tournament-match-ready', async ({ matchId, tournamentId }) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.emit('tournament-error', { error: 'Not authenticated' });
        return;
      }

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      // Get match details FIRST so we can verify the caller is one of the two
      // listed players. Previously this handler added any authenticated caller
      // to the ready set, letting a third party know matchId trigger the
      // match-ready state for someone else's tournament match.
      const match = await dbHelper.getTournamentMatch(matchId);
      if (!match) {
        socket.emit('tournament-error', { error: 'Match not found' });
        return;
      }

      // Caller must be one of the two matched players.
      if (String(match.player1_id) !== String(userId) && String(match.player2_id) !== String(userId)) {
        logger.warn(`[Tournament] tournament-match-ready: user ${userId} is not a participant in match ${matchId}`);
        socket.emit('tournament-error', { error: 'You are not a participant in this match' });
        return;
      }

      // Match must be in a state where readying up is meaningful, i.e. not
      // already completed or cancelled.
      if (match.status && !['pending', 'ready', 'in_progress'].includes(match.status)) {
        socket.emit('tournament-error', { error: `Match cannot be readied (status: ${match.status})` });
        return;
      }

      // Match's tournament_id must match the client-supplied tournamentId so
      // a caller can't pretend a match belongs to a different bracket.
      if (String(match.tournament_id) !== String(tournamentId)) {
        socket.emit('tournament-error', { error: 'Match does not belong to this tournament' });
        return;
      }

      // Store ready status with timestamp for cleanup
      if (!global.tournamentMatchReady) {
        global.tournamentMatchReady = new Map();
      }

      const matchKey = `match-${matchId}`;
      if (!global.tournamentMatchReady.has(matchKey)) {
        global.tournamentMatchReady.set(matchKey, { players: new Set(), createdAt: Date.now() });
      }

      global.tournamentMatchReady.get(matchKey).players.add(userId);

      // Round synchronization: all matches in the previous round must be complete
      // before any match in the next round can begin
      if (match.round > 1) {
        const pendingPrev = await dbHelper.getPendingMatchCountInRound(match.tournament_id, match.round - 1);
        if (pendingPrev > 0) {
          socket.emit('tournament-error', {
            error: 'Cannot start yet, waiting for all matches in the previous round to finish.'
          });
          return;
        }
      }

      const readyData = global.tournamentMatchReady.get(matchKey);
      const readyPlayers = readyData.players;
      const bothReady = readyPlayers.has(match.player1_id) && readyPlayers.has(match.player2_id);

      // Broadcast ready status to tournament room
      const roomName = `tournament-${tournamentId}`;
      io.to(roomName).emit('tournament-match-ready-update', {
        matchId,
        readyPlayers: Array.from(readyPlayers),
        bothReady
      });

      // If both players ready, start the match
      if (bothReady) {
        // Generate a battle for this match
        const battleId = `tournament-${tournamentId}-match-${matchId}-${Date.now()}`;

        // Use average player rating for difficulty selection
        const [p1Stats, p2Stats] = await Promise.all([
          dbHelper.getUserStats(match.player1_id),
          dbHelper.getUserStats(match.player2_id)
        ]);
        const tourneyAvgRating = Math.floor(((p1Stats?.rating || 1000) + (p2Stats?.rating || 1000)) / 2);
        const problem = getRandomProblem(null, tourneyAvgRating);

        // Create battle
        const battle = {
          id: battleId,
          problem: problem,
          players: [
            {
              id: `player-${match.player1_id}`,
              name: match.player1_username,
              ready: true,
              language: match.player1_language || 'python',
              socketId: null,
              code: '',
              testResults: []
            },
            {
              id: `player-${match.player2_id}`,
              name: match.player2_username,
              ready: true,
              language: match.player2_language || 'python',
              socketId: null,
              code: '',
              testResults: []
            }
          ],
          state: 'waiting',
          createdAt: Date.now(),
          startedAt: null,
          timeLimit: 600, // 10 minutes (in seconds; matches all other battle creation sites and the timer sweep at ~line 3596)
          isTournament: true,
          tournamentId,
          matchId
        };

        evictOldBattlesIfNeeded();
        battles.set(battleId, battle);

        // Update match in database
        await dbHelper.startTournamentMatch(matchId, battleId, problem.id);

        // Clear ready status
        global.tournamentMatchReady.delete(matchKey);

        // Notify both players
        io.to(roomName).emit('tournament-match-started', {
          matchId,
          battleId,
          player1Id: match.player1_id,
          player2Id: match.player2_id
        });

        logger.info(`Tournament match ${matchId} started: battle ${battleId}`);
      }
    } catch (err) {
      logger.error('Tournament match ready error:', err);
      socket.emit('tournament-error', { error: 'Failed to ready up' });
    }
  });

  // =====================================================
  // AGENT BATTLES - Matchmaking for AI agent battles
  // =====================================================

  if (AGENT_PRODUCT_ENABLED) {

  // Agent queue data structure (at module level, but we'll track per socket)
  if (!global.agentMatchmakingQueue) {
    global.agentMatchmakingQueue = new Map();
  }

  // Matchmaking locks to prevent double-matching
  if (!global.agentMatchmakingLocks) {
    global.agentMatchmakingLocks = new Set();
  }

  // Rematch locks to prevent duplicate rematch battles
  if (!global.agentRematchLocks) {
    global.agentRematchLocks = new Set();
  }

  // Timer tracking for cleanup on shutdown (Medium #9 fix)
  if (!global.agentCleanupTimers) {
    global.agentCleanupTimers = new Map(); // battleId -> timerId
  }

  // =====================================================
  // AGENT BATTLE MEMORY MANAGEMENT - Cleanup intervals
  // =====================================================

  // Constants for agent battle cleanup
  const MAX_AGENT_BATTLES = 500; // Max active agent battles
  const MAX_SPECTATORS_PER_BATTLE = 100; // Max spectators per battle to prevent unbounded growth
  const AGENT_BATTLE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes max lifetime
  const AGENT_QUEUE_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes idle timeout
  const AGENT_LOCK_ORPHAN_TIMEOUT_MS = 30 * 1000; // 30 seconds for orphaned locks
  const AGENT_CLEANUP_INTERVAL_MS = 60 * 1000; // Run cleanup every minute

  // Initialize cleanup tracking
  if (!global.agentLockTimestamps) {
    global.agentLockTimestamps = new Map(); // userId -> timestamp when lock was acquired
  }
  if (!global.agentQueueTimestamps) {
    global.agentQueueTimestamps = new Map(); // userId -> timestamp when joined queue
  }

  // Cleanup function for agent battles
  function cleanupAgentBattles() {
    try {
      if (!global.agentBattles) return;

      const now = Date.now();
      let cleanedCount = 0;

      for (const [battleId, battle] of global.agentBattles.entries()) {
        const age = now - (battle.createdAt || 0);
        let shouldDelete = false;

        // 1. Finished battles older than 5 minutes
        if (battle.state === 'finished' && age > 5 * 60 * 1000) {
          shouldDelete = true;
        }
        // 2. Any battle older than max age
        else if (age > AGENT_BATTLE_MAX_AGE_MS) {
          shouldDelete = true;
        }

        if (shouldDelete) {
          global.agentBattles.delete(battleId);
          global.agentRematchRequests?.delete(battleId);
          global.agentCleanupTimers?.delete(battleId);
          cleanedCount++;
        }
      }

      // Evict oldest finished if still over capacity
      if (global.agentBattles.size > MAX_AGENT_BATTLES) {
        const finishedBattles = [];
        for (const [id, battle] of global.agentBattles.entries()) {
          if (battle.state === 'finished') {
            finishedBattles.push({ id, createdAt: battle.createdAt || 0 });
          }
        }
        finishedBattles.sort((a, b) => a.createdAt - b.createdAt);
        const toDelete = Math.min(finishedBattles.length, global.agentBattles.size - MAX_AGENT_BATTLES + 50);
        for (let i = 0; i < toDelete; i++) {
          global.agentBattles.delete(finishedBattles[i].id);
          global.agentRematchRequests?.delete(finishedBattles[i].id);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`[Agent Cleanup] Removed ${cleanedCount} agent battles. Remaining: ${global.agentBattles.size}`);
      }
    } catch (error) {
      logger.error('[Agent Cleanup] Error cleaning agent battles:', error);
    }
  }

  // Cleanup function for agent queue (idle timeout)
  function cleanupAgentQueue() {
    try {
      if (!global.agentMatchmakingQueue) return;

      const now = Date.now();
      let cleanedCount = 0;

      for (const [odlUserId, entry] of global.agentMatchmakingQueue.entries()) {
        const joinedAt = global.agentQueueTimestamps?.get(odlUserId) || entry.joinedAt || 0;
        if (now - joinedAt > AGENT_QUEUE_IDLE_TIMEOUT_MS) {
          // Bug 4 follow-up: refund the held reservation on idle timeout.
          if (entry.reservationId) {
            releaseReservation(entry.reservationId).catch(refundErr => {
              logger.warn(`[Agent Cleanup] releaseReservation failed for idle user=${odlUserId}: ${refundErr.message}`);
            });
          }
          global.agentMatchmakingQueue.delete(odlUserId);
          global.agentQueueTimestamps?.delete(odlUserId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`[Agent Cleanup] Removed ${cleanedCount} idle queue entries. Remaining: ${global.agentMatchmakingQueue.size}`);
      }
    } catch (error) {
      logger.error('[Agent Cleanup] Error cleaning agent queue:', error);
    }
  }

  // Cleanup function for orphaned matchmaking locks
  function cleanupAgentLocks() {
    try {
      if (!global.agentMatchmakingLocks || !global.agentLockTimestamps) return;

      const now = Date.now();
      let cleanedCount = 0;

      for (const userId of global.agentMatchmakingLocks) {
        const lockTime = global.agentLockTimestamps.get(userId) || 0;
        if (lockTime > 0 && now - lockTime > AGENT_LOCK_ORPHAN_TIMEOUT_MS) {
          global.agentMatchmakingLocks.delete(userId);
          global.agentLockTimestamps.delete(userId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`[Agent Cleanup] Removed ${cleanedCount} orphaned locks`);
      }
    } catch (error) {
      logger.error('[Agent Cleanup] Error cleaning agent locks:', error);
    }
  }

  // Cleanup function for expired rate limit entries in database
  async function cleanupRateLimits() {
    try {
      const deletedCount = await cleanupExpiredRateLimits();
      if (deletedCount > 0) {
        logger.info(`[Agent Cleanup] Purged ${deletedCount} expired rate limit entries`);
      }
    } catch (error) {
      logger.error('[Agent Cleanup] Error cleaning rate limits:', error);
    }
  }

  // Combined cleanup function
  function runAgentCleanup() {
    cleanupAgentBattles();
    cleanupAgentQueue();
    cleanupAgentLocks();
    cleanupRateLimits();
  }

  // Start cleanup interval (only once per server, not per socket)
  if (!global.agentCleanupIntervalStarted) {
    global.agentCleanupIntervalStarted = true;
    setInterval(runAgentCleanup, AGENT_CLEANUP_INTERVAL_MS);
    // Run once after 30 seconds to clean up any stale data from previous session
    setTimeout(runAgentCleanup, 30000);
    logger.info('[Agent Cleanup] Memory management cleanup interval started');
  }

  // Join agent battle queue
  socket.on('join-agent-queue', async ({ loadout, loadoutId, preferences }) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.emit('agent-queue-error', { error: 'Not authenticated' });
        return;
      }

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      // Get user info
      const user = await dbHelper.getUserById(userId);
      if (!user) {
        socket.emit('agent-queue-error', { error: 'User not found' });
        return;
      }

      // Check if user is banned from agent battles
      const ban = await dbHelper.get(
        `SELECT * FROM agent_battle_bans
         WHERE user_id = ? AND banned_until > datetime('now')
         ORDER BY banned_until DESC
         LIMIT 1`,
        [userId]
      );

      if (ban) {
        const bannedUntil = new Date(ban.banned_until);
        const hoursRemaining = Math.ceil((bannedUntil - new Date()) / (1000 * 60 * 60));
        socket.emit('agent-queue-error', {
          error: `You are temporarily banned from agent battles. Reason: ${ban.reason}. Ban expires in ${hoursRemaining} hour${hoursRemaining !== 1 ? 's' : ''}.`
        });
        return;
      }

      // Validate and sanitize preferences
      const sanitizedPreferences = {
        modelPreference: preferences?.modelPreference || 'any',
        eloRange: preferences?.eloRange || 'any',
        customEloMin: preferences?.customEloMin || null,
        customEloMax: preferences?.customEloMax || null,
        difficulty: preferences?.difficulty || 'any'
      };

      // Security: Validate preference values
      const validModelPreferences = ['any', 'same-model-only', 'haiku', 'sonnet', 'opus'];
      const validEloRanges = ['any', 'similar', 'custom'];
      const validDifficulties = ['any', 'easy', 'medium', 'hard'];

      if (!validModelPreferences.includes(sanitizedPreferences.modelPreference)) {
        socket.emit('agent-queue-error', { error: 'Invalid model preference' });
        return;
      }

      if (!validEloRanges.includes(sanitizedPreferences.eloRange)) {
        socket.emit('agent-queue-error', { error: 'Invalid ELO range preference' });
        return;
      }

      if (!validDifficulties.includes(sanitizedPreferences.difficulty)) {
        socket.emit('agent-queue-error', { error: 'Invalid difficulty preference' });
        return;
      }

      // Validate custom ELO range if specified
      if (sanitizedPreferences.eloRange === 'custom') {
        if (typeof sanitizedPreferences.customEloMin !== 'number' ||
            typeof sanitizedPreferences.customEloMax !== 'number' ||
            sanitizedPreferences.customEloMin < 0 ||
            sanitizedPreferences.customEloMax > 3000 ||
            sanitizedPreferences.customEloMin >= sanitizedPreferences.customEloMax) {
          socket.emit('agent-queue-error', { error: 'Invalid custom ELO range' });
          return;
        }
      }

      // Check rate limit (pass model for model-specific limits)
      const isPro = await dbHelper.isUserPro(userId);
      const model = loadout?.model || 'sonnet'; // Default to sonnet if not specified
      const rateLimitResult = await checkAgentBattleRateLimit(userId, isPro, model);

      if (!rateLimitResult.allowed) {
        const errorMessage = rateLimitResult.modelLimit
          ? `${rateLimitResult.modelLimit.charAt(0).toUpperCase() + rateLimitResult.modelLimit.slice(1)} model limit exceeded. ${isPro ? 'Pro' : 'Free'} users can create ${rateLimitResult.limit} ${rateLimitResult.modelLimit} battles per hour. Please try again in ${rateLimitResult.minutesUntilReset} minute${rateLimitResult.minutesUntilReset !== 1 ? 's' : ''}.`
          : `Rate limit exceeded. ${isPro ? 'Pro' : 'Free'} users can create ${rateLimitResult.limit} agent battles per hour. Please try again in ${rateLimitResult.minutesUntilReset} minute${rateLimitResult.minutesUntilReset !== 1 ? 's' : ''}.`;

        socket.emit('agent-queue-error', {
          error: errorMessage,
          rateLimitExceeded: true,
          limit: rateLimitResult.limit,
          remaining: 0,
          resetTime: rateLimitResult.resetTime,
          minutesUntilReset: rateLimitResult.minutesUntilReset,
          modelLimit: rateLimitResult.modelLimit
        });
        logger.warn(`[Agent Queue] Rate limit exceeded for user ${userId} (${isPro ? 'Pro' : 'Free'}) - ${rateLimitResult.modelLimit ? `${rateLimitResult.modelLimit} model` : 'overall'}`);
        return;
      }

      // M8 fix: atomically check + commit spend at admission (closes the TOCTOU
      // window where N concurrent joins could each pass a read-only check).
      // Cost is committed inside reserveSpending; we drop the redundant
      // recordSpending at battle completion to avoid double-charging.
      const spendingResult = await reserveSpending(userId, loadout?.model, isPro);
      if (!spendingResult.ok) {
        socket.emit('agent-queue-error', {
          error: spendingResult.reason,
          spendingLimitExceeded: true,
          dailySpend: spendingResult.dailySpend,
          dailyLimit: spendingResult.dailyLimit,
          monthlySpend: spendingResult.monthlySpend,
          monthlyLimit: spendingResult.monthlyLimit
        });
        logger.warn(`[Agent Queue] Spending limit exceeded for user ${userId}: ${spendingResult.reason}`);
        return;
      }

      // Bug 4 follow-up: refund the just-committed reservation on every
      // abandonment path between here and queue admission (invalid loadout,
      // already-in-battle, etc.). Ownership transfers to queueEntry once we
      // successfully queue.set; from that point downstream handlers (leave,
      // disconnect, idle sweep) refund via the entry's reservationId.
      let pendingReservationId = spendingResult.reservationId;
      try {

      // Check if user is already being matched
      if (global.agentMatchmakingLocks.has(userId)) {
        socket.emit('agent-queue-error', { error: 'Already matching with another player' });
        logger.warn(`[Agent Queue] User ${userId} tried to join queue while already being matched`);
        return;
      }

      // Check if user is already in an active battle
      if (global.agentBattles) {
        for (const [battleId, battle] of global.agentBattles.entries()) {
          if ((battle.state === 'matched' || battle.state === 'running') &&
              battle.players.some(p => p.userId === userId)) {
            socket.emit('agent-queue-error', { error: 'Already in an active battle' });
            logger.warn(`[Agent Queue] User ${userId} tried to join queue while in battle ${battleId}`);
            return;
          }
        }
      }

      // Security: Validate loadout configuration
      if (!loadout || !loadout.model || !loadout.language) {
        socket.emit('agent-queue-error', { error: 'Invalid loadout configuration' });
        return;
      }

      // Security: Validate model
      const validModels = ['haiku', 'sonnet', 'opus'];
      if (!validModels.includes(loadout.model.toLowerCase())) {
        socket.emit('agent-queue-error', { error: 'Invalid model' });
        return;
      }

      // Security: Validate language
      const validLanguages = ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'sql'];
      if (!validLanguages.includes(loadout.language.toLowerCase())) {
        socket.emit('agent-queue-error', { error: 'Invalid language' });
        return;
      }

      // Security: Validate system prompt length
      if (loadout.systemPrompt && loadout.systemPrompt.length > 2000) {
        socket.emit('agent-queue-error', { error: 'System prompt too long (max 2000 chars)' });
        return;
      }

      // Security: Validate and sanitize tools
      const validTools = ['run_code', 'auto_retry', 'docs_lookup'];
      let sanitizedTools = [];
      if (Array.isArray(loadout.tools)) {
        sanitizedTools = loadout.tools.filter(t => typeof t === 'string' && validTools.includes(t)).slice(0, 2);
      }

      let dbLoadoutId = loadoutId;
      let activeVersionId = null;

      // If loadoutId is provided, verify it exists and belongs to user
      if (loadoutId) {
        const existingLoadout = await dbHelper.get(
          'SELECT id, elo FROM agent_loadouts WHERE id = ? AND user_id = ?',
          [loadoutId, userId]
        );

        if (!existingLoadout) {
          socket.emit('agent-queue-error', { error: 'Loadout not found or does not belong to you' });
          return;
        }

        // Get the active version for this loadout
        const activeVersion = await dbHelper.get(
          'SELECT id FROM agent_loadout_versions WHERE loadout_id = ? AND is_active = 1',
          [loadoutId]
        );
        activeVersionId = activeVersion?.id || null;
      } else {
        // No loadoutId provided, create a temporary loadout in the database
        dbLoadoutId = uuidv4();

        try {
          await dbHelper.run(
            `INSERT INTO agent_loadouts (id, user_id, name, model, system_prompt, language, tools, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [
              dbLoadoutId,
              userId,
              `Temp Loadout ${Date.now()}`,
              loadout.model.toLowerCase(),
              loadout.systemPrompt || '',
              loadout.language.toLowerCase(),
              JSON.stringify(sanitizedTools)
            ]
          );

          // Create version 1 for this temporary loadout
          activeVersionId = uuidv4();
          await dbHelper.run(
            `INSERT INTO agent_loadout_versions (id, loadout_id, version_number, system_prompt, model, language, tools, is_active, created_at)
             VALUES (?, ?, 1, ?, ?, ?, ?, 1, datetime('now'))`,
            [
              activeVersionId,
              dbLoadoutId,
              loadout.systemPrompt || '',
              loadout.model.toLowerCase(),
              loadout.language.toLowerCase(),
              JSON.stringify(sanitizedTools)
            ]
          );
          logger.info(`[Agent Queue] Created temporary loadout ${dbLoadoutId} with version ${activeVersionId} for user ${userId}`);
        } catch (dbErr) {
          logger.error(`[Agent Queue] Failed to create loadout: ${dbErr.message}`, dbErr);
          socket.emit('agent-queue-error', { error: `Failed to save loadout: ${dbErr.message}` });
          return;
        }
      }

      // Get loadout ELO for matchmaking
      const loadoutData = await dbHelper.get(
        'SELECT elo FROM agent_loadouts WHERE id = ?',
        [dbLoadoutId]
      );
      const loadoutElo = loadoutData?.elo || 1000;

      // Add to queue with real database loadout ID and sanitized values
      const queueEntry = {
        loadoutId: dbLoadoutId,
        versionId: activeVersionId,
        socketId: socket.id,
        userId,
        username: user.username,
        loadout: {
          model: loadout.model.toLowerCase(),
          language: loadout.language.toLowerCase(),
          tools: sanitizedTools,
          systemPrompt: loadout.systemPrompt || ''
        },
        elo: loadoutElo,
        preferences: sanitizedPreferences,
        joinedAt: Date.now(),
        expandedSearchAt: null,
        isMatching: false
      };

      // Transfer reservation ownership to the queue entry so any downstream
      // abandonment (leave, disconnect, idle sweep) can refund correctly.
      queueEntry.reservationId = pendingReservationId;
      pendingReservationId = null;
      global.agentMatchmakingQueue.set(userId, queueEntry);
      // Track queue timestamp for idle cleanup
      if (global.agentQueueTimestamps) {
        global.agentQueueTimestamps.set(userId, Date.now());
      }
      logger.info(`[Agent Queue] ${user.username} joined queue with ${loadout.model} agent (loadout ID: ${dbLoadoutId}) - ${rateLimitResult.remaining}/${rateLimitResult.limit} battles remaining`);

      // Calculate how many players match preferences
      const matchingPlayersCount = countMatchingPlayers(queueEntry, global.agentMatchmakingQueue);

      // Send queue update (position = queue size since they just joined at the end)
      socket.emit('agent-queue-update', {
        position: global.agentMatchmakingQueue.size,
        playersInQueue: global.agentMatchmakingQueue.size,
        matchingPlayersCount,
        rateLimit: {
          remaining: rateLimitResult.remaining,
          limit: rateLimitResult.limit,
          resetTime: rateLimitResult.resetTime
        }
      });

      // Try to match players
      tryAgentMatch(socket, userId);
      } finally {
        // Refund if the reservation was never transferred to a queue entry
        // (e.g. an early-return before queue.set, or an exception below).
        if (pendingReservationId) {
          releaseReservation(pendingReservationId).catch(refundErr => {
            logger.warn(`[Agent Queue] releaseReservation failed for abandoned admission user=${userId}: ${refundErr.message}`);
          });
        }
      }
    } catch (err) {
      logger.error('[Agent Queue] Join error:', err);
      socket.emit('agent-queue-error', { error: `Failed to join queue: ${err.message}` });
    }
  });

  // Leave agent battle queue
  socket.on('leave-agent-queue', async () => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return;

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      if (global.agentMatchmakingQueue.has(userId)) {
        const entry = global.agentMatchmakingQueue.get(userId);
        // Bug 4 follow-up: refund the held reservation on explicit leave.
        if (entry?.reservationId) {
          releaseReservation(entry.reservationId).catch(refundErr => {
            logger.warn(`[Agent Queue] releaseReservation failed on leave user=${userId}: ${refundErr.message}`);
          });
        }
        global.agentMatchmakingQueue.delete(userId);
        logger.info(`[Agent Queue] User ${userId} left queue`);
      }
    } catch (err) {
      logger.error('[Agent Queue] Leave error:', err);
    }
  });

  // Helper function to check if two players match preferences
  function checkPreferenceMatch(player1, player2) {
    const p1Prefs = player1.preferences;
    const p2Prefs = player2.preferences;

    // Check model preferences
    const modelMatch = checkModelPreference(player1, player2);
    if (!modelMatch) return { matches: false, reason: 'model' };

    // Check ELO range preferences
    const eloMatch = checkEloPreference(player1, player2);
    if (!eloMatch) return { matches: false, reason: 'elo' };

    // Difficulty preference is applied to problem selection, not player matching
    // So we don't check it here

    return { matches: true, reason: null };
  }

  function checkModelPreference(player1, player2) {
    const p1Prefs = player1.preferences;
    const p2Prefs = player2.preferences;

    // Check player 1's preferences
    if (p1Prefs.modelPreference === 'same-model-only') {
      if (player1.loadout.model !== player2.loadout.model) return false;
    } else if (p1Prefs.modelPreference !== 'any') {
      // Specific model preference (haiku, sonnet, opus)
      if (player2.loadout.model !== p1Prefs.modelPreference) return false;
    }

    // Check player 2's preferences
    if (p2Prefs.modelPreference === 'same-model-only') {
      if (player2.loadout.model !== player1.loadout.model) return false;
    } else if (p2Prefs.modelPreference !== 'any') {
      // Specific model preference (haiku, sonnet, opus)
      if (player1.loadout.model !== p2Prefs.modelPreference) return false;
    }

    return true;
  }

  function checkEloPreference(player1, player2) {
    const p1Prefs = player1.preferences;
    const p2Prefs = player2.preferences;

    // Check player 1's ELO preference
    if (p1Prefs.eloRange === 'similar') {
      const eloDiff = Math.abs(player1.elo - player2.elo);
      if (eloDiff > 200) return false;
    } else if (p1Prefs.eloRange === 'custom') {
      if (player2.elo < p1Prefs.customEloMin || player2.elo > p1Prefs.customEloMax) {
        return false;
      }
    }

    // Check player 2's ELO preference
    if (p2Prefs.eloRange === 'similar') {
      const eloDiff = Math.abs(player2.elo - player1.elo);
      if (eloDiff > 200) return false;
    } else if (p2Prefs.eloRange === 'custom') {
      if (player1.elo < p2Prefs.customEloMin || player1.elo > p2Prefs.customEloMax) {
        return false;
      }
    }

    return true;
  }

  // Helper function to count how many players in queue match a player's preferences
  function countMatchingPlayers(player, queue) {
    let count = 0;
    for (const [userId, otherPlayer] of queue.entries()) {
      if (userId === player.userId) continue;
      const match = checkPreferenceMatch(player, otherPlayer);
      if (match.matches) count++;
    }
    return count;
  }

  // Helper function to check if preferences should be expanded (after timeout)
  function shouldExpandSearch(queueEntry) {
    const EXPAND_SEARCH_TIMEOUT = 60000; // 60 seconds
    const timeInQueue = Date.now() - queueEntry.joinedAt;

    if (timeInQueue >= EXPAND_SEARCH_TIMEOUT && !queueEntry.expandedSearchAt) {
      return true;
    }
    return false;
  }

  // Helper function to try matching agents
  async function tryAgentMatch(joiningSocket, joiningUserId) {
    const queue = global.agentMatchmakingQueue;
    if (queue.size < 2) return;

    // Find two players to match
    const entries = Array.from(queue.entries());
    const joiningPlayer = queue.get(joiningUserId);

    // Check if joining player is already being matched or locked
    if (!joiningPlayer || joiningPlayer.isMatching || global.agentMatchmakingLocks.has(joiningUserId)) {
      return;
    }

    // Verify joining player's socket is still connected (High #6 fix)
    const joiningPlayerSocket = io.sockets.sockets.get(joiningPlayer.socketId);
    if (!joiningPlayerSocket || !joiningPlayerSocket.connected) {
      // Player disconnected, remove from queue
      // Bug 4 follow-up: refund their reservation since the battle never happens.
      if (joiningPlayer.reservationId) {
        releaseReservation(joiningPlayer.reservationId).catch(refundErr => {
          logger.warn(`[Agent Queue] releaseReservation failed for disconnected user=${joiningUserId}: ${refundErr.message}`);
        });
      }
      queue.delete(joiningUserId);
      if (global.agentMatchmakingLocks) {
        global.agentMatchmakingLocks.delete(joiningUserId);
      }
      logger.debug(`[Agent Queue] Removed disconnected player ${joiningUserId} from queue`);
      return;
    }

    // Check if player should expand search (after timeout)
    const expandSearch = shouldExpandSearch(joiningPlayer);
    if (expandSearch && !joiningPlayer.expandedSearchAt) {
      joiningPlayer.expandedSearchAt = Date.now();
      logger.info(`[Agent Queue] Expanding search for user ${joiningUserId} after timeout`);

      // Notify player that search is expanding
      const joiningSocketObj = io.sockets.sockets.get(joiningPlayer.socketId);
      if (joiningSocketObj) {
        joiningSocketObj.emit('agent-search-expanded', {
          message: 'Search expanded - now matching with any available player'
        });
      }
    }

    // Find an opponent with preference matching
    let bestMatch = null;
    let bestMatchQuality = 0;

    for (const [opponentId, opponent] of entries) {
      if (opponentId === joiningUserId) continue;

      // Skip if opponent is already being matched or locked
      if (opponent.isMatching || global.agentMatchmakingLocks.has(opponentId)) continue;

      // Verify opponent's socket is still connected (High #6 fix)
      const opponentPlayerSocket = io.sockets.sockets.get(opponent.socketId);
      if (!opponentPlayerSocket || !opponentPlayerSocket.connected) {
        // Opponent disconnected, remove from queue and continue searching
        // Bug 4 follow-up: refund their reservation since the battle never happens.
        if (opponent.reservationId) {
          releaseReservation(opponent.reservationId).catch(refundErr => {
            logger.warn(`[Agent Queue] releaseReservation failed for disconnected opponent=${opponentId}: ${refundErr.message}`);
          });
        }
        queue.delete(opponentId);
        if (global.agentMatchmakingLocks) {
          global.agentMatchmakingLocks.delete(opponentId);
        }
        logger.debug(`[Agent Queue] Removed disconnected opponent ${opponentId} from queue`);
        continue;
      }

      // Check if opponent should also expand search
      const opponentExpandSearch = shouldExpandSearch(opponent);
      if (opponentExpandSearch && !opponent.expandedSearchAt) {
        opponent.expandedSearchAt = Date.now();
        logger.info(`[Agent Queue] Expanding search for user ${opponentId} after timeout`);

        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        if (opponentSocket) {
          opponentSocket.emit('agent-search-expanded', {
            message: 'Search expanded - now matching with any available player'
          });
        }
      }

      // If either player has expanded search, match them
      if (expandSearch || opponentExpandSearch) {
        bestMatch = opponent;
        bestMatchQuality = 100; // Perfect match due to timeout
        break;
      }

      // Check preference match
      const preferenceMatch = checkPreferenceMatch(joiningPlayer, opponent);
      if (preferenceMatch.matches) {
        // Calculate match quality (0-100)
        let matchQuality = 100;

        // Reduce quality slightly based on ELO difference (for similar preference)
        if (joiningPlayer.preferences.eloRange === 'similar' || opponent.preferences.eloRange === 'similar') {
          const eloDiff = Math.abs(joiningPlayer.elo - opponent.elo);
          matchQuality -= Math.min(eloDiff / 4, 50); // Max penalty of 50
        }

        // Take the first valid match (FIFO within preference constraints)
        if (!bestMatch || matchQuality > bestMatchQuality) {
          bestMatch = opponent;
          bestMatchQuality = matchQuality;
        }

        // If we found a perfect match, stop searching
        if (matchQuality >= 100) {
          break;
        }
      }
    }

    // If no match found, return early
    if (!bestMatch) {
      return;
    }

    const opponent = bestMatch;
    const opponentId = opponent.userId;

      // Match found! Set locks and flags to prevent double-matching
      global.agentMatchmakingLocks.add(joiningUserId);
      global.agentMatchmakingLocks.add(opponentId);
      // Track lock timestamps for orphan cleanup
      if (global.agentLockTimestamps) {
        global.agentLockTimestamps.set(joiningUserId, Date.now());
        global.agentLockTimestamps.set(opponentId, Date.now());
      }
      joiningPlayer.isMatching = true;
      opponent.isMatching = true;

      // Remove both from queue IMMEDIATELY (atomic with lock)
      queue.delete(joiningUserId);
      queue.delete(opponentId);

      try {
        const battleId = `agent-battle-${uuidv4()}`;

        // Determine problem difficulty based on preferences
        let difficulty = 'medium'; // Default
        const p1Difficulty = joiningPlayer.preferences.difficulty;
        const p2Difficulty = opponent.preferences.difficulty;

        // If both players have same difficulty preference (not 'any'), use it
        if (p1Difficulty === p2Difficulty && p1Difficulty !== 'any') {
          difficulty = p1Difficulty;
        } else if (p1Difficulty !== 'any' && p2Difficulty === 'any') {
          difficulty = p1Difficulty;
        } else if (p2Difficulty !== 'any' && p1Difficulty === 'any') {
          difficulty = p2Difficulty;
        }
        // Otherwise, use default 'medium'

        // Get or generate a problem (Low #13 fix - robust fallback chain)
        const generateAdversarialProblem = async (d) => { const pool = problemsLoader.getAgentProblems(['easy', 'medium', 'hard'].includes(d) ? d : null); return pool.length ? { success: true, problem: pool[Math.floor(Math.random() * pool.length)] } : { success: false }; }; // open edition: no problem generator
        let problem;

        try {
          // Try to generate a fresh adversarial problem
          const result = await generateAdversarialProblem(difficulty);
          if (result.success) {
            problem = result.problem;
          } else {
            // Fallback to random problem
            problem = getRandomProblem(null, 1200);
          }
        } catch (err) {
          logger.warn('[Agent Battle] Problem generation failed, using fallback:', err.message);
          try {
            problem = getRandomProblem(null, 1200);
          } catch (fallbackErr) {
            // Emergency fallback - hardcoded Two Sum problem
            logger.error('[Agent Battle] Fallback problem also failed, using emergency problem:', fallbackErr.message);
            problem = {
              id: 'emergency-two-sum',
              title: 'Two Sum',
              description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice.',
              examples: [
                { input: { nums: [2, 7, 11, 15], target: 9 }, output: [0, 1] },
                { input: { nums: [3, 2, 4], target: 6 }, output: [1, 2] }
              ],
              constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', '-10^9 <= target <= 10^9'],
              testCases: [
                { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
                { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
                { input: { nums: [3, 3], target: 6 }, expected: [0, 1] }
              ],
              difficulty: 'easy'
            };
          }
        }

      // Create battle record
      const agentBattle = {
        id: battleId,
        problem,
        players: [
          {
            loadoutId: joiningPlayer.loadoutId,
            versionId: joiningPlayer.versionId,
            userId: joiningUserId,
            username: joiningPlayer.username,
            loadout: joiningPlayer.loadout,
            socketId: joiningPlayer.socketId,
            status: 'pending',
            code: null,
            testResults: null
          },
          {
            loadoutId: opponent.loadoutId,
            versionId: opponent.versionId,
            userId: opponentId,
            username: opponent.username,
            loadout: opponent.loadout,
            socketId: opponent.socketId,
            status: 'pending',
            code: null,
            testResults: null
          }
        ],
        spectators: new Set(), // Track spectators
        state: 'matched',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null
      };

      // Store battle
      if (!global.agentBattles) {
        global.agentBattles = new Map();
      }
      global.agentBattles.set(battleId, agentBattle);

      // Notify both players with match quality information
      const joiningSocketObj = io.sockets.sockets.get(joiningPlayer.socketId);
      const opponentSocketObj = io.sockets.sockets.get(opponent.socketId);

      if (joiningSocketObj) {
        joiningSocketObj.emit('agent-match-found', {
          battleId,
          opponent: {
            username: opponent.username,
            model: opponent.loadout.model,
            elo: opponent.elo
          },
          matchQuality: bestMatchQuality,
          problemDifficulty: difficulty
        });
      }

      if (opponentSocketObj) {
        opponentSocketObj.emit('agent-match-found', {
          battleId,
          opponent: {
            username: joiningPlayer.username,
            model: joiningPlayer.loadout.model,
            elo: joiningPlayer.elo
          },
          matchQuality: bestMatchQuality,
          problemDifficulty: difficulty
        });
      }

      logger.info(`[Agent Battle] Match created: ${joiningPlayer.username} vs ${opponent.username} (${battleId})`);

        // Release locks now that battle is successfully created
        global.agentMatchmakingLocks.delete(joiningUserId);
        global.agentMatchmakingLocks.delete(opponentId);

        // Start the battle asynchronously with error handling
        runAgentBattle(battleId).catch(err => {
          logger.error(`[Agent Battle] Fatal error in battle ${battleId}:`, err);
          const battle = global.agentBattles?.get(battleId);
          if (battle) {
            battle.state = 'error';
            battle.error = err.message;
            // Notify players of failure
            for (const player of battle.players) {
              const socketObj = io.sockets.sockets.get(player.socketId);
              if (socketObj) {
                socketObj.emit('agent-battle-error', { battleId, error: 'Battle execution failed' });
              }
            }

            // Clean up battle from memory after error (with timer tracking)
            const errorCleanupTimer = setTimeout(() => {
              if (global.agentBattles?.has(battleId)) {
                global.agentBattles.delete(battleId);
                logger.debug(`[Memory] Cleaned up errored battle ${battleId}`);
              }
              global.agentCleanupTimers?.delete(battleId);
            }, 5 * 60 * 1000); // 5 minutes
            global.agentCleanupTimers?.set(battleId, errorCleanupTimer);
          }
        });

        return; // Match found, exit
      } catch (err) {
        // If match creation fails, release locks, reset flags and put players back in queue
        logger.error('[Agent Battle] Match creation failed:', err);
        global.agentMatchmakingLocks.delete(joiningUserId);
        global.agentMatchmakingLocks.delete(opponentId);
        joiningPlayer.isMatching = false;
        opponent.isMatching = false;
        queue.set(joiningUserId, joiningPlayer);
        queue.set(opponentId, opponent);

        // Refund rate limit slots since match never happened
        await refundRateLimitSlot(joiningUserId, joiningPlayer?.loadout?.model);
        await refundRateLimitSlot(opponentId, opponent?.loadout?.model);
        logger.info(`[Agent Battle] Refunded rate limit slots for users ${joiningUserId} and ${opponentId} after match failure`);

        // Notify players of failure
        const joiningSocketObj = io.sockets.sockets.get(joiningPlayer.socketId);
        const opponentSocketObj = io.sockets.sockets.get(opponent.socketId);

        if (joiningSocketObj) {
          joiningSocketObj.emit('agent-match-error', { error: 'Failed to create match' });
        }
        if (opponentSocketObj) {
          opponentSocketObj.emit('agent-match-error', { error: 'Failed to create match' });
        }

        return; // Exit after handling error
      }
  }

  // Join agent battle room for spectating
  socket.on('join-agent-battle-room', async ({ battleId }) => {
    try {
      // Verify authentication
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.emit('agent-battle-error', { error: 'Not authenticated' });
        return;
      }

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      if (!battleId) return;
      const roomName = `agent-battle-${battleId}`;
      socket.join(roomName);
      logger.debug(`Socket ${socket.id} (user ${userId}) joined agent battle room ${roomName}`);

      // Send current battle state if available
      const battle = global.agentBattles?.get(battleId);
      if (battle) {
        const participant = battle.players.find(p => String(p.userId) === String(userId));
        if (participant && participant.socketId !== socket.id) {
          participant.socketId = socket.id;
          logger.debug(`[Agent Battle] Refreshed socket for participant ${userId} in battle ${battleId}`);
        }

        // Add user to spectators (with limit)
        if (!battle.spectators) {
          battle.spectators = new Set();
        }

        // Check spectator limit before adding
        if (battle.spectators.size >= MAX_SPECTATORS_PER_BATTLE && !battle.spectators.has(userId)) {
          socket.emit('agent-battle-error', { error: 'Battle has reached maximum spectator capacity' });
          return;
        }
        battle.spectators.add(userId);

        // Store battleId on socket for cleanup on disconnect
        if (!socket.agentBattleRooms) {
          socket.agentBattleRooms = new Set();
        }
        socket.agentBattleRooms.add(battleId);

        socket.emit('agent-battle-state', {
          battleId,
          state: battle.state,
          problem: battle.problem ? {
            id: battle.problem.id,
            title: battle.problem.title,
            description: battle.problem.description,
            examples: battle.problem.examples
          } : null,
          players: battle.players.map(p => ({
            loadoutId: p.loadoutId,
            userId: p.userId,
            username: p.username,
            model: p.loadout.model,
            status: p.status,
            passedCount: p.passedCount || 0,
            totalTests: p.totalTests || 0,
            executionTime: p.executionTime
          })),
          spectatorCount: battle.spectators.size
        });

        // Emit spectator count update to all in the room
        io.to(roomName).emit('spectator-count-update', {
          battleId,
          spectatorCount: battle.spectators.size
        });
      }
    } catch (err) {
      logger.error('Error in join-agent-battle-room:', err);
      socket.emit('agent-battle-error', { error: 'Authentication failed' });
    }
  });

  // Leave agent battle room
  socket.on('leave-agent-battle-room', async ({ battleId }) => {
    try {
      if (!battleId) return;
      const roomName = `agent-battle-${battleId}`;
      socket.leave(roomName);

      // Get userId from socket auth
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (token) {
        const decoded = await verifySessionClaims(token);
        const userId = decoded.sub;

        // Remove from spectators
        const battle = global.agentBattles?.get(battleId);
        if (battle && battle.spectators) {
          battle.spectators.delete(userId);

          // Emit updated spectator count
          io.to(roomName).emit('spectator-count-update', {
            battleId,
            spectatorCount: battle.spectators.size
          });
        }
      }

      // Remove from socket's tracked rooms
      if (socket.agentBattleRooms) {
        socket.agentBattleRooms.delete(battleId);
      }

      logger.debug(`Socket ${socket.id} left agent battle room ${roomName}`);
    } catch (err) {
      logger.error('Error in leave-agent-battle-room:', err);
    }
  });

  // =====================================================
  // AGENT BATTLE REMATCH SYSTEM
  // =====================================================

  // Initialize rematch tracking map
  if (!global.agentRematchRequests) {
    global.agentRematchRequests = new Map();
  }

  // Request an agent battle rematch
  socket.on('request-agent-rematch', async ({ battleId }) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.emit('agent-rematch-error', { error: 'Not authenticated' });
        return;
      }

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      // Verify the battle exists (battles are cleaned up after 5 minutes)
      const battle = global.agentBattles?.get(battleId);
      if (!battle) {
        socket.emit('agent-rematch-error', {
          error: 'Battle not found. Rematches are only available within 5 minutes after a battle ends.',
          expired: true
        });
        return;
      }

      // Verify user was a participant
      const player = battle.players.find(p => p.userId === userId);
      if (!player) {
        socket.emit('agent-rematch-error', { error: 'You were not a participant in this battle' });
        return;
      }

      // Find opponent
      const opponent = battle.players.find(p => p.userId !== userId);
      if (!opponent) {
        socket.emit('agent-rematch-error', { error: 'Opponent not found' });
        return;
      }

      // Create or update rematch request
      let rematchData = global.agentRematchRequests.get(battleId);
      if (!rematchData) {
        rematchData = {
          battleId,
          players: battle.players.map(p => ({
            userId: p.userId,
            username: p.username,
            loadout: p.loadout,
            loadoutId: p.loadoutId,
            socketId: p.socketId
          })),
          requests: new Set(),
          createdAt: Date.now()
        };
        global.agentRematchRequests.set(battleId, rematchData);

        // Auto-cleanup after 60 seconds
        setTimeout(() => {
          if (global.agentRematchRequests?.has(battleId)) {
            global.agentRematchRequests.delete(battleId);
            logger.debug(`[Agent Rematch] Cleaned up expired rematch request for battle ${battleId}`);
          }
        }, 60 * 1000);
      }

      // Add this player's request
      rematchData.requests.add(userId);

      logger.info(`[Agent Rematch] ${player.username} requested rematch for battle ${battleId}`);

      // Notify opponent
      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) {
        opponentSocket.emit('agent-rematch-requested', {
          battleId,
          requester: {
            userId: player.userId,
            username: player.username
          },
          expiresIn: 60000 // 60 seconds
        });
      }

      // If both players have requested, create new battle
      if (rematchData.requests.size === 2) {
        // Check if rematch is already being created (race condition prevention)
        if (global.agentRematchLocks.has(battleId)) {
          logger.debug(`[Agent Rematch] Rematch already being created for battle ${battleId}, ignoring duplicate`);
          return;
        }

        // Lock the rematch to prevent duplicate creation
        global.agentRematchLocks.add(battleId);

        try {
          logger.info(`[Agent Rematch] Both players accepted rematch for battle ${battleId}`);

          // Create new battle with same loadouts
          const newBattleId = `agent-battle-${uuidv4()}`;
          const allProblems = problemsLoader.getAgentProblems(); // open edition problem set
          const problem = allProblems[Math.floor(Math.random() * allProblems.length)];

          if (!global.agentBattles) {
            global.agentBattles = new Map();
          }

          const newBattle = {
            id: newBattleId,
            players: rematchData.players.map(p => ({
              ...p,
              status: 'pending',
              passedCount: 0,
              totalTests: 0,
              eloChange: 0,
              isWinner: false
            })),
            problem,
            state: 'matched',
            createdAt: Date.now(),
            spectators: new Set()
          };

          global.agentBattles.set(newBattleId, newBattle);

          // Notify both players
          for (const player of rematchData.players) {
            const playerSocket = io.sockets.sockets.get(player.socketId);
            if (playerSocket) {
              playerSocket.emit('agent-rematch-starting', {
                battleId: newBattleId,
                message: 'Rematch starting!'
              });
            }
          }

          // Start the new battle. Always attach .catch so a rejection here
          // (e.g. agentSolver/Anthropic SDK throws) doesn't become an
          // unhandled rejection that kills the process under
          // --unhandled-rejections=strict.
          setTimeout(() => {
            runAgentBattle(newBattleId).catch(err => {
              logger.error(`[Agent Rematch] runAgentBattle ${newBattleId} failed:`, err);
            });
          }, 2000); // 2 second delay for UI transition
        } finally {
          // Clean up rematch request and lock
          global.agentRematchRequests.delete(battleId);
          global.agentRematchLocks.delete(battleId);
        }
      } else {
        // Confirm to requester that they're waiting
        socket.emit('agent-rematch-waiting', {
          battleId,
          message: 'Waiting for opponent to accept...'
        });
      }
    } catch (err) {
      logger.error('Error in request-agent-rematch:', err);
      socket.emit('agent-rematch-error', { error: 'Failed to request rematch' });
    }
  });

  // Accept an agent battle rematch (same logic as request - both players must "accept")
  socket.on('accept-agent-rematch', async ({ battleId }) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.emit('agent-rematch-error', { error: 'Not authenticated' });
        return;
      }

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      // Verify the battle exists (battles are cleaned up after 5 minutes)
      const battle = global.agentBattles?.get(battleId);
      if (!battle) {
        socket.emit('agent-rematch-error', {
          error: 'Battle not found. Rematches are only available within 5 minutes after a battle ends.',
          expired: true
        });
        return;
      }

      // Verify user was a participant
      const player = battle.players.find(p => p.userId === userId);
      if (!player) {
        socket.emit('agent-rematch-error', { error: 'You were not a participant in this battle' });
        return;
      }

      // Find opponent
      const opponent = battle.players.find(p => p.userId !== userId);
      if (!opponent) {
        socket.emit('agent-rematch-error', { error: 'Opponent not found' });
        return;
      }

      // Get or create rematch data
      let rematchData = global.agentRematchRequests.get(battleId);
      if (!rematchData) {
        // No existing request - this "accept" acts as the first request
        rematchData = {
          battleId,
          players: battle.players.map(p => ({
            userId: p.userId,
            username: p.username,
            loadout: p.loadout,
            loadoutId: p.loadoutId,
            socketId: p.socketId
          })),
          requests: new Set(),
          createdAt: Date.now()
        };
        global.agentRematchRequests.set(battleId, rematchData);

        // Auto-cleanup after 60 seconds
        setTimeout(() => {
          if (global.agentRematchRequests?.has(battleId)) {
            global.agentRematchRequests.delete(battleId);
          }
        }, 60 * 1000);
      }

      // Add this player's acceptance
      rematchData.requests.add(userId);

      logger.info(`[Agent Rematch] ${player.username} accepted rematch for battle ${battleId}`);

      // If both players have requested/accepted, create new battle
      if (rematchData.requests.size === 2) {
        // Check if rematch is already being created
        if (global.agentRematchLocks.has(battleId)) {
          return;
        }

        global.agentRematchLocks.add(battleId);

        try {
          logger.info(`[Agent Rematch] Both players ready for rematch ${battleId}`);

          const newBattleId = `agent-battle-${uuidv4()}`;
          const allProblems = problemsLoader.getAgentProblems(); // open edition problem set
          const problem = allProblems[Math.floor(Math.random() * allProblems.length)];

          if (!global.agentBattles) {
            global.agentBattles = new Map();
          }

          const newBattle = {
            id: newBattleId,
            players: rematchData.players.map(p => ({
              ...p,
              status: 'pending',
              passedCount: 0,
              totalTests: 0,
              eloChange: 0,
              isWinner: false
            })),
            problem,
            state: 'matched',
            createdAt: Date.now(),
            spectators: new Set()
          };

          global.agentBattles.set(newBattleId, newBattle);

          // Notify both players
          for (const p of rematchData.players) {
            const pSocket = io.sockets.sockets.get(p.socketId);
            if (pSocket) {
              pSocket.emit('agent-rematch-starting', {
                battleId: newBattleId,
                message: 'Rematch starting!'
              });
            }
          }

          // Start the new battle (see comment above on the other rematch path).
          setTimeout(() => {
            runAgentBattle(newBattleId).catch(err => {
              logger.error(`[Agent Rematch] runAgentBattle ${newBattleId} failed:`, err);
            });
          }, 2000);
        } finally {
          global.agentRematchRequests.delete(battleId);
          global.agentRematchLocks.delete(battleId);
        }
      } else {
        // Notify opponent that we accepted
        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        if (opponentSocket) {
          opponentSocket.emit('agent-rematch-accepted', {
            battleId,
            accepter: {
              userId: player.userId,
              username: player.username
            }
          });
        }
        socket.emit('agent-rematch-waiting', {
          battleId,
          message: 'Waiting for opponent...'
        });
      }
    } catch (err) {
      logger.error('Error in accept-agent-rematch:', err);
      socket.emit('agent-rematch-error', { error: 'Failed to accept rematch' });
    }
  });

  // Decline an agent battle rematch
  socket.on('decline-agent-rematch', async ({ battleId }) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        socket.emit('agent-rematch-error', { error: 'Not authenticated' });
        return;
      }

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      // Get rematch data
      const rematchData = global.agentRematchRequests.get(battleId);
      if (!rematchData) {
        return; // Already expired or doesn't exist
      }

      // Find opponent who requested
      const battle = global.agentBattles?.get(battleId);
      if (!battle) return;

      const decliner = battle.players.find(p => p.userId === userId);
      const opponent = battle.players.find(p => p.userId !== userId);

      if (opponent && decliner) {
        // Notify opponent that rematch was declined
        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        if (opponentSocket) {
          opponentSocket.emit('agent-rematch-declined', {
            battleId,
            decliner: {
              userId: decliner.userId,
              username: decliner.username
            }
          });
        }

        logger.info(`[Agent Rematch] ${decliner.username} declined rematch for battle ${battleId}`);
      }

      // Clean up rematch request
      global.agentRematchRequests.delete(battleId);
    } catch (err) {
      logger.error('Error in decline-agent-rematch:', err);
    }
  });

  // Cancel rematch request
  socket.on('cancel-agent-rematch', async ({ battleId }) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return;

      const decoded = await verifySessionClaims(token);
      const userId = decoded.sub;

      const rematchData = global.agentRematchRequests.get(battleId);
      if (!rematchData) return;

      // Remove user's request
      rematchData.requests.delete(userId);

      // If no requests left, clean up
      if (rematchData.requests.size === 0) {
        global.agentRematchRequests.delete(battleId);
      }

      // Notify opponent if they exist
      const battle = global.agentBattles?.get(battleId);
      if (battle) {
        const canceller = battle.players.find(p => p.userId === userId);
        const opponent = battle.players.find(p => p.userId !== userId);

        if (opponent && canceller) {
          const opponentSocket = io.sockets.sockets.get(opponent.socketId);
          if (opponentSocket) {
            opponentSocket.emit('agent-rematch-cancelled', {
              battleId,
              canceller: {
                userId: canceller.userId,
                username: canceller.username
              }
            });
          }
        }
      }

      logger.debug(`[Agent Rematch] User ${userId} cancelled rematch request for battle ${battleId}`);
    } catch (err) {
      logger.error('Error in cancel-agent-rematch:', err);
    }
  });

  // Helper function to record battle event for replay
  async function recordBattleEvent(battleId, eventType, playerId, eventData, battleStartTime) {
    try {
      const timestampMs = Date.now() - battleStartTime;
      await dbHelper.run(
        `INSERT INTO agent_battle_events (battle_id, event_type, player_id, event_data, timestamp_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [battleId, eventType, playerId, JSON.stringify(eventData), timestampMs]
      );
    } catch (err) {
      logger.error(`[Agent Battle Replay] Failed to record event: ${err.message}`);
    }
  }

  // Run the agent battle
  async function runAgentBattle(battleId) {
    const battle = global.agentBattles?.get(battleId);
    if (!battle) return;

    const { generateSolutionStreaming } = require('./services/agentSolver');
    const { validateSolution } = require('./services/validateSolution');

    battle.state = 'running';
    battle.startedAt = Date.now();

    logger.info(`[Agent Battle] Starting battle ${battleId}`);

    // Record battle start event
    await recordBattleEvent(battleId, 'battle_start', 0, {
      problem: {
        id: battle.problem.id,
        title: battle.problem.title,
        description: battle.problem.description,
        examples: battle.problem.examples
      }
    }, battle.startedAt);

    // Notify spectators
    io.to(`agent-battle-${battleId}`).emit('agent-battle-started', {
      battleId,
      problem: {
        id: battle.problem.id,
        title: battle.problem.title,
        description: battle.problem.description,
        examples: battle.problem.examples
      }
    });

    // Broadcast to all users that a new live battle has started
    io.emit('live-battles-update', {
      type: 'battle-started',
      battleId,
      timestamp: Date.now()
    });

    // Run both agents in parallel
    const results = await Promise.all(
      battle.players.map(async (player, index) => {
        try {
          const startTime = Date.now();

          // Track accumulated code for validation
          let accumulatedCode = '';

          // Emit agent-coding-started event
          io.to(`agent-battle-${battleId}`).emit('agent-coding-started', {
            battleId,
            playerId: player.userId,
            timestamp: Date.now()
          });

          // Record coding started event
          await recordBattleEvent(battleId, 'coding_started', player.userId, {
            loadout: {
              model: player.loadout.model,
              language: player.loadout.language
            }
          }, battle.startedAt);

          // Generate solution with streaming
          const result = await generateSolutionStreaming(
            battle.problem,
            player.loadout,
            (chunk) => {
              // Accumulate code
              accumulatedCode += chunk;

              // Record code chunk event
              recordBattleEvent(battleId, 'code_chunk', player.userId, { chunk }, battle.startedAt).catch(err => {
                logger.error(`[Agent Battle Replay] Failed to record code chunk: ${err.message}`);
              });

              // Emit code chunk to battle room
              io.to(`agent-battle-${battleId}`).emit('agent-code-chunk', {
                battleId,
                playerId: player.userId,
                chunk: chunk,
                timestamp: Date.now()
              });
            },
            // onToolUse callback
            (toolName, input, output) => {
              // Record tool use event
              recordBattleEvent(battleId, 'tool_use', player.userId, {
                tool: toolName,
                input: input,
                output: output
              }, battle.startedAt).catch(err => {
                logger.error(`[Agent Battle Replay] Failed to record tool use: ${err.message}`);
              });

              // Emit tool usage event
              io.to(`agent-battle-${battleId}`).emit('agent-tool-use', {
                battleId,
                playerId: player.userId,
                tool: toolName,
                input: input,
                output: output,
                timestamp: Date.now()
              });
            }
          );

          // Emit agent-coding-finished event
          io.to(`agent-battle-${battleId}`).emit('agent-coding-finished', {
            battleId,
            playerId: player.userId,
            timestamp: Date.now()
          });

          // Record submission event
          await recordBattleEvent(battleId, 'submission', player.userId, {
            code: result.code || '',
            success: result.success,
            error: result.error
          }, battle.startedAt);

          const endTime = Date.now();

          // Validate the generated code
          let testResults = [];
          let passedCount = 0;
          let totalTests = 0;

          if (result.success && result.code) {
            testResults = await validateSolution(
              result.code,
              battle.problem.testCases,
              player.loadout.language,
              battle.problem.id
            );
            passedCount = testResults.filter(r => r.passed).length;
            totalTests = testResults.length;
          } else {
            // No code generated, create failed test results
            testResults = battle.problem.testCases.map(tc => ({
              input: tc.input,
              expected: tc.output,
              actual: 'No code generated',
              passed: false,
              error: result.error || 'Code generation failed'
            }));
            totalTests = testResults.length;
          }

          // Update player status
          player.status = result.success && passedCount === totalTests ? 'completed' : 'failed';
          player.code = result.code;
          player.testResults = testResults;
          player.executionTime = endTime - startTime;
          player.passedCount = passedCount;
          player.totalTests = totalTests;

          // Store token usage and generation metrics
          player.tokensUsed = result.tokensUsed?.total || 0;
          player.generationTimeMs = result.generationTimeMs || 0;
          player.toolCalls = result.toolCalls?.length || 0;

          // Record result event
          await recordBattleEvent(battleId, 'result', player.userId, {
            status: player.status,
            passedCount,
            totalTests,
            executionTime: player.executionTime,
            tokensUsed: player.tokensUsed,
            generationTimeMs: player.generationTimeMs,
            toolCalls: player.toolCalls
          }, battle.startedAt);

          // Emit progress
          const socketObj = io.sockets.sockets.get(player.socketId);
          if (socketObj) {
            socketObj.emit('agent-battle-progress', {
              battleId,
              playerId: player.userId,
              status: player.status,
              passedCount: player.passedCount,
              totalTests: player.totalTests
            });
          }

          return {
            playerId: player.userId,
            success: passedCount === totalTests,
            passedCount: player.passedCount,
            executionTime: player.executionTime,
            tokensUsed: player.tokensUsed,
            generationTimeMs: player.generationTimeMs,
            toolCalls: player.toolCalls
          };
        } catch (err) {
          logger.error(`[Agent Battle] Error running agent for ${player.username}:`, err);
          player.status = 'error';

          // Emit agent-coding-finished even on error
          io.to(`agent-battle-${battleId}`).emit('agent-coding-finished', {
            battleId,
            coderId: player.userId,
            timestamp: Date.now(),
            error: err.message
          });

          return {
            playerId: player.userId,
            success: false,
            passedCount: 0,
            error: err.message
          };
        }
      })
    );

    // Determine winner
    battle.state = 'finished';
    battle.finishedAt = Date.now();

    const [p1Result, p2Result] = results;
    const p1 = battle.players[0];
    const p2 = battle.players[1];

    let winnerId = null;
    let reason = '';

    if (p1.passedCount > p2.passedCount) {
      winnerId = p1.userId;
      reason = 'more_tests_passed';
    } else if (p2.passedCount > p1.passedCount) {
      winnerId = p2.userId;
      reason = 'more_tests_passed';
    } else if (p1.passedCount === p2.passedCount && p1.passedCount > 0) {
      // Tie on tests - faster wins
      if (p1.executionTime < p2.executionTime) {
        winnerId = p1.userId;
        reason = 'faster_execution';
      } else {
        winnerId = p2.userId;
        reason = 'faster_execution';
      }
    } else {
      reason = 'tie';
    }

    battle.winnerId = winnerId;
    battle.winReason = reason;

    // Calculate ELO changes
    const elo = require('./elo');
    let eloChanges = { p1Change: 0, p2Change: 0 };
    let streakInfo = { p1: {}, p2: {} };

    try {
      // Get current agent ELO and streak info from loadouts (default 1000)
      const p1EloRow = await dbHelper.get(
        'SELECT elo, current_streak, best_streak FROM agent_loadouts WHERE id = ?',
        [p1.loadoutId]
      );
      const p2EloRow = await dbHelper.get(
        'SELECT elo, current_streak, best_streak FROM agent_loadouts WHERE id = ?',
        [p2.loadoutId]
      );

      const p1Elo = p1EloRow?.elo || 1000;
      const p2Elo = p2EloRow?.elo || 1000;
      const p1CurrentStreak = p1EloRow?.current_streak || 0;
      const p2CurrentStreak = p2EloRow?.current_streak || 0;
      const p1BestStreak = p1EloRow?.best_streak || 0;
      const p2BestStreak = p2EloRow?.best_streak || 0;

      // Update default with actual ELO values so draws/errors have valid fallbacks
      eloChanges = { p1Change: 0, p2Change: 0, p1NewElo: p1Elo, p2NewElo: p2Elo, p1StreakBonus: 0, p2StreakBonus: 0 };

      // Get total agent battles for K-factor (based on loadout)
      const p1GamesRow = await dbHelper.get(
        'SELECT COUNT(*) as count FROM agent_battles WHERE loadout1_id = ? OR loadout2_id = ?',
        [p1.loadoutId, p1.loadoutId]
      );
      const p2GamesRow = await dbHelper.get(
        'SELECT COUNT(*) as count FROM agent_battles WHERE loadout1_id = ? OR loadout2_id = ?',
        [p2.loadoutId, p2.loadoutId]
      );

      const p1Games = p1GamesRow?.count || 0;
      const p2Games = p2GamesRow?.count || 0;

      if (winnerId && reason !== 'tie') {
        // Someone won
        const isP1Winner = p1.userId === winnerId;
        const winner = isP1Winner ? { rating: p1Elo, totalGames: p1Games } : { rating: p2Elo, totalGames: p2Games };
        const loser = isP1Winner ? { rating: p2Elo, totalGames: p2Games } : { rating: p1Elo, totalGames: p1Games };

        const eloResult = elo.calculateMatchRatings(winner, loser);

        // Calculate new streak for winner
        const winnerCurrentStreak = isP1Winner ? p1CurrentStreak : p2CurrentStreak;
        const loserCurrentStreak = isP1Winner ? p2CurrentStreak : p1CurrentStreak;
        const winnerBestStreak = isP1Winner ? p1BestStreak : p2BestStreak;
        const loserBestStreak = isP1Winner ? p2BestStreak : p1BestStreak;

        const newWinnerStreak = winnerCurrentStreak + 1;
        const newWinnerBestStreak = Math.max(newWinnerStreak, winnerBestStreak);
        const newLoserStreak = 0; // Loser streak resets

        // Calculate streak bonus ELO
        let streakBonus = 0;
        if (newWinnerStreak >= 10) {
          streakBonus = 20; // Legendary!
        } else if (newWinnerStreak >= 5) {
          streakBonus = 10;
        } else if (newWinnerStreak >= 3) {
          streakBonus = 5;
        }

        // Base ELO changes
        let baseWinnerChange = eloResult.winner.change;
        let baseLoserChange = eloResult.loser.change;

        // Apply streak bonus to winner
        const winnerChangeWithBonus = baseWinnerChange + streakBonus;

        eloChanges = {
          p1Change: isP1Winner ? winnerChangeWithBonus : baseLoserChange,
          p2Change: isP1Winner ? baseLoserChange : winnerChangeWithBonus,
          p1NewElo: isP1Winner ? (eloResult.winner.newRating + streakBonus) : eloResult.loser.newRating,
          p2NewElo: isP1Winner ? eloResult.loser.newRating : (eloResult.winner.newRating + streakBonus),
          p1StreakBonus: isP1Winner ? streakBonus : 0,
          p2StreakBonus: isP1Winner ? 0 : streakBonus
        };

        // Store streak info for battle result
        streakInfo = {
          p1: {
            currentStreak: isP1Winner ? newWinnerStreak : newLoserStreak,
            bestStreak: isP1Winner ? newWinnerBestStreak : loserBestStreak,
            streakBonus: isP1Winner ? streakBonus : 0
          },
          p2: {
            currentStreak: isP1Winner ? newLoserStreak : newWinnerStreak,
            bestStreak: isP1Winner ? loserBestStreak : newWinnerBestStreak,
            streakBonus: isP1Winner ? 0 : streakBonus
          }
        };

        // Update loadout ELO, wins/losses, streaks AND record battle in a transaction
        // This ensures atomicity - either all updates succeed or none do
        await db.withTransaction(async () => {
          // Calculate tests passed for each player
          const p1TestsPassed = (p1.testResults || []).filter(t => t.passed).length;
          const p2TestsPassed = (p2.testResults || []).filter(t => t.passed).length;

          // Get current recent_results for both loadouts
          const p1Loadout = await dbHelper.get('SELECT recent_results FROM agent_loadouts WHERE id = ?', [p1.loadoutId]);
          const p2Loadout = await dbHelper.get('SELECT recent_results FROM agent_loadouts WHERE id = ?', [p2.loadoutId]);

          // Parse and update recent results (keep last 5)
          let p1RecentResults = [];
          let p2RecentResults = [];
          try {
            p1RecentResults = p1Loadout?.recent_results ? JSON.parse(p1Loadout.recent_results) : [];
            p2RecentResults = p2Loadout?.recent_results ? JSON.parse(p2Loadout.recent_results) : [];
          } catch (e) {
            // If parse fails, start fresh
          }

          // Add new result (W for win, L for loss)
          p1RecentResults.push(isP1Winner ? 'W' : 'L');
          p2RecentResults.push(isP1Winner ? 'L' : 'W');

          // Keep only last 5
          p1RecentResults = p1RecentResults.slice(-5);
          p2RecentResults = p2RecentResults.slice(-5);

          if (isP1Winner) {
            await dbHelper.run(
              `UPDATE agent_loadouts SET
                elo = ?,
                wins = wins + 1,
                current_streak = ?,
                best_streak = ?,
                last_battle_result = ?,
                total_tokens_used = total_tokens_used + ?,
                total_tests_passed = total_tests_passed + ?,
                total_battles = total_battles + 1,
                recent_results = ?,
                updated_at = datetime("now")
              WHERE id = ?`,
              [eloChanges.p1NewElo, newWinnerStreak, newWinnerBestStreak, 'win', p1.tokensUsed || 0, p1TestsPassed, JSON.stringify(p1RecentResults), p1.loadoutId]
            );
            await dbHelper.run(
              `UPDATE agent_loadouts SET
                elo = ?,
                losses = losses + 1,
                current_streak = 0,
                last_battle_result = ?,
                total_tokens_used = total_tokens_used + ?,
                total_tests_passed = total_tests_passed + ?,
                total_battles = total_battles + 1,
                recent_results = ?,
                updated_at = datetime("now")
              WHERE id = ?`,
              [eloChanges.p2NewElo, 'loss', p2.tokensUsed || 0, p2TestsPassed, JSON.stringify(p2RecentResults), p2.loadoutId]
            );
          } else {
            await dbHelper.run(
              `UPDATE agent_loadouts SET
                elo = ?,
                losses = losses + 1,
                current_streak = 0,
                last_battle_result = ?,
                total_tokens_used = total_tokens_used + ?,
                total_tests_passed = total_tests_passed + ?,
                total_battles = total_battles + 1,
                recent_results = ?,
                updated_at = datetime("now")
              WHERE id = ?`,
              [eloChanges.p1NewElo, 'loss', p1.tokensUsed || 0, p1TestsPassed, JSON.stringify(p1RecentResults), p1.loadoutId]
            );
            await dbHelper.run(
              `UPDATE agent_loadouts SET
                elo = ?,
                wins = wins + 1,
                current_streak = ?,
                best_streak = ?,
                last_battle_result = ?,
                total_tokens_used = total_tokens_used + ?,
                total_tests_passed = total_tests_passed + ?,
                total_battles = total_battles + 1,
                recent_results = ?,
                updated_at = datetime("now")
              WHERE id = ?`,
              [eloChanges.p2NewElo, newWinnerStreak, newWinnerBestStreak, 'win', p2.tokensUsed || 0, p2TestsPassed, JSON.stringify(p2RecentResults), p2.loadoutId]
            );
          }

          // Record battle in database (inside transaction)
          await dbHelper.run(
            `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id, loadout1_version_id, loadout2_version_id, problem_id, winner_id, player1_code, player2_code, player1_results, player2_results, player1_time_ms, player2_time_ms, player1_elo_change, player2_elo_change, player1_tokens_used, player2_tokens_used, player1_generation_time_ms, player2_generation_time_ms, player1_tool_calls, player2_tool_calls, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              battleId,
              p1.userId,
              p2.userId,
              p1.loadoutId,
              p2.loadoutId,
              p1.versionId,
              p2.versionId,
              battle.problem.id,
              winnerId,
              p1.code || '',
              p2.code || '',
              JSON.stringify(p1.testResults || []),
              JSON.stringify(p2.testResults || []),
              p1.executionTime || 0,
              p2.executionTime || 0,
              eloChanges.p1Change,
              eloChanges.p2Change,
              p1.tokensUsed || 0,
              p2.tokensUsed || 0,
              p1.generationTimeMs || 0,
              p2.generationTimeMs || 0,
              p1.toolCalls || 0,
              p2.toolCalls || 0,
              'finished'
            ]
          );
        });

        logger.info(`[Agent Battle] ELO updated: ${p1.username} ${eloChanges.p1Change > 0 ? '+' : ''}${eloChanges.p1Change}, ${p2.username} ${eloChanges.p2Change > 0 ? '+' : ''}${eloChanges.p2Change}`);
      } else {
        // Tie
        const tieResult = elo.calculateTieRatings(
          { rating: p1Elo, totalGames: p1Games },
          { rating: p2Elo, totalGames: p2Games }
        );

        eloChanges = {
          p1Change: tieResult.player1.change,
          p2Change: tieResult.player2.change,
          p1NewElo: tieResult.player1.newRating,
          p2NewElo: tieResult.player2.newRating,
          p1StreakBonus: 0,
          p2StreakBonus: 0
        };

        // Store streak info (streaks reset on tie)
        streakInfo = {
          p1: {
            currentStreak: 0,
            bestStreak: p1BestStreak,
            streakBonus: 0
          },
          p2: {
            currentStreak: 0,
            bestStreak: p2BestStreak,
            streakBonus: 0
          }
        };

        // Update ELO for ties, reset streaks, and record battle in a transaction
        await db.withTransaction(async () => {
          // Calculate tests passed for each player
          const p1TestsPassed = (p1.testResults || []).filter(t => t.passed).length;
          const p2TestsPassed = (p2.testResults || []).filter(t => t.passed).length;

          // Get current recent_results for both loadouts
          const p1Loadout = await dbHelper.get('SELECT recent_results FROM agent_loadouts WHERE id = ?', [p1.loadoutId]);
          const p2Loadout = await dbHelper.get('SELECT recent_results FROM agent_loadouts WHERE id = ?', [p2.loadoutId]);

          // Parse and update recent results (keep last 5)
          let p1RecentResults = [];
          let p2RecentResults = [];
          try {
            p1RecentResults = p1Loadout?.recent_results ? JSON.parse(p1Loadout.recent_results) : [];
            p2RecentResults = p2Loadout?.recent_results ? JSON.parse(p2Loadout.recent_results) : [];
          } catch (e) {
            // If parse fails, start fresh
          }

          // Add new result (D for draw)
          p1RecentResults.push('D');
          p2RecentResults.push('D');

          // Keep only last 5
          p1RecentResults = p1RecentResults.slice(-5);
          p2RecentResults = p2RecentResults.slice(-5);

          await dbHelper.run(
            `UPDATE agent_loadouts SET
              elo = ?,
              current_streak = 0,
              last_battle_result = ?,
              total_tokens_used = total_tokens_used + ?,
              total_tests_passed = total_tests_passed + ?,
              total_battles = total_battles + 1,
              recent_results = ?,
              updated_at = datetime("now")
            WHERE id = ?`,
            [eloChanges.p1NewElo, 'draw', p1.tokensUsed || 0, p1TestsPassed, JSON.stringify(p1RecentResults), p1.loadoutId]
          );
          await dbHelper.run(
            `UPDATE agent_loadouts SET
              elo = ?,
              current_streak = 0,
              last_battle_result = ?,
              total_tokens_used = total_tokens_used + ?,
              total_tests_passed = total_tests_passed + ?,
              total_battles = total_battles + 1,
              recent_results = ?,
              updated_at = datetime("now")
            WHERE id = ?`,
            [eloChanges.p2NewElo, 'draw', p2.tokensUsed || 0, p2TestsPassed, JSON.stringify(p2RecentResults), p2.loadoutId]
          );

          // Record battle in database (inside transaction)
          await dbHelper.run(
            `INSERT INTO agent_battles (id, player1_id, player2_id, loadout1_id, loadout2_id, loadout1_version_id, loadout2_version_id, problem_id, winner_id, player1_code, player2_code, player1_results, player2_results, player1_time_ms, player2_time_ms, player1_elo_change, player2_elo_change, player1_tokens_used, player2_tokens_used, player1_generation_time_ms, player2_generation_time_ms, player1_tool_calls, player2_tool_calls, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              battleId,
              p1.userId,
              p2.userId,
              p1.loadoutId,
              p2.loadoutId,
              p1.versionId,
              p2.versionId,
              battle.problem.id,
              winnerId,
              p1.code || '',
              p2.code || '',
              JSON.stringify(p1.testResults || []),
              JSON.stringify(p2.testResults || []),
              p1.executionTime || 0,
              p2.executionTime || 0,
              eloChanges.p1Change,
              eloChanges.p2Change,
              p1.tokensUsed || 0,
              p2.tokensUsed || 0,
              p1.generationTimeMs || 0,
              p2.generationTimeMs || 0,
              p1.toolCalls || 0,
              p2.toolCalls || 0,
              'finished'
            ]
          );
        });
      }

      logger.info(`[Agent Battle] Battle ${battleId} recorded in database`);

      // M8 fix: spending was already committed at admission via reserveSpending.
      // Calling recordSpending here again would double-charge the user.
    } catch (eloErr) {
      // Low #15 fix - detailed error logging for debugging
      logger.error('[Agent Battle] ELO/database error:', {
        error: eloErr.message,
        stack: eloErr.stack,
        battleId,
        winnerId,
        reason,
        p1: { userId: p1.userId, loadoutId: p1.loadoutId, username: p1.username },
        p2: { userId: p2.userId, loadoutId: p2.loadoutId, username: p2.username },
        operation: eloErr.message?.includes('UPDATE') ? 'loadout_update' :
                   eloErr.message?.includes('INSERT') ? 'battle_insert' :
                   eloErr.message?.includes('SELECT') ? 'elo_fetch' : 'unknown'
      });
    }

    // Notify both players of result
    const battleResult = {
      battleId,
      winnerId,
      winReason: reason,
      eloChanges: {
        [p1.userId]: eloChanges.p1Change,
        [p2.userId]: eloChanges.p2Change
      },
      players: battle.players.map(p => ({
        userId: p.userId,
        username: p.username,
        model: p.loadout.model,
        passedCount: p.passedCount,
        totalTests: p.totalTests,
        executionTime: p.executionTime,
        isWinner: p.userId === winnerId,
        eloChange: p.userId === p1.userId ? eloChanges.p1Change : eloChanges.p2Change,
        streakBonus: p.userId === p1.userId ? (eloChanges.p1StreakBonus || 0) : (eloChanges.p2StreakBonus || 0),
        currentStreak: p.userId === p1.userId ? streakInfo.p1.currentStreak : streakInfo.p2.currentStreak,
        bestStreak: p.userId === p1.userId ? streakInfo.p1.bestStreak : streakInfo.p2.bestStreak,
        tokensUsed: p.tokensUsed || 0,
        generationTimeMs: p.generationTimeMs || 0,
        toolCalls: p.toolCalls || 0
      }))
    };

    for (const player of battle.players) {
      const socketObj = io.sockets.sockets.get(player.socketId);
      if (socketObj) {
        socketObj.emit('agent-battle-finished', battleResult);
      }
    }

    // Also emit to battle room for spectators
    io.to(`agent-battle-${battleId}`).emit('agent-battle-finished', battleResult);

    // Broadcast to all users that a live battle has ended
    io.emit('live-battles-update', {
      type: 'battle-ended',
      battleId,
      winnerId,
      timestamp: Date.now()
    });

    logger.info(`[Agent Battle] Battle ${battleId} finished. Winner: ${winnerId || 'TIE'} (${reason})`);

    // Update rivalry record between the two players
    try {
      await db.updateAgentRivalry(p1.userId, p2.userId, winnerId);
    } catch (rivalryErr) {
      logger.error('[Agent Battle] Error updating rivalry:', rivalryErr);
    }

    // Check and award agent battle badges
    for (const player of battle.players) {
      try {
        const isWinner = player.userId === winnerId;
        const playerInfo = isWinner ?
          { ...streakInfo.p1, elo: eloChanges.p1NewElo } :
          { ...streakInfo.p2, elo: eloChanges.p2NewElo };
        const opponentInfo = isWinner ?
          { ...streakInfo.p2, elo: eloChanges.p2NewElo } :
          { ...streakInfo.p1, elo: eloChanges.p1NewElo };

        const earnedBadges = await db.checkAgentBattleBadges(player.userId, {
          isWinner,
          winnerId,
          loadoutId: player.loadoutId,
          currentStreak: playerInfo.currentStreak || 0,
          executionTime: player.executionTime,
          opponentElo: opponentInfo.elo || 1000,
          userElo: playerInfo.elo || 1000
        });

        // Check for rivalry badges
        const opponentId = player.userId === p1.userId ? p2.userId : p1.userId;
        const rivalryBadges = await db.checkRivalryBadges(player.userId, opponentId);
        earnedBadges.push(...rivalryBadges);

        // Emit badge-earned events for each new badge
        if (earnedBadges.length > 0) {
          const socketObj = io.sockets.sockets.get(player.socketId);
          if (socketObj) {
            for (const badge of earnedBadges) {
              socketObj.emit('badge-earned', {
                badge: {
                  slug: badge.slug,
                  name: badge.name,
                  description: badge.description,
                  icon: badge.icon,
                  rarity: badge.rarity
                },
                context: 'agent-battle',
                battleId
              });
              logger.info(`[Badges] User ${player.userId} earned badge: ${badge.slug} from agent battle`);
            }
          }
        }
      } catch (badgeErr) {
        logger.error(`[Badges] Error checking badges for player ${player.userId}:`, badgeErr);
      }
    }

    // Update challenge progress for both players
    const agentChallenges = require('./services/agentChallenges');
    for (const player of battle.players) {
      try {
        const isWinner = player.userId === winnerId;

        // Get active challenges for this player
        const activeChallenges = await db.getActiveChallenges();

        for (const challenge of activeChallenges) {
          const battleData = {
            winner: isWinner ? 'player' : 'opponent',
            aiModel: battle.players.find(p => p.userId !== player.userId).loadout.model,
            language: player.loadout.language,
            duration: player.executionTime ? Math.floor(player.executionTime / 1000) : 0
          };

          // Check if this battle matches the challenge requirement
          if (agentChallenges.checkBattleMatchesRequirement(battleData, challenge.requirement_type, challenge.requirement_value)) {
            // Get current progress
            const currentProgress = await db.getChallengeProgress(player.userId, challenge.id);
            const progressValue = currentProgress ? currentProgress.progress : 0;

            // Calculate new progress
            let newProgress = agentChallenges.calculateProgress(progressValue, challenge, battleData);

            // Special handling for streak challenges
            if (challenge.requirement_type === 'streak') {
              if (isWinner) {
                newProgress = progressValue + 1;
              } else {
                newProgress = 0; // Reset on loss
              }
            }

            // Check if completed
            const completed = agentChallenges.isChallengeComplete(newProgress, challenge);

            // Update progress
            await db.updateChallengeProgress(
              player.userId,
              challenge.id,
              newProgress,
              completed ? 1 : 0,
              completed ? new Date().toISOString() : null
            );

            logger.info(`[Agent Challenges] Updated progress for user ${player.userId}, challenge ${challenge.id}: ${newProgress}/${challenge.requirement_value.count}${completed ? ' (COMPLETED)' : ''}`);

            // Notify player of progress update
            const socketObj = io.sockets.sockets.get(player.socketId);
            if (socketObj) {
              socketObj.emit('challenge-progress-updated', {
                challengeId: challenge.id,
                progress: newProgress,
                completed: completed,
                challenge: {
                  title: challenge.title,
                  description: challenge.description,
                  type: challenge.type,
                  requirementType: challenge.requirement_type,
                  requirementValue: challenge.requirement_value,
                  rewardType: challenge.reward_type,
                  rewardValue: challenge.reward_value
                }
              });
            }
          }
        }
      } catch (challengeErr) {
        logger.error(`[Agent Challenges] Error updating progress for player ${player.userId}:`, challengeErr);
      }
    }

    // Cleanup: Remove battle from memory after 5 minutes (allow late spectators to see result)
    // Track timer for cleanup on shutdown (Medium #9 fix)
    const battleCleanupTimer = setTimeout(() => {
      if (global.agentBattles?.has(battleId)) {
        global.agentBattles.delete(battleId);
        logger.debug(`[Agent Battle] Cleaned up battle ${battleId} from memory`);
      }
      global.agentCleanupTimers?.delete(battleId);
    }, 5 * 60 * 1000);
    global.agentCleanupTimers?.set(battleId, battleCleanupTimer);
  }

  // ============================================================================
  // AGENT TOURNAMENT SOCKET EVENTS
  // ============================================================================

  /**
   * Join a tournament room to receive live updates
   */
  socket.on('join-agent-tournament', async (data) => {
    try {
      const { tournamentId } = data;
      if (!tournamentId) {
        socket.emit('error', { message: 'Tournament ID required' });
        return;
      }

      const roomName = `agent-tournament-${tournamentId}`;
      socket.join(roomName);
      logger.debug(`Socket ${socket.id} joined agent tournament room: ${roomName}`);

      socket.emit('joined-agent-tournament', { tournamentId });
    } catch (err) {
      logger.error('Error joining agent tournament:', err);
      socket.emit('error', { message: 'Failed to join tournament' });
    }
  });

  /**
   * Leave a tournament room
   */
  socket.on('leave-agent-tournament', async (data) => {
    try {
      const { tournamentId } = data;
      if (!tournamentId) return;

      const roomName = `agent-tournament-${tournamentId}`;
      socket.leave(roomName);
      logger.debug(`Socket ${socket.id} left agent tournament room: ${roomName}`);
    } catch (err) {
      logger.error('Error leaving agent tournament:', err);
    }
  });

  /**
   * Notify all tournament participants when bracket is updated
   * Called internally when matches complete or new rounds start
   */
  function notifyTournamentUpdate(tournamentId, updateType, data) {
    const roomName = `agent-tournament-${tournamentId}`;
    io.to(roomName).emit('agent-tournament-update', {
      tournamentId,
      updateType, // 'match-complete', 'round-start', 'tournament-complete'
      data
    });
  }

  /**
   * Notify specific players their match is ready
   */
  function notifyTournamentMatchReady(tournamentId, matchId, player1Id, player2Id) {
    // Find sockets for both players
    const sockets = Array.from(io.sockets.sockets.values());

    for (const playerSocket of sockets) {
      if (playerSocket.userId === player1Id || playerSocket.userId === player2Id) {
        playerSocket.emit('agent-tournament-match-ready', {
          tournamentId,
          matchId,
          message: 'Your tournament match is ready to start!'
        });
      }
    }
  }

  // Make helper functions available globally for use in routes
  if (!global.tournamentNotifiers) {
    global.tournamentNotifiers = {
      notifyTournamentUpdate,
      notifyTournamentMatchReady
    };
  }
  }

  socket.on('disconnect', async () => {
  try {
    logger.debug('\n ===== SOCKET DISCONNECT =====');
    logger.debug(` Socket: ${socket.id?.substring(0, 8)}`);

    // Clean up throttle and rate limit state for this socket
    cleanupSocketThrottle(socket.id);
    cleanupSocketRateLimit(socket.id);

    // Clean up matchmaking interval using helper
    clearSocketInterval(socket, 'matchCheckInterval');

    // Clean up agent matchmaking queue on disconnect
    if (global.agentMatchmakingQueue) {
      for (const [oderId, entry] of global.agentMatchmakingQueue.entries()) {
        if (entry.socketId === socket.id) {
          // Bug 4 follow-up: refund the held reservation on socket disconnect.
          if (entry.reservationId) {
            releaseReservation(entry.reservationId).catch(refundErr => {
              logger.warn(`[Agent Queue] releaseReservation failed on disconnect user=${oderId}: ${refundErr.message}`);
            });
          }
          global.agentMatchmakingQueue.delete(oderId);
          // Also clear matchmaking lock for this user (High #5 fix)
          if (global.agentMatchmakingLocks) {
            global.agentMatchmakingLocks.delete(oderId);
          }
          logger.debug(`[Agent Queue] Removed ${entry.username} (user ${oderId}) from agent queue on disconnect`);
          break;
        }
      }
    }

    // Clean up rematch requests on disconnect
    if (global.agentRematchRequests) {
      for (const [battleId, requests] of global.agentRematchRequests.entries()) {
        // Remove any requests from this socket
        for (const [oderId, request] of requests.entries()) {
          if (request.socketId === socket.id) {
            requests.delete(oderId);
            logger.debug(`[Agent Rematch] Removed rematch request for user ${oderId} on disconnect`);
          }
        }
        // Clean up empty battle request maps
        if (requests.size === 0) {
          global.agentRematchRequests.delete(battleId);
        }
      }
    }

    // Clean up rematch locks on disconnect
    if (global.agentRematchLocks) {
      // We can't easily know which battles this user was involved in,
      // so we rely on the timeout cleanup in the rematch handler
    }

    // Clean up agent battle spectators on disconnect
    if (socket.agentBattleRooms && global.agentBattles) {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (token) {
        try {
          const decoded = await verifySessionClaims(token);
          const userId = decoded.sub;

          for (const battleId of socket.agentBattleRooms) {
            const battle = global.agentBattles.get(battleId);
            if (battle && battle.spectators) {
              battle.spectators.delete(userId);

              // Emit updated spectator count
              const roomName = `agent-battle-${battleId}`;
              io.to(roomName).emit('spectator-count-update', {
                battleId,
                spectatorCount: battle.spectators.size
              });

              logger.debug(`[Agent Battle] Removed spectator ${userId} from battle ${battleId} on disconnect`);
            }
          }
        } catch (err) {
          logger.error('Error cleaning up agent battle spectators on disconnect:', err);
        }
      }
    }

    // CRITICAL FIX: Don't immediately remove from queue
    // Give them 5 seconds to reconnect (for page navigation)
    let playerInQueue = null;
    let playerIdToRemove = null;
    
    for (const [playerId, player] of matchmakingQueue.entries()) {
      if (player.socketId === socket.id) {
        playerInQueue = player;
        playerIdToRemove = playerId;
        break;
      }
    }
    
    if (playerInQueue) {
      logger.debug(` Player ${playerInQueue.playerName} disconnected but in queue`);

      // Clear any existing pending timeout for this player to prevent duplicates
      const existingTimeout = pendingDisconnectTimeouts.get(playerIdToRemove);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        pendingDisconnectTimeouts.delete(playerIdToRemove);
      }

      // Check if player just declined a match and wants to stay in queue
      const timeoutDuration = playerInQueue.skipAndStayInQueue ? 10000 : 5000;
      const timeoutReason = playerInQueue.skipAndStayInQueue ? 'skip-and-stay' : 'normal disconnect';

      if (playerInQueue.skipAndStayInQueue) {
        logger.info(' Player has skipAndStayInQueue flag - NOT removing from queue');
        logger.debug(' Waiting for them to reconnect with update-queue-socket...');
      } else {
        logger.debug('  Waiting 5 seconds for reconnection before removing...');
      }

      const timeoutId = setTimeout(() => {
        // Clean up timeout tracking
        pendingDisconnectTimeouts.delete(playerIdToRemove);

        const stillInQueue = matchmakingQueue.get(playerIdToRemove);
        if (stillInQueue && stillInQueue.socketId === socket.id) {
          matchmakingQueue.delete(playerIdToRemove);
          logger.warn(` Removed ${playerInQueue.playerName} from queue (${timeoutReason} timeout)`);
          updateQueuePositions();
        } else if (stillInQueue) {
          logger.info(` ${playerInQueue.playerName} reconnected with new socket`);
        } else {
          logger.debug(`  ${playerInQueue.playerName} already left queue`);
        }
      }, timeoutDuration);

      // Cap map size to prevent unbounded growth
      if (pendingDisconnectTimeouts.size > 10000) {
        const entriesToRemove = [...pendingDisconnectTimeouts.entries()].slice(0, 1000);
        for (const [key, tid] of entriesToRemove) {
          clearTimeout(tid);
          pendingDisconnectTimeouts.delete(key);
          // Also remove from matchmaking queue to prevent zombie entries
          const queueEntry = matchmakingQueue.get(key);
          if (queueEntry) {
            matchmakingQueue.delete(key);
            logger.warn(`[Memory] Evicted zombie queue entry for player ${key}`);
          }
        }
        logger.warn(`[Memory] Evicted 1000 stale pendingDisconnectTimeouts entries`);
        updateQueuePositions();
      }

      // Track the timeout so it can be cancelled on reconnection
      pendingDisconnectTimeouts.set(playerIdToRemove, timeoutId);
    } else {
  logger.debug('  Socket not in matchmaking queue');
}
    
    const connection = playerConnections.get(socket.id);
    if (connection) {
      const { battleId, playerId } = connection;
      
      const battle = battles.get(battleId);
      
      if (battle) {
        const player = battle.players.find(p => p.id === playerId);
        if (player) {
          player.socketId = null;
          
          socket.to(battleId).emit('player-disconnected', {
            playerId,
            playerName: player.name,
            message: `${player.name} has disconnected`
          });

          // Grace-then-forfeit: if they don't reconnect within the grace window, forfeit them
          // (opponent wins) rather than leaving the opponent to wait out the full timer. The timer
          // re-fetches and re-checks state at fire time, so a reconnect (which re-sets socketId on
          // join-battle) makes it a no-op.
          if (battle.state === 'coding' && !battle.isAgainstBot) {
            const fkey = `${battleId}:${playerId}`;
            const existing = battleDisconnectForfeitTimeouts.get(fkey);
            if (existing) clearTimeout(existing);
            const ftid = setTimeout(async () => {
              battleDisconnectForfeitTimeouts.delete(fkey);
              const b = battles.get(battleId);
              const p = b && b.players.find(pl => pl.id === playerId);
              if (b && b.state === 'coding' && p && !p.socketId) {
                await handleBattleForfeit(battleId, playerId);
              }
            }, DISCONNECT_FORFEIT_GRACE_MS);
            if (ftid.unref) ftid.unref();
            battleDisconnectForfeitTimeouts.set(fkey, ftid);
          }
        }
      }
      
      playerConnections.delete(socket.id);
    }

    // Clean up messaging socket mapping
    if (socket.userId && global.userSockets) {
      const userSockets = global.userSockets.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          global.userSockets.delete(socket.userId);
          // Update user online status and notify friends
          try {
            await dbHelper.setUserOnlineStatus(socket.userId, false);
            const friends = await dbHelper.getUserFriends(socket.userId);
            friends.forEach(friend => {
              const friendSockets = global.userSockets.get(friend.id);
              if (friendSockets) {
                friendSockets.forEach(socketId => {
                  io.to(socketId).emit('friend-offline', { friendId: socket.userId });
                });
              }
            });
          } catch (err) {
            logger.error('Error updating offline status or notifying friends:', err.message);
          }
        }
      }
    }

    logger.info(' Disconnect handled');
    
  } catch (error) {
    logger.error('❌ Disconnect error:', error);
  }
  });
});

// Version endpoint for deploy verification
app.get('/api/version', (req, res) => {
  res.json({ version: '2026-04-11-v3', deployed: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    success: false,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

function clearAllIntervals() {
  if (queueCleanupInterval) clearInterval(queueCleanupInterval);
  if (staleBattleCleanupInterval) clearInterval(staleBattleCleanupInterval);
  if (rateLimitCleanupInterval) clearInterval(rateLimitCleanupInterval);
  if (staleLockCleanupInterval) clearInterval(staleLockCleanupInterval);
  if (tournamentStatusInterval) clearInterval(tournamentStatusInterval);
  if (tournamentMatchReadyCleanupInterval) clearInterval(tournamentMatchReadyCleanupInterval);
  if (timerSyncInterval) clearInterval(timerSyncInterval);
  cleanupFriendsInterval();

  // Clear all agent battle cleanup timers (Medium #9 fix)
  if (global.agentCleanupTimers) {
    for (const [battleId, timerId] of global.agentCleanupTimers.entries()) {
      clearTimeout(timerId);
      logger.debug(`[Shutdown] Cleared cleanup timer for battle ${battleId}`);
    }
    global.agentCleanupTimers.clear();
  }

}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  clearAllIntervals();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  clearAllIntervals();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Global error handlers for async errors that slip through
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
  // Don't exit - log and continue (the server is resilient)
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  // For uncaught exceptions, we should exit after logging
  // Give time for the log to be written
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

const PORT = process.env.PORT || 3001;

// Initialize database and run migrations before starting server
dbHelper.init().then(async () => {
  // Store interval IDs for cleanup (used in tests)
  const intervalIds = [];

  // ============================================
  // BATTLE PERSISTENCE: Restore battles from snapshots
  // ============================================
  try {
    const snapshots = await dbHelper.getActiveBattleSnapshots();
    if (snapshots.length > 0) {
      logger.info(`[BattlePersistence] Restoring ${snapshots.length} battles from snapshots...`);
      let restoredCount = 0;
      for (const snapshot of snapshots) {
        const battle = snapshot.battleData;
        // Validate battle has required fields
        if (!battle || !battle.id || !battle.players || !battle.problem) {
          logger.warn(`[BattlePersistence] Skipping invalid snapshot ${snapshot.battleId}`);
          await dbHelper.deleteBattleSnapshot(snapshot.battleId);
          continue;
        }
        // Clear socket IDs since connections are lost after restart
        battle.players.forEach(p => {
          p.socketId = null;
        });
        // Restore battle to in-memory map
        battles.set(snapshot.battleId, battle);
        // Re-arm the bot's submission timer; the timeout handle is never serialized,
        // so without this a restored bot battle has a permanently inert opponent
        if (battle.isAgainstBot && battle.state === 'coding' && !battle.winner) {
          try {
            scheduleBotSubmission(battle);
          } catch (botErr) {
            logger.warn(`[BattlePersistence] Failed to reschedule bot for battle ${snapshot.battleId}:`, botErr?.message);
          }
        }
        restoredCount++;
        logger.info(`[BattlePersistence] Restored battle ${snapshot.battleId} (state: ${snapshot.state})`);
      }
      logger.info(`[BattlePersistence] Successfully restored ${restoredCount} battles`);
    }
    // Cleanup stale snapshots
    const staleCount = await dbHelper.cleanupStaleBattleSnapshots();
    if (staleCount > 0) {
      logger.info(`[BattlePersistence] Cleaned up ${staleCount} stale snapshots`);
    }
  } catch (err) {
    logger.error('[BattlePersistence] Failed to restore battles:', err);
  }

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(` Battle server running on port ${PORT}`);
    logger.info(` Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(` Total problems loaded: ${problemsLoader.count()}`);
    logger.info(` Server started at: ${new Date().toISOString()}`);
    logger.info('Version 2.3.1 - PROBLEMS MODULE FIXED');
    logger.info('All systems operational');

    // Initialize and start the scheduler for weekly emails
    // - Weekly challenge emails pick from the open problem set
    // - Weekly progress digests use dbHelper for Pro user stats
    scheduler.init(dbHelper, problemsLoader.getAll(), dbHelper);
    scheduler.startScheduledJobs();

    // Nightly offsite DB backup. No-op unless BACKUP_S3_BUCKET is configured, so it
    // is safe to ship before the bucket exists; it activates on the next restart
    // after BACKUP_S3_BUCKET (+ creds) are set. See services/backupScheduler.js.
    require('./services/backupScheduler').startBackupScheduler();

    // Start periodic cleanup of stale socket throttle entries (every 5 minutes)
    const throttleCleanupInterval = setInterval(() => cleanupStaleThrottles(io), 5 * 60 * 1000);
    intervalIds.push(throttleCleanupInterval);
    logger.info('[Socket] Throttle cleanup scheduler started');

    // Battle Persistence: Save active battle snapshots every 30 seconds
    const battleSnapshotInterval = setInterval(async () => {
      try {
        let savedCount = 0;
        for (const [battleId, battle] of battles) {
          // Only persist active battles (not finished)
          if (['waiting', 'ready', 'coding'].includes(battle.state)) {
            // Create a serializable copy of battle data (exclude non-serializable properties like setTimeout handles)
            const serializableBattle = { ...battle };
            delete serializableBattle.botSubmitTimeout;
            delete serializableBattle.timer;
            delete serializableBattle.interval;
            await dbHelper.saveBattleSnapshot(battleId, battle.state, serializableBattle);
            savedCount++;
          }
        }
        if (savedCount > 0) {
          logger.debug(`[BattlePersistence] Saved ${savedCount} battle snapshots`);
        }
      } catch (err) {
        logger.error('[BattlePersistence] Failed to save snapshots:', err?.message || err, err?.stack);
      }
    }, 30 * 1000); // Every 30 seconds
    intervalIds.push(battleSnapshotInterval);
    logger.info('[BattlePersistence] Battle snapshot scheduler started (30s interval)');

    // GDPR Data Retention: Run cleanup on startup and schedule daily
    if (process.env.NODE_ENV !== 'test') {
      (async () => {
        try {
          logger.info('[DataRetention] Running initial cleanup...');
          const results = await dbHelper.runDataRetentionCleanup();
          logger.info(`[DataRetention] Cleanup complete: ${results.messagesDeleted} messages, ${results.activityLogsDeleted} activity logs, ${results.codingSessionsDeleted} coding sessions deleted`);
        } catch (err) {
          logger.warn('[DataRetention] Initial cleanup failed:', err.message);
        }
      })();

      // Schedule daily cleanup at 3 AM UTC
      const dataRetentionInterval = setInterval(async () => {
        const now = new Date();
        if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) {
          try {
            logger.info('[DataRetention] Running scheduled daily cleanup...');
            const results = await dbHelper.runDataRetentionCleanup();
            logger.info(`[DataRetention] Daily cleanup complete: ${results.messagesDeleted} messages, ${results.activityLogsDeleted} activity logs deleted`);
          } catch (err) {
            logger.warn('[DataRetention] Daily cleanup failed:', err.message);
          }
        }
      }, 5 * 60 * 1000); // Check every 5 minutes
      intervalIds.push(dataRetentionInterval);

    }
  });

  // Cleanup function for tests
  module.exports.cleanup = () => {
    // Clear all intervals
    intervalIds.forEach(id => clearInterval(id));
    intervalIds.length = 0;
    // Stop scheduler
    if (scheduler.stop) {
      scheduler.stop();
    }
  };

  // Export for tests
  module.exports.app = app;
  module.exports.server = server;
  module.exports.io = io;

}).catch(err => {
  logger.error('Failed to initialize database:', err);
  process.exit(1);
});
