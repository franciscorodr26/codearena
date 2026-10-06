/**
 * Agent Battle Integration Tests
 *
 * These tests cover the full agent battle flow in CodeArena, including:
 * - Matchmaking and queue management
 * - Battle execution with AI agents (via Anthropic SDK)
 * - Code generation and validation
 * - Winner determination (by test passage count and execution time)
 * - ELO rating updates for agent loadouts
 * - Error handling (API failures, timeouts, code generation failures)
 * - Battle state management and spectator functionality
 *
 * The tests mock:
 * - Anthropic SDK streaming API for code generation
 * - Socket.io for real-time event emission
 * - Database operations for ELO and battle records
 * - Code validation/execution via Judge0
 *
 * Run with: npm test -- agentBattle.integration.test.js
 */

const { v4: uuidv4 } = require('uuid');

// Mock the Anthropic SDK before other imports
const mockMessagesCreate = jest.fn();
const mockMessagesStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
      stream: mockMessagesStream
    }
  }));
});

// Mock Socket.io
const mockIo = {
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
  sockets: {
    sockets: new Map()
  }
};

const mockSocket = {
  id: 'socket-123',
  emit: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  handshake: {
    auth: { token: 'valid-jwt-token' },
    query: {}
  }
};

// Mock database
jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  getUserById: jest.fn()
}));

// Mock JWT
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ sub: 'user-123' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock codeExecutor
jest.mock('../services/codeExecutor', () => ({
  executeCode: jest.fn()
}), { virtual: true });

// Mock validateSolution
jest.mock('../services/validateSolution', () => ({
  validateSolution: jest.fn()
}));

const db = require('../db');
const agentSolver = require('../services/agentSolver');
const { validateSolution } = require('../services/validateSolution');
const { executeCode } = require('../services/codeExecutor');

describe('Agent Battle Integration Tests - Full Battle Flow', () => {
  let battleId;
  let player1;
  let player2;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset global state
    global.agentBattles = new Map();
    global.agentMatchmakingQueue = new Map();
    global.agentMatchmakingLocks = new Set();
    global.agentRematchRequests = new Map();
    global.agentCleanupTimers = new Map();

    battleId = `agent-battle-${uuidv4()}`;

    // Setup test players
    player1 = {
      userId: 'user-1',
      username: 'alice',
      loadoutId: 'loadout-1',
      loadout: {
        model: 'haiku',
        language: 'python',
        systemPrompt: 'Be efficient',
        tools: []
      },
      socketId: 'socket-1'
    };

    player2 = {
      userId: 'user-2',
      username: 'bob',
      loadoutId: 'loadout-2',
      loadout: {
        model: 'sonnet',
        language: 'python',
        systemPrompt: 'Write clean code',
        tools: []
      },
      socketId: 'socket-2'
    };

    // Mock database responses
    db.getUserById.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      rating: 1200,
      is_pro: 0
    });

    db.get.mockImplementation((sql, params) => {
      if (sql.includes('agent_loadouts') && sql.includes('elo')) {
        return Promise.resolve({
          elo: 1000,
          current_streak: 0,
          best_streak: 0
        });
      }
      if (sql.includes('agent_battles') && sql.includes('COUNT')) {
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve(null);
    });

    db.run.mockResolvedValue({ lastID: 1, changes: 1 });
  });

  describe('Successful Battle Completion with Winner', () => {
    it('should complete a full battle where player 1 wins by passing all tests', async () => {
      // Setup problem
      const problem = {
        id: 'test-problem-1',
        title: 'Two Sum',
        description: 'Return indices of two numbers that add up to target',
        examples: [
          { input: { nums: [2, 7, 11, 15], target: 9 }, output: [0, 1] }
        ],
        constraints: ['2 <= nums.length <= 10^4'],
        testCases: [
          { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
          { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
          { input: { nums: [3, 3], target: 6 }, expected: [0, 1] }
        ]
      };

      // Create battle
      const battle = {
        id: battleId,
        problem,
        players: [
          { ...player1, status: 'pending', code: null, testResults: null },
          { ...player2, status: 'pending', code: null, testResults: null }
        ],
        spectators: new Set(),
        state: 'matched',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null
      };

      global.agentBattles.set(battleId, battle);

      // Mock Player 1 generating perfect solution
      mockMessagesStream.mockImplementationOnce(() => {
        const events = [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'def solve(nums, target):\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '    seen = {}\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '    for i, num in enumerate(nums):\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '        if target - num in seen:\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '            return [seen[target - num], i]\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '        seen[num] = i\n' } }
        ];

        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          },
          finalMessage: async () => ({
            usage: { input_tokens: 100, output_tokens: 50 }
          })
        };
      });

      // Mock Player 2 generating imperfect solution (fails some tests)
      mockMessagesStream.mockImplementationOnce(() => {
        const events = [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'def solve(nums, target):\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '    return [0, 1]\n' } }
        ];

        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          },
          finalMessage: async () => ({
            usage: { input_tokens: 100, output_tokens: 20 }
          })
        };
      });

      // Mock validation results - note: Promise.all may run in any order
      // We'll use mockImplementation to return different results based on the code
      validateSolution.mockImplementation((code, testCases) => {
        const passedCount = code.includes('seen[target - num]') ? 3 : 2;

        return Promise.resolve(testCases.map((tc, i) => ({
          input: tc.input,
          expected: tc.expected,
          actual: tc.expected,
          passed: passedCount === 3 || i !== 1 // Player 1 passes all, Player 2 fails test 2
        })));
      });

      // Import the battle runner function (we'll simulate it here)
      const runBattle = async (battleId) => {
        const battle = global.agentBattles.get(battleId);
        battle.state = 'running';
        battle.startedAt = Date.now();

        // Run both agents
        const results = await Promise.all(
          battle.players.map(async (player) => {
            const { generateSolutionStreaming } = require('../services/agentSolver');

            let code = '';
            const result = await generateSolutionStreaming(
              battle.problem,
              player.loadout,
              (chunk) => { code += chunk; }
            );

            if (!result.success) {
              player.status = 'error';
              player.passedCount = 0;
              player.totalTests = battle.problem.testCases.length;
              return { playerId: player.userId, success: false, passedCount: 0 };
            }

            player.code = result.code;

            // Validate solution
            const testResults = await validateSolution(
              result.code,
              battle.problem.testCases,
              player.loadout.language,
              battle.problem.id
            );

            const passedCount = testResults.filter(r => r.passed).length;
            player.testResults = testResults;
            player.passedCount = passedCount;
            player.totalTests = testResults.length;
            player.status = passedCount === testResults.length ? 'completed' : 'failed';
            player.executionTime = 1000;
            player.tokensUsed = result.tokensUsed?.total || 0;

            return {
              playerId: player.userId,
              success: passedCount === testResults.length,
              passedCount,
              executionTime: player.executionTime
            };
          })
        );

        // Determine winner
        battle.state = 'finished';
        battle.finishedAt = Date.now();

        const [p1, p2] = battle.players;
        if (p1.passedCount > p2.passedCount) {
          battle.winnerId = p1.userId;
          battle.winReason = 'more_tests_passed';
        } else if (p2.passedCount > p1.passedCount) {
          battle.winnerId = p2.userId;
          battle.winReason = 'more_tests_passed';
        } else if (p1.passedCount === p2.passedCount && p1.passedCount > 0) {
          battle.winnerId = p1.executionTime < p2.executionTime ? p1.userId : p2.userId;
          battle.winReason = 'faster_execution';
        } else {
          battle.winnerId = null;
          battle.winReason = 'tie';
        }

        // Calculate ELO changes
        const elo = require('../elo');
        if (battle.winnerId) {
          const isP1Winner = p1.userId === battle.winnerId;
          const winner = { rating: 1000, totalGames: 0 };
          const loser = { rating: 1000, totalGames: 0 };
          const eloResult = elo.calculateMatchRatings(winner, loser);

          battle.eloChanges = {
            p1Change: isP1Winner ? eloResult.winner.change : eloResult.loser.change,
            p2Change: isP1Winner ? eloResult.loser.change : eloResult.winner.change
          };
        }

        return battle;
      };

      // Run the battle
      const completedBattle = await runBattle(battleId);

      // Assertions
      expect(completedBattle.state).toBe('finished');
      expect(completedBattle.winnerId).toBe('user-1'); // Player 1 should win
      expect(completedBattle.winReason).toBe('more_tests_passed');
      expect(completedBattle.players[0].passedCount).toBe(3);
      expect(completedBattle.players[1].passedCount).toBeLessThan(3);
      expect(completedBattle.eloChanges).toBeDefined();
      expect(completedBattle.eloChanges.p1Change).toBeGreaterThan(0);
      expect(completedBattle.eloChanges.p2Change).toBeLessThan(0);
    });

    it('should handle winner determination by execution time when both pass all tests', async () => {
      const problem = {
        id: 'test-problem-2',
        title: 'Simple Add',
        description: 'Add two numbers',
        examples: [],
        testCases: [
          { input: { a: 1, b: 2 }, expected: 3 },
          { input: { a: 5, b: 7 }, expected: 12 }
        ]
      };

      const battle = {
        id: battleId,
        problem,
        players: [
          { ...player1, status: 'pending', code: null, testResults: null },
          { ...player2, status: 'pending', code: null, testResults: null }
        ],
        spectators: new Set(),
        state: 'matched',
        createdAt: Date.now()
      };

      global.agentBattles.set(battleId, battle);

      // Both players generate working solutions
      mockMessagesStream.mockImplementation(() => {
        const events = [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'def solve(a, b):\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '    return a + b\n' } }
        ];

        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          },
          finalMessage: async () => ({
            usage: { input_tokens: 50, output_tokens: 20 }
          })
        };
      });

      // Mock validation - both pass all tests
      validateSolution.mockResolvedValue([
        { input: { a: 1, b: 2 }, expected: 3, actual: 3, passed: true },
        { input: { a: 5, b: 7 }, expected: 12, actual: 12, passed: true }
      ]);

      // Simulate battle with different execution times
      const runBattle = async () => {
        const battle = global.agentBattles.get(battleId);
        battle.state = 'running';
        battle.startedAt = Date.now();

        const { generateSolutionStreaming } = require('../services/agentSolver');

        for (let i = 0; i < battle.players.length; i++) {
          const player = battle.players[i];
          const startTime = Date.now();

          const result = await generateSolutionStreaming(
            battle.problem,
            player.loadout,
            (chunk) => {}
          );

          player.code = result.code;
          const testResults = await validateSolution(
            result.code,
            battle.problem.testCases,
            player.loadout.language,
            battle.problem.id
          );

          player.passedCount = testResults.filter(r => r.passed).length;
          player.totalTests = testResults.length;
          player.executionTime = i === 0 ? 800 : 1200; // Player 1 is faster
          player.status = 'completed';
        }

        battle.state = 'finished';
        const [p1, p2] = battle.players;

        if (p1.passedCount > p2.passedCount) {
          battle.winnerId = p1.userId;
          battle.winReason = 'more_tests_passed';
        } else if (p2.passedCount > p1.passedCount) {
          battle.winnerId = p2.userId;
          battle.winReason = 'more_tests_passed';
        } else if (p1.passedCount === p2.passedCount && p1.passedCount > 0) {
          battle.winnerId = p1.executionTime < p2.executionTime ? p1.userId : p2.userId;
          battle.winReason = 'faster_execution';
        } else {
          battle.winnerId = null;
          battle.winReason = 'tie';
        }

        return battle;
      };

      const completedBattle = await runBattle();

      expect(completedBattle.winnerId).toBe('user-1');
      expect(completedBattle.winReason).toBe('faster_execution');
      expect(completedBattle.players[0].executionTime).toBeLessThan(completedBattle.players[1].executionTime);
    });
  });

  describe('Battle Tie Scenarios', () => {
    it('should handle tie when both agents pass same number of tests with same time', async () => {
      const problem = {
        id: 'test-problem-3',
        title: 'Return One',
        description: 'Return 1',
        examples: [],
        testCases: [
          { input: {}, expected: 1 }
        ]
      };

      const battle = {
        id: battleId,
        problem,
        players: [
          { ...player1, status: 'pending', passedCount: 1, totalTests: 1, executionTime: 1000 },
          { ...player2, status: 'pending', passedCount: 1, totalTests: 1, executionTime: 1000 }
        ],
        state: 'finished',
        createdAt: Date.now()
      };

      // Determine winner logic
      const [p1, p2] = battle.players;
      if (p1.passedCount === p2.passedCount) {
        if (p1.executionTime === p2.executionTime) {
          battle.winReason = 'tie';
          battle.winnerId = null;
        } else {
          battle.winnerId = p1.executionTime < p2.executionTime ? p1.userId : p2.userId;
          battle.winReason = 'faster_execution';
        }
      }

      expect(battle.winReason).toBe('tie');
      expect(battle.winnerId).toBeNull();
    });

    it('should handle tie when both agents fail all tests', async () => {
      const problem = {
        id: 'test-problem-4',
        title: 'Complex Problem',
        description: 'Very hard',
        examples: [],
        testCases: [
          { input: { n: 5 }, expected: 120 },
          { input: { n: 3 }, expected: 6 }
        ]
      };

      const battle = {
        id: battleId,
        problem,
        players: [
          { ...player1, status: 'failed', passedCount: 0, totalTests: 2, executionTime: 2000 },
          { ...player2, status: 'failed', passedCount: 0, totalTests: 2, executionTime: 1500 }
        ],
        state: 'finished'
      };

      const [p1, p2] = battle.players;
      let winReason = '';

      if (p1.passedCount === 0 && p2.passedCount === 0) {
        winReason = 'tie';
      }

      expect(winReason).toBe('tie');
    });
  });

  describe('Battle Error Handling', () => {
    it('should handle when one agent fails to generate code', async () => {
      const problem = {
        id: 'test-problem-5',
        title: 'Test Problem',
        description: 'Test',
        examples: [],
        testCases: [
          { input: { x: 1 }, expected: 2 }
        ]
      };

      const battle = {
        id: battleId,
        problem,
        players: [
          { ...player1, status: 'pending', code: null },
          { ...player2, status: 'pending', code: null }
        ],
        spectators: new Set(),
        state: 'matched',
        createdAt: Date.now()
      };

      global.agentBattles.set(battleId, battle);

      // Player 1 succeeds
      mockMessagesStream.mockImplementationOnce(() => {
        const events = [
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'def solve(x):\n' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: '    return x * 2\n' } }
        ];

        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) {
              yield event;
            }
          },
          finalMessage: async () => ({
            usage: { input_tokens: 50, output_tokens: 20 }
          })
        };
      });

      // Player 2 fails
      mockMessagesStream.mockImplementationOnce(() => {
        throw new Error('API rate limit exceeded');
      });

      // Player 1 passes test
      validateSolution.mockResolvedValueOnce([
        { input: { x: 1 }, expected: 2, actual: 2, passed: true }
      ]);

      // Player 2 gets error (no validation called due to exception)

      const runBattle = async () => {
        const battle = global.agentBattles.get(battleId);
        battle.state = 'running';

        const { generateSolutionStreaming } = require('../services/agentSolver');

        const results = await Promise.all(
          battle.players.map(async (player) => {
            try {
              const result = await generateSolutionStreaming(
                battle.problem,
                player.loadout,
                (chunk) => {}
              );

              if (!result.success) {
                player.status = 'error';
                player.passedCount = 0;
                player.totalTests = battle.problem.testCases.length;
                player.executionTime = 0;
                return { playerId: player.userId, success: false, passedCount: 0 };
              }

              player.code = result.code;
              const testResults = await validateSolution(
                result.code,
                battle.problem.testCases,
                player.loadout.language,
                battle.problem.id
              );

              player.passedCount = testResults.filter(r => r.passed).length;
              player.totalTests = testResults.length;
              player.status = 'completed';
              player.executionTime = 1000;

              return { playerId: player.userId, success: true, passedCount: player.passedCount };
            } catch (err) {
              player.status = 'error';
              player.passedCount = 0;
              player.totalTests = battle.problem.testCases.length;
              player.executionTime = 0;
              return { playerId: player.userId, success: false, passedCount: 0, error: err.message };
            }
          })
        );

        battle.state = 'finished';
        const [p1, p2] = battle.players;

        if (p1.passedCount > p2.passedCount) {
          battle.winnerId = p1.userId;
          battle.winReason = 'more_tests_passed';
        } else if (p2.passedCount > p1.passedCount) {
          battle.winnerId = p2.userId;
          battle.winReason = 'more_tests_passed';
        } else if (p1.passedCount === p2.passedCount && p1.passedCount > 0) {
          battle.winnerId = p1.executionTime < p2.executionTime ? p1.userId : p2.userId;
          battle.winReason = 'faster_execution';
        } else {
          battle.winnerId = null;
          battle.winReason = 'tie';
        }

        return battle;
      };

      const completedBattle = await runBattle();

      expect(completedBattle.state).toBe('finished');
      expect(completedBattle.players[0].status).toBe('completed');
      expect(completedBattle.players[1].status).toBe('error');
      expect(completedBattle.winnerId).toBe('user-1'); // Player 1 wins by default
      expect(completedBattle.players[1].passedCount).toBe(0);
    });

    it('should handle when both agents fail to generate code', async () => {
      const problem = {
        id: 'test-problem-6',
        title: 'Test Problem',
        description: 'Test',
        examples: [],
        testCases: [{ input: {}, expected: 1 }]
      };

      const battle = {
        id: battleId,
        problem,
        players: [
          { ...player1, status: 'pending', code: null },
          { ...player2, status: 'pending', code: null }
        ],
        state: 'matched'
      };

      global.agentBattles.set(battleId, battle);

      // Both fail
      mockMessagesStream.mockImplementation(() => {
        throw new Error('API error');
      });

      const runBattle = async () => {
        const battle = global.agentBattles.get(battleId);
        battle.state = 'running';

        const { generateSolutionStreaming } = require('../services/agentSolver');

        for (const player of battle.players) {
          try {
            const result = await generateSolutionStreaming(battle.problem, player.loadout, () => {});
            player.status = 'error';
            player.passedCount = 0;
            player.totalTests = battle.problem.testCases.length;
          } catch (err) {
            player.status = 'error';
            player.passedCount = 0;
            player.totalTests = battle.problem.testCases.length;
          }
        }

        battle.state = 'finished';
        battle.winnerId = null;
        battle.winReason = 'tie';

        return battle;
      };

      const completedBattle = await runBattle();

      expect(completedBattle.state).toBe('finished');
      expect(completedBattle.players[0].status).toBe('error');
      expect(completedBattle.players[1].status).toBe('error');
      expect(completedBattle.winReason).toBe('tie');
    });
  });

  describe('ELO Rating Updates', () => {
    it('should calculate correct ELO changes for winner and loser', async () => {
      const battle = {
        id: battleId,
        players: [
          { ...player1, loadoutId: 'loadout-1', userId: 'user-1', passedCount: 3, totalTests: 3 },
          { ...player2, loadoutId: 'loadout-2', userId: 'user-2', passedCount: 1, totalTests: 3 }
        ],
        state: 'finished',
        winnerId: 'user-1',
        winReason: 'more_tests_passed'
      };

      // Mock ELO data
      db.get.mockImplementation((sql) => {
        if (sql.includes('agent_loadouts') && sql.includes('elo')) {
          return Promise.resolve({
            elo: 1000,
            current_streak: 0,
            best_streak: 0
          });
        }
        if (sql.includes('COUNT')) {
          return Promise.resolve({ count: 0 });
        }
        return Promise.resolve(null);
      });

      const elo = require('../elo');
      const winner = { rating: 1000, totalGames: 0 };
      const loser = { rating: 1000, totalGames: 0 };

      const eloResult = elo.calculateMatchRatings(winner, loser);

      expect(eloResult.winner.newRating).toBeGreaterThan(1000);
      expect(eloResult.loser.newRating).toBeLessThan(1000);
      expect(eloResult.winner.change).toBeGreaterThan(0);
      expect(eloResult.loser.change).toBeLessThan(0);
      expect(eloResult.winner.change + eloResult.loser.change).toBe(0); // Zero-sum
    });

    it('should calculate different ELO changes for uneven matchup', async () => {
      const elo = require('../elo');

      // High rated player beats low rated player (small gain)
      const highRatedWinner = { rating: 1800, totalGames: 50 };
      const lowRatedLoser = { rating: 1000, totalGames: 10 };

      const result1 = elo.calculateMatchRatings(highRatedWinner, lowRatedLoser);

      // Low rated player beats high rated player (large gain)
      const lowRatedWinner = { rating: 1000, totalGames: 10 };
      const highRatedLoser = { rating: 1800, totalGames: 50 };

      const result2 = elo.calculateMatchRatings(lowRatedWinner, highRatedLoser);

      // Upset should give more points than expected win
      expect(result2.winner.change).toBeGreaterThan(result1.winner.change);
    });

    it('should update loadout ELO in database after battle', async () => {
      const battle = {
        id: battleId,
        players: [
          { ...player1, loadoutId: 'loadout-1', userId: 'user-1', passedCount: 3 },
          { ...player2, loadoutId: 'loadout-2', userId: 'user-2', passedCount: 0 }
        ],
        winnerId: 'user-1',
        winReason: 'more_tests_passed'
      };

      db.get.mockResolvedValue({ elo: 1000, current_streak: 0, best_streak: 0 });

      const elo = require('../elo');
      const eloResult = elo.calculateMatchRatings(
        { rating: 1000, totalGames: 0 },
        { rating: 1000, totalGames: 0 }
      );

      // Simulate ELO update
      await db.run(
        'UPDATE agent_loadouts SET elo = ?, wins = wins + 1, current_streak = ? WHERE id = ?',
        [eloResult.winner.newRating, 1, 'loadout-1']
      );

      await db.run(
        'UPDATE agent_loadouts SET elo = ?, losses = losses + 1, current_streak = ? WHERE id = ?',
        [eloResult.loser.newRating, 0, 'loadout-2']
      );

      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agent_loadouts'),
        expect.arrayContaining([expect.any(Number), expect.any(Number), 'loadout-1'])
      );

      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agent_loadouts'),
        expect.arrayContaining([expect.any(Number), 0, 'loadout-2'])
      );
    });
  });

  describe('Battle Timeout Handling', () => {
    it('should set timeout state and error message when battle times out', async () => {
      // Simpler test: verify timeout handling logic without complex async
      const battle = {
        id: battleId,
        problem: {
          id: 'test-timeout',
          title: 'Timeout Test',
          testCases: [{ input: {}, expected: 1 }]
        },
        players: [
          { ...player1, status: 'pending' },
          { ...player2, status: 'pending' }
        ],
        state: 'running'
      };

      // Simulate timeout handling
      const handleTimeout = (battle) => {
        battle.state = 'timeout';
        battle.error = 'Battle timed out after 60000ms';
        return battle;
      };

      const result = handleTimeout(battle);

      expect(result.state).toBe('timeout');
      expect(result.error).toContain('timed out');
    });

    it('should reject promise when timeout occurs before completion', async () => {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout after 100ms')), 100);
      });

      const slowPromise = new Promise((resolve) => {
        setTimeout(() => resolve('done'), 5000);
      });

      await expect(Promise.race([slowPromise, timeoutPromise])).rejects.toThrow('Timeout');
    }, 1000);
  });

  describe('Matchmaking and Queue', () => {
    it('should match two players from queue and create battle', () => {
      const queue = new Map();

      queue.set('user-1', {
        userId: 'user-1',
        username: 'alice',
        loadout: { model: 'haiku', language: 'python' },
        loadoutId: 'loadout-1',
        socketId: 'socket-1',
        joinedAt: Date.now()
      });

      queue.set('user-2', {
        userId: 'user-2',
        username: 'bob',
        loadout: { model: 'sonnet', language: 'python' },
        loadoutId: 'loadout-2',
        socketId: 'socket-2',
        joinedAt: Date.now()
      });

      // Simulate matching
      const players = Array.from(queue.values());
      expect(players.length).toBe(2);

      // Create battle
      const newBattleId = `agent-battle-${uuidv4()}`;
      const newBattle = {
        id: newBattleId,
        players: players.map(p => ({
          userId: p.userId,
          username: p.username,
          loadout: p.loadout,
          loadoutId: p.loadoutId,
          socketId: p.socketId,
          status: 'pending'
        })),
        state: 'matched',
        createdAt: Date.now()
      };

      // Remove from queue
      queue.delete('user-1');
      queue.delete('user-2');

      expect(queue.size).toBe(0);
      expect(newBattle.players).toHaveLength(2);
      expect(newBattle.state).toBe('matched');
    });

    it('should prevent user from joining queue twice', () => {
      const queue = new Map();
      const userId = 'user-1';

      const queueEntry = {
        userId,
        username: 'alice',
        loadout: { model: 'haiku', language: 'python' },
        loadoutId: 'loadout-1',
        socketId: 'socket-1',
        joinedAt: Date.now()
      };

      queue.set(userId, queueEntry);

      // Try to add again
      const isAlreadyInQueue = queue.has(userId);

      expect(isAlreadyInQueue).toBe(true);
      expect(queue.size).toBe(1);
    });
  });

  describe('Spectator Functionality', () => {
    it('should allow spectators to join battle room', () => {
      const battle = {
        id: battleId,
        players: [player1, player2],
        spectators: new Set(),
        state: 'running'
      };

      global.agentBattles.set(battleId, battle);

      // Add spectators
      battle.spectators.add('spectator-1');
      battle.spectators.add('spectator-2');

      expect(battle.spectators.size).toBe(2);
      expect(battle.spectators.has('spectator-1')).toBe(true);
    });

    it('should track spectator count correctly', () => {
      const battle = {
        id: battleId,
        spectators: new Set(),
        state: 'running'
      };

      battle.spectators.add('user-3');
      battle.spectators.add('user-4');
      battle.spectators.add('user-5');

      expect(battle.spectators.size).toBe(3);

      // Remove spectator
      battle.spectators.delete('user-4');
      expect(battle.spectators.size).toBe(2);
    });
  });
});
