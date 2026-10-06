/**
 * Agent Modules Routes
 *
 * Module unlock system for agent battles.
 */

const express = require('express');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');
const agentModules = require('../services/agentModules');
const moduleTelemetry = require('../services/moduleTelemetry');

const router = express.Router();

/**
 * GET /api/agent/modules
 * Get all available modules with unlock status for the current user
 */
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const modules = await agentModules.getModuleProgress(db, userId);

    res.json({
      success: true,
      modules
    });
  } catch (err) {
    logger.error('[Modules API] Error getting modules:', err);
    next(err);
  }
});

/**
 * GET /api/agent/modules/unlocked
 * Get list of unlocked module IDs for the current user
 */
router.get('/unlocked', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const unlockedIds = await agentModules.getUnlockedModules(db, userId);

    res.json({
      success: true,
      unlockedModules: unlockedIds
    });
  } catch (err) {
    logger.error('[Modules API] Error getting unlocked modules:', err);
    next(err);
  }
});

/**
 * POST /api/agent/modules/check-unlocks
 * Manually check and award any new module unlocks for the user
 */
router.post('/check-unlocks', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const newUnlocks = await agentModules.checkAndAwardUnlocks(db, userId, {});

    if (newUnlocks.length > 0) {
      logger.info(`[Modules API] User ${userId} unlocked modules: ${newUnlocks.join(', ')}`);
    }

    res.json({
      success: true,
      newUnlocks,
      unlockedModules: newUnlocks.map(id => agentModules.getModule(id))
    });
  } catch (err) {
    logger.error('[Modules API] Error checking unlocks:', err);
    next(err);
  }
});

/**
 * GET /api/agent/modules/stats
 * Get aggregated module usage statistics for balancing
 */
router.get('/stats', authMiddleware, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const stats = await moduleTelemetry.getModuleStats(db, {
      startDate,
      endDate
    });

    // Enrich with module details
    const enrichedStats = stats.map(s => ({
      ...s,
      module: agentModules.getModule(s.moduleId)
    }));

    res.json({
      success: true,
      stats: enrichedStats
    });
  } catch (err) {
    logger.error('[Modules API] Error getting stats:', err);
    next(err);
  }
});

/**
 * GET /api/agent/modules/combinations
 * Get module combination statistics
 */
router.get('/combinations', authMiddleware, async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const combinations = await moduleTelemetry.getModuleCombinations(db, days);

    res.json({
      success: true,
      combinations
    });
  } catch (err) {
    logger.error('[Modules API] Error getting combinations:', err);
    next(err);
  }
});

/**
 * GET /api/agent/modules/:id/trends
 * Get daily usage trends for a specific module
 */
router.get('/:id/trends', authMiddleware, async (req, res, next) => {
  try {
    const moduleId = req.params.id;
    const days = parseInt(req.query.days) || 30;

    const module = agentModules.getModule(moduleId);
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const trends = await moduleTelemetry.getModuleTrends(db, moduleId, days);

    res.json({
      success: true,
      moduleId,
      trends
    });
  } catch (err) {
    logger.error('[Modules API] Error getting trends:', err);
    next(err);
  }
});

/**
 * GET /api/agent/modules/:id
 * Get details for a specific module
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const moduleId = req.params.id;

    const module = agentModules.getModule(moduleId);
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    const isUnlocked = await agentModules.isModuleUnlocked(db, userId, moduleId);

    res.json({
      success: true,
      module: {
        ...module,
        isUnlocked
      }
    });
  } catch (err) {
    logger.error('[Modules API] Error getting module:', err);
    next(err);
  }
});

module.exports = router;
