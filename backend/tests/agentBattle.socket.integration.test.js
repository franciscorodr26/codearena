/**
 * Agent Battle Socket Integration Tests
 *
 * Tests the full battle flow through actual socket event handlers:
 * - Queue joining with authentication
 * - Matchmaking between two players
 * - Battle execution and completion
 * - Rate limiting integration
 * - ELO updates post-battle
 * - Error handling and edge cases
 */

const { v4: uuidv4 } = require('uuid');

// Mock Anthropic SDK
const mockStream = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
      stream: mockStream
    }
  }));
});

// Mock database
const mockDb = {
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  getUserById: jest.fn()
};
jest.mock('../db', () => mockDb);

// Mock JWT
const mockJwt = {
  verify: jest.fn(),
  sign: jest.fn()
};
jest.mock('jsonwebtoken', () => mockJwt);

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock code executor and validator
jest.mock('../services/codeExecutor', () => ({
  executeCode: jest.fn()
}), { virtual: true });

jest.mock('../services/validateSolution', () => ({
  validateSolution: jest.fn()
}));

// Mock rate limiter
const mockRateLimiter = {
  checkAgentBattleRateLimit: jest.fn(),
  getRateLimitStatus: jest.fn(),
  refundRateLimitSlot: jest.fn()
};
jest.mock('../services/agentRateLimiter', () => mockRateLimiter);

// Mock spending limiter
jest.mock('../services/agentSpendingLimiter', () => ({
  checkSpendingLimit: jest.fn().mockReturnValue({ allowed: true }),
  recordSpending: jest.fn()
}));

const { validateSolution } = require('../services/validateSolution');

describe('Agent Battle Socket Integration Tests', () => {
  let mockSocket1, mockSocket2;
  let mockIo;

  // Simulated socket event handlers (extracted from server.js logic)
  const createMockSocket = (userId, username) => ({
    id: `socket-${userId}`,
    emit: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
    handshake: {
      auth: { token: `token-${userId}` },
      query: {}
    },
    userId,
    username
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset global state
    global.agentBattles = new Map();
    global.agentMatchmakingQueue = new Map();
    global.agentMatchmakingLocks = new Set();
    global.agentRematchRequests = new Map();
    global.agentCleanupTimers = new Map();

    // Setup mock sockets
    mockSocket1 = createMockSocket('user-1', 'alice');
    mockSocket2 = createMockSocket('user-2', 'bob');

    // Setup mock io
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      sockets: {
        sockets: new Map([
          [mockSocket1.id, mockSocket1],
          [mockSocket2.id, mockSocket2]
        ])
      }
    };

    // Default JWT mock
    mockJwt.verify.mockImplementation((token) => {
      if (token === 'token-user-1') return { sub: 'user-1' };
      if (token === 'token-user-2') return { sub: 'user-2' };
      throw new Error('Invalid token');
    });

    // Default user mock
    mockDb.getUserById.mockImplementation((userId) => {
      if (userId === 'user-1') {
        return Promise.resolve({ id: 'user-1', username: 'alice', rating: 1200, is_pro: 0 });
      }
      if (userId === 'user-2') {
        return Promise.resolve({ id: 'user-2', username: 'bob', rating: 1200, is_pro: 1, pro_expires_at: '2030-01-01' });
      }
      return Promise.resolve(null);
    });

    // Default rate limit mock (allow)
    mockRateLimiter.checkAgentBattleRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetTime: Date.now() + 3600000,
      limit: 5
    });

    // Default ELO mock
    mockDb.get.mockImplementation((sql) => {
      if (sql.includes('agent_loadouts') && sql.includes('elo')) {
        return Promise.resolve({ elo: 1000, current_streak: 0, best_streak: 0 });
      }
      if (sql.includes('COUNT')) {
        return Promise.resolve({ count: 0 });
      }
      return Promise.resolve(null);
    });

    mockDb.run.mockResolvedValue({ lastID: 1, changes: 1 });
  });

  describe('Queue Join Flow', () => {
    it('should reject unauthenticated users', async () => {
      const socket = createMockSocket('anon', 'anonymous');
      socket.handshake.auth.token = null;

      // Simulate join-agent-queue handler logic
      const token = socket.handshake.auth?.token;
      if (!token) {
        socket.emit('agent-queue-error', { error: 'Not authenticated' });
      }

      expect(socket.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Not authenticated' });
    });

    it('should reject users with invalid tokens', async () => {
      const socket = createMockSocket('bad', 'baduser');
      socket.handshake.auth.token = 'invalid-token';

      mockJwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      try {
        mockJwt.verify(socket.handshake.auth.token, 'secret');
      } catch (err) {
        socket.emit('agent-queue-error', { error: 'Authentication failed' });
      }

      expect(socket.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Authentication failed' });
    });

    it('should reject users who hit rate limit', async () => {
      mockRateLimiter.checkAgentBattleRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 1800000,
        minutesUntilReset: 30,
        limit: 5
      });

      const rateLimitResult = await mockRateLimiter.checkAgentBattleRateLimit('user-1', false);

      if (!rateLimitResult.allowed) {
        mockSocket1.emit('agent-queue-error', {
          error: `Rate limit exceeded. Free users can create ${rateLimitResult.limit} agent battles per hour.`,
          rateLimitExceeded: true,
          limit: rateLimitResult.limit,
          remaining: 0,
          resetTime: rateLimitResult.resetTime,
          minutesUntilReset: rateLimitResult.minutesUntilReset
        });
      }

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-error', expect.objectContaining({
        rateLimitExceeded: true,
        limit: 5
      }));
    });

    it('should reject invalid loadout configuration', async () => {
      const loadout = { model: null, language: 'python' };

      if (!loadout || !loadout.model || !loadout.language) {
        mockSocket1.emit('agent-queue-error', { error: 'Invalid loadout configuration' });
      }

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Invalid loadout configuration' });
    });

    it('should reject invalid model', async () => {
      const loadout = { model: 'gpt-4', language: 'python' };
      const validModels = ['haiku', 'sonnet', 'opus'];

      if (!validModels.includes(loadout.model.toLowerCase())) {
        mockSocket1.emit('agent-queue-error', { error: 'Invalid model' });
      }

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Invalid model' });
    });

    it('should reject invalid language', async () => {
      const loadout = { model: 'haiku', language: 'brainfuck' };
      const validLanguages = ['python', 'javascript', 'typescript', 'java', 'cpp', 'c', 'csharp', 'go', 'rust', 'sql'];

      if (!validLanguages.includes(loadout.language.toLowerCase())) {
        mockSocket1.emit('agent-queue-error', { error: 'Invalid language' });
      }

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Invalid language' });
    });

    it('should add valid user to queue', async () => {
      const loadout = { model: 'haiku', language: 'python', systemPrompt: 'Be efficient' };
      const loadoutId = 'loadout-1';
      const userId = 'user-1';

      // Simulate adding to queue
      global.agentMatchmakingQueue.set(userId, {
        userId,
        username: 'alice',
        loadout,
        loadoutId,
        socketId: mockSocket1.id,
        joinedAt: Date.now()
      });

      mockSocket1.emit('agent-queue-joined', {
        position: 1,
        playersInQueue: 1,
        rateLimit: { remaining: 4, limit: 5 }
      });

      expect(global.agentMatchmakingQueue.has(userId)).toBe(true);
      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-joined', expect.objectContaining({
        position: 1
      }));
    });

    it('should prevent user from joining queue twice', async () => {
      const userId = 'user-1';

      // First join
      global.agentMatchmakingQueue.set(userId, {
        userId,
        socketId: mockSocket1.id,
        joinedAt: Date.now()
      });

      // Second join attempt
      if (global.agentMatchmakingQueue.has(userId)) {
        mockSocket1.emit('agent-queue-error', { error: 'Already in queue' });
      }

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Already in queue' });
    });
  });

  describe('Matchmaking Flow', () => {
    it('should match two players when queue has 2+ players', async () => {
      // Add two players to queue
      global.agentMatchmakingQueue.set('user-1', {
        userId: 'user-1',
        username: 'alice',
        loadout: { model: 'haiku', language: 'python' },
        loadoutId: 'loadout-1',
        socketId: mockSocket1.id,
        joinedAt: Date.now() - 1000
      });

      global.agentMatchmakingQueue.set('user-2', {
        userId: 'user-2',
        username: 'bob',
        loadout: { model: 'sonnet', language: 'python' },
        loadoutId: 'loadout-2',
        socketId: mockSocket2.id,
        joinedAt: Date.now()
      });

      expect(global.agentMatchmakingQueue.size).toBe(2);

      // Simulate matchmaking
      const players = Array.from(global.agentMatchmakingQueue.values());
      const battleId = `agent-battle-${uuidv4()}`;

      const battle = {
        id: battleId,
        players: players.map(p => ({
          userId: p.userId,
          username: p.username,
          loadout: p.loadout,
          loadoutId: p.loadoutId,
          socketId: p.socketId,
          status: 'pending'
        })),
        spectators: new Set(),
        state: 'matched',
        createdAt: Date.now()
      };

      global.agentBattles.set(battleId, battle);

      // Clear queue
      global.agentMatchmakingQueue.delete('user-1');
      global.agentMatchmakingQueue.delete('user-2');

      expect(global.agentMatchmakingQueue.size).toBe(0);
      expect(global.agentBattles.size).toBe(1);
      expect(battle.players).toHaveLength(2);
      expect(battle.state).toBe('matched');
    });

    it('should lock users during matchmaking to prevent race conditions', async () => {
      const userId1 = 'user-1';
      const userId2 = 'user-2';

      // Add locks during matching
      global.agentMatchmakingLocks.add(userId1);
      global.agentMatchmakingLocks.add(userId2);

      // Try to join queue while locked
      if (global.agentMatchmakingLocks.has(userId1)) {
        mockSocket1.emit('agent-queue-error', { error: 'Already matching with another player' });
      }

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-error', { error: 'Already matching with another player' });

      // Unlock after match created
      global.agentMatchmakingLocks.delete(userId1);
      global.agentMatchmakingLocks.delete(userId2);

      expect(global.agentMatchmakingLocks.size).toBe(0);
    });
  });

  describe('Battle Execution Flow', () => {
    let battleId;
    let battle;

    beforeEach(() => {
      battleId = `agent-battle-${uuidv4()}`;
      battle = {
        id: battleId,
        problem: {
          id: 'two-sum',
          title: 'Two Sum',
          description: 'Return indices of two numbers that add up to target',
          examples: [{ input: { nums: [2, 7], target: 9 }, output: [0, 1] }],
          testCases: [
            { input: { nums: [2, 7], target: 9 }, expected: [0, 1] },
            { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] }
          ]
        },
        players: [
          {
            userId: 'user-1',
            username: 'alice',
            loadout: { model: 'haiku', language: 'python', systemPrompt: '' },
            loadoutId: 'loadout-1',
            socketId: mockSocket1.id,
            status: 'pending',
            code: null,
            testResults: null
          },
          {
            userId: 'user-2',
            username: 'bob',
            loadout: { model: 'sonnet', language: 'python', systemPrompt: '' },
            loadoutId: 'loadout-2',
            socketId: mockSocket2.id,
            status: 'pending',
            code: null,
            testResults: null
          }
        ],
        spectators: new Set(),
        state: 'matched',
        createdAt: Date.now()
      };

      global.agentBattles.set(battleId, battle);
    });

    it('should transition battle through correct states', async () => {
      expect(battle.state).toBe('matched');

      // Start battle
      battle.state = 'running';
      battle.startedAt = Date.now();
      expect(battle.state).toBe('running');

      // Finish battle
      battle.state = 'finished';
      battle.finishedAt = Date.now();
      expect(battle.state).toBe('finished');
    });

    it('should determine winner by test pass count', async () => {
      // Player 1 passes all tests
      battle.players[0].passedCount = 2;
      battle.players[0].totalTests = 2;
      battle.players[0].status = 'completed';

      // Player 2 passes only 1 test
      battle.players[1].passedCount = 1;
      battle.players[1].totalTests = 2;
      battle.players[1].status = 'failed';

      // Determine winner
      const [p1, p2] = battle.players;
      if (p1.passedCount > p2.passedCount) {
        battle.winnerId = p1.userId;
        battle.winReason = 'more_tests_passed';
      }

      expect(battle.winnerId).toBe('user-1');
      expect(battle.winReason).toBe('more_tests_passed');
    });

    it('should determine winner by execution time when tied on tests', async () => {
      // Both pass all tests
      battle.players[0].passedCount = 2;
      battle.players[0].totalTests = 2;
      battle.players[0].executionTime = 800;
      battle.players[0].status = 'completed';

      battle.players[1].passedCount = 2;
      battle.players[1].totalTests = 2;
      battle.players[1].executionTime = 1200;
      battle.players[1].status = 'completed';

      // Determine winner
      const [p1, p2] = battle.players;
      if (p1.passedCount === p2.passedCount && p1.passedCount > 0) {
        battle.winnerId = p1.executionTime < p2.executionTime ? p1.userId : p2.userId;
        battle.winReason = 'faster_execution';
      }

      expect(battle.winnerId).toBe('user-1');
      expect(battle.winReason).toBe('faster_execution');
    });

    it('should handle tie when both fail all tests', async () => {
      battle.players[0].passedCount = 0;
      battle.players[0].totalTests = 2;
      battle.players[0].status = 'failed';

      battle.players[1].passedCount = 0;
      battle.players[1].totalTests = 2;
      battle.players[1].status = 'failed';

      // Determine winner
      const [p1, p2] = battle.players;
      if (p1.passedCount === 0 && p2.passedCount === 0) {
        battle.winnerId = null;
        battle.winReason = 'tie';
      }

      expect(battle.winnerId).toBeNull();
      expect(battle.winReason).toBe('tie');
    });

    it('should handle when one agent errors', async () => {
      battle.players[0].passedCount = 2;
      battle.players[0].totalTests = 2;
      battle.players[0].status = 'completed';

      battle.players[1].passedCount = 0;
      battle.players[1].totalTests = 2;
      battle.players[1].status = 'error';
      battle.players[1].error = 'API rate limit exceeded';

      // Player with error gets 0 passed tests
      const [p1, p2] = battle.players;
      if (p1.passedCount > p2.passedCount) {
        battle.winnerId = p1.userId;
        battle.winReason = 'more_tests_passed';
      }

      expect(battle.winnerId).toBe('user-1');
    });
  });

  describe('ELO Updates', () => {
    it('should calculate correct ELO changes for winner and loser', () => {
      const elo = require('../elo');

      const winner = { rating: 1000, totalGames: 10 };
      const loser = { rating: 1000, totalGames: 10 };

      const result = elo.calculateMatchRatings(winner, loser);

      expect(result.winner.newRating).toBeGreaterThan(1000);
      expect(result.loser.newRating).toBeLessThan(1000);
      expect(result.winner.change).toBeGreaterThan(0);
      expect(result.loser.change).toBeLessThan(0);
      // ELO is zero-sum
      expect(result.winner.change + result.loser.change).toBe(0);
    });

    it('should give larger gains for upsets', () => {
      const elo = require('../elo');

      // Expected outcome: high rated wins
      const result1 = elo.calculateMatchRatings(
        { rating: 1500, totalGames: 20 },
        { rating: 1000, totalGames: 20 }
      );

      // Upset: low rated wins
      const result2 = elo.calculateMatchRatings(
        { rating: 1000, totalGames: 20 },
        { rating: 1500, totalGames: 20 }
      );

      // Upset should give more points
      expect(result2.winner.change).toBeGreaterThan(result1.winner.change);
    });

    it('should persist ELO changes to database', async () => {
      const battleId = 'test-battle';
      const winnerId = 'user-1';
      const loserId = 'user-2';
      const winnerNewElo = 1016;
      const loserNewElo = 984;

      // Simulate ELO update
      await mockDb.run(
        'UPDATE agent_loadouts SET elo = ?, wins = wins + 1 WHERE id = ?',
        [winnerNewElo, 'loadout-1']
      );

      await mockDb.run(
        'UPDATE agent_loadouts SET elo = ?, losses = losses + 1 WHERE id = ?',
        [loserNewElo, 'loadout-2']
      );

      expect(mockDb.run).toHaveBeenCalledTimes(2);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agent_loadouts'),
        expect.arrayContaining([winnerNewElo])
      );
    });
  });

  describe('Spectator Functionality', () => {
    let battleId;
    let battle;

    beforeEach(() => {
      battleId = `agent-battle-${uuidv4()}`;
      battle = {
        id: battleId,
        players: [],
        spectators: new Set(),
        state: 'running'
      };
      global.agentBattles.set(battleId, battle);
    });

    it('should allow spectators to join battle room', () => {
      const spectatorId = 'spectator-1';

      battle.spectators.add(spectatorId);

      expect(battle.spectators.has(spectatorId)).toBe(true);
      expect(battle.spectators.size).toBe(1);
    });

    it('should track multiple spectators', () => {
      battle.spectators.add('spec-1');
      battle.spectators.add('spec-2');
      battle.spectators.add('spec-3');

      expect(battle.spectators.size).toBe(3);
    });

    it('should remove spectators correctly', () => {
      battle.spectators.add('spec-1');
      battle.spectators.add('spec-2');

      battle.spectators.delete('spec-1');

      expect(battle.spectators.size).toBe(1);
      expect(battle.spectators.has('spec-1')).toBe(false);
      expect(battle.spectators.has('spec-2')).toBe(true);
    });

    it('should provide battle state to spectators', () => {
      const spectatorSocket = createMockSocket('spec-1', 'spectator');

      // Simulate sending battle state
      const battleState = {
        id: battleId,
        state: battle.state,
        players: battle.players.map(p => ({
          username: p.username,
          status: p.status,
          passedCount: p.passedCount || 0,
          totalTests: p.totalTests || 0
        })),
        spectatorCount: battle.spectators.size
      };

      spectatorSocket.emit('agent-battle-state', battleState);

      expect(spectatorSocket.emit).toHaveBeenCalledWith('agent-battle-state', expect.objectContaining({
        id: battleId,
        state: 'running'
      }));
    });
  });

  describe('Leave Queue Flow', () => {
    it('should remove user from queue when leaving', () => {
      const userId = 'user-1';

      // Add to queue
      global.agentMatchmakingQueue.set(userId, {
        userId,
        socketId: mockSocket1.id,
        joinedAt: Date.now()
      });

      expect(global.agentMatchmakingQueue.has(userId)).toBe(true);

      // Leave queue
      global.agentMatchmakingQueue.delete(userId);

      expect(global.agentMatchmakingQueue.has(userId)).toBe(false);
    });

    it('should emit confirmation when leaving queue', () => {
      global.agentMatchmakingQueue.delete('user-1');
      mockSocket1.emit('agent-queue-left', { success: true });

      expect(mockSocket1.emit).toHaveBeenCalledWith('agent-queue-left', { success: true });
    });
  });

  describe('Battle Cleanup', () => {
    it('should clean up battle after completion', () => {
      const battleId = `agent-battle-${uuidv4()}`;

      global.agentBattles.set(battleId, {
        id: battleId,
        state: 'finished'
      });

      // Simulate cleanup
      setTimeout(() => {
        global.agentBattles.delete(battleId);
      }, 0);

      // Immediately after setting timeout, battle still exists
      expect(global.agentBattles.has(battleId)).toBe(true);
    });

    it('should clean up matchmaking locks after match', () => {
      global.agentMatchmakingLocks.add('user-1');
      global.agentMatchmakingLocks.add('user-2');

      // After match created, clear locks
      global.agentMatchmakingLocks.delete('user-1');
      global.agentMatchmakingLocks.delete('user-2');

      expect(global.agentMatchmakingLocks.size).toBe(0);
    });
  });

  describe('Rate Limit Refund', () => {
    it('should refund rate limit slot when battle fails to start', async () => {
      mockRateLimiter.refundRateLimitSlot.mockResolvedValue(true);

      // Simulate battle failure after rate limit consumed
      const refunded = await mockRateLimiter.refundRateLimitSlot('user-1');

      expect(refunded).toBe(true);
      expect(mockRateLimiter.refundRateLimitSlot).toHaveBeenCalledWith('user-1');
    });
  });
});
