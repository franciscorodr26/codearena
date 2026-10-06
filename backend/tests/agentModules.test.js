/**
 * Tests for Agent Modules Service
 *
 * Tests cover:
 * - Module definitions and constants
 * - Normalization functions
 * - Default vs unlockable modules
 * - Validation logic
 * - Prompt building
 * - Tool extraction
 * - Database functions with mocks
 */

const agentModules = require('../services/agentModules');

// ============================================================================
// MODULE DEFINITIONS TESTS
// ============================================================================

describe('AgentModules - Module Definitions', () => {
  describe('MODULES constant', () => {
    it('should have all expected modules defined', () => {
      const expectedModules = [
        'test-runner',
        'auto-retry',
        'docs-lookup',
        'debug-mode',
        'edge-case-focus',
        'type-checker',
        'complexity-analyzer',
        'memory-profiler',
        'template-library',
        'strategic-planner'
      ];

      expectedModules.forEach(moduleId => {
        expect(agentModules.MODULES[moduleId]).toBeDefined();
        expect(agentModules.MODULES[moduleId].id).toBe(moduleId);
      });
    });

    it('should have required fields for each module', () => {
      Object.values(agentModules.MODULES).forEach(module => {
        expect(module.id).toBeDefined();
        expect(module.name).toBeDefined();
        expect(module.description).toBeDefined();
        expect(module.category).toBeDefined();
        expect(module.icon).toBeDefined();
        expect(typeof module.isDefault).toBe('boolean');
        expect(module.effect).toBeDefined();
      });
    });

    it('should have valid categories', () => {
      const validCategories = ['execution', 'analysis', 'generation'];
      Object.values(agentModules.MODULES).forEach(module => {
        expect(validCategories).toContain(module.category);
      });
    });

    it('should have unlock conditions for non-default modules', () => {
      Object.values(agentModules.MODULES).forEach(module => {
        if (!module.isDefault) {
          expect(module.unlockCondition).toBeDefined();
          expect(module.unlockCondition.type).toBeDefined();
          expect(module.unlockCondition.value).toBeDefined();
          expect(module.unlockCondition.description).toBeDefined();
        }
      });
    });

    it('should have valid unlock condition types', () => {
      const validTypes = ['wins', 'battles', 'rank', 'languages', 'streak'];
      Object.values(agentModules.MODULES).forEach(module => {
        if (module.unlockCondition) {
          expect(validTypes).toContain(module.unlockCondition.type);
        }
      });
    });
  });

  describe('RANK_THRESHOLDS constant', () => {
    it('should have all ranks defined', () => {
      expect(agentModules.RANK_THRESHOLDS.bronze).toBe(0);
      expect(agentModules.RANK_THRESHOLDS.silver).toBe(1000);
      expect(agentModules.RANK_THRESHOLDS.gold).toBe(1200);
      expect(agentModules.RANK_THRESHOLDS.platinum).toBe(1400);
      expect(agentModules.RANK_THRESHOLDS.diamond).toBe(1600);
      expect(agentModules.RANK_THRESHOLDS.master).toBe(1800);
      expect(agentModules.RANK_THRESHOLDS.grandmaster).toBe(2000);
    });

    it('should have ranks in ascending order', () => {
      const thresholds = Object.values(agentModules.RANK_THRESHOLDS);
      for (let i = 1; i < thresholds.length; i++) {
        expect(thresholds[i]).toBeGreaterThanOrEqual(thresholds[i - 1]);
      }
    });
  });

  describe('MODULE_ID_ALIASES constant', () => {
    it('should map legacy tool IDs to module IDs', () => {
      expect(agentModules.MODULE_ID_ALIASES.run_code).toBe('test-runner');
      expect(agentModules.MODULE_ID_ALIASES.auto_retry).toBe('auto-retry');
      expect(agentModules.MODULE_ID_ALIASES.docs_lookup).toBe('docs-lookup');
    });

    it('should include short aliases', () => {
      expect(agentModules.MODULE_ID_ALIASES.retry).toBe('auto-retry');
      expect(agentModules.MODULE_ID_ALIASES.docs).toBe('docs-lookup');
    });
  });
});

// ============================================================================
// NORMALIZATION FUNCTIONS TESTS
// ============================================================================

describe('AgentModules - Normalization Functions', () => {
  describe('normalizeModuleId', () => {
    it('should return null for invalid inputs', () => {
      expect(agentModules.normalizeModuleId(null)).toBeNull();
      expect(agentModules.normalizeModuleId(undefined)).toBeNull();
      expect(agentModules.normalizeModuleId('')).toBeNull();
      expect(agentModules.normalizeModuleId(123)).toBeNull();
      expect(agentModules.normalizeModuleId({})).toBeNull();
      expect(agentModules.normalizeModuleId('   ')).toBeNull();
    });

    it('should normalize valid module IDs', () => {
      expect(agentModules.normalizeModuleId('test-runner')).toBe('test-runner');
      expect(agentModules.normalizeModuleId('TEST-RUNNER')).toBe('test-runner');
      expect(agentModules.normalizeModuleId('  test-runner  ')).toBe('test-runner');
    });

    it('should normalize legacy tool IDs', () => {
      expect(agentModules.normalizeModuleId('run_code')).toBe('run_code');
      expect(agentModules.normalizeModuleId('auto_retry')).toBe('auto_retry');
      expect(agentModules.normalizeModuleId('docs_lookup')).toBe('docs_lookup');
    });

    it('should normalize aliases to canonical IDs', () => {
      // Aliases are converted to their canonical module IDs
      expect(agentModules.normalizeModuleId('retry')).toBe('auto-retry');
      expect(agentModules.normalizeModuleId('docs')).toBe('docs-lookup');
    });

    it('should return null for unknown module IDs', () => {
      expect(agentModules.normalizeModuleId('unknown-module')).toBeNull();
      expect(agentModules.normalizeModuleId('fake-tool')).toBeNull();
    });
  });

  describe('getCanonicalModuleId', () => {
    it('should return canonical IDs for valid modules', () => {
      expect(agentModules.getCanonicalModuleId('test-runner')).toBe('test-runner');
      expect(agentModules.getCanonicalModuleId('debug-mode')).toBe('debug-mode');
    });

    it('should convert legacy tool IDs to canonical module IDs', () => {
      expect(agentModules.getCanonicalModuleId('run_code')).toBe('test-runner');
      expect(agentModules.getCanonicalModuleId('auto_retry')).toBe('auto-retry');
      expect(agentModules.getCanonicalModuleId('docs_lookup')).toBe('docs-lookup');
    });

    it('should return null for invalid inputs', () => {
      expect(agentModules.getCanonicalModuleId(null)).toBeNull();
      expect(agentModules.getCanonicalModuleId('unknown')).toBeNull();
    });
  });

  describe('normalizeModuleIds', () => {
    it('should return empty array for invalid inputs', () => {
      expect(agentModules.normalizeModuleIds(null)).toEqual([]);
      expect(agentModules.normalizeModuleIds(undefined)).toEqual([]);
      expect(agentModules.normalizeModuleIds('string')).toEqual([]);
      expect(agentModules.normalizeModuleIds({})).toEqual([]);
    });

    it('should normalize array of module IDs', () => {
      const result = agentModules.normalizeModuleIds(['test-runner', 'debug-mode']);
      expect(result).toContain('test-runner');
      expect(result).toContain('debug-mode');
    });

    it('should filter out invalid module IDs', () => {
      const result = agentModules.normalizeModuleIds(['test-runner', 'invalid', 'debug-mode']);
      expect(result).toHaveLength(2);
      expect(result).not.toContain('invalid');
    });

    it('should deduplicate module IDs', () => {
      const result = agentModules.normalizeModuleIds(['test-runner', 'test-runner', 'run_code']);
      expect(result).toHaveLength(1);
      expect(result).toContain('test-runner');
    });

    it('should convert legacy tool IDs', () => {
      const result = agentModules.normalizeModuleIds(['run_code', 'auto_retry']);
      expect(result).toContain('test-runner');
      expect(result).toContain('auto-retry');
    });
  });
});

// ============================================================================
// MODULE QUERY FUNCTIONS TESTS
// ============================================================================

describe('AgentModules - Module Query Functions', () => {
  describe('getAllModules', () => {
    it('should return all modules as an array', () => {
      const modules = agentModules.getAllModules();
      expect(Array.isArray(modules)).toBe(true);
      expect(modules.length).toBe(10);
    });

    it('should return copies not references', () => {
      const modules1 = agentModules.getAllModules();
      const modules2 = agentModules.getAllModules();
      expect(modules1).not.toBe(modules2);
    });
  });

  describe('getModule', () => {
    it('should return module by ID', () => {
      const module = agentModules.getModule('test-runner');
      expect(module).toBeDefined();
      expect(module.id).toBe('test-runner');
      expect(module.name).toBe('Test Runner');
    });

    it('should return module by legacy tool ID', () => {
      const module = agentModules.getModule('run_code');
      expect(module).toBeDefined();
      expect(module.id).toBe('test-runner');
    });

    it('should return null for unknown module', () => {
      expect(agentModules.getModule('unknown')).toBeNull();
      expect(agentModules.getModule(null)).toBeNull();
    });
  });

  describe('getDefaultModules', () => {
    it('should return only default modules', () => {
      const defaults = agentModules.getDefaultModules();
      expect(defaults.length).toBe(3);
      defaults.forEach(module => {
        expect(module.isDefault).toBe(true);
      });
    });

    it('should include test-runner, auto-retry, docs-lookup', () => {
      const defaults = agentModules.getDefaultModules();
      const ids = defaults.map(m => m.id);
      expect(ids).toContain('test-runner');
      expect(ids).toContain('auto-retry');
      expect(ids).toContain('docs-lookup');
    });
  });

  describe('getUnlockableModules', () => {
    it('should return only non-default modules', () => {
      const unlockables = agentModules.getUnlockableModules();
      expect(unlockables.length).toBe(7);
      unlockables.forEach(module => {
        expect(module.isDefault).toBe(false);
      });
    });

    it('should include all unlockable modules', () => {
      const unlockables = agentModules.getUnlockableModules();
      const ids = unlockables.map(m => m.id);
      expect(ids).toContain('debug-mode');
      expect(ids).toContain('edge-case-focus');
      expect(ids).toContain('type-checker');
      expect(ids).toContain('complexity-analyzer');
      expect(ids).toContain('memory-profiler');
      expect(ids).toContain('template-library');
      expect(ids).toContain('strategic-planner');
    });
  });
});

// ============================================================================
// VALIDATION FUNCTIONS TESTS
// ============================================================================

describe('AgentModules - Validation Functions', () => {
  describe('validateModuleSelection', () => {
    const defaultUnlocked = ['test-runner', 'auto-retry', 'docs-lookup'];

    it('should return invalid for non-array input', () => {
      const result = agentModules.validateModuleSelection('not-array', defaultUnlocked);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be an array');
    });

    it('should allow empty selection', () => {
      const result = agentModules.validateModuleSelection([], defaultUnlocked);
      expect(result.valid).toBe(true);
    });

    it('should allow valid selection of 1 module', () => {
      const result = agentModules.validateModuleSelection(['test-runner'], defaultUnlocked);
      expect(result.valid).toBe(true);
    });

    it('should allow valid selection of 2 modules', () => {
      const result = agentModules.validateModuleSelection(['test-runner', 'auto-retry'], defaultUnlocked);
      expect(result.valid).toBe(true);
    });

    it('should reject selection of more than 2 modules', () => {
      const result = agentModules.validateModuleSelection(
        ['test-runner', 'auto-retry', 'docs-lookup'],
        defaultUnlocked
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Maximum 2 modules');
    });

    it('should silently filter out unknown modules', () => {
      // Unknown modules are filtered out during normalization, not rejected
      // This allows graceful handling of deprecated/removed modules
      const result = agentModules.validateModuleSelection(['unknown-module'], defaultUnlocked);
      expect(result.valid).toBe(true);
      expect(result.normalizedIds).toEqual([]);
    });

    it('should reject locked modules', () => {
      const result = agentModules.validateModuleSelection(['debug-mode'], defaultUnlocked);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not unlocked');
    });

    it('should accept unlocked non-default modules', () => {
      const unlockedWithDebug = [...defaultUnlocked, 'debug-mode'];
      const result = agentModules.validateModuleSelection(['debug-mode'], unlockedWithDebug);
      expect(result.valid).toBe(true);
    });

    it('should accept legacy tool IDs', () => {
      const result = agentModules.validateModuleSelection(['run_code', 'auto_retry'], defaultUnlocked);
      expect(result.valid).toBe(true);
    });

    it('should handle null unlockedIds gracefully', () => {
      const result = agentModules.validateModuleSelection(['test-runner'], null);
      expect(result.valid).toBe(false);
    });
  });
});

// ============================================================================
// PROMPT AND TOOL FUNCTIONS TESTS
// ============================================================================

describe('AgentModules - Prompt and Tool Functions', () => {
  describe('buildModulePromptAdditions', () => {
    it('should return empty string for empty array', () => {
      expect(agentModules.buildModulePromptAdditions([])).toBe('');
    });

    it('should return empty string for default modules (no prompt additions)', () => {
      const result = agentModules.buildModulePromptAdditions(['test-runner', 'auto-retry']);
      expect(result).toBe('');
    });

    it('should include prompt additions for modules with them', () => {
      const result = agentModules.buildModulePromptAdditions(['debug-mode']);
      expect(result).toContain('ACTIVE MODULES');
      expect(result).toContain('DEBUGGING MODE ACTIVE');
    });

    it('should combine multiple module prompts', () => {
      const result = agentModules.buildModulePromptAdditions(['debug-mode', 'edge-case-focus']);
      expect(result).toContain('DEBUGGING MODE ACTIVE');
      expect(result).toContain('EDGE CASE FOCUS ACTIVE');
    });

    it('should handle invalid module IDs gracefully', () => {
      const result = agentModules.buildModulePromptAdditions(['invalid', 'debug-mode']);
      expect(result).toContain('DEBUGGING MODE ACTIVE');
    });

    it('should handle non-array input', () => {
      expect(agentModules.buildModulePromptAdditions(null)).toBe('');
      expect(agentModules.buildModulePromptAdditions('string')).toBe('');
    });
  });

  describe('getToolsFromModules', () => {
    it('should return empty array for empty input', () => {
      expect(agentModules.getToolsFromModules([])).toEqual([]);
    });

    it('should extract tool IDs from tool-type modules', () => {
      const result = agentModules.getToolsFromModules(['test-runner']);
      expect(result).toContain('run_code');
    });

    it('should handle multiple tool modules', () => {
      const result = agentModules.getToolsFromModules(['test-runner', 'auto-retry', 'docs-lookup']);
      expect(result).toContain('run_code');
      expect(result).toContain('auto_retry');
      expect(result).toContain('docs_lookup');
    });

    it('should not include duplicates', () => {
      const result = agentModules.getToolsFromModules(['test-runner', 'run_code']);
      const runCodeCount = result.filter(t => t === 'run_code').length;
      expect(runCodeCount).toBe(1);
    });

    it('should handle prompt-only modules (no tool)', () => {
      const result = agentModules.getToolsFromModules(['debug-mode', 'edge-case-focus']);
      expect(result).toEqual([]);
    });

    it('should handle mixed modules', () => {
      const result = agentModules.getToolsFromModules(['test-runner', 'debug-mode']);
      expect(result).toContain('run_code');
      expect(result).toHaveLength(1);
    });

    it('should handle legacy tool IDs as input', () => {
      const result = agentModules.getToolsFromModules(['run_code']);
      expect(result).toContain('run_code');
    });
  });
});

// ============================================================================
// DATABASE FUNCTIONS TESTS (with mocks)
// ============================================================================

describe('AgentModules - Database Functions', () => {
  // Mock database
  let mockDb;

  beforeEach(() => {
    mockDb = {
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn()
    };
  });

  describe('isModuleUnlocked', () => {
    it('should return true for default modules without DB call', async () => {
      const result = await agentModules.isModuleUnlocked(mockDb, 1, 'test-runner');
      expect(result).toBe(true);
      expect(mockDb.get).not.toHaveBeenCalled();
    });

    it('should return false for unknown modules', async () => {
      const result = await agentModules.isModuleUnlocked(mockDb, 1, 'unknown');
      expect(result).toBe(false);
    });

    it('should check database for non-default modules', async () => {
      mockDb.get.mockResolvedValue({ 1: 1 });
      const result = await agentModules.isModuleUnlocked(mockDb, 1, 'debug-mode');
      expect(result).toBe(true);
      expect(mockDb.get).toHaveBeenCalled();
    });

    it('should return false if module not in database', async () => {
      mockDb.get.mockResolvedValue(null);
      const result = await agentModules.isModuleUnlocked(mockDb, 1, 'debug-mode');
      expect(result).toBe(false);
    });
  });

  describe('getUnlockedModules', () => {
    it('should always include default modules', async () => {
      mockDb.all.mockResolvedValue([]);
      const result = await agentModules.getUnlockedModules(mockDb, 1);
      expect(result).toContain('test-runner');
      expect(result).toContain('auto-retry');
      expect(result).toContain('docs-lookup');
    });

    it('should include user-unlocked modules from database', async () => {
      mockDb.all.mockResolvedValue([
        { module_id: 'debug-mode' },
        { module_id: 'edge-case-focus' }
      ]);
      const result = await agentModules.getUnlockedModules(mockDb, 1);
      expect(result).toContain('debug-mode');
      expect(result).toContain('edge-case-focus');
      expect(result.length).toBe(5); // 3 defaults + 2 unlocked
    });

    it('should not duplicate modules', async () => {
      mockDb.all.mockResolvedValue([{ module_id: 'test-runner' }]);
      const result = await agentModules.getUnlockedModules(mockDb, 1);
      const testRunnerCount = result.filter(m => m === 'test-runner').length;
      expect(testRunnerCount).toBe(1);
    });
  });

  describe('checkAndAwardUnlocks', () => {
    beforeEach(() => {
      // Default: user with no stats (below any unlock thresholds)
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 0,
        total_battles: 0,
        max_elo: 800, // Below Silver rank (1000) so type-checker isn't unlocked
        current_streak: 0,
        best_streak: 0
      });
      mockDb.all.mockResolvedValue([]);
      mockDb.run.mockResolvedValue({ lastID: 1 });
    });

    it('should return empty array when no unlocks earned', async () => {
      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toEqual([]);
    });

    it('should unlock debug-mode after 5 wins', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 5,
        total_battles: 10,
        max_elo: 1000,
        current_streak: 0,
        best_streak: 0
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toContain('debug-mode');
    });

    it('should unlock type-checker at Silver rank (1000 ELO)', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 0,
        total_battles: 0,
        max_elo: 1000,
        current_streak: 0,
        best_streak: 0
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toContain('type-checker');
    });

    it('should unlock complexity-analyzer after 50 battles', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 20,
        total_battles: 50,
        max_elo: 1000,
        current_streak: 0,
        best_streak: 0
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toContain('complexity-analyzer');
    });

    it('should unlock strategic-planner with 5 win streak', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 5,
        total_battles: 10,
        max_elo: 1000,
        current_streak: 5,
        best_streak: 5
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toContain('strategic-planner');
    });

    it('should unlock memory-profiler with 3 languages', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 3,
        total_battles: 10,
        max_elo: 1000,
        current_streak: 0,
        best_streak: 0
      });
      // Mock languages query to return 3 different languages
      mockDb.all.mockImplementation((query) => {
        if (query.includes('DISTINCT al.language')) {
          return Promise.resolve([
            { language: 'python' },
            { language: 'javascript' },
            { language: 'go' }
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toContain('memory-profiler');
    });

    it('should not unlock already-unlocked modules', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 100,
        total_battles: 200,
        max_elo: 2000,
        current_streak: 10,
        best_streak: 20
      });
      // Mock that all modules are already unlocked
      mockDb.all.mockImplementation((query) => {
        if (query.includes('user_agent_modules')) {
          return Promise.resolve([
            { module_id: 'debug-mode' },
            { module_id: 'edge-case-focus' },
            { module_id: 'type-checker' },
            { module_id: 'complexity-analyzer' },
            { module_id: 'memory-profiler' },
            { module_id: 'template-library' },
            { module_id: 'strategic-planner' }
          ]);
        }
        if (query.includes('DISTINCT al.language')) {
          return Promise.resolve([
            { language: 'python' },
            { language: 'javascript' },
            { language: 'go' }
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      expect(result).toEqual([]);
    });

    it('should unlock multiple modules at once', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 15,
        total_battles: 50,
        max_elo: 1200,
        current_streak: 5,
        best_streak: 5
      });
      mockDb.all.mockImplementation((query) => {
        if (query.includes('DISTINCT al.language')) {
          return Promise.resolve([
            { language: 'python' },
            { language: 'javascript' },
            { language: 'go' }
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await agentModules.checkAndAwardUnlocks(mockDb, 1, {});
      // Should unlock: debug-mode (5 wins), edge-case-focus (15 wins),
      // type-checker (Silver), complexity-analyzer (50 battles),
      // memory-profiler (3 languages), template-library (Gold), strategic-planner (5 streak)
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('getModuleProgress', () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 3,
        total_battles: 10,
        max_elo: 950,
        best_streak: 2
      });
      mockDb.all.mockResolvedValue([]);
    });

    it('should return all modules with progress info', async () => {
      const result = await agentModules.getModuleProgress(mockDb, 1);
      expect(result.length).toBe(10);
    });

    it('should mark default modules as unlocked', async () => {
      const result = await agentModules.getModuleProgress(mockDb, 1);
      const testRunner = result.find(m => m.id === 'test-runner');
      expect(testRunner.isUnlocked).toBe(true);
      expect(testRunner.progress).toBeNull();
    });

    it('should include progress for locked modules', async () => {
      const result = await agentModules.getModuleProgress(mockDb, 1);
      const debugMode = result.find(m => m.id === 'debug-mode');
      expect(debugMode.isUnlocked).toBe(false);
      expect(debugMode.progress).toBeDefined();
      expect(debugMode.progress.current).toBe(3); // 3 wins
      expect(debugMode.progress.target).toBe(5);  // need 5 wins
      expect(debugMode.progress.percentage).toBe(60);
    });

    it('should cap percentage at 100', async () => {
      mockDb.get.mockResolvedValue({
        id: 1,
        total_wins: 100,
        total_battles: 200,
        max_elo: 2000,
        best_streak: 20
      });

      const result = await agentModules.getModuleProgress(mockDb, 1);
      result.forEach(module => {
        if (module.progress) {
          expect(module.progress.percentage).toBeLessThanOrEqual(100);
        }
      });
    });
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING TESTS
// ============================================================================

describe('AgentModules - Edge Cases', () => {
  describe('Table creation on missing table error', () => {
    let mockDb;

    beforeEach(() => {
      mockDb = {
        get: jest.fn(),
        all: jest.fn(),
        run: jest.fn()
      };
    });

    it('should handle missing table error gracefully', async () => {
      // First call throws "no such table" error, second succeeds
      let callCount = 0;
      mockDb.get.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('no such table: user_agent_modules');
          return Promise.reject(error);
        }
        return Promise.resolve(null);
      });

      const result = await agentModules.isModuleUnlocked(mockDb, 1, 'debug-mode');
      expect(result).toBe(false);
    });
  });

  describe('Null and undefined handling', () => {
    it('should handle null module arrays in validation', () => {
      const result = agentModules.validateModuleSelection(null, ['test-runner']);
      expect(result.valid).toBe(false);
    });

    it('should handle undefined unlocked array in validation', () => {
      const result = agentModules.validateModuleSelection(['test-runner'], undefined);
      expect(result.valid).toBe(false);
    });
  });
});
