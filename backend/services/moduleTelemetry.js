/**
 * Module Telemetry Service
 *
 * Tracks module usage and win rates for balancing purposes.
 */

const logger = require('../utils/logger');

/**
 * Record module usage for a completed battle
 * @param {Object} db - Database instance
 * @param {Object} battleData - Battle completion data
 */
async function recordBattleModules(db, battleData) {
  const {
    player1Modules = [],
    player2Modules = [],
    winnerId,
    player1Id,
    player2Id,
    player1Tokens = 0,
    player2Tokens = 0
  } = battleData;

  const today = new Date().toISOString().split('T')[0];
  const isDraw = winnerId === null;

  // Determine outcome for each player
  const player1Won = !isDraw && winnerId === player1Id;
  const player2Won = !isDraw && winnerId === player2Id;

  // Record stats for player 1's modules
  for (const moduleId of player1Modules) {
    await updateModuleStats(db, moduleId, today, {
      used: 1,
      win: player1Won ? 1 : 0,
      loss: player2Won ? 1 : 0,
      draw: isDraw ? 1 : 0,
      tokens: player1Tokens
    });
  }

  // Record stats for player 2's modules
  for (const moduleId of player2Modules) {
    await updateModuleStats(db, moduleId, today, {
      used: 1,
      win: player2Won ? 1 : 0,
      loss: player1Won ? 1 : 0,
      draw: isDraw ? 1 : 0,
      tokens: player2Tokens
    });
  }
}

/**
 * Update module stats in the telemetry table
 */
async function updateModuleStats(db, moduleId, date, stats) {
  try {
    await db.run(`
      INSERT INTO module_telemetry (module_id, date, times_used, wins, losses, draws, total_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module_id, date) DO UPDATE SET
        times_used = times_used + excluded.times_used,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        draws = draws + excluded.draws,
        total_tokens = total_tokens + excluded.total_tokens
    `, [moduleId, date, stats.used, stats.win, stats.loss, stats.draw, stats.tokens]);
  } catch (err) {
    logger.warn(`[Module Telemetry] Failed to update stats for ${moduleId}:`, err.message);
  }
}

/**
 * Get module stats for a date range
 * @param {Object} db - Database instance
 * @param {Object} options - Query options
 * @returns {Array} Module stats
 */
async function getModuleStats(db, options = {}) {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate = new Date().toISOString().split('T')[0],
    moduleId = null
  } = options;

  let query = `
    SELECT
      module_id,
      SUM(times_used) as total_uses,
      SUM(wins) as total_wins,
      SUM(losses) as total_losses,
      SUM(draws) as total_draws,
      SUM(total_tokens) as total_tokens,
      ROUND(CAST(SUM(wins) AS FLOAT) / NULLIF(SUM(wins) + SUM(losses), 0) * 100, 1) as win_rate
    FROM module_telemetry
    WHERE date >= ? AND date <= ?
  `;

  const params = [startDate, endDate];

  if (moduleId) {
    query += ' AND module_id = ?';
    params.push(moduleId);
  }

  query += ' GROUP BY module_id ORDER BY total_uses DESC';

  try {
    const stats = await db.all(query, params);
    return stats.map(s => ({
      moduleId: s.module_id,
      totalUses: s.total_uses || 0,
      totalWins: s.total_wins || 0,
      totalLosses: s.total_losses || 0,
      totalDraws: s.total_draws || 0,
      totalTokens: s.total_tokens || 0,
      winRate: s.win_rate || 0,
      totalBattles: (s.total_wins || 0) + (s.total_losses || 0) + (s.total_draws || 0)
    }));
  } catch (err) {
    logger.error('[Module Telemetry] Failed to get stats:', err);
    return [];
  }
}

/**
 * Get daily module usage trends
 * @param {Object} db - Database instance
 * @param {string} moduleId - Module to get trends for
 * @param {number} days - Number of days of history
 * @returns {Array} Daily stats
 */
async function getModuleTrends(db, moduleId, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    const trends = await db.all(`
      SELECT
        date,
        times_used,
        wins,
        losses,
        draws,
        total_tokens,
        ROUND(CAST(wins AS FLOAT) / NULLIF(wins + losses, 0) * 100, 1) as win_rate
      FROM module_telemetry
      WHERE module_id = ? AND date >= ?
      ORDER BY date ASC
    `, [moduleId, startDate]);

    return trends.map(t => ({
      date: t.date,
      uses: t.times_used,
      wins: t.wins,
      losses: t.losses,
      draws: t.draws,
      tokens: t.total_tokens,
      winRate: t.win_rate || 0
    }));
  } catch (err) {
    logger.error('[Module Telemetry] Failed to get trends:', err);
    return [];
  }
}

/**
 * Get module combination stats (which modules are used together)
 * @param {Object} db - Database instance
 * @param {number} days - Days of history to analyze
 * @returns {Array} Combination stats
 */
async function getModuleCombinations(db, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    // Get battles with modules recorded
    const battles = await db.all(`
      SELECT
        player1_modules,
        player2_modules,
        winner_id,
        player1_id,
        player2_id
      FROM agent_battles
      WHERE created_at >= ?
        AND player1_modules IS NOT NULL
        AND player2_modules IS NOT NULL
        AND status = 'finished'
    `, [startDate]);

    // Count combinations
    const combos = {};

    for (const battle of battles) {
      const processModules = (modulesJson, playerId, winnerId) => {
        try {
          const modules = JSON.parse(modulesJson || '[]');
          if (modules.length === 2) {
            const key = modules.sort().join('+');
            if (!combos[key]) {
              combos[key] = { modules, uses: 0, wins: 0 };
            }
            combos[key].uses++;
            if (winnerId === playerId) {
              combos[key].wins++;
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      };

      processModules(battle.player1_modules, battle.player1_id, battle.winner_id);
      processModules(battle.player2_modules, battle.player2_id, battle.winner_id);
    }

    // Convert to array and calculate win rates
    return Object.entries(combos)
      .map(([key, data]) => ({
        combination: key,
        modules: data.modules,
        uses: data.uses,
        wins: data.wins,
        winRate: data.uses > 0 ? Math.round((data.wins / data.uses) * 100 * 10) / 10 : 0
      }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 20); // Top 20 combinations
  } catch (err) {
    logger.error('[Module Telemetry] Failed to get combinations:', err);
    return [];
  }
}

module.exports = {
  recordBattleModules,
  getModuleStats,
  getModuleTrends,
  getModuleCombinations
};
