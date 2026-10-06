/**
 * Agent Battle Shared Utilities
 *
 * Common constants, validators, sanitizers, and middleware
 * shared across agent battle route files.
 */

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const problemsLoader = require('../problemsLoader');
const agentModules = require('../services/agentModules');

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

const SECURITY_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_SYSTEM_PROMPT_LENGTH: 2000,
  MAX_TOOLS: 2
};

const VALID_MODELS = ['haiku', 'sonnet', 'opus'];
const VALID_TOOLS = ['run_code', 'auto_retry', 'docs_lookup']; // Legacy - kept for backward compatibility
const VALID_MODULES = Object.keys(agentModules.MODULES);
const VALID_LANGUAGES = [
  'python', 'javascript', 'typescript', 'java',
  'cpp', 'c', 'csharp', 'go', 'rust', 'sql'
];

// ============================================================================
// MODULE PARSING UTILITIES
// ============================================================================

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

async function validateModuleSelectionForUser(db, userId, moduleIds) {
  const unlockedModules = await agentModules.getUnlockedModules(db, userId);
  const validation = agentModules.validateModuleSelection(moduleIds, unlockedModules);

  if (!validation.valid) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    throw error;
  }

  return validation.normalizedIds || [];
}

// ============================================================================
// INPUT SANITIZATION
// ============================================================================

/**
 * Sanitize string input for XSS prevention
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
      systemPrompt: systemPrompt || '',
      language: language.toLowerCase(),
      modules: sanitizedModules,
      tools: hasModulesField ? sanitizedModules : agentModules.getToolsFromModules(sanitizedModules)
    },
    warnings
  };
}

// ============================================================================
// RATE LIMITERS
// ============================================================================

// Rate limiter for agent test runs: 20 requests per minute per user
const agentTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many test run requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

// Rate limiter for loadout operations: 30 requests per minute
const loadoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

// Rate limiter for reward claims: 10 per minute
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many claim requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  validate: false
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper function to load problem from JSON files
 */
async function loadProblem(problemId) {
  const problem = problemsLoader.getAgentProblem(problemId);
  return problem ? { problem, difficulty: String(problem.difficulty).toLowerCase() } : null;
}

module.exports = {
  // Constants
  SECURITY_LIMITS,
  VALID_MODELS,
  VALID_TOOLS,
  VALID_MODULES,
  VALID_LANGUAGES,

  // Module utilities
  parseStoredModules,
  formatStoredLoadoutSelections,
  validateModuleSelectionForUser,

  // Sanitization
  sanitizeForXSS,
  validateLoadoutInput,

  // Rate limiters
  agentTestLimiter,
  loadoutLimiter,
  claimLimiter,

  // Helpers
  loadProblem
};
