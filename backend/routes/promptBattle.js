const express = require('express')
const { authMiddleware } = require('./auth')
const promptEngineeringLoader = require('../services/promptEngineeringLoader')
const {
  getAvailablePromptBattleModels,
  getDefaultPromptBattleModelId
} = require('../services/promptBattleRunner')
const db = require('../db')
const logger = require('../utils/logger')

const router = express.Router()

/**
 * GET /api/prompt-battle/config
 * Models list for Quick Match (prompt) and prompt-battle UI.
 */
router.get('/config', authMiddleware, (req, res) => {
  try {
    const availableModels = getAvailablePromptBattleModels()
    const defaultModelId = getDefaultPromptBattleModelId()
    res.json({
      success: true,
      availableModels,
      defaultModelId
    })
  } catch (err) {
    logger.error('[prompt-battle] config:', err)
    res.status(500).json({ error: 'Failed to load prompt battle config' })
  }
})

router.get('/problems', authMiddleware, (req, res) => {
  try {
    res.json({ problems: promptEngineeringLoader.listSummaries() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load problems' })
  }
})

/**
 * GET /api/prompt-battle/history
 * Get prompt battle history for the current user
 * Query params: limit (default 20), offset (default 0)
 */
router.get('/history', authMiddleware, async (req, res, next) => {
  try {
    const userId = String(req.user.sub)
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 20, 50))
    const offset = Math.max(0, parseInt(req.query.offset) || 0)

    // Get battles where user was player1 or player2
    const battles = await db.all(
      `SELECT
        id, room_code,
        player1_id, player1_username,
        player2_id, player2_username,
        problem_id, problem_title, difficulty, duration_sec,
        player1_score, player2_score,
        player1_adjusted_score, player2_adjusted_score,
        player1_submit_count, player2_submit_count,
        winner_id, is_tie,
        started_at, finished_at
       FROM prompt_battle_history
       WHERE player1_id = ? OR player2_id = ?
       ORDER BY finished_at DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, limit, offset]
    )

    // Get total count for pagination
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM prompt_battle_history
       WHERE player1_id = ? OR player2_id = ?`,
      [userId, userId]
    )

    // Format battles for response
    const formattedBattles = battles.map(battle => {
      const isPlayer1 = String(battle.player1_id) === userId
      const myScore = isPlayer1 ? battle.player1_adjusted_score : battle.player2_adjusted_score
      const opponentScore = isPlayer1 ? battle.player2_adjusted_score : battle.player1_adjusted_score
      const opponentUsername = isPlayer1 ? battle.player2_username : battle.player1_username

      let outcome = 'loss'
      if (battle.is_tie === 1) {
        outcome = 'tie'
      } else if (String(battle.winner_id) === userId) {
        outcome = 'win'
      }

      return {
        id: battle.id,
        roomCode: battle.room_code,
        problemId: battle.problem_id,
        problemTitle: battle.problem_title,
        difficulty: battle.difficulty,
        durationSec: battle.duration_sec,
        opponent: {
          username: opponentUsername || 'Unknown'
        },
        myScore: Math.round((myScore || 0) * 10) / 10,
        opponentScore: Math.round((opponentScore || 0) * 10) / 10,
        outcome,
        startedAt: battle.started_at,
        finishedAt: battle.finished_at
      }
    })

    // Calculate stats
    const stats = await db.get(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN is_tie = 1 THEN 1 ELSE 0 END) as ties,
        SUM(CASE WHEN winner_id != ? AND winner_id IS NOT NULL AND is_tie = 0 THEN 1 ELSE 0 END) as losses
       FROM prompt_battle_history
       WHERE player1_id = ? OR player2_id = ?`,
      [userId, userId, userId, userId]
    )

    res.json({
      success: true,
      battles: formattedBattles,
      stats: {
        total: stats?.total || 0,
        wins: stats?.wins || 0,
        losses: stats?.losses || 0,
        ties: stats?.ties || 0,
        winRate: stats?.total > 0
          ? Math.round((stats.wins / stats.total) * 1000) / 10
          : 0
      },
      pagination: {
        limit,
        offset,
        total: countResult?.total || 0,
        hasMore: offset + limit < (countResult?.total || 0)
      }
    })
  } catch (err) {
    logger.error('[Prompt Battle History] Error fetching history:', err)
    next(err)
  }
})

/**
 * GET /api/prompt-battle/history/:id
 * Get details of a specific prompt battle
 */
router.get('/history/:id', authMiddleware, async (req, res, next) => {
  try {
    const userId = String(req.user.sub)
    const battleId = parseInt(req.params.id)

    if (isNaN(battleId)) {
      return res.status(400).json({ error: 'Invalid battle ID' })
    }

    const battle = await db.get(
      `SELECT * FROM prompt_battle_history WHERE id = ?`,
      [battleId]
    )

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' })
    }

    // Check if user was a participant
    if (String(battle.player1_id) !== userId && String(battle.player2_id) !== userId) {
      return res.status(403).json({ error: 'You were not a participant in this battle' })
    }

    const isPlayer1 = String(battle.player1_id) === userId

    // Parse token usage
    let player1TokenUsage = null
    let player2TokenUsage = null
    try {
      if (battle.player1_token_usage) {
        player1TokenUsage = JSON.parse(battle.player1_token_usage)
      }
      if (battle.player2_token_usage) {
        player2TokenUsage = JSON.parse(battle.player2_token_usage)
      }
    } catch {
      // Ignore parse errors
    }

    let outcome = 'loss'
    if (battle.is_tie === 1) {
      outcome = 'tie'
    } else if (String(battle.winner_id) === userId) {
      outcome = 'win'
    }

    res.json({
      success: true,
      battle: {
        id: battle.id,
        roomCode: battle.room_code,
        problemId: battle.problem_id,
        problemTitle: battle.problem_title,
        difficulty: battle.difficulty,
        durationSec: battle.duration_sec,
        outcome,
        isTie: battle.is_tie === 1,
        me: {
          prompt: isPlayer1 ? battle.player1_prompt : battle.player2_prompt,
          score: isPlayer1 ? battle.player1_score : battle.player2_score,
          adjustedScore: isPlayer1 ? battle.player1_adjusted_score : battle.player2_adjusted_score,
          submitCount: isPlayer1 ? battle.player1_submit_count : battle.player2_submit_count,
          modelOutput: isPlayer1 ? battle.player1_model_output : battle.player2_model_output,
          tokenUsage: isPlayer1 ? player1TokenUsage : player2TokenUsage
        },
        opponent: {
          username: isPlayer1 ? battle.player2_username : battle.player1_username,
          score: isPlayer1 ? battle.player2_score : battle.player1_score,
          adjustedScore: isPlayer1 ? battle.player2_adjusted_score : battle.player1_adjusted_score,
          submitCount: isPlayer1 ? battle.player2_submit_count : battle.player1_submit_count
        },
        startedAt: battle.started_at,
        finishedAt: battle.finished_at
      }
    })
  } catch (err) {
    logger.error('[Prompt Battle History] Error fetching battle details:', err)
    next(err)
  }
})

module.exports = router
