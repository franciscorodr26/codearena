const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { authMiddleware } = require('./auth');
const db = require('../db');
const logger = require('../utils/logger');
const agentRunner = require('../services/agentRunner');
const problemsLoader = require('../problemsLoader');
const seasonService = require('../services/seasonService');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
const agentChallenges = require('../services/agentChallenges');
const agentModules = require('../services/agentModules');

// Sub-routers for split route files
const agentTrainingRoutes = require('./agentTrainingRoutes');
const agentModulesRoutes = require('./agentModulesRoutes');

// Mount sub-routers
router.use('/training', agentTrainingRoutes);
router.use('/modules', agentModulesRoutes);

// ============================================================================
// SECURITY: Input Validation and Sanitization
// ============================================================================

/**
 * Security constants
 */
const SECURITY_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_SYSTEM_PROMPT_LENGTH: 2000,
  MAX_TOOLS: 2
};

const VALID_MODELS = ['haiku', 'sonnet', 'opus'];
const VALID_TOOLS = ['run_code', 'auto_retry', 'docs_lookup']; // Legacy - kept for backward compatibility
const VALID_MODULES = Object.keys(agentModules.MODULES); // New module system
const VALID_LANGUAGES = [
  'python', 'javascript', 'typescript', 'java',
  'cpp', 'c', 'csharp', 'go', 'rust', 'sql'
];

function parseStoredModules(rawModules) {
  if (!rawModules) return [];

  if (Array.isArray(rawModules)) {
    return agentModules.normalizeModuleIds(rawModules);
  }

  if (typeof rawModules !== 'string') {
    return [];
  }

  try {
    return agentModules.normalizeModuleIds(JSON.parse(rawModules));
  } catch {
    return [];
  }
}

function formatStoredLoadoutSelections(rawModules) {
  const storedSelections = parseStoredModules(rawModules);
  const modules = [...new Set(
    storedSelections
      .map(selection => agentModules.getCanonicalModuleId(selection))
      .filter(Boolean)
  )];

  return {
    modules,
    tools: agentModules.getToolsFromModules(storedSelections)
  };
}

async function validateModuleSelectionForUser(userId, moduleIds) {
  const unlockedModules = await agentModules.getUnlockedModules(db, userId);
  const validation = agentModules.validateModuleSelection(moduleIds, unlockedModules);

  if (!validation.valid) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    throw error;
  }

  return validation.normalizedIds || [];
}

/**
 * Sanitize string input for XSS prevention
 * Escapes HTML entities to prevent script injection when displayed
 *
 * @param {string} input - Raw user input
 * @returns {string} - Sanitized string safe for display
 */
function sanitizeForXSS(input) {
  if (!input || typeof input !== 'string') return '';

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and sanitize loadout input
 * Returns sanitized data or throws an error with details
 *
 * @param {Object} input - Raw loadout input from request body
 * @returns {{ sanitized: Object, warnings: string[] }}
 */
function validateLoadoutInput(input) {
  const warnings = [];
  const errors = [];

  const { name, description, model, systemPrompt, language, tools } = input;
  const hasModulesField = Object.prototype.hasOwnProperty.call(input, 'modules');

  // Validate and sanitize name
  if (!name || typeof name !== 'string') {
    errors.push('Name is required');
  } else if (name.length < 1) {
    errors.push('Name cannot be empty');
  } else if (name.length > SECURITY_LIMITS.MAX_NAME_LENGTH) {
    errors.push(`Name must be ${SECURITY_LIMITS.MAX_NAME_LENGTH} characters or less`);
  }

  // Validate model
  if (!model || typeof model !== 'string') {
    errors.push('Model is required');
  } else if (!VALID_MODELS.includes(model.toLowerCase())) {
    errors.push(`Invalid model. Must be one of: ${VALID_MODELS.join(', ')}`);
  }

  // Validate language
  if (!language || typeof language !== 'string') {
    errors.push('Language is required');
  } else if (!VALID_LANGUAGES.includes(language.toLowerCase())) {
    errors.push(`Invalid language. Must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }

  // Validate description length
  if (description && typeof description === 'string' && description.length > SECURITY_LIMITS.MAX_DESCRIPTION_LENGTH) {
    errors.push(`Description must be ${SECURITY_LIMITS.MAX_DESCRIPTION_LENGTH} characters or less`);
  }

  // Validate system prompt length
  if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.length > SECURITY_LIMITS.MAX_SYSTEM_PROMPT_LENGTH) {
    errors.push(`System prompt must be ${SECURITY_LIMITS.MAX_SYSTEM_PROMPT_LENGTH} characters or less`);
  }

  // Validate modules (new system) or tools (legacy)
  // Accept either 'modules' or 'tools' field for backward compatibility
  const inputModules = hasModulesField ? input.modules : tools;
  let sanitizedModules = [];
  if (inputModules !== undefined) {
    if (!Array.isArray(inputModules)) {
      errors.push(hasModulesField ? 'Modules must be an array' : 'Tools must be an array');
    } else {
      sanitizedModules = agentModules.normalizeModuleIds(inputModules);
      if (sanitizedModules.length !== inputModules.filter(m => typeof m === 'string').length) {
        warnings.push(hasModulesField ? 'Some invalid modules were removed' : 'Some invalid tools were removed');
      }
      if (sanitizedModules.length > SECURITY_LIMITS.MAX_TOOLS) {
        sanitizedModules = sanitizedModules.slice(0, SECURITY_LIMITS.MAX_TOOLS);
        warnings.push(`${hasModulesField ? 'Modules' : 'Tools'} limited to ${SECURITY_LIMITS.MAX_TOOLS}`);
      }
    }
  }

  if (errors.length > 0) {
    const error = new Error(errors.join('. '));
    error.statusCode = 400;
    throw error;
  }

  return {
    sanitized: {
      name: sanitizeForXSS(name.trim()),
      description: description ? sanitizeForXSS(description.trim()) : '',
      model: model.toLowerCase(),
      systemPrompt: systemPrompt || '', // Sanitized in agentSolver.js before API call
      language: language.toLowerCase(),
      modules: sanitizedModules,
      tools: hasModulesField ? sanitizedModules : agentModules.getToolsFromModules(sanitizedModules)
    },
    warnings
  };
}

// Rate limiter for agent test runs: 20 requests per minute per user
// Prevents abuse of API resources and external service costs
const agentTestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many test run requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

// Rate limiter for loadout operations: 30 requests per minute
const loadoutLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

// Rate limiter for reward claims: 10 per minute (prevents claim spam)
const claimLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many claim requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

/**
 * Helper function to load problem from JSON files
 * Supports easy.json, medium.json, hard.json, and prompt-engineering.json
 */
async function loadProblem(problemId) {
  const problem = problemsLoader.getAgentProblem(problemId);
  return problem ? { problem, difficulty: String(problem.difficulty).toLowerCase() } : null;
}

// Open edition: there is no problem generator; draw a problem from the open set.
async function pickOpenProblem(difficulty, category) {
  let pool = problemsLoader.getAgentProblems(difficulty);
  if (category) {
    const inCategory = pool.filter(p => p.category === category || (p.tags || []).includes(category));
    if (inCategory.length) pool = inCategory;
  }
  if (!pool.length) return { success: false, error: 'No problems available' };
  return { success: true, problem: pool[Math.floor(Math.random() * pool.length)], tokensUsed: 0 };
}

/**
 * POST /api/agent/test-run
 * Test run an agent against a problem
 * Body: { problemId, loadout: { model, systemPrompt, language, tools } }
 */
router.post('/test-run', authMiddleware, agentTestLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { problemId, loadout } = req.body;

    // Validate required fields
    if (!problemId || !loadout) {
      return res.status(400).json({
        error: 'Missing required fields: problemId and loadout'
      });
    }

    // Validate loadout structure
    const { model, systemPrompt, language } = loadout;
    if (!model || !language) {
      return res.status(400).json({
        error: 'Loadout must include model and language'
      });
    }

    // Validate language
    const validLanguages = [
      'python',
      'javascript',
      'typescript',
      'java',
      'cpp',
      'c',
      'csharp',
      'go',
      'rust',
      'sql'
    ];
    if (!validLanguages.includes(language)) {
      return res.status(400).json({
        error: `Invalid language. Must be one of: ${validLanguages.join(', ')}`
      });
    }

    // Load the problem
    const problemData = await loadProblem(problemId);
    if (!problemData) {
      return res.status(404).json({
        error: 'Problem not found'
      });
    }

    logger.info(`[Agent Test Run] User ${userId} testing agent on problem ${problemId}`);

    const rawSelections = loadout.modules !== undefined ? loadout.modules : loadout.tools;
    if (rawSelections !== undefined && !Array.isArray(rawSelections)) {
      return res.status(400).json({
        error: loadout.modules !== undefined ? 'Modules must be an array' : 'Tools must be an array'
      });
    }

    let enabledModules;
    try {
      enabledModules = await validateModuleSelectionForUser(
        userId,
        agentModules.normalizeModuleIds(rawSelections || [])
      );
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        error: validationError.message
      });
    }

    // Run the agent
    const result = await agentRunner.runAgent(
      problemData.problem,
      {
        model,
        systemPrompt: systemPrompt || '',
        language,
        modules: enabledModules,
        tools: enabledModules
      }
    );

    // Log result for analytics
    logger.info(`[Agent Test Run] Result for user ${userId}, problem ${problemId}: ${result.success ? 'SUCCESS' : 'FAILURE'}`);

    res.json({
      success: true,
      result: {
        ...result,
        problemId,
        difficulty: problemData.difficulty
      }
    });
  } catch (err) {
    logger.error(`[Agent Test Run] Error: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/loadouts
 * Save a loadout configuration
 * Body: { name, description, model, systemPrompt, language, tools }
 */
router.post('/loadouts', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Security: Validate and sanitize all input
    let sanitized, warnings;
    try {
      const result = validateLoadoutInput(req.body);
      sanitized = result.sanitized;
      warnings = result.warnings;
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        error: validationError.message
      });
    }

    if (warnings.length > 0) {
      logger.warn(`[Agent Loadout] Validation warnings for user ${userId}:`, warnings);
    }

    try {
      const normalizedModules = await validateModuleSelectionForUser(userId, sanitized.modules);
      sanitized.modules = normalizedModules;
      sanitized.tools = normalizedModules;
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        error: validationError.message
      });
    }

    // Check if user already has a loadout with this name
    const existing = await db.get(
      'SELECT id FROM agent_loadouts WHERE user_id = ? AND name = ?',
      [userId, sanitized.name]
    );

    if (existing) {
      return res.status(400).json({
        error: 'You already have a loadout with this name'
      });
    }

    // Generate a UUID for the loadout
    const loadoutId = uuidv4();

    // Save the loadout with sanitized values
    await db.run(
      `INSERT INTO agent_loadouts (id, user_id, name, description, model, system_prompt, language, tools, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        loadoutId,
        userId,
        sanitized.name,
        sanitized.description,
        sanitized.model,
        sanitized.systemPrompt,
        sanitized.language,
        JSON.stringify(sanitized.tools)
      ]
    );

    // Create version 1 for this loadout
    const versionId = uuidv4();
    await db.run(
      `INSERT INTO agent_loadout_versions (id, loadout_id, version_number, system_prompt, model, language, tools, is_active, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 1, datetime('now'))`,
      [
        versionId,
        loadoutId,
        sanitized.systemPrompt,
        sanitized.model,
        sanitized.language,
        JSON.stringify(sanitized.tools)
      ]
    );

    logger.info(`[Agent Loadout] User ${userId} created loadout "${sanitized.name}" with ID ${loadoutId} and version ${versionId}`);

    res.json({
      success: true,
      loadoutId: loadoutId,
      versionId: versionId,
      message: 'Loadout saved successfully'
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error saving loadout: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/loadouts
 * Get all loadouts for the current user
 */
router.get('/loadouts', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    const loadouts = await db.all(
      `SELECT id, name, description, model, system_prompt, language, tools,
              is_public, times_cloned, wins, losses, elo, created_at, updated_at
       FROM agent_loadouts
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    // Parse tools JSON and calculate win rate for each loadout
    const formattedLoadouts = loadouts.map(loadout => {
      const totalGames = loadout.wins + loadout.losses;
      const winRate = totalGames > 0 ? (loadout.wins / totalGames * 100).toFixed(1) : 0;
      const selections = formatStoredLoadoutSelections(loadout.tools);

      return {
        ...loadout,
        modules: selections.modules,
        tools: selections.tools,
        isPublic: loadout.is_public === 1,
        timesCloned: loadout.times_cloned || 0,
        winRate: parseFloat(winRate)
      };
    });

    res.json({
      success: true,
      loadouts: formattedLoadouts
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error fetching loadouts: ${err.message}`, err);
    next(err);
  }
});

/**
 * PUT /api/agent/loadouts/:id
 * Update a loadout configuration (creates a new version)
 * Body: { model, systemPrompt, language, tools, name?, description? }
 */
router.put('/loadouts/:id', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT * FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Security: Validate and sanitize all input
    let sanitized, warnings;
    try {
      const result = validateLoadoutInput({
        name: req.body.name || loadout.name,
        description: req.body.description !== undefined ? req.body.description : loadout.description,
        model: req.body.model,
        systemPrompt: req.body.systemPrompt,
        language: req.body.language,
        modules: req.body.modules !== undefined ? req.body.modules : req.body.tools
      });
      sanitized = result.sanitized;
      warnings = result.warnings;
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        error: validationError.message
      });
    }

    if (warnings.length > 0) {
      logger.warn(`[Agent Loadout] Validation warnings for user ${userId}:`, warnings);
    }

    try {
      const normalizedModules = await validateModuleSelectionForUser(userId, sanitized.modules);
      sanitized.modules = normalizedModules;
      sanitized.tools = normalizedModules;
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        error: validationError.message
      });
    }

    // Check if system_prompt or model changed (if so, create new version)
    const hasChanges =
      sanitized.systemPrompt !== loadout.system_prompt ||
      sanitized.model !== loadout.model ||
      sanitized.language !== loadout.language ||
      JSON.stringify(sanitized.tools) !== loadout.tools;

    // Use transaction for atomic update of loadout and version
    await db.withTransaction(async () => {
      if (hasChanges) {
        // Get current highest version number
        const latestVersion = await db.get(
          'SELECT MAX(version_number) as max_version FROM agent_loadout_versions WHERE loadout_id = ?',
          [loadoutId]
        );

        const newVersionNumber = (latestVersion?.max_version || 0) + 1;

        // Deactivate all previous versions
        await db.run(
          'UPDATE agent_loadout_versions SET is_active = 0 WHERE loadout_id = ?',
          [loadoutId]
        );

        // Create new version
        const versionId = uuidv4();
        await db.run(
          `INSERT INTO agent_loadout_versions (id, loadout_id, version_number, system_prompt, model, language, tools, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
          [
            versionId,
            loadoutId,
            newVersionNumber,
            sanitized.systemPrompt,
            sanitized.model,
            sanitized.language,
            JSON.stringify(sanitized.tools)
          ]
        );

        logger.info(`[Agent Loadout] User ${userId} created version ${newVersionNumber} for loadout ${loadoutId}`);
      }

      // Update loadout
      await db.run(
        `UPDATE agent_loadouts
         SET name = ?, description = ?, model = ?, system_prompt = ?, language = ?, tools = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
        [
          sanitized.name,
          sanitized.description,
          sanitized.model,
          sanitized.systemPrompt,
          sanitized.language,
          JSON.stringify(sanitized.tools),
          loadoutId,
          userId
        ]
      );
    });

    logger.info(`[Agent Loadout] User ${userId} updated loadout ${loadoutId}`);

    res.json({
      success: true,
      message: 'Loadout updated successfully',
      versionCreated: hasChanges
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error updating loadout: ${err.message}`, err);
    next(err);
  }
});

/**
 * DELETE /api/agent/loadouts/:id
 * Delete a loadout
 */
router.delete('/loadouts/:id', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT id FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Delete the loadout
    await db.run(
      'DELETE FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    logger.info(`[Agent Loadout] User ${userId} deleted loadout ${loadoutId}`);

    res.json({
      success: true,
      message: 'Loadout deleted successfully'
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error deleting loadout: ${err.message}`, err);
    next(err);
  }
});

/**
 * PUT /api/agent/loadouts/:id/visibility
 * Toggle public/private visibility of a loadout
 */
router.put('/loadouts/:id/visibility', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;
    const { isPublic } = req.body;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    if (typeof isPublic !== 'boolean') {
      return res.status(400).json({ error: 'isPublic must be a boolean' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT id FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Update visibility
    await db.run(
      'UPDATE agent_loadouts SET is_public = ? WHERE id = ? AND user_id = ?',
      [isPublic ? 1 : 0, loadoutId, userId]
    );

    logger.info(`[Agent Loadout] User ${userId} set loadout ${loadoutId} to ${isPublic ? 'public' : 'private'}`);

    res.json({
      success: true,
      message: `Loadout is now ${isPublic ? 'public' : 'private'}`,
      isPublic
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error updating visibility: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/loadouts/public
 * Get public loadouts with pagination
 * Query params: page (default 1), limit (default 20)
 */
router.get('/loadouts/public', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    // Get public loadouts with user info and battle stats
    const loadouts = await db.all(
      `SELECT
        l.id,
        l.name,
        l.description,
        l.model,
        l.language,
        l.tools,
        l.wins,
        l.losses,
        l.elo,
        l.times_cloned,
        l.created_at,
        u.username,
        u.id as user_id
       FROM agent_loadouts l
       JOIN users u ON l.user_id = u.id
       WHERE l.is_public = 1
       ORDER BY l.elo DESC, l.times_cloned DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Get total count for pagination
    const countResult = await db.get(
      'SELECT COUNT(*) as total FROM agent_loadouts WHERE is_public = 1'
    );

    // Calculate win rate for each loadout
    const formattedLoadouts = loadouts.map(loadout => {
      const totalGames = loadout.wins + loadout.losses;
      const winRate = totalGames > 0 ? (loadout.wins / totalGames * 100).toFixed(1) : 0;
      const selections = formatStoredLoadoutSelections(loadout.tools);

      return {
        id: loadout.id,
        name: loadout.name,
        description: loadout.description,
        model: loadout.model,
        language: loadout.language,
        modules: selections.modules,
        tools: selections.tools,
        wins: loadout.wins,
        losses: loadout.losses,
        elo: loadout.elo,
        winRate: parseFloat(winRate),
        timesCloned: loadout.times_cloned,
        createdAt: loadout.created_at,
        creator: {
          id: loadout.user_id,
          username: loadout.username
        }
      };
    });

    res.json({
      success: true,
      loadouts: formattedLoadouts,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      }
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error fetching public loadouts: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/loadouts/:id/clone
 * Clone a public loadout to your account
 */
router.post('/loadouts/:id/clone', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    // Get the original loadout
    const original = await db.get(
      `SELECT l.*, u.username
       FROM agent_loadouts l
       JOIN users u ON l.user_id = u.id
       WHERE l.id = ? AND l.is_public = 1`,
      [loadoutId]
    );

    if (!original) {
      return res.status(404).json({
        error: 'Public loadout not found'
      });
    }

    // Don't allow cloning your own loadout
    if (original.user_id === userId) {
      return res.status(400).json({
        error: 'Cannot clone your own loadout'
      });
    }

    // Generate a new UUID for the cloned loadout
    const newLoadoutId = uuidv4();
    // Security: Sanitize original name and username to prevent stored XSS
    const safeName = sanitizeForXSS(original.name);
    const safeUsername = sanitizeForXSS(original.username);
    const clonedName = `${safeName} (from ${safeUsername})`.substring(0, SECURITY_LIMITS.MAX_NAME_LENGTH);

    // Check if user already has a loadout with this name
    const existing = await db.get(
      'SELECT id FROM agent_loadouts WHERE user_id = ? AND name = ?',
      [userId, clonedName]
    );

    const finalName = existing ? `${clonedName.substring(0, 80)} ${Date.now()}` : clonedName;

    // Use transaction for atomic clone and counter update
    await db.withTransaction(async () => {
      // Create the cloned loadout
      await db.run(
        `INSERT INTO agent_loadouts (
          id, user_id, name, description, model, system_prompt, language, tools,
          is_public, original_loadout_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))`,
        [
          newLoadoutId,
          userId,
          finalName,
          original.description || '',
          original.model,
          original.system_prompt || '',
          original.language,
          original.tools,
          loadoutId
        ]
      );

      // Increment the times_cloned counter on the original
      await db.run(
        'UPDATE agent_loadouts SET times_cloned = times_cloned + 1 WHERE id = ?',
        [loadoutId]
      );
    });

    logger.info(`[Agent Loadout] User ${userId} cloned loadout ${loadoutId} as ${newLoadoutId}`);

    res.json({
      success: true,
      loadoutId: newLoadoutId,
      message: 'Loadout cloned successfully',
      name: finalName
    });
  } catch (err) {
    logger.error(`[Agent Loadout] Error cloning loadout: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/loadouts/:id/versions
 * Get all versions of a loadout
 */
router.get('/loadouts/:id/versions', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT id, name FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Get all versions
    const versions = await db.all(
      `SELECT id, version_number, system_prompt, model, language, tools, wins, losses, is_active, created_at
       FROM agent_loadout_versions
       WHERE loadout_id = ?
       ORDER BY version_number DESC`,
      [loadoutId]
    );

    // Format versions
    const formattedVersions = versions.map(version => {
      const totalGames = version.wins + version.losses;
      const winRate = totalGames > 0 ? (version.wins / totalGames * 100).toFixed(1) : 0;
      const selections = formatStoredLoadoutSelections(version.tools);

      return {
        id: version.id,
        versionNumber: version.version_number,
        systemPrompt: version.system_prompt,
        model: version.model,
        language: version.language,
        modules: selections.modules,
        tools: selections.tools,
        wins: version.wins,
        losses: version.losses,
        winRate: parseFloat(winRate),
        isActive: version.is_active === 1,
        createdAt: version.created_at
      };
    });

    res.json({
      success: true,
      loadoutName: loadout.name,
      versions: formattedVersions
    });
  } catch (err) {
    logger.error(`[Agent Loadout Versions] Error fetching versions: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/loadouts/:id/versions/:versionId
 * Get a specific version of a loadout
 */
router.get('/loadouts/:id/versions/:versionId', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;
    const versionId = req.params.versionId;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    if (!versionId || typeof versionId !== 'string') {
      return res.status(400).json({ error: 'Invalid version ID' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT id, name FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Get the version
    const version = await db.get(
      `SELECT id, version_number, system_prompt, model, language, tools, wins, losses, is_active, created_at
       FROM agent_loadout_versions
       WHERE id = ? AND loadout_id = ?`,
      [versionId, loadoutId]
    );

    if (!version) {
      return res.status(404).json({
        error: 'Version not found'
      });
    }

    const totalGames = version.wins + version.losses;
    const winRate = totalGames > 0 ? (version.wins / totalGames * 100).toFixed(1) : 0;
    const selections = formatStoredLoadoutSelections(version.tools);

    res.json({
      success: true,
      version: {
        id: version.id,
        versionNumber: version.version_number,
        systemPrompt: version.system_prompt,
        model: version.model,
        language: version.language,
        modules: selections.modules,
        tools: selections.tools,
        wins: version.wins,
        losses: version.losses,
        winRate: parseFloat(winRate),
        isActive: version.is_active === 1,
        createdAt: version.created_at
      }
    });
  } catch (err) {
    logger.error(`[Agent Loadout Versions] Error fetching version: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/loadouts/:id/versions/:versionId/activate
 * Activate a specific version (revert to it)
 */
router.post('/loadouts/:id/versions/:versionId/activate', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;
    const versionId = req.params.versionId;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    if (!versionId || typeof versionId !== 'string') {
      return res.status(400).json({ error: 'Invalid version ID' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT id FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Get the version
    const version = await db.get(
      `SELECT id, system_prompt, model, language, tools
       FROM agent_loadout_versions
       WHERE id = ? AND loadout_id = ?`,
      [versionId, loadoutId]
    );

    if (!version) {
      return res.status(404).json({
        error: 'Version not found'
      });
    }

    // Use transaction for atomic version activation
    await db.withTransaction(async () => {
      // Deactivate all versions
      await db.run(
        'UPDATE agent_loadout_versions SET is_active = 0 WHERE loadout_id = ?',
        [loadoutId]
      );

      // Activate this version
      await db.run(
        'UPDATE agent_loadout_versions SET is_active = 1 WHERE id = ?',
        [versionId]
      );

      // Update the loadout to match this version
      await db.run(
        `UPDATE agent_loadouts
         SET model = ?, system_prompt = ?, language = ?, tools = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [
          version.model,
          version.system_prompt,
          version.language,
          version.tools,
          loadoutId
        ]
      );
    });

    logger.info(`[Agent Loadout Versions] User ${userId} activated version ${versionId} for loadout ${loadoutId}`);

    res.json({
      success: true,
      message: 'Version activated successfully'
    });
  } catch (err) {
    logger.error(`[Agent Loadout Versions] Error activating version: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/loadouts/:id/versions/compare
 * Compare two versions
 * Query params: v1 (version ID), v2 (version ID)
 */
router.get('/loadouts/:id/versions/compare', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const loadoutId = req.params.id;
    const { v1, v2 } = req.query;

    if (!loadoutId || typeof loadoutId !== 'string') {
      return res.status(400).json({ error: 'Invalid loadout ID' });
    }

    if (!v1 || !v2) {
      return res.status(400).json({ error: 'Both v1 and v2 query parameters are required' });
    }

    // Check if loadout exists and belongs to user
    const loadout = await db.get(
      'SELECT id, name FROM agent_loadouts WHERE id = ? AND user_id = ?',
      [loadoutId, userId]
    );

    if (!loadout) {
      return res.status(404).json({
        error: 'Loadout not found or does not belong to you'
      });
    }

    // Get both versions
    const version1 = await db.get(
      `SELECT id, version_number, system_prompt, model, language, tools, wins, losses, created_at
       FROM agent_loadout_versions
       WHERE id = ? AND loadout_id = ?`,
      [v1, loadoutId]
    );

    const version2 = await db.get(
      `SELECT id, version_number, system_prompt, model, language, tools, wins, losses, created_at
       FROM agent_loadout_versions
       WHERE id = ? AND loadout_id = ?`,
      [v2, loadoutId]
    );

    if (!version1 || !version2) {
      return res.status(404).json({
        error: 'One or both versions not found'
      });
    }

    // Calculate differences
    const differences = {
      systemPrompt: version1.system_prompt !== version2.system_prompt,
      model: version1.model !== version2.model,
      language: version1.language !== version2.language,
      tools: JSON.stringify(parseStoredModules(version1.tools)) !== JSON.stringify(parseStoredModules(version2.tools))
    };

    res.json({
      success: true,
      loadoutName: loadout.name,
      version1: {
        id: version1.id,
        versionNumber: version1.version_number,
        systemPrompt: version1.system_prompt,
        model: version1.model,
        language: version1.language,
        modules: formatStoredLoadoutSelections(version1.tools).modules,
        tools: formatStoredLoadoutSelections(version1.tools).tools,
        wins: version1.wins,
        losses: version1.losses,
        createdAt: version1.created_at
      },
      version2: {
        id: version2.id,
        versionNumber: version2.version_number,
        systemPrompt: version2.system_prompt,
        model: version2.model,
        language: version2.language,
        modules: formatStoredLoadoutSelections(version2.tools).modules,
        tools: formatStoredLoadoutSelections(version2.tools).tools,
        wins: version2.wins,
        losses: version2.losses,
        createdAt: version2.created_at
      },
      differences
    });
  } catch (err) {
    logger.error(`[Agent Loadout Versions] Error comparing versions: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/generate-problem
 * Generate an adversarial problem designed to challenge AI agents
 * Body: { difficulty: 'easy'|'medium'|'hard', category?: string }
 */
router.post('/generate-problem', authMiddleware, async (req, res, next) => {
  try {
    const { difficulty = 'medium', category } = req.body;

    // Validate difficulty
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      return res.status(400).json({
        error: 'Invalid difficulty. Must be easy, medium, or hard'
      });
    }

    logger.info(`[Problem Generator] Generating ${difficulty} adversarial problem`);

    const result = await pickOpenProblem(difficulty, category);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to generate problem'
      });
    }

    res.json({
      success: true,
      problem: result.problem,
      tokensUsed: result.tokensUsed
    });
  } catch (err) {
    logger.error(`[Problem Generator] Error: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/battle-with-generated
 * Generate a fresh problem and immediately run an agent battle on it
 * This ensures agents can't memorize solutions
 */
router.post('/battle-with-generated', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const { loadout, difficulty = 'medium' } = req.body;

    if (!loadout || !loadout.model || !loadout.language) {
      return res.status(400).json({
        error: 'Missing loadout configuration'
      });
    }

    const rawSelections = loadout.modules !== undefined ? loadout.modules : loadout.tools;
    if (rawSelections !== undefined && !Array.isArray(rawSelections)) {
      return res.status(400).json({
        error: loadout.modules !== undefined ? 'Modules must be an array' : 'Tools must be an array'
      });
    }

    let enabledModules;
    try {
      enabledModules = await validateModuleSelectionForUser(
        userId,
        agentModules.normalizeModuleIds(rawSelections || [])
      );
    } catch (validationError) {
      return res.status(validationError.statusCode || 400).json({
        error: validationError.message
      });
    }

    // Step 1: Generate a fresh problem
    logger.info(`[Agent Battle] Generating fresh ${difficulty} problem`);
    const problemResult = await pickOpenProblem(difficulty);

    if (!problemResult.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate problem'
      });
    }

    // Step 2: Run the agent on it
    logger.info(`[Agent Battle] Running agent on generated problem: ${problemResult.problem.id}`);
    const battleResult = await agentRunner.runAgent(problemResult.problem, {
      ...loadout,
      modules: enabledModules,
      tools: enabledModules
    });

    res.json({
      success: true,
      problem: {
        id: problemResult.problem.id,
        title: problemResult.problem.title,
        description: problemResult.problem.description,
        examples: problemResult.problem.examples,
        category: problemResult.problem.category,
        trapExplanation: problemResult.problem.trapExplanation
      },
      result: battleResult
    });
  } catch (err) {
    logger.error(`[Agent Battle] Error: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/battles/:id/replay
 * Get all events for a battle replay (sorted by timestamp)
 */
router.get('/battles/:id/replay', authMiddleware, async (req, res, next) => {
  try {
    const battleId = req.params.id;
    const userId = req.user.sub;

    if (!battleId || typeof battleId !== 'string') {
      return res.status(400).json({ error: 'Invalid battle ID' });
    }

    // Check if battle exists and user is a participant or it's a public battle
    const battle = await db.get(
      `SELECT ab.*,
              u1.username as player1_username,
              u2.username as player2_username,
              l1.name as loadout1_name, l1.model as loadout1_model, l1.language as loadout1_language, l1.tools as loadout1_tools,
              l2.name as loadout2_name, l2.model as loadout2_model, l2.language as loadout2_language, l2.tools as loadout2_tools
       FROM agent_battles ab
       JOIN users u1 ON ab.player1_id = u1.id
       JOIN users u2 ON ab.player2_id = u2.id
       LEFT JOIN agent_loadouts l1 ON ab.loadout1_id = l1.id
       LEFT JOIN agent_loadouts l2 ON ab.loadout2_id = l2.id
       WHERE ab.id = ?`,
      [battleId]
    );

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    // Check access: user must be a participant
    const isParticipant = battle.player1_id === userId || battle.player2_id === userId;
    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied. You must be a participant to view this replay.' });
    }

    // Get all events for this battle
    const events = await db.all(
      `SELECT event_type, player_id, event_data, timestamp_ms
       FROM agent_battle_events
       WHERE battle_id = ?
       ORDER BY timestamp_ms ASC`,
      [battleId]
    );

    // Parse event_data JSON safely
    const parsedEvents = events.map(event => {
      let eventData = null;
      try {
        eventData = event.event_data ? JSON.parse(event.event_data) : null;
      } catch (e) {
        logger.warn(`[Agent Battle] Failed to parse event_data for event ${event.id}:`, e.message);
        eventData = { error: 'Failed to parse event data' };
      }
      return { ...event, event_data: eventData };
    });
    const player1Selections = formatStoredLoadoutSelections(battle.loadout1_tools);
    const player2Selections = formatStoredLoadoutSelections(battle.loadout2_tools);

    // Return battle info and events
    res.json({
      success: true,
      battle: {
        id: battle.id,
        player1: {
          id: battle.player1_id,
          username: battle.player1_username,
          loadout: {
            name: battle.loadout1_name || 'Unknown',
            model: battle.loadout1_model || 'unknown',
            language: battle.loadout1_language || 'javascript',
            modules: player1Selections.modules,
            tools: player1Selections.tools
          }
        },
        player2: {
          id: battle.player2_id,
          username: battle.player2_username,
          loadout: {
            name: battle.loadout2_name || 'Unknown',
            model: battle.loadout2_model || 'unknown',
            language: battle.loadout2_language || 'javascript',
            modules: player2Selections.modules,
            tools: player2Selections.tools
          }
        },
        winnerId: battle.winner_id,
        status: battle.status,
        createdAt: battle.created_at
      },
      events: parsedEvents
    });
  } catch (err) {
    logger.error(`[Agent Battle Replay] Error fetching replay: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/battles/active
 * Get list of currently active agent battles for spectating
 */
router.get('/battles/active', authMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // Access global.agentBattles from server.js
    const activeBattles = [];

    if (global.agentBattles && global.agentBattles.size > 0) {
      for (const [battleId, battle] of global.agentBattles.entries()) {
        // Only include battles that are running or matched (not finished/error)
        if (battle.state === 'running' || battle.state === 'matched') {
          const spectatorCount = battle.spectators ? battle.spectators.size : 0;

          activeBattles.push({
            id: battleId,
            state: battle.state,
            players: battle.players.map(p => ({
              username: p.username,
              userId: p.userId,
              model: p.loadout?.model,
              language: p.loadout?.language,
              modules: p.loadout?.modules || [],
              tools: p.loadout?.tools || [],
              status: p.status,
              passedCount: p.passedCount || 0,
              totalTests: p.totalTests || 0
            })),
            problem: {
              id: battle.problem?.id,
              title: battle.problem?.title,
              difficulty: battle.problem?.difficulty
            },
            spectatorCount,
            createdAt: battle.createdAt,
            startedAt: battle.startedAt,
            elapsedTime: battle.startedAt ? Date.now() - battle.startedAt : 0
          });
        }
      }
    }

    // Sort by most recent first
    activeBattles.sort((a, b) => b.createdAt - a.createdAt);

    // Apply limit
    const limitedBattles = activeBattles.slice(0, limit);

    res.json({
      success: true,
      battles: limitedBattles,
      total: activeBattles.length
    });
  } catch (err) {
    logger.error(`[Agent Battle] Error fetching active battles: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/battles/live
 * Get list of currently running battles with enhanced information for discovery
 * Returns: battle ID, players info (username, avatar, ELO), problem difficulty,
 * start time, spectator count, visibility status
 * Only returns public battles (both players have public loadouts or opted-in to spectating)
 */
router.get('/battles/live', authMiddleware, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // Access global.agentBattles from server.js
    const liveBattles = [];

    if (global.agentBattles && global.agentBattles.size > 0) {
      for (const [battleId, battle] of global.agentBattles.entries()) {
        // Only include battles that are running (not matched, finished, or error)
        if (battle.state === 'running') {
          try {
            // Get player details from database
            const player1 = await db.get(
              'SELECT id, username, avatar, avatar_url FROM users WHERE id = ?',
              [battle.players[0]?.userId]
            );
            const player2 = await db.get(
              'SELECT id, username, avatar, avatar_url FROM users WHERE id = ?',
              [battle.players[1]?.userId]
            );

            if (!player1 || !player2) {
              continue; // Skip if players not found
            }

            // Get loadout details including visibility
            const loadout1 = await db.get(
              'SELECT id, name, elo, is_public FROM agent_loadouts WHERE id = ?',
              [battle.players[0]?.loadoutId]
            );
            const loadout2 = await db.get(
              'SELECT id, name, elo, is_public FROM agent_loadouts WHERE id = ?',
              [battle.players[1]?.loadoutId]
            );

            // Check if battle is public (both players have public loadouts)
            const isPublic = (loadout1?.is_public === 1) && (loadout2?.is_public === 1);

            // Only include public battles
            if (!isPublic) {
              continue;
            }

            const spectatorCount = battle.spectators ? battle.spectators.size : 0;

            liveBattles.push({
              id: battleId,
              players: [
                {
                  userId: player1.id,
                  username: player1.username,
                  avatar: player1.avatar,
                  model: battle.players[0]?.loadout?.model,
                  language: battle.players[0]?.loadout?.language,
                  modules: battle.players[0]?.loadout?.modules || [],
                  tools: battle.players[0]?.loadout?.tools || [],
                  elo: loadout1?.elo || 1000,
                  loadoutName: loadout1?.name,
                  passedCount: battle.players[0]?.passedCount || 0,
                  totalTests: battle.players[0]?.totalTests || 0
                },
                {
                  userId: player2.id,
                  username: player2.username,
                  avatar: player2.avatar,
                  model: battle.players[1]?.loadout?.model,
                  language: battle.players[1]?.loadout?.language,
                  modules: battle.players[1]?.loadout?.modules || [],
                  tools: battle.players[1]?.loadout?.tools || [],
                  elo: loadout2?.elo || 1000,
                  loadoutName: loadout2?.name,
                  passedCount: battle.players[1]?.passedCount || 0,
                  totalTests: battle.players[1]?.totalTests || 0
                }
              ],
              problem: {
                id: battle.problem?.id,
                title: battle.problem?.title,
                difficulty: battle.problem?.difficulty
              },
              spectatorCount,
              startedAt: battle.startedAt,
              elapsedTime: battle.startedAt ? Date.now() - battle.startedAt : 0,
              createdAt: battle.createdAt,
              isPublic: true
            });
          } catch (err) {
            logger.warn(`[Agent Battle Live] Error processing battle ${battleId}:`, err);
            continue; // Skip this battle if there's an error
          }
        }
      }
    }

    // Sort by most spectators, then by most recent
    liveBattles.sort((a, b) => {
      if (b.spectatorCount !== a.spectatorCount) {
        return b.spectatorCount - a.spectatorCount;
      }
      return b.createdAt - a.createdAt;
    });

    // Apply limit
    const limitedBattles = liveBattles.slice(0, limit);

    logger.info(`[Agent Battle Live] Fetched ${limitedBattles.length} live battles (${liveBattles.length} total public)`);

    res.json({
      success: true,
      battles: limitedBattles,
      total: liveBattles.length
    });
  } catch (err) {
    logger.error(`[Agent Battle Live] Error fetching live battles: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/battles/recent
 * Get user's recent agent battles (last 20)
 */
router.get('/battles/recent', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const battles = await db.all(
      `SELECT ab.id, ab.player1_id, ab.player2_id, ab.winner_id, ab.status, ab.created_at,
              u1.username as player1_username, u1.avatar as player1_avatar, u1.avatar_url as player1_avatar_url,
              u2.username as player2_username, u2.avatar as player2_avatar, u2.avatar_url as player2_avatar_url,
              l1.name as loadout1_name, l1.model as loadout1_model,
              l2.name as loadout2_name, l2.model as loadout2_model,
              ab.player1_elo_change, ab.player2_elo_change
       FROM agent_battles ab
       JOIN users u1 ON ab.player1_id = u1.id
       JOIN users u2 ON ab.player2_id = u2.id
       LEFT JOIN agent_loadouts l1 ON ab.loadout1_id = l1.id
       LEFT JOIN agent_loadouts l2 ON ab.loadout2_id = l2.id
       WHERE (ab.player1_id = ? OR ab.player2_id = ?)
         AND ab.status = 'finished'
       ORDER BY ab.created_at DESC
       LIMIT ?`,
      [userId, userId, limit]
    );

    // Format battles with user perspective
    const formattedBattles = battles.map(battle => {
      const isPlayer1 = battle.player1_id === userId;
      const isWinner = battle.winner_id === userId;
      const opponent = isPlayer1
        ? { id: battle.player2_id, username: battle.player2_username || 'Unknown', avatar: battle.player2_avatar || null, loadout: { name: battle.loadout2_name || 'Unknown', model: battle.loadout2_model || 'unknown' } }
        : { id: battle.player1_id, username: battle.player1_username || 'Unknown', avatar: battle.player1_avatar || null, loadout: { name: battle.loadout1_name || 'Unknown', model: battle.loadout1_model || 'unknown' } };

      const userLoadout = isPlayer1
        ? { name: battle.loadout1_name || 'Unknown', model: battle.loadout1_model || 'unknown' }
        : { name: battle.loadout2_name || 'Unknown', model: battle.loadout2_model || 'unknown' };

      const eloChange = isPlayer1 ? battle.player1_elo_change : battle.player2_elo_change;

      return {
        id: battle.id,
        opponent,
        userLoadout,
        isWinner,
        winnerId: battle.winner_id,
        eloChange: eloChange || 0,
        createdAt: battle.created_at
      };
    });

    res.json({
      success: true,
      battles: formattedBattles
    });
  } catch (err) {
    logger.error(`[Agent Battle Replay] Error fetching recent battles: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/battles/history
 * Get user's battle history with pagination and filtering
 * Query params:
 *   - page: Page number (default: 1)
 *   - limit: Results per page (default: 20, max: 50)
 *   - outcome: Filter by 'wins', 'losses', or 'all' (default: 'all')
 *   - opponentId: Filter by specific opponent (optional)
 * IMPORTANT: This route must come BEFORE /battles/:battleId to prevent "history" from being matched as an ID
 */
router.get('/battles/history', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const outcome = req.query.outcome || 'all';
    const opponentId = req.query.opponentId ? parseInt(req.query.opponentId) : null;

    // Validate outcome filter
    if (!['wins', 'losses', 'all'].includes(outcome)) {
      return res.status(400).json({
        error: 'Invalid outcome filter. Must be: wins, losses, or all'
      });
    }

    // Build WHERE clause based on filters
    let whereConditions = ['(ab.player1_id = ? OR ab.player2_id = ?)', 'ab.status = ?'];
    let queryParams = [userId, userId, 'completed'];

    // Add outcome filter
    if (outcome === 'wins') {
      whereConditions.push('ab.winner_id = ?');
      queryParams.push(userId);
    } else if (outcome === 'losses') {
      whereConditions.push('ab.winner_id IS NOT NULL AND ab.winner_id != ?');
      queryParams.push(userId);
    }

    // Add opponent filter
    if (opponentId) {
      whereConditions.push('(ab.player1_id = ? OR ab.player2_id = ?)');
      queryParams.push(opponentId, opponentId);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count for pagination
    const countResult = await db.get(
      `SELECT COUNT(*) as total FROM agent_battles ab WHERE ${whereClause}`,
      queryParams
    );

    // Get battles with full details
    const battles = await db.all(
      `SELECT ab.*,
              u1.username as player1_username, u1.avatar as player1_avatar, u1.avatar_url as player1_avatar_url,
              u2.username as player2_username, u2.avatar as player2_avatar, u2.avatar_url as player2_avatar_url,
              l1.name as loadout1_name, l1.model as loadout1_model, l1.language as loadout1_language, l1.tools as loadout1_tools,
              l2.name as loadout2_name, l2.model as loadout2_model, l2.language as loadout2_language, l2.tools as loadout2_tools
       FROM agent_battles ab
       JOIN users u1 ON ab.player1_id = u1.id
       JOIN users u2 ON ab.player2_id = u2.id
       LEFT JOIN agent_loadouts l1 ON ab.loadout1_id = l1.id
       LEFT JOIN agent_loadouts l2 ON ab.loadout2_id = l2.id
       WHERE ${whereClause}
       ORDER BY ab.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    // Format battles with user perspective
    const formattedBattles = battles.map(battle => {
      const isPlayer1 = battle.player1_id === userId;
      const isWinner = battle.winner_id === userId;
      const isDraw = battle.winner_id === null;
      const player1Selections = formatStoredLoadoutSelections(battle.loadout1_tools);
      const player2Selections = formatStoredLoadoutSelections(battle.loadout2_tools);

      const opponent = isPlayer1
        ? {
            id: battle.player2_id,
            username: battle.player2_username || 'Unknown',
            avatar: battle.player2_avatar || null,
            loadout: {
              name: battle.loadout2_name || 'Unknown',
              model: battle.loadout2_model || 'unknown',
              language: battle.loadout2_language || 'javascript',
              modules: player2Selections.modules,
              tools: player2Selections.tools
            }
          }
        : {
            id: battle.player1_id,
            username: battle.player1_username || 'Unknown',
            avatar: battle.player1_avatar || null,
            loadout: {
              name: battle.loadout1_name || 'Unknown',
              model: battle.loadout1_model || 'unknown',
              language: battle.loadout1_language || 'javascript',
              modules: player1Selections.modules,
              tools: player1Selections.tools
            }
          };

      const userLoadout = isPlayer1
        ? {
            id: battle.loadout1_id,
            name: battle.loadout1_name || 'Unknown',
            model: battle.loadout1_model || 'unknown',
            language: battle.loadout1_language || 'javascript',
            modules: player1Selections.modules,
            tools: player1Selections.tools
          }
        : {
            id: battle.loadout2_id,
            name: battle.loadout2_name || 'Unknown',
            model: battle.loadout2_model || 'unknown',
            language: battle.loadout2_language || 'javascript',
            modules: player2Selections.modules,
            tools: player2Selections.tools
          };

      const eloChange = isPlayer1 ? battle.player1_elo_change : battle.player2_elo_change;
      const testsPassed = isPlayer1 ? battle.player1_tests_passed : battle.player2_tests_passed;
      const tokensUsed = isPlayer1 ? battle.player1_tokens_used : battle.player2_tokens_used;

      return {
        id: battle.id,
        opponent,
        userLoadout,
        outcome: isDraw ? 'draw' : (isWinner ? 'win' : 'loss'),
        isWinner,
        isDraw,
        winnerId: battle.winner_id,
        eloChange: eloChange || 0,
        testsPassed: testsPassed || 0,
        tokensUsed: tokensUsed || 0,
        problemId: battle.problem_id,
        createdAt: battle.created_at,
        finishedAt: battle.finished_at
      };
    });

    const totalPages = Math.ceil(countResult.total / limit);

    logger.info(`[Agent Battle History] User ${userId} fetched page ${page} with outcome filter: ${outcome}`);

    res.json({
      success: true,
      battles: formattedBattles,
      pagination: {
        page,
        limit,
        total: countResult.total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (err) {
    logger.error(`[Agent Battle History] Error: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/battles/:battleId
 * Get full battle details for replay/history viewing
 * Returns: battle metadata, both players' info, problem, code submissions, test results, timestamps, etc.
 * NOTE: This route must come AFTER /battles/history to avoid route conflicts
 */
router.get('/battles/:battleId', authMiddleware, async (req, res, next) => {
  try {
    const battleId = req.params.battleId;
    const userId = req.user.sub;

    if (!battleId || typeof battleId !== 'string') {
      return res.status(400).json({ error: 'Invalid battle ID' });
    }

    // Get battle with full details
    const battle = await db.get(
      `SELECT ab.*,
              u1.username as player1_username, u1.avatar as player1_avatar, u1.avatar_url as player1_avatar_url,
              u2.username as player2_username, u2.avatar as player2_avatar, u2.avatar_url as player2_avatar_url,
              l1.name as loadout1_name, l1.model as loadout1_model,
              l1.language as loadout1_language, l1.system_prompt as loadout1_prompt,
              l1.tools as loadout1_tools,
              l2.name as loadout2_name, l2.model as loadout2_model,
              l2.language as loadout2_language, l2.system_prompt as loadout2_prompt,
              l2.tools as loadout2_tools
       FROM agent_battles ab
       JOIN users u1 ON ab.player1_id = u1.id
       JOIN users u2 ON ab.player2_id = u2.id
       LEFT JOIN agent_loadouts l1 ON ab.loadout1_id = l1.id
       LEFT JOIN agent_loadouts l2 ON ab.loadout2_id = l2.id
       WHERE ab.id = ?`,
      [battleId]
    );

    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    // Check access: user must be a participant
    const isParticipant = battle.player1_id === userId || battle.player2_id === userId;
    if (!isParticipant) {
      return res.status(403).json({
        error: 'Access denied. You must be a participant to view this battle.'
      });
    }

    // Load problem details from problem files
    const problemData = await loadProblem(battle.problem_id);

    // Parse JSON fields
    let player1Results = null;
    let player2Results = null;
    try {
      player1Results = battle.player1_results ? JSON.parse(battle.player1_results) : null;
    } catch (e) {
      logger.warn(`Failed to parse player1_results for battle ${battleId}:`, e);
    }
    try {
      player2Results = battle.player2_results ? JSON.parse(battle.player2_results) : null;
    } catch (e) {
      logger.warn(`Failed to parse player2_results for battle ${battleId}:`, e);
    }

    // Format response
    const response = {
      success: true,
      battle: {
        id: battle.id,
        status: battle.status,
        winnerId: battle.winner_id,
        createdAt: battle.created_at,
        finishedAt: battle.finished_at,
        player1: {
          id: battle.player1_id,
          username: battle.player1_username || 'Unknown',
          avatar: battle.player1_avatar || null,
          loadout: {
            id: battle.loadout1_id,
            name: battle.loadout1_name || 'Unknown',
            model: battle.loadout1_model || 'unknown',
            language: battle.loadout1_language || 'javascript',
            systemPrompt: battle.loadout1_prompt || '',
            modules: formatStoredLoadoutSelections(battle.loadout1_tools).modules,
            tools: formatStoredLoadoutSelections(battle.loadout1_tools).tools
          },
          code: battle.player1_code || '',
          results: player1Results,
          testsPassed: battle.player1_tests_passed || 0,
          tokensUsed: battle.player1_tokens_used || 0,
          generationTimeMs: battle.player1_generation_time_ms || 0,
          toolCalls: battle.player1_tool_calls || 0,
          eloChange: battle.player1_elo_change || 0
        },
        player2: {
          id: battle.player2_id,
          username: battle.player2_username || 'Unknown',
          avatar: battle.player2_avatar || null,
          loadout: {
            id: battle.loadout2_id,
            name: battle.loadout2_name || 'Unknown',
            model: battle.loadout2_model || 'unknown',
            language: battle.loadout2_language || 'javascript',
            systemPrompt: battle.loadout2_prompt || '',
            modules: formatStoredLoadoutSelections(battle.loadout2_tools).modules,
            tools: formatStoredLoadoutSelections(battle.loadout2_tools).tools
          },
          code: battle.player2_code || '',
          results: player2Results,
          testsPassed: battle.player2_tests_passed || 0,
          tokensUsed: battle.player2_tokens_used || 0,
          generationTimeMs: battle.player2_generation_time_ms || 0,
          toolCalls: battle.player2_tool_calls || 0,
          eloChange: battle.player2_elo_change || 0
        },
        problem: problemData ? {
          id: problemData.problem.id,
          title: problemData.problem.title,
          description: problemData.problem.description,
          examples: problemData.problem.examples,
          testCases: problemData.problem.testCases,
          difficulty: problemData.difficulty,
          category: problemData.problem.category
        } : {
          id: battle.problem_id,
          title: 'Problem not found',
          description: 'This problem may have been removed or is no longer available.',
          difficulty: 'unknown'
        }
      }
    };

    logger.info(`[Agent Battle] User ${userId} fetched battle details for ${battleId}`);
    res.json(response);
  } catch (err) {
    logger.error(`[Agent Battle] Error fetching battle details: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/leaderboard
 * Get agent loadout leaderboard
 * Query params:
 *   - timeframe: 'weekly' | 'monthly' | 'alltime' (default: 'alltime')
 *   - limit: number of results (default: 100)
 */
router.get('/leaderboard', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const timeframe = req.query.timeframe || 'alltime';
    const limit = Math.min(parseInt(req.query.limit) || 100, 100);
    const userId = req.user.sub;

    // Validate timeframe
    if (!['weekly', 'monthly', 'alltime'].includes(timeframe)) {
      return res.status(400).json({
        error: 'Invalid timeframe. Must be weekly, monthly, or alltime'
      });
    }

    // Calculate date filter based on timeframe
    let dateFilter = '';
    if (timeframe === 'weekly') {
      dateFilter = `AND ab.created_at >= datetime('now', '-7 days')`;
    } else if (timeframe === 'monthly') {
      dateFilter = `AND ab.created_at >= datetime('now', '-30 days')`;
    }

    // Build the query to get top loadouts with battle stats
    // We need to aggregate from agent_battles to get timeframe-specific stats
    const leaderboardQuery = `
      WITH loadout_stats AS (
        SELECT
          l.id,
          l.user_id,
          l.name,
          l.model,
          l.language,
          l.elo,
          l.current_streak,
          l.best_streak,
          l.total_tokens_used,
          l.total_tests_passed,
          l.total_battles,
          l.recent_results,
          COUNT(CASE
            WHEN ab.winner_id = l.user_id
            AND (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
            THEN 1
          END) as wins,
          COUNT(CASE
            WHEN ab.winner_id IS NOT NULL
            AND ab.winner_id != l.user_id
            AND (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
            THEN 1
          END) as losses,
          SUM(CASE
            WHEN ab.loadout1_id = l.id THEN COALESCE(ab.player1_tests_passed, 0)
            WHEN ab.loadout2_id = l.id THEN COALESCE(ab.player2_tests_passed, 0)
            ELSE 0
          END) as timeframe_tests_passed,
          COUNT(CASE
            WHEN (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
            AND ab.status = 'finished'
            THEN 1
          END) as timeframe_battles
        FROM agent_loadouts l
        LEFT JOIN agent_battles ab ON (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
          AND ab.status = 'finished'
          ${dateFilter}
        WHERE l.is_public = 1 OR l.user_id = ?
        GROUP BY l.id
        HAVING (wins + losses) > 0
      )
      SELECT
        ls.*,
        u.username,
        u.avatar,
        u.avatar_url,
        CASE
          WHEN (ls.wins + ls.losses) > 0
          THEN CAST(ls.wins * 100.0 / (ls.wins + ls.losses) AS INTEGER)
          ELSE 0
        END as win_rate,
        CASE
          WHEN ls.timeframe_battles > 0
          THEN CAST(ls.timeframe_tests_passed * 1.0 / ls.timeframe_battles AS REAL)
          ELSE 0
        END as avg_tests_passed
      FROM loadout_stats ls
      JOIN users u ON ls.user_id = u.id
      ORDER BY ls.elo DESC, ls.wins DESC
      LIMIT ?
    `;

    const leaderboard = await db.all(leaderboardQuery, [userId, limit]);

    // Add rank to each entry
    const rankedLeaderboard = leaderboard.map((entry, index) => {
      // Parse recent results (last 5 battles)
      let recentResults = [];
      try {
        recentResults = entry.recent_results ? JSON.parse(entry.recent_results) : [];
      } catch (e) {
        recentResults = [];
      }

      return {
        rank: index + 1,
        username: entry.username,
        avatar: entry.avatar,
        loadoutId: entry.id,
        loadoutName: entry.name,
        model: entry.model,
        language: entry.language,
        elo: entry.elo,
        wins: entry.wins,
        losses: entry.losses,
        winRate: entry.win_rate,
        currentStreak: entry.current_streak || 0,
        bestStreak: entry.best_streak || 0,
        totalTokensUsed: entry.total_tokens_used || 0,
        totalTestsPassed: entry.total_tests_passed || 0,
        totalBattles: entry.total_battles || 0,
        avgTestsPassed: entry.avg_tests_passed ? parseFloat(entry.avg_tests_passed.toFixed(1)) : 0,
        recentResults: recentResults.slice(-5), // Last 5 results
        isCurrentUser: entry.user_id === userId
      };
    });

    // Find current user's rank if not in top results
    let userRank = null;
    const userEntry = rankedLeaderboard.find(entry => entry.isCurrentUser);

    if (!userEntry) {
      // User not in top results, find their rank
      const userRankQuery = `
        WITH loadout_stats AS (
          SELECT
            l.id,
            l.user_id,
            l.elo,
            COUNT(CASE
              WHEN ab.winner_id = l.user_id
              AND (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
              THEN 1
            END) as wins,
            COUNT(CASE
              WHEN ab.winner_id IS NOT NULL
              AND ab.winner_id != l.user_id
              AND (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
              THEN 1
            END) as losses
          FROM agent_loadouts l
          LEFT JOIN agent_battles ab ON (ab.loadout1_id = l.id OR ab.loadout2_id = l.id)
            AND ab.status = 'finished'
            ${dateFilter}
          WHERE l.is_public = 1 OR l.user_id = ?
          GROUP BY l.id
          HAVING (wins + losses) > 0
        ),
        ranked AS (
          SELECT
            id,
            user_id,
            ROW_NUMBER() OVER (ORDER BY elo DESC, wins DESC) as rank
          FROM loadout_stats
        )
        SELECT rank FROM ranked WHERE user_id = ? LIMIT 1
      `;

      const userRankResult = await db.get(userRankQuery, [userId, userId]);
      if (userRankResult) {
        userRank = userRankResult.rank;
      }
    } else {
      userRank = userEntry.rank;
    }

    logger.info(`[Agent Leaderboard] Fetched ${timeframe} leaderboard for user ${userId}`);

    res.json({
      success: true,
      timeframe,
      leaderboard: rankedLeaderboard,
      userRank: userRank,
      total: rankedLeaderboard.length
    });
  } catch (err) {
    logger.error(`[Agent Leaderboard] Error: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/challenges
 * Get active daily and weekly challenges with user progress
 */
router.get('/challenges', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;

    // Get active challenges
    const challenges = await db.getActiveChallenges();

    // Get user progress for each challenge
    const challengesWithProgress = await Promise.all(
      challenges.map(async (challenge) => {
        const progress = await db.getChallengeProgress(userId, challenge.id);

        return {
          id: challenge.id,
          type: challenge.type,
          title: challenge.title,
          description: challenge.description,
          requirementType: challenge.requirement_type,
          requirementValue: challenge.requirement_value,
          rewardType: challenge.reward_type,
          rewardValue: challenge.reward_value,
          endsAt: challenge.ends_at,
          progress: progress ? progress.progress : 0,
          completed: progress ? progress.completed === 1 : false,
          completedAt: progress ? progress.completed_at : null
        };
      })
    );

    // Separate daily and weekly
    const daily = challengesWithProgress.filter(c => c.type === 'daily');
    const weekly = challengesWithProgress.filter(c => c.type === 'weekly');

    res.json({
      success: true,
      challenges: {
        daily: daily[0] || null,
        weekly: weekly[0] || null
      }
    });
  } catch (err) {
    logger.error(`[Agent Challenges] Error fetching challenges: ${err.message}`, err);
    next(err);
  }
});

/**
 * POST /api/agent/challenges/:id/claim
 * Claim reward for completed challenge
 */
router.post('/challenges/:id/claim', authMiddleware, claimLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const challengeId = req.params.id;

    if (!challengeId || typeof challengeId !== 'string') {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    // Get the challenge
    const challenge = await db.getAgentChallengeById(challengeId);
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Get user's progress
    const progress = await db.getChallengeProgress(userId, challengeId);
    if (!progress) {
      return res.status(400).json({ error: 'You have not started this challenge' });
    }

    if (progress.completed !== 1) {
      return res.status(400).json({ error: 'Challenge not completed yet' });
    }

    // Apply the reward
    const { reward_type, reward_value } = challenge;

    if (reward_type === 'elo_bonus') {
      // Add ELO to user's agent loadout rating
      const user = await db.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get user's most used loadout or default to increasing their base rating
      const loadouts = await db.all(
        'SELECT id FROM agent_loadouts WHERE user_id = ? ORDER BY (wins + losses) DESC LIMIT 1',
        [userId]
      );

      if (loadouts.length > 0) {
        await db.run(
          'UPDATE agent_loadouts SET elo = elo + ? WHERE id = ?',
          [reward_value.amount, loadouts[0].id]
        );
      }

      // Also record in user stats for tracking
      await db.run(
        `INSERT INTO user_stats (user_id, agent_challenge_rewards)
         VALUES (?, ?)
         ON CONFLICT(user_id)
         DO UPDATE SET agent_challenge_rewards = COALESCE(agent_challenge_rewards, 0) + ?`,
        [userId, reward_value.amount, reward_value.amount]
      );
    }

    // Mark as claimed (delete progress)
    await db.markChallengeClaimed(userId, challengeId);

    logger.info(`[Agent Challenges] User ${userId} claimed reward for challenge ${challengeId}`);

    res.json({
      success: true,
      message: 'Reward claimed successfully',
      reward: {
        type: reward_type,
        value: reward_value
      }
    });
  } catch (err) {
    logger.error(`[Agent Challenges] Error claiming reward: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/rivalries
 * Get user's top rivalries (most battles fought)
 */
router.get('/rivalries', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const rivalries = await db.getUserTopRivalries(userId, limit);

    logger.info(`[Agent Rivalries] Fetched ${rivalries.length} rivalries for user ${userId}`);

    res.json({
      success: true,
      rivalries
    });
  } catch (err) {
    logger.error(`[Agent Rivalries] Error fetching rivalries: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/rivalries/:opponentId
 * Get head-to-head record with specific opponent
 */
router.get('/rivalries/:opponentId', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const opponentId = parseInt(req.params.opponentId);

    if (!opponentId || isNaN(opponentId)) {
      return res.status(400).json({ error: 'Invalid opponent ID' });
    }

    if (opponentId === userId) {
      return res.status(400).json({ error: 'Cannot get rivalry with yourself' });
    }

    const rivalry = await db.getAgentRivalry(userId, opponentId);

    if (!rivalry) {
      return res.json({
        success: true,
        rivalry: null,
        message: 'No battles found with this opponent'
      });
    }

    logger.info(`[Agent Rivalries] Fetched rivalry between ${userId} and ${opponentId}`);

    res.json({
      success: true,
      rivalry
    });
  } catch (err) {
    logger.error(`[Agent Rivalries] Error fetching rivalry: ${err.message}`, err);
    next(err);
  }
});

/**
 * GET /api/agent/seasons/current
 * Get current active season with user's ranking
 */
router.get('/seasons/current', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Get current season
    const season = await seasonService.getCurrentSeason();
    if (!season) {
      return res.json({
        success: true,
        season: null,
        userRanking: null
      });
    }

    // Get user's current ranking (based on current loadout ELO)
    const userLoadouts = await db.all(
      `SELECT
        l.id,
        l.name,
        l.elo,
        l.wins,
        l.losses,
        l.current_streak,
        l.best_streak,
        (SELECT COUNT(*) + 1 FROM agent_loadouts l2 WHERE l2.elo > l.elo) as current_rank
       FROM agent_loadouts l
       WHERE l.user_id = ?
       ORDER BY l.elo DESC
       LIMIT 1`,
      [userId]
    );

    const userRanking = userLoadouts.length > 0 ? userLoadouts[0] : null;

    // Calculate time remaining
    const now = new Date();
    const endsAt = new Date(season.ends_at);
    const daysRemaining = Math.ceil((endsAt - now) / (1000 * 60 * 60 * 24));

    res.json({
      success: true,
      season: {
        ...season,
        daysRemaining
      },
      userRanking
    });
  } catch (err) {
    logger.error('[Agent Seasons] Error getting current season:', err);
    next(err);
  }
});

/**
 * GET /api/agent/seasons/:id/results
 * Get final results for a past season
 */
router.get('/seasons/:id/results', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const seasonId = parseInt(req.params.id);

    if (isNaN(seasonId)) {
      return res.status(400).json({ error: 'Invalid season ID' });
    }

    // Get season
    const season = await seasonService.getSeasonById(seasonId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    // Get leaderboard
    const leaderboard = await seasonService.getSeasonLeaderboard(seasonId, 100);

    // Get user's ranking
    const userRanking = await seasonService.getUserSeasonRanking(userId, seasonId);

    // Calculate total participants
    const totalParticipants = await db.get(
      'SELECT COUNT(DISTINCT user_id) as count FROM agent_season_rankings WHERE season_id = ?',
      [seasonId]
    );

    res.json({
      success: true,
      season,
      leaderboard,
      userRanking,
      totalParticipants: totalParticipants.count
    });
  } catch (err) {
    logger.error('[Agent Seasons] Error getting season results:', err);
    next(err);
  }
});

/**
 * GET /api/agent/seasons/history
 * Get list of past seasons
 */
router.get('/seasons/history', authMiddleware, async (req, res, next) => {
  try {
    const seasons = await seasonService.getPastSeasons();
    res.json({
      success: true,
      seasons
    });
  } catch (err) {
    logger.error('[Agent Seasons] Error getting season history:', err);
    next(err);
  }
});

/**
 * POST /api/agent/seasons/:id/claim-reward
 * Claim season rewards
 */
router.post('/seasons/:id/claim-reward', authMiddleware, claimLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const seasonId = parseInt(req.params.id);

    if (isNaN(seasonId)) {
      return res.status(400).json({ error: 'Invalid season ID' });
    }

    // Get season to ensure it's ended
    const season = await seasonService.getSeasonById(seasonId);
    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    if (season.is_active === 1) {
      return res.status(400).json({
        error: 'Cannot claim rewards for active season. Wait until it ends.'
      });
    }

    // Claim rewards
    const result = await seasonService.claimSeasonRewards(userId, seasonId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      rewards: result.rewards,
      message: 'Rewards claimed successfully!'
    });
  } catch (err) {
    logger.error('[Agent Seasons] Error claiming rewards:', err);
    next(err);
  }
});
// ============================================================================
// SPENDING LIMITS
// ============================================================================

const { getSpendingStatus, MODEL_COSTS, LIMITS } = require('../services/agentSpendingLimiter');

/**
 * GET /api/agent/spending
 * Get current spending status for the user
 */
router.get('/spending', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.sub;

    // Check if user is pro using consistent helper
    const isPro = await db.isUserPro(userId);

    const status = getSpendingStatus(userId, isPro);

    res.json({
      success: true,
      spending: {
        daily: {
          spent: status.dailySpend,
          limit: status.dailyLimit,
          remaining: status.dailyRemaining,
          resetTime: status.dailyResetTime
        },
        monthly: {
          spent: status.monthlySpend,
          limit: status.monthlyLimit,
          remaining: status.monthlyRemaining,
          resetTime: status.monthlyResetTime
        }
      },
      costs: MODEL_COSTS,
      limits: isPro ? LIMITS.pro : LIMITS.free,
      isPro
    });
  } catch (err) {
    logger.error('[Agent Spending] Error fetching spending status:', err);
    next(err);
  }
});

// ============================================================================
// AGENT LOADOUT TEMPLATES
// ============================================================================

/**
 * GET /api/agent/templates
 * Get all active official templates
 */
router.get('/templates', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const templates = await db.all(
      `SELECT id, name, description, strategy, model, system_prompt, language, tools,
              is_official, win_rate, times_used, sort_order, created_at
       FROM agent_loadout_templates
       WHERE is_active = 1
       ORDER BY sort_order ASC, created_at DESC`
    );

    // Format templates for response
    const formattedTemplates = templates.map(template => {
      let parsedTools = [];
      try {
        parsedTools = typeof template.tools === 'string' ? JSON.parse(template.tools) : (template.tools || []);
      } catch {
        parsedTools = [];
      }

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        strategy: template.strategy,
        model: template.model,
        systemPrompt: template.system_prompt,
        language: template.language,
        modules: parsedTools,
        tools: parsedTools,
        isOfficial: template.is_official === 1,
        winRate: template.win_rate,
        timesUsed: template.times_used,
        createdAt: template.created_at
      };
    });

    res.json({
      success: true,
      templates: formattedTemplates
    });
  } catch (err) {
    logger.error('[Agent Templates] Error fetching templates:', err);
    next(err);
  }
});

/**
 * GET /api/agent/templates/:id
 * Get a single template by ID
 */
router.get('/templates/:id', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const templateId = req.params.id;

    const template = await db.get(
      `SELECT id, name, description, strategy, model, system_prompt, language, tools,
              is_official, win_rate, times_used, created_at
       FROM agent_loadout_templates
       WHERE id = ? AND is_active = 1`,
      [templateId]
    );

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    let parsedTools = [];
    try {
      parsedTools = typeof template.tools === 'string' ? JSON.parse(template.tools) : (template.tools || []);
    } catch {
      parsedTools = [];
    }

    res.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        strategy: template.strategy,
        model: template.model,
        systemPrompt: template.system_prompt,
        language: template.language,
        modules: parsedTools,
        tools: parsedTools,
        isOfficial: template.is_official === 1,
        winRate: template.win_rate,
        timesUsed: template.times_used,
        createdAt: template.created_at
      }
    });
  } catch (err) {
    logger.error('[Agent Templates] Error fetching template:', err);
    next(err);
  }
});

/**
 * POST /api/agent/templates/:id/clone
 * Clone a template into the user's loadouts
 */
router.post('/templates/:id/clone', authMiddleware, loadoutLimiter, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const templateId = req.params.id;
    const { customName } = req.body;

    // Get the template
    const template = await db.get(
      `SELECT * FROM agent_loadout_templates WHERE id = ? AND is_active = 1`,
      [templateId]
    );

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Generate a new UUID for the loadout
    const newLoadoutId = uuidv4();

    // Use custom name or default to template name
    let loadoutName = customName ? sanitizeForXSS(customName.trim()) : sanitizeForXSS(template.name);
    if (loadoutName.length > SECURITY_LIMITS.MAX_NAME_LENGTH) {
      loadoutName = loadoutName.substring(0, SECURITY_LIMITS.MAX_NAME_LENGTH);
    }

    // Check if user already has a loadout with this name
    const existing = await db.get(
      'SELECT id FROM agent_loadouts WHERE user_id = ? AND name = ?',
      [userId, loadoutName]
    );

    if (existing) {
      loadoutName = `${loadoutName.substring(0, 80)} (${Date.now()})`;
    }

    // Use transaction for atomic clone and counter update
    await db.withTransaction(async () => {
      // Create the new loadout from template
      await db.run(
        `INSERT INTO agent_loadouts (
          id, user_id, name, description, model, system_prompt, language, tools,
          is_public, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
        [
          newLoadoutId,
          userId,
          loadoutName,
          template.description || '',
          template.model,
          template.system_prompt || '',
          template.language,
          template.tools
        ]
      );

      // Create version 1 for this loadout
      const versionId = uuidv4();
      await db.run(
        `INSERT INTO agent_loadout_versions (id, loadout_id, version_number, system_prompt, model, language, tools, is_active, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, 1, datetime('now'))`,
        [
          versionId,
          newLoadoutId,
          template.system_prompt || '',
          template.model,
          template.language,
          template.tools
        ]
      );

      // Increment the times_used counter on the template
      await db.run(
        'UPDATE agent_loadout_templates SET times_used = times_used + 1, updated_at = datetime(\'now\') WHERE id = ?',
        [templateId]
      );
    });

    logger.info(`[Agent Templates] User ${userId} cloned template ${templateId} as loadout ${newLoadoutId}`);

    res.json({
      success: true,
      loadoutId: newLoadoutId,
      message: 'Template cloned successfully',
      name: loadoutName
    });
  } catch (err) {
    logger.error('[Agent Templates] Error cloning template:', err);
    next(err);
  }
});

module.exports = router;
