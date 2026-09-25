/**
 * Season Service
 * Handles agent battle season rotation, rewards, and rankings
 */

const db = require('../db');
const logger = require('../utils/logger');

/**
 * Get the current active season
 */
async function getCurrentSeason() {
  try {
    const season = await db.get(
      'SELECT * FROM agent_seasons WHERE is_active = 1 ORDER BY season_number DESC LIMIT 1'
    );
    return season || null;
  } catch (err) {
    logger.error('[Season Service] Error getting current season:', err);
    throw err;
  }
}

/**
 * Get a season by ID
 */
async function getSeasonById(seasonId) {
  try {
    const season = await db.get(
      'SELECT * FROM agent_seasons WHERE id = ?',
      [seasonId]
    );
    return season || null;
  } catch (err) {
    logger.error('[Season Service] Error getting season by ID:', err);
    throw err;
  }
}

/**
 * Get user's ranking in a season
 */
async function getUserSeasonRanking(userId, seasonId) {
  try {
    const ranking = await db.get(
      `SELECT r.*, l.name as loadout_name, l.model, l.language
       FROM agent_season_rankings r
       JOIN agent_loadouts l ON r.loadout_id = l.id
       WHERE r.user_id = ? AND r.season_id = ?
       ORDER BY r.final_rank ASC
       LIMIT 1`,
      [userId, seasonId]
    );
    return ranking || null;
  } catch (err) {
    logger.error('[Season Service] Error getting user season ranking:', err);
    throw err;
  }
}

/**
 * Get top rankings for a season
 */
async function getSeasonLeaderboard(seasonId, limit = 100) {
  try {
    const rankings = await db.all(
      `SELECT
        r.*,
        u.username,
        u.avatar,
        l.name as loadout_name,
        l.model,
        l.language
       FROM agent_season_rankings r
       JOIN users u ON r.user_id = u.id
       JOIN agent_loadouts l ON r.loadout_id = l.id
       WHERE r.season_id = ?
       ORDER BY r.final_rank ASC
       LIMIT ?`,
      [seasonId, limit]
    );
    return rankings;
  } catch (err) {
    logger.error('[Season Service] Error getting season leaderboard:', err);
    throw err;
  }
}

/**
 * Get all past seasons
 */
async function getPastSeasons() {
  try {
    const seasons = await db.all(
      'SELECT * FROM agent_seasons WHERE is_active = 0 ORDER BY season_number DESC'
    );
    return seasons;
  } catch (err) {
    logger.error('[Season Service] Error getting past seasons:', err);
    throw err;
  }
}

/**
 * Calculate season rewards based on final rank
 */
function calculateSeasonRewards(finalRank, totalParticipants) {
  const rewards = {
    badge: null,
    eloBonus: 0,
    rank: finalRank
  };

  // Top 1: Champion badge + 500 ELO
  if (finalRank === 1) {
    rewards.badge = 'season-champion';
    rewards.eloBonus = 500;
  }
  // Top 3: Podium badge + 200 ELO
  else if (finalRank <= 3) {
    rewards.badge = 'season-podium';
    rewards.eloBonus = 200;
  }
  // Top 10: Elite badge + 100 ELO
  else if (finalRank <= 10) {
    rewards.badge = 'season-elite';
    rewards.eloBonus = 100;
  }
  // Top 25%: Competitor badge + 50 ELO
  else if (finalRank <= Math.ceil(totalParticipants * 0.25)) {
    rewards.badge = 'season-competitor';
    rewards.eloBonus = 50;
  }
  // Everyone else who participated: 25 ELO
  else {
    rewards.eloBonus = 25;
  }

  return rewards;
}

/**
 * Award badge to user
 */
async function awardBadge(userId, badgeSlug) {
  try {
    // Get badge ID
    const badge = await db.get('SELECT id FROM badges WHERE slug = ?', [badgeSlug]);
    if (!badge) {
      logger.warn(`[Season Service] Badge not found: ${badgeSlug}`);
      return false;
    }

    // Award badge (INSERT OR IGNORE to prevent duplicates)
    await db.run(
      'INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)',
      [userId, badge.id]
    );

    logger.info(`[Season Service] Awarded badge ${badgeSlug} to user ${userId}`);
    return true;
  } catch (err) {
    logger.error('[Season Service] Error awarding badge:', err);
    throw err;
  }
}

/**
 * Claim season rewards for a user
 */
async function claimSeasonRewards(userId, seasonId) {
  try {
    // Get user's ranking
    const ranking = await db.get(
      `SELECT * FROM agent_season_rankings
       WHERE user_id = ? AND season_id = ?
       ORDER BY final_rank ASC
       LIMIT 1`,
      [userId, seasonId]
    );

    if (!ranking) {
      return { success: false, error: 'No ranking found for this season' };
    }

    // Fast-fail pre-check to avoid wasted work when reward is obviously already
    // claimed. The atomic claim below is still the source of truth for races.
    if (ranking.reward_claimed) {
      return { success: false, error: 'Rewards already claimed' };
    }

    // Get total participants to calculate percentile
    const totalParticipants = await db.get(
      'SELECT COUNT(DISTINCT user_id) as count FROM agent_season_rankings WHERE season_id = ?',
      [seasonId]
    );

    // Calculate rewards
    const rewards = calculateSeasonRewards(ranking.final_rank, totalParticipants.count);

    // ATOMIC CLAIM: flip reward_claimed 0 -> 1 in a single UPDATE guarded by the
    // current value. Only ONE concurrent caller can see changes === 1; the rest
    // see changes === 0 and bail out before granting anything. This is what
    // prevents the double-grant race that an "if (claimed) ... else UPDATE"
    // pattern is vulnerable to.
    const claimResult = await db.run(
      'UPDATE agent_season_rankings SET reward_claimed = 1 WHERE id = ? AND reward_claimed = 0',
      [ranking.id]
    );

    if (!claimResult || claimResult.changes === 0) {
      // Someone else won the race (or row was already claimed between the
      // pre-check and now). Do NOT grant the reward.
      return { success: false, error: 'Rewards already claimed' };
    }

    // Claim is ours. Grant badge + ELO bonus. If either grant fails, attempt a
    // best-effort rollback so the user can retry. This is not a true atomic
    // transaction across tables, but it preserves the "one-shot reward"
    // invariant under the common failure modes.
    try {
      if (rewards.badge) {
        await awardBadge(userId, rewards.badge);
      }

      if (rewards.eloBonus > 0) {
        await db.run(
          'UPDATE agent_loadouts SET elo = elo + ? WHERE id = ?',
          [rewards.eloBonus, ranking.loadout_id]
        );
      }
    } catch (grantErr) {
      logger.error(
        `[Season Service] Reward grant failed after atomic claim for user ${userId}, season ${seasonId}; attempting rollback`,
        grantErr
      );
      try {
        await db.run(
          'UPDATE agent_season_rankings SET reward_claimed = 0 WHERE id = ? AND reward_claimed = 1',
          [ranking.id]
        );
      } catch (rollbackErr) {
        logger.error(
          `[Season Service] Failed to rollback reward_claimed for ranking ${ranking.id}, manual intervention may be required`,
          rollbackErr
        );
      }
      throw grantErr;
    }

    logger.info(`[Season Service] User ${userId} claimed season ${seasonId} rewards: ${JSON.stringify(rewards)}`);

    return {
      success: true,
      rewards: {
        ...rewards,
        badgeName: rewards.badge ? rewards.badge.replace('season-', '').replace('-', ' ') : null
      }
    };
  } catch (err) {
    logger.error('[Season Service] Error claiming season rewards:', err);
    throw err;
  }
}

/**
 * End the current season and snapshot rankings
 */
async function endCurrentSeason() {
  try {
    logger.info('[Season Service] Ending current season...');

    // Get current season
    const currentSeason = await getCurrentSeason();
    if (!currentSeason) {
      logger.warn('[Season Service] No active season to end');
      return { success: false, error: 'No active season' };
    }

    // Get all loadouts with their current stats
    const loadouts = await db.all(
      `SELECT
        l.id,
        l.user_id,
        l.elo,
        l.wins,
        l.losses,
        l.best_streak
       FROM agent_loadouts l
       WHERE (l.wins + l.losses) > 0
       ORDER BY l.elo DESC`
    );

    logger.info(`[Season Service] Found ${loadouts.length} active loadouts to snapshot`);

    // Snapshot each loadout's final ranking
    for (let i = 0; i < loadouts.length; i++) {
      const loadout = loadouts[i];
      const finalRank = i + 1;

      await db.run(
        `INSERT INTO agent_season_rankings (
          season_id, user_id, loadout_id, final_elo, final_rank, wins, losses, best_streak
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          currentSeason.id,
          loadout.user_id,
          loadout.id,
          loadout.elo,
          finalRank,
          loadout.wins,
          loadout.losses,
          loadout.best_streak
        ]
      );
    }

    // Deactivate current season
    await db.run(
      'UPDATE agent_seasons SET is_active = 0 WHERE id = ?',
      [currentSeason.id]
    );

    logger.info(`[Season Service] Season ${currentSeason.season_number} ended successfully`);

    return {
      success: true,
      seasonId: currentSeason.id,
      participants: loadouts.length
    };
  } catch (err) {
    logger.error('[Season Service] Error ending season:', err);
    throw err;
  }
}

/**
 * Reset all loadout ELOs (soft reset formula: (elo + 1000) / 2)
 */
async function resetLoadoutElos(softReset = true) {
  try {
    logger.info(`[Season Service] Resetting loadout ELOs (soft reset: ${softReset})...`);

    if (softReset) {
      // Soft reset: move everyone halfway back to 1000
      await db.run(
        `UPDATE agent_loadouts
         SET elo = CAST((elo + 1000) / 2 AS INTEGER),
             wins = 0,
             losses = 0,
             current_streak = 0,
             best_streak = 0`
      );
    } else {
      // Hard reset: everyone back to 1000
      await db.run(
        `UPDATE agent_loadouts
         SET elo = 1000,
             wins = 0,
             losses = 0,
             current_streak = 0,
             best_streak = 0`
      );
    }

    logger.info('[Season Service] ELO reset completed');
  } catch (err) {
    logger.error('[Season Service] Error resetting ELOs:', err);
    throw err;
  }
}

/**
 * Start a new season
 */
async function startNewSeason(seasonNumber, seasonName, durationDays = 30) {
  try {
    logger.info(`[Season Service] Starting new season: ${seasonName}`);

    const startsAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const result = await db.run(
      `INSERT INTO agent_seasons (season_number, name, starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [seasonNumber, seasonName, startsAt, endsAt]
    );

    logger.info(`[Season Service] New season ${seasonNumber} started with ID ${result.lastID}`);

    return {
      success: true,
      seasonId: result.lastID,
      seasonNumber,
      startsAt,
      endsAt
    };
  } catch (err) {
    logger.error('[Season Service] Error starting new season:', err);
    throw err;
  }
}

/**
 * Full season rotation: end current, reset ELOs, start new
 */
async function rotateSeason(newSeasonName, durationDays = 30, softReset = true) {
  try {
    logger.info('[Season Service] Starting season rotation...');

    // 1. End current season and snapshot rankings
    const endResult = await endCurrentSeason();
    if (!endResult.success) {
      return endResult;
    }

    // 2. Reset all loadout ELOs
    await resetLoadoutElos(softReset);

    // 3. Get next season number
    const lastSeason = await db.get(
      'SELECT season_number FROM agent_seasons ORDER BY season_number DESC LIMIT 1'
    );
    const nextSeasonNumber = (lastSeason?.season_number || 0) + 1;

    // 4. Start new season
    const startResult = await startNewSeason(
      nextSeasonNumber,
      newSeasonName || `Season ${nextSeasonNumber}`,
      durationDays
    );

    logger.info('[Season Service] Season rotation completed successfully');

    return {
      success: true,
      oldSeasonId: endResult.seasonId,
      newSeasonId: startResult.seasonId,
      newSeasonNumber: nextSeasonNumber,
      participants: endResult.participants
    };
  } catch (err) {
    logger.error('[Season Service] Error during season rotation:', err);
    throw err;
  }
}

/**
 * Check if current season has ended and needs rotation
 */
async function checkSeasonExpiration() {
  try {
    const currentSeason = await getCurrentSeason();
    if (!currentSeason) {
      logger.warn('[Season Service] No active season found');
      return { expired: false };
    }

    const now = new Date();
    const endDate = new Date(currentSeason.ends_at);

    if (now > endDate) {
      logger.info('[Season Service] Current season has expired, needs rotation');
      return { expired: true, season: currentSeason };
    }

    return { expired: false, season: currentSeason };
  } catch (err) {
    logger.error('[Season Service] Error checking season expiration:', err);
    throw err;
  }
}

module.exports = {
  getCurrentSeason,
  getSeasonById,
  getUserSeasonRanking,
  getSeasonLeaderboard,
  getPastSeasons,
  calculateSeasonRewards,
  claimSeasonRewards,
  endCurrentSeason,
  resetLoadoutElos,
  startNewSeason,
  rotateSeason,
  checkSeasonExpiration
};
