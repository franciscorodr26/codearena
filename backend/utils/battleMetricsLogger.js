/**
 * Battle Metrics Logger
 *
 * Structured logging utility for agent battles with correlation IDs,
 * consistent field naming, and performance metrics tracking.
 */

const logger = require('./logger');

/**
 * Create a battle-specific logger with traceId preset
 * @param {string} battleId - Unique battle identifier
 * @returns {Object} - Logger methods scoped to this battle
 */
function createBattleLogger(battleId) {
  const traceId = `battle-${battleId}`;

  return {
    traceId,

    /**
     * Log battle initialization
     */
    start(players, problem) {
      logger.info('Agent battle starting', {
        traceId,
        operation: 'agent-battle',
        stage: 'initialization',
        player1: {
          userId: players[0]?.userId,
          loadoutId: players[0]?.loadoutId,
          model: players[0]?.model
        },
        player2: {
          userId: players[1]?.userId,
          loadoutId: players[1]?.loadoutId,
          model: players[1]?.model
        },
        problem: {
          id: problem?.id,
          difficulty: problem?.difficulty,
          category: problem?.category
        },
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log code generation start
     */
    generationStart(playerId, loadout) {
      const spanId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.debug('Starting code generation', {
        traceId,
        spanId,
        stage: 'generation',
        playerId,
        model: loadout?.model,
        language: loadout?.language,
        modules: loadout?.modules || [],
        hasCustomPrompt: !!loadout?.systemPrompt,
        timestamp: new Date().toISOString()
      });
      return spanId;
    },

    /**
     * Log token usage checkpoint (call sparingly - high frequency)
     */
    tokenCheckpoint(playerId, spanId, tokens, elapsedMs) {
      logger.debug('Token usage checkpoint', {
        traceId,
        spanId,
        stage: 'generation',
        playerId,
        metrics: {
          tokens: {
            input: tokens?.input || 0,
            output: tokens?.output || 0,
            total: tokens?.total || 0
          }
        },
        elapsedMs,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log tool invocation
     */
    toolInvocation(playerId, spanId, toolName, durationMs, success) {
      logger.debug('Tool invocation', {
        traceId,
        spanId,
        stage: 'generation',
        playerId,
        tool: toolName,
        durationMs,
        success,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log generation completion
     */
    generationComplete(playerId, spanId, result) {
      logger.info('Code generation completed', {
        traceId,
        spanId,
        stage: 'generation',
        playerId,
        success: result?.success ?? true,
        metrics: {
          tokens: result?.tokensUsed || {},
          generationTimeMs: result?.generationTimeMs,
          toolCalls: result?.toolCalls?.length || 0,
          codeLines: result?.code?.split('\n').length || 0
        },
        error: result?.error ? {
          type: 'generation',
          message: result.error
        } : null,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log validation results
     */
    validationComplete(playerId, results, validationTimeMs) {
      const passed = results?.filter(r => r.passed)?.length || 0;
      const total = results?.length || 0;

      logger.info('Code validation completed', {
        traceId,
        stage: 'validation',
        playerId,
        metrics: {
          tests: {
            passed,
            failed: total - passed,
            total,
            passRate: total > 0 ? passed / total : 0
          },
          validationTimeMs
        },
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log battle completion
     */
    complete(winnerId, players, battleDurationMs) {
      logger.info('Agent battle completed', {
        traceId,
        operation: 'agent-battle',
        stage: 'completion',
        winnerId,
        isTie: winnerId === null,
        players: players.map(p => ({
          playerId: p.userId,
          metrics: {
            tokens: p.tokensUsed || {},
            generationTimeMs: p.generationTimeMs,
            testsPassed: p.testsPassed,
            testsTotal: p.testsTotal
          },
          eloChange: p.eloChange
        })),
        battleDurationMs,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log battle error
     */
    error(stage, error, context = {}) {
      logger.error('Battle execution error', {
        traceId,
        stage,
        error: {
          type: error?.type || 'unknown',
          message: error?.message || String(error),
          code: error?.code
        },
        ...context,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log warning
     */
    warn(message, context = {}) {
      logger.warn(message, {
        traceId,
        ...context,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log info
     */
    info(message, context = {}) {
      logger.info(message, {
        traceId,
        ...context,
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Log debug
     */
    debug(message, context = {}) {
      logger.debug(message, {
        traceId,
        ...context,
        timestamp: new Date().toISOString()
      });
    }
  };
}

/**
 * Log a standalone battle metric (for one-off logging without context)
 */
function logBattleMetric(battleId, event, data) {
  logger.info(`Battle metric: ${event}`, {
    traceId: `battle-${battleId}`,
    event,
    ...data,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log matchmaking event
 */
function logMatchmaking(event, data) {
  logger.info(`Matchmaking: ${event}`, {
    operation: 'matchmaking',
    event,
    ...data,
    timestamp: new Date().toISOString()
  });
}

/**
 * Log queue event
 */
function logQueue(event, userId, data = {}) {
  logger.debug(`Queue: ${event}`, {
    operation: 'queue',
    event,
    userId,
    ...data,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  createBattleLogger,
  logBattleMetric,
  logMatchmaking,
  logQueue
};
