/**
 * Agent Modules System
 *
 * Modules are unlockable abilities for AI agents in battles.
 * Players earn modules through gameplay achievements.
 * Each loadout can equip up to 2 modules.
 */

/**
 * Module definitions with unlock conditions
 *
 * Categories:
 * - execution: Affects how code is run/tested
 * - analysis: Provides insights about the solution
 * - generation: Affects how the AI generates code
 */
const MODULES = {
  // === DEFAULT MODULES (unlocked for everyone) ===
  'test-runner': {
    id: 'test-runner',
    name: 'Test Runner',
    description: 'Run code against test cases before submitting',
    category: 'execution',
    icon: 'TestTube',
    isDefault: true,
    unlockCondition: null,
    effect: {
      type: 'tool',
      toolId: 'run_code',
      promptAddition: null
    }
  },
  'auto-retry': {
    id: 'auto-retry',
    name: 'Auto Retry',
    description: 'Automatically retry on failure with error feedback',
    category: 'execution',
    icon: 'RotateCcw',
    isDefault: true,
    unlockCondition: null,
    effect: {
      type: 'tool',
      toolId: 'auto_retry',
      promptAddition: null
    }
  },
  'docs-lookup': {
    id: 'docs-lookup',
    name: 'Docs Lookup',
    description: 'Search language documentation during battle',
    category: 'analysis',
    icon: 'BookOpen',
    isDefault: true,
    unlockCondition: null,
    effect: {
      type: 'tool',
      toolId: 'docs_lookup',
      promptAddition: null
    }
  },

  // === UNLOCKABLE MODULES ===

  'debug-mode': {
    id: 'debug-mode',
    name: 'Debug Mode',
    description: 'Get verbose error messages and stack traces',
    category: 'execution',
    icon: 'Bug',
    isDefault: false,
    unlockCondition: {
      type: 'wins',
      value: 5,
      description: 'Win 5 agent battles'
    },
    effect: {
      type: 'prompt',
      promptAddition: `DEBUGGING MODE ACTIVE: When your code fails, you will receive detailed error messages including:
- Full stack traces
- Variable states at point of failure
- Line numbers and context
Use this information to identify and fix issues quickly.`
    }
  },

  'edge-case-focus': {
    id: 'edge-case-focus',
    name: 'Edge Case Focus',
    description: 'Emphasize edge case handling in solutions',
    category: 'generation',
    icon: 'Shield',
    isDefault: false,
    unlockCondition: {
      type: 'wins',
      value: 15,
      description: 'Win 15 agent battles'
    },
    effect: {
      type: 'prompt',
      promptAddition: `EDGE CASE FOCUS ACTIVE: Before writing your solution, explicitly consider and handle these edge cases:
- Empty inputs (empty arrays, empty strings, null values)
- Single element inputs
- Maximum/minimum value boundaries
- Duplicate values
- Negative numbers (if applicable)
- Off-by-one scenarios
Include explicit checks for these cases in your code.`
    }
  },

  'type-checker': {
    id: 'type-checker',
    name: 'Type Checker',
    description: 'Warn about potential type mismatches',
    category: 'analysis',
    icon: 'FileType',
    isDefault: false,
    unlockCondition: {
      type: 'rank',
      value: 'silver',
      description: 'Reach Silver rank'
    },
    effect: {
      type: 'prompt',
      promptAddition: `TYPE SAFETY MODE ACTIVE: Pay extra attention to type safety:
- Ensure all variables have consistent types
- Handle type coercion explicitly
- Validate input types before processing
- Use appropriate type conversions
- Consider integer overflow for large numbers
Add type checks and validations where appropriate.`
    }
  },

  'complexity-analyzer': {
    id: 'complexity-analyzer',
    name: 'Complexity Analyzer',
    description: 'Analyze and optimize time/space complexity',
    category: 'analysis',
    icon: 'TrendingUp',
    isDefault: false,
    unlockCondition: {
      type: 'battles',
      value: 50,
      description: 'Play 50 agent battles'
    },
    effect: {
      type: 'prompt',
      promptAddition: `COMPLEXITY ANALYSIS ACTIVE: Before finalizing your solution:
1. State the time complexity of your approach
2. State the space complexity
3. If complexity is O(n²) or worse, consider if there's a more efficient approach
4. For large input constraints (n > 10^4), prefer O(n log n) or O(n) solutions
5. Consider using hash maps, sorting, or two-pointer techniques to optimize
Optimize your solution if the complexity seems too high for the constraints.`
    }
  },

  'memory-profiler': {
    id: 'memory-profiler',
    name: 'Memory Profiler',
    description: 'Track and optimize memory usage',
    category: 'analysis',
    icon: 'HardDrive',
    isDefault: false,
    unlockCondition: {
      type: 'languages',
      value: 3,
      description: 'Win battles with 3 different languages'
    },
    effect: {
      type: 'prompt',
      promptAddition: `MEMORY OPTIMIZATION ACTIVE: Optimize memory usage in your solution:
- Avoid creating unnecessary copies of data structures
- Use in-place modifications when possible
- Consider memory-efficient data structures
- Release references to large objects when done
- For recursive solutions, consider iterative alternatives to avoid stack overflow
- Use generators/iterators instead of materializing large lists when appropriate.`
    }
  },

  'template-library': {
    id: 'template-library',
    name: 'Template Library',
    description: 'Access common algorithm templates',
    category: 'generation',
    icon: 'Library',
    isDefault: false,
    unlockCondition: {
      type: 'rank',
      value: 'gold',
      description: 'Reach Gold rank'
    },
    effect: {
      type: 'prompt',
      promptAddition: `TEMPLATE LIBRARY AVAILABLE: You have access to these proven algorithm templates:
- Binary Search: left, right = 0, n-1; while left <= right: mid = (left+right)//2
- Two Pointers: left, right converging or same direction
- Sliding Window: expand right, shrink left while maintaining invariant
- BFS: queue with level tracking, visited set
- DFS: recursion or stack, visited tracking
- Dynamic Programming: identify subproblems, memoize, build bottom-up
- Union-Find: parent array with path compression and union by rank
- Monotonic Stack: maintain increasing/decreasing order for next greater/smaller
Choose the appropriate template based on the problem pattern.`
    }
  },

  'strategic-planner': {
    id: 'strategic-planner',
    name: 'Strategic Planner',
    description: 'Plan approach before coding',
    category: 'generation',
    icon: 'GitBranch',
    isDefault: false,
    unlockCondition: {
      type: 'streak',
      value: 5,
      description: 'Achieve a 5-battle win streak'
    },
    effect: {
      type: 'prompt',
      promptAddition: `STRATEGIC PLANNING ACTIVE: Before writing any code, create a brief plan:
1. Identify the problem type (array manipulation, graph, DP, etc.)
2. Choose the optimal algorithmic approach
3. List the key steps of your solution
4. Identify potential edge cases to handle
5. Estimate the expected complexity

Write your plan as a brief comment, then implement the solution.`
    }
  }
};

const TOOL_ID_TO_MODULE_ID = {
  run_code: 'test-runner',
  auto_retry: 'auto-retry',
  docs_lookup: 'docs-lookup'
};

const MODULE_ID_ALIASES = {
  ...TOOL_ID_TO_MODULE_ID,
  retry: 'auto-retry',
  docs: 'docs-lookup'
};

/**
 * ELO thresholds for rank-based unlocks
 */
const RANK_THRESHOLDS = {
  bronze: 0,
  silver: 1000,
  gold: 1200,
  platinum: 1400,
  diamond: 1600,
  master: 1800,
  grandmaster: 2000
};

async function ensureModuleTables(db) {
  if (!db || db.__agentModulesTablesReady) return;

  await db.run(`CREATE TABLE IF NOT EXISTS user_agent_modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    module_id TEXT NOT NULL,
    unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, module_id)
  )`);

  await db.run(
    'CREATE INDEX IF NOT EXISTS idx_user_agent_modules_user ON user_agent_modules(user_id)'
  );

  db.__agentModulesTablesReady = true;
}

function isMissingModuleTableError(error) {
  return error && typeof error.message === 'string' && error.message.includes('no such table: user_agent_modules');
}

async function withModuleTables(db, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingModuleTableError(error)) {
      throw error;
    }

    await ensureModuleTables(db);
    return operation();
  }
}

function normalizeModuleId(moduleId) {
  if (typeof moduleId !== 'string') return null;

  const normalized = moduleId.trim().toLowerCase();
  if (!normalized) return null;

  if (MODULES[normalized] || TOOL_ID_TO_MODULE_ID[normalized]) return normalized;
  return MODULE_ID_ALIASES[normalized] || null;
}

function getCanonicalModuleId(moduleId) {
  const normalized = normalizeModuleId(moduleId);
  if (!normalized) return null;
  if (MODULES[normalized]) return normalized;
  return TOOL_ID_TO_MODULE_ID[normalized] || null;
}

function normalizeModuleIds(moduleIds) {
  if (!Array.isArray(moduleIds)) return [];

  const normalizedIds = [];
  const seen = new Set();

  for (const moduleId of moduleIds) {
    const normalized = normalizeModuleId(moduleId);
    const canonicalKey = normalized ? (getCanonicalModuleId(normalized) || normalized) : null;

    if (!normalized || !canonicalKey || seen.has(canonicalKey)) {
      continue;
    }
    seen.add(canonicalKey);
    normalizedIds.push(canonicalKey);
  }

  return normalizedIds;
}

/**
 * Get all module definitions
 */
function getAllModules() {
  return Object.values(MODULES);
}

/**
 * Get a specific module by ID
 */
function getModule(moduleId) {
  const canonicalModuleId = getCanonicalModuleId(moduleId);
  return canonicalModuleId ? MODULES[canonicalModuleId] : null;
}

/**
 * Get default modules (always unlocked)
 */
function getDefaultModules() {
  return Object.values(MODULES).filter(m => m.isDefault);
}

/**
 * Get unlockable modules (not default)
 */
function getUnlockableModules() {
  return Object.values(MODULES).filter(m => !m.isDefault);
}

/**
 * Check if a user has unlocked a specific module
 * @param {Object} db - Database instance
 * @param {number} userId - User ID
 * @param {string} moduleId - Module ID to check
 * @returns {Promise<boolean>}
 */
async function isModuleUnlocked(db, userId, moduleId) {
  const canonicalModuleId = getCanonicalModuleId(moduleId);
  const module = canonicalModuleId ? MODULES[canonicalModuleId] : null;
  if (!module) return false;
  if (module.isDefault) return true;

  const unlock = await withModuleTables(
    db,
    () => db.get(
      'SELECT 1 FROM user_agent_modules WHERE user_id = ? AND module_id = ?',
      [userId, canonicalModuleId]
    )
  );
  return !!unlock;
}

/**
 * Get all unlocked modules for a user
 * @param {Object} db - Database instance
 * @param {number} userId - User ID
 * @returns {Promise<string[]>} - Array of unlocked module IDs
 */
async function getUnlockedModules(db, userId) {
  // Start with default modules
  const unlocked = getDefaultModules().map(m => m.id);

  // Add user-specific unlocks
  const userUnlocks = await withModuleTables(
    db,
    () => db.all(
      'SELECT module_id FROM user_agent_modules WHERE user_id = ?',
      [userId]
    )
  ) || [];

  userUnlocks.forEach(row => {
    if (!unlocked.includes(row.module_id)) {
      unlocked.push(row.module_id);
    }
  });

  return unlocked;
}

/**
 * Check and award module unlocks after a battle
 * @param {Object} db - Database instance
 * @param {number} userId - User ID
 * @param {Object} battleResult - Battle result data
 * @returns {Promise<string[]>} - Newly unlocked module IDs
 */
async function checkAndAwardUnlocks(db, userId, battleResult) {
  const newUnlocks = [];

  // Get user's current stats
  const userStats = await db.get(`
    SELECT
      u.id,
      COALESCE((
        SELECT COUNT(*)
        FROM agent_battles ab
        WHERE (ab.player1_id = u.id OR ab.player2_id = u.id)
          AND ab.status = 'finished'
          AND ab.winner_id = u.id
      ), 0) as total_wins,
      COALESCE((
        SELECT COUNT(*)
        FROM agent_battles ab
        WHERE (ab.player1_id = u.id OR ab.player2_id = u.id)
          AND ab.status = 'finished'
      ), 0) as total_battles,
      COALESCE((
        SELECT MAX(al.elo)
        FROM agent_loadouts al
        WHERE al.user_id = u.id
      ), 1000) as max_elo,
      COALESCE((
        SELECT MAX(al.current_streak)
        FROM agent_loadouts al
        WHERE al.user_id = u.id
      ), 0) as current_streak,
      COALESCE((
        SELECT MAX(al.best_streak)
        FROM agent_loadouts al
        WHERE al.user_id = u.id
      ), 0) as best_streak
    FROM users u
    WHERE u.id = ?
  `, [userId]) || {
    total_wins: 0,
    total_battles: 0,
    max_elo: 1000,
    current_streak: 0,
    best_streak: 0
  };

  // Get unique languages user has won with
  const languages = await db.all(`
    SELECT DISTINCT al.language
    FROM agent_battles ab
    JOIN agent_loadouts al ON (
      (ab.player1_id = ? AND ab.loadout1_id = al.id) OR
      (ab.player2_id = ? AND ab.loadout2_id = al.id)
    )
    WHERE ab.winner_id = ? AND ab.status = 'finished'
  `, [userId, userId, userId]) || [];
  const uniqueLanguages = languages.length;

  // Get already unlocked modules
  const alreadyUnlocked = await getUnlockedModules(db, userId);

  // Check each unlockable module
  for (const module of getUnlockableModules()) {
    if (alreadyUnlocked.includes(module.id)) continue;

    const condition = module.unlockCondition;
    let unlocked = false;

    switch (condition.type) {
      case 'wins':
        unlocked = userStats.total_wins >= condition.value;
        break;
      case 'battles':
        unlocked = userStats.total_battles >= condition.value;
        break;
      case 'rank':
        const requiredElo = RANK_THRESHOLDS[condition.value] || 0;
        unlocked = userStats.max_elo >= requiredElo;
        break;
      case 'languages':
        unlocked = uniqueLanguages >= condition.value;
        break;
      case 'streak':
        unlocked = userStats.best_streak >= condition.value;
        break;
    }

    if (unlocked) {
      // Award the unlock
      await withModuleTables(
        db,
        () => db.run(
          'INSERT OR IGNORE INTO user_agent_modules (user_id, module_id, unlocked_at) VALUES (?, ?, ?)',
          [userId, module.id, new Date().toISOString()]
        )
      );
      newUnlocks.push(module.id);
    }
  }

  return newUnlocks;
}

/**
 * Get unlock progress for all modules for a user
 * @param {Object} db - Database instance
 * @param {number} userId - User ID
 * @returns {Promise<Object[]>} - Modules with progress info
 */
async function getModuleProgress(db, userId) {
  // Get user stats
  const userStats = await db.get(`
    SELECT
      u.id,
      COALESCE((
        SELECT COUNT(*)
        FROM agent_battles ab
        WHERE (ab.player1_id = u.id OR ab.player2_id = u.id)
          AND ab.status = 'finished'
          AND ab.winner_id = u.id
      ), 0) as total_wins,
      COALESCE((
        SELECT COUNT(*)
        FROM agent_battles ab
        WHERE (ab.player1_id = u.id OR ab.player2_id = u.id)
          AND ab.status = 'finished'
      ), 0) as total_battles,
      COALESCE((
        SELECT MAX(al.elo)
        FROM agent_loadouts al
        WHERE al.user_id = u.id
      ), 1000) as max_elo,
      COALESCE((
        SELECT MAX(al.best_streak)
        FROM agent_loadouts al
        WHERE al.user_id = u.id
      ), 0) as best_streak
    FROM users u
    WHERE u.id = ?
  `, [userId]) || { total_wins: 0, total_battles: 0, max_elo: 1000, best_streak: 0 };

  // Get unique languages
  const languages = await db.all(`
    SELECT DISTINCT al.language
    FROM agent_battles ab
    JOIN agent_loadouts al ON (
      (ab.player1_id = ? AND ab.loadout1_id = al.id) OR
      (ab.player2_id = ? AND ab.loadout2_id = al.id)
    )
    WHERE ab.winner_id = ? AND ab.status = 'finished'
  `, [userId, userId, userId]) || [];
  const uniqueLanguages = languages.length;

  // Get unlocked modules
  const unlockedIds = await getUnlockedModules(db, userId);

  // Build progress for each module
  return getAllModules().map(module => {
    const isUnlocked = unlockedIds.includes(module.id);
    let progress = null;

    if (!module.isDefault && !isUnlocked) {
      const condition = module.unlockCondition;
      let current = 0;
      let target = condition.value;

      switch (condition.type) {
        case 'wins':
          current = userStats.total_wins || 0;
          break;
        case 'battles':
          current = userStats.total_battles || 0;
          break;
        case 'rank':
          const requiredElo = RANK_THRESHOLDS[condition.value] || 0;
          current = userStats.max_elo || 1000;
          target = requiredElo;
          break;
        case 'languages':
          current = uniqueLanguages;
          break;
        case 'streak':
          current = userStats.best_streak || 0;
          break;
      }

      progress = {
        current,
        target,
        percentage: Math.min(100, Math.round((current / target) * 100))
      };
    }

    return {
      ...module,
      isUnlocked,
      progress
    };
  });
}

/**
 * Build prompt additions for enabled modules
 * @param {string[]} moduleIds - Enabled module IDs
 * @returns {string} - Combined prompt additions
 */
function buildModulePromptAdditions(moduleIds) {
  const additions = [];

  for (const moduleId of normalizeModuleIds(moduleIds)) {
    const module = MODULES[moduleId];
    if (module && module.effect && module.effect.promptAddition) {
      additions.push(module.effect.promptAddition);
    }
  }

  if (additions.length === 0) return '';

  return `\n\n=== ACTIVE MODULES ===\n${additions.join('\n\n')}\n=== END MODULES ===\n`;
}

/**
 * Get tool IDs from enabled modules
 * @param {string[]} moduleIds - Enabled module IDs
 * @returns {string[]} - Tool IDs to enable
 */
function getToolsFromModules(moduleIds) {
  const tools = [];

  for (const moduleId of normalizeModuleIds(moduleIds)) {
    if (TOOL_ID_TO_MODULE_ID[moduleId]) {
      if (!tools.includes(moduleId)) {
        tools.push(moduleId);
      }
      continue;
    }

    const module = MODULES[moduleId];
    if (module && module.effect && module.effect.type === 'tool' && module.effect.toolId && !tools.includes(module.effect.toolId)) {
      tools.push(module.effect.toolId);
    }
  }

  return tools;
}

/**
 * Validate module selection for a loadout
 * @param {string[]} moduleIds - Selected module IDs
 * @param {string[]} unlockedIds - User's unlocked module IDs
 * @returns {{ valid: boolean, error?: string }}
 */
function validateModuleSelection(moduleIds, unlockedIds) {
  if (!Array.isArray(moduleIds)) {
    return { valid: false, error: 'Modules must be an array' };
  }

  const normalizedIds = normalizeModuleIds(moduleIds);

  if (normalizedIds.length > 2) {
    return { valid: false, error: 'Maximum 2 modules allowed per loadout' };
  }

  const unlockedSet = new Set((Array.isArray(unlockedIds) ? unlockedIds : []).map(getCanonicalModuleId).filter(Boolean));

  for (const moduleId of normalizedIds) {
    const canonicalModuleId = getCanonicalModuleId(moduleId);
    if (!canonicalModuleId || !MODULES[canonicalModuleId]) {
      return { valid: false, error: `Unknown module: ${moduleId}` };
    }
    if (!unlockedSet.has(canonicalModuleId)) {
      return { valid: false, error: `Module not unlocked: ${canonicalModuleId}` };
    }
  }

  return { valid: true, normalizedIds };
}

module.exports = {
  MODULES,
  MODULE_ID_ALIASES,
  TOOL_ID_TO_MODULE_ID,
  RANK_THRESHOLDS,
  normalizeModuleId,
  normalizeModuleIds,
  getCanonicalModuleId,
  getAllModules,
  getModule,
  getDefaultModules,
  getUnlockableModules,
  isModuleUnlocked,
  getUnlockedModules,
  checkAndAwardUnlocks,
  getModuleProgress,
  buildModulePromptAdditions,
  getToolsFromModules,
  validateModuleSelection
};
