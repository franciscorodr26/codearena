/**
 * Tests for Module Telemetry Service
 *
 * Tests cover:
 * - Recording module usage from battles
 * - Getting aggregated module stats
 * - Getting module trends over time
 * - Getting module combination stats
 */

const moduleTelemetry = require('../services/moduleTelemetry');

// Mock database
const createMockDb = () => ({
  run: jest.fn().mockResolvedValue({ changes: 1 }),
  get: jest.fn(),
  all: jest.fn().mockResolvedValue([])
});

// ============================================================================
// recordBattleModules TESTS
// ============================================================================

describe('ModuleTelemetry - recordBattleModules', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should record module usage for both players', async () => {
    const battleData = {
      player1Modules: ['test-runner', 'auto-retry'],
      player2Modules: ['debug-mode'],
      winnerId: 'user1',
      player1Id: 'user1',
      player2Id: 'user2',
      player1Tokens: 1000,
      player2Tokens: 800
    };

    await moduleTelemetry.recordBattleModules(mockDb, battleData);

    // Should call db.run for each module (3 total)
    expect(mockDb.run).toHaveBeenCalledTimes(3);
  });

  it('should record win for winner modules', async () => {
    const battleData = {
      player1Modules: ['test-runner'],
      player2Modules: ['debug-mode'],
      winnerId: 'user1',
      player1Id: 'user1',
      player2Id: 'user2',
      player1Tokens: 500,
      player2Tokens: 600
    };

    await moduleTelemetry.recordBattleModules(mockDb, battleData);

    // First call should be for test-runner (winner)
    const firstCall = mockDb.run.mock.calls[0];
    expect(firstCall[1]).toEqual(expect.arrayContaining([
      'test-runner',   // moduleId
      expect.any(String), // date
      1,               // used
      1,               // win (player1 won)
      0,               // loss
      0,               // draw
      500              // tokens
    ]));

    // Second call should be for debug-mode (loser)
    const secondCall = mockDb.run.mock.calls[1];
    expect(secondCall[1]).toEqual(expect.arrayContaining([
      'debug-mode',    // moduleId
      expect.any(String), // date
      1,               // used
      0,               // win
      1,               // loss (player2 lost)
      0,               // draw
      600              // tokens
    ]));
  });

  it('should record draw for all modules when no winner', async () => {
    const battleData = {
      player1Modules: ['test-runner'],
      player2Modules: ['debug-mode'],
      winnerId: null,
      player1Id: 'user1',
      player2Id: 'user2',
      player1Tokens: 500,
      player2Tokens: 600
    };

    await moduleTelemetry.recordBattleModules(mockDb, battleData);

    // Both calls should have draw=1
    mockDb.run.mock.calls.forEach(call => {
      const params = call[1];
      expect(params[5]).toBe(1); // draw
    });
  });

  it('should handle empty module arrays', async () => {
    const battleData = {
      player1Modules: [],
      player2Modules: [],
      winnerId: 'user1',
      player1Id: 'user1',
      player2Id: 'user2'
    };

    await moduleTelemetry.recordBattleModules(mockDb, battleData);

    // No modules to record
    expect(mockDb.run).not.toHaveBeenCalled();
  });

  it('should handle missing module arrays with defaults', async () => {
    const battleData = {
      winnerId: 'user1',
      player1Id: 'user1',
      player2Id: 'user2'
    };

    await moduleTelemetry.recordBattleModules(mockDb, battleData);

    // Should use default empty arrays
    expect(mockDb.run).not.toHaveBeenCalled();
  });

  it('should continue recording even if one module fails', async () => {
    mockDb.run
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ changes: 1 });

    const battleData = {
      player1Modules: ['test-runner'],
      player2Modules: ['debug-mode'],
      winnerId: 'user1',
      player1Id: 'user1',
      player2Id: 'user2'
    };

    // Should not throw
    await expect(moduleTelemetry.recordBattleModules(mockDb, battleData))
      .resolves.not.toThrow();

    // Should still try to record both
    expect(mockDb.run).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// getModuleStats TESTS
// ============================================================================

describe('ModuleTelemetry - getModuleStats', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should return formatted stats', async () => {
    mockDb.all.mockResolvedValue([
      {
        module_id: 'test-runner',
        total_uses: 100,
        total_wins: 60,
        total_losses: 30,
        total_draws: 10,
        total_tokens: 50000,
        win_rate: 66.7
      },
      {
        module_id: 'debug-mode',
        total_uses: 50,
        total_wins: 20,
        total_losses: 25,
        total_draws: 5,
        total_tokens: 25000,
        win_rate: 44.4
      }
    ]);

    const stats = await moduleTelemetry.getModuleStats(mockDb);

    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual({
      moduleId: 'test-runner',
      totalUses: 100,
      totalWins: 60,
      totalLosses: 30,
      totalDraws: 10,
      totalTokens: 50000,
      winRate: 66.7,
      totalBattles: 100
    });
  });

  it('should use default date range of 30 days', async () => {
    await moduleTelemetry.getModuleStats(mockDb);

    const call = mockDb.all.mock.calls[0];
    const params = call[1];

    // Should have start and end dates as first two params
    expect(params).toHaveLength(2);
    expect(typeof params[0]).toBe('string');
    expect(typeof params[1]).toBe('string');

    // Dates should be in YYYY-MM-DD format
    expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should filter by module ID when provided', async () => {
    await moduleTelemetry.getModuleStats(mockDb, { moduleId: 'test-runner' });

    const call = mockDb.all.mock.calls[0];
    const params = call[1];

    expect(params).toHaveLength(3);
    expect(params[2]).toBe('test-runner');
  });

  it('should handle null values gracefully', async () => {
    mockDb.all.mockResolvedValue([
      {
        module_id: 'test-runner',
        total_uses: null,
        total_wins: null,
        total_losses: null,
        total_draws: null,
        total_tokens: null,
        win_rate: null
      }
    ]);

    const stats = await moduleTelemetry.getModuleStats(mockDb);

    expect(stats[0]).toEqual({
      moduleId: 'test-runner',
      totalUses: 0,
      totalWins: 0,
      totalLosses: 0,
      totalDraws: 0,
      totalTokens: 0,
      winRate: 0,
      totalBattles: 0
    });
  });

  it('should return empty array on error', async () => {
    mockDb.all.mockRejectedValue(new Error('DB error'));

    const stats = await moduleTelemetry.getModuleStats(mockDb);

    expect(stats).toEqual([]);
  });
});

// ============================================================================
// getModuleTrends TESTS
// ============================================================================

describe('ModuleTelemetry - getModuleTrends', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should return formatted daily trends', async () => {
    mockDb.all.mockResolvedValue([
      {
        date: '2026-04-01',
        times_used: 10,
        wins: 6,
        losses: 3,
        draws: 1,
        total_tokens: 5000,
        win_rate: 66.7
      },
      {
        date: '2026-04-02',
        times_used: 15,
        wins: 8,
        losses: 5,
        draws: 2,
        total_tokens: 7500,
        win_rate: 61.5
      }
    ]);

    const trends = await moduleTelemetry.getModuleTrends(mockDb, 'test-runner', 30);

    expect(trends).toHaveLength(2);
    expect(trends[0]).toEqual({
      date: '2026-04-01',
      uses: 10,
      wins: 6,
      losses: 3,
      draws: 1,
      tokens: 5000,
      winRate: 66.7
    });
  });

  it('should query with correct module ID and date range', async () => {
    await moduleTelemetry.getModuleTrends(mockDb, 'debug-mode', 7);

    const call = mockDb.all.mock.calls[0];
    const params = call[1];

    expect(params[0]).toBe('debug-mode');
    expect(params[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should use default 30 days', async () => {
    await moduleTelemetry.getModuleTrends(mockDb, 'test-runner');

    const call = mockDb.all.mock.calls[0];
    const query = call[0];

    // Query should be executed with a date 30 days ago
    expect(query).toContain('WHERE module_id = ?');
    expect(query).toContain('AND date >= ?');
  });

  it('should return empty array on error', async () => {
    mockDb.all.mockRejectedValue(new Error('DB error'));

    const trends = await moduleTelemetry.getModuleTrends(mockDb, 'test-runner');

    expect(trends).toEqual([]);
  });
});

// ============================================================================
// getModuleCombinations TESTS
// ============================================================================

describe('ModuleTelemetry - getModuleCombinations', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should count module combinations from battles', async () => {
    mockDb.all.mockResolvedValue([
      {
        player1_modules: '["test-runner","auto-retry"]',
        player2_modules: '["debug-mode","edge-case-focus"]',
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      },
      {
        player1_modules: '["test-runner","auto-retry"]',
        player2_modules: '["debug-mode","edge-case-focus"]',
        winner_id: 'user2',
        player1_id: 'user1',
        player2_id: 'user2'
      }
    ]);

    const combinations = await moduleTelemetry.getModuleCombinations(mockDb, 30);

    expect(combinations.length).toBeGreaterThan(0);

    // test-runner+auto-retry should have 2 uses, 1 win
    const combo1 = combinations.find(c => c.combination.includes('test-runner'));
    expect(combo1).toBeDefined();
    expect(combo1.uses).toBe(2);
    expect(combo1.wins).toBe(1);
  });

  it('should skip invalid JSON modules', async () => {
    mockDb.all.mockResolvedValue([
      {
        player1_modules: 'invalid json',
        player2_modules: '["debug-mode","edge-case-focus"]',
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      }
    ]);

    const combinations = await moduleTelemetry.getModuleCombinations(mockDb);

    // Should still return combinations from valid data
    expect(combinations.length).toBe(1);
  });

  it('should only count combinations of exactly 2 modules', async () => {
    mockDb.all.mockResolvedValue([
      {
        player1_modules: '["test-runner"]',  // Only 1 module
        player2_modules: '["a","b","c"]',    // 3 modules
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      }
    ]);

    const combinations = await moduleTelemetry.getModuleCombinations(mockDb);

    // Neither should count as a combination
    expect(combinations).toEqual([]);
  });

  it('should calculate win rate correctly', async () => {
    mockDb.all.mockResolvedValue([
      {
        player1_modules: '["a","b"]',
        player2_modules: '["c","d"]',
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      },
      {
        player1_modules: '["a","b"]',
        player2_modules: '["c","d"]',
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      },
      {
        player1_modules: '["a","b"]',
        player2_modules: '["c","d"]',
        winner_id: 'user2',
        player1_id: 'user1',
        player2_id: 'user2'
      }
    ]);

    const combinations = await moduleTelemetry.getModuleCombinations(mockDb);

    const comboAB = combinations.find(c => c.modules.includes('a'));
    expect(comboAB.uses).toBe(3);
    expect(comboAB.wins).toBe(2);
    expect(comboAB.winRate).toBeCloseTo(66.7, 0);
  });

  it('should return top 20 combinations sorted by usage', async () => {
    // Create many combinations
    const battles = [];
    for (let i = 0; i < 25; i++) {
      battles.push({
        player1_modules: `["mod${i}","mod${i + 100}"]`,
        player2_modules: '["x","y"]',
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      });
    }
    // Add more uses for x+y combo
    for (let i = 0; i < 30; i++) {
      battles.push({
        player1_modules: '["x","y"]',
        player2_modules: '["a","b"]',
        winner_id: 'user1',
        player1_id: 'user1',
        player2_id: 'user2'
      });
    }
    mockDb.all.mockResolvedValue(battles);

    const combinations = await moduleTelemetry.getModuleCombinations(mockDb);

    expect(combinations.length).toBeLessThanOrEqual(20);
    // Most used should be first
    expect(combinations[0].combination).toContain('x');
  });

  it('should return empty array on error', async () => {
    mockDb.all.mockRejectedValue(new Error('DB error'));

    const combinations = await moduleTelemetry.getModuleCombinations(mockDb);

    expect(combinations).toEqual([]);
  });
});
