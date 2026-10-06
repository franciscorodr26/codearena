const request = require('supertest');
const express = require('express');

// Mock rate limiter to always pass through
jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

const agentBattleRouter = require('../routes/agentBattle');

// Mock db
jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn()
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock authentication middleware
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { sub: 123 };
    next();
  }
}));

const db = require('../db');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentBattleRouter);
  return app;
}

describe('AgentBattle Routes - Live Battles Discovery', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    app = createTestApp();

    // Reset global.agentBattles
    global.agentBattles = new Map();

    // Reset db.get mock to default (no implementation)
    db.get.mockReset();
  });

  afterEach(() => {
    // Clean up
    delete global.agentBattles;
  });

  describe('GET /api/agent/battles/live', () => {
    it('should return empty array when no battles are running', async () => {
      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('should return only running battles, not matched or finished', async () => {
      // Mock database responses for players
      db.get
        .mockResolvedValueOnce({ id: 1, username: 'player1', avatar: null })
        .mockResolvedValueOnce({ id: 2, username: 'player2', avatar: null })
        .mockResolvedValueOnce({ id: 'loadout1', name: 'Fast Agent', elo: 1200, is_public: 1 })
        .mockResolvedValueOnce({ id: 'loadout2', name: 'Smart Agent', elo: 1250, is_public: 1 })
        .mockResolvedValueOnce({ id: 3, username: 'player3', avatar: null })
        .mockResolvedValueOnce({ id: 4, username: 'player4', avatar: null })
        .mockResolvedValueOnce({ id: 'loadout3', name: 'Test Agent', elo: 1100, is_public: 1 })
        .mockResolvedValueOnce({ id: 'loadout4', name: 'Another Agent', elo: 1150, is_public: 1 });

      // Add battles in different states
      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 1, username: 'player1', loadoutId: 'loadout1', loadout: { model: 'sonnet', language: 'python' }, passedCount: 2, totalTests: 5 },
          { userId: 2, username: 'player2', loadoutId: 'loadout2', loadout: { model: 'haiku', language: 'javascript' }, passedCount: 3, totalTests: 5 }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'easy' },
        spectators: new Set([10, 11]),
        startedAt: Date.now() - 60000,
        createdAt: Date.now() - 60000
      });

      global.agentBattles.set('battle2', {
        state: 'matched',
        players: [
          { userId: 3, username: 'player3', loadoutId: 'loadout3', loadout: { model: 'opus', language: 'python' } },
          { userId: 4, username: 'player4', loadoutId: 'loadout4', loadout: { model: 'sonnet', language: 'java' } }
        ],
        problem: { id: 'reverse-string', title: 'Reverse String', difficulty: 'easy' },
        spectators: new Set(),
        createdAt: Date.now()
      });

      global.agentBattles.set('battle3', {
        state: 'finished',
        players: [],
        problem: {},
        spectators: new Set(),
        createdAt: Date.now() - 120000
      });

      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(1);
      expect(response.body.battles[0].id).toBe('battle1');
      expect(response.body.battles[0].spectatorCount).toBe(2);
      expect(response.body.total).toBe(1);
    });

    it('should only return battles where both loadouts are public', async () => {
      // Mock db.get to return values based on the query
      db.get.mockImplementation((query, params) => {
        // Player queries
        if (query.includes('FROM users')) {
          if (params[0] === 1) return Promise.resolve({ id: 1, username: 'player1', avatar: null });
          if (params[0] === 2) return Promise.resolve({ id: 2, username: 'player2', avatar: null });
          if (params[0] === 3) return Promise.resolve({ id: 3, username: 'player3', avatar: null });
          if (params[0] === 4) return Promise.resolve({ id: 4, username: 'player4', avatar: null });
        }
        // Loadout queries
        if (query.includes('FROM agent_loadouts')) {
          if (params[0] === 'loadout1') return Promise.resolve({ id: 'loadout1', name: 'Public Agent 1', elo: 1200, is_public: 1 });
          if (params[0] === 'loadout2') return Promise.resolve({ id: 'loadout2', name: 'Public Agent 2', elo: 1250, is_public: 1 });
          if (params[0] === 'loadout3') return Promise.resolve({ id: 'loadout3', name: 'Private Agent 1', elo: 1100, is_public: 0 });
          if (params[0] === 'loadout4') return Promise.resolve({ id: 'loadout4', name: 'Public Agent 3', elo: 1150, is_public: 1 });
        }
        return Promise.resolve(null);
      });

      // Public battle
      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 1, loadoutId: 'loadout1', loadout: { model: 'sonnet', language: 'python' } },
          { userId: 2, loadoutId: 'loadout2', loadout: { model: 'haiku', language: 'javascript' } }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'easy' },
        spectators: new Set(),
        startedAt: Date.now(),
        createdAt: Date.now()
      });

      // Private battle (one private loadout)
      global.agentBattles.set('battle2', {
        state: 'running',
        players: [
          { userId: 3, loadoutId: 'loadout3', loadout: { model: 'opus', language: 'python' } },
          { userId: 4, loadoutId: 'loadout4', loadout: { model: 'sonnet', language: 'java' } }
        ],
        problem: { id: 'reverse-string', title: 'Reverse String', difficulty: 'medium' },
        spectators: new Set(),
        startedAt: Date.now(),
        createdAt: Date.now()
      });

      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(1);
      expect(response.body.battles[0].id).toBe('battle1');
      expect(response.body.battles[0].isPublic).toBe(true);
    });

    it('should return battles sorted by spectator count then by recency', async () => {
      // Mock db.get to return values based on the query
      db.get.mockImplementation((query, params) => {
        // Player queries
        if (query.includes('FROM users')) {
          if (params[0] === 1) return Promise.resolve({ id: 1, username: 'player1', avatar: null });
          if (params[0] === 2) return Promise.resolve({ id: 2, username: 'player2', avatar: null });
          if (params[0] === 3) return Promise.resolve({ id: 3, username: 'player3', avatar: null });
          if (params[0] === 4) return Promise.resolve({ id: 4, username: 'player4', avatar: null });
          if (params[0] === 5) return Promise.resolve({ id: 5, username: 'player5', avatar: null });
          if (params[0] === 6) return Promise.resolve({ id: 6, username: 'player6', avatar: null });
        }
        // Loadout queries
        if (query.includes('FROM agent_loadouts')) {
          if (params[0] === 'loadout1') return Promise.resolve({ id: 'loadout1', name: 'Agent 1', elo: 1200, is_public: 1 });
          if (params[0] === 'loadout2') return Promise.resolve({ id: 'loadout2', name: 'Agent 2', elo: 1250, is_public: 1 });
          if (params[0] === 'loadout3') return Promise.resolve({ id: 'loadout3', name: 'Agent 3', elo: 1100, is_public: 1 });
          if (params[0] === 'loadout4') return Promise.resolve({ id: 'loadout4', name: 'Agent 4', elo: 1150, is_public: 1 });
          if (params[0] === 'loadout5') return Promise.resolve({ id: 'loadout5', name: 'Agent 5', elo: 1300, is_public: 1 });
          if (params[0] === 'loadout6') return Promise.resolve({ id: 'loadout6', name: 'Agent 6', elo: 1350, is_public: 1 });
        }
        return Promise.resolve(null);
      });

      // Battle with 5 spectators
      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 1, loadoutId: 'loadout1', loadout: { model: 'sonnet', language: 'python' } },
          { userId: 2, loadoutId: 'loadout2', loadout: { model: 'haiku', language: 'javascript' } }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'easy' },
        spectators: new Set([10, 11, 12, 13, 14]),
        startedAt: Date.now() - 120000,
        createdAt: Date.now() - 120000
      });

      // Battle with 10 spectators (should be first)
      global.agentBattles.set('battle2', {
        state: 'running',
        players: [
          { userId: 3, loadoutId: 'loadout3', loadout: { model: 'opus', language: 'python' } },
          { userId: 4, loadoutId: 'loadout4', loadout: { model: 'sonnet', language: 'java' } }
        ],
        problem: { id: 'reverse-string', title: 'Reverse String', difficulty: 'medium' },
        spectators: new Set([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]),
        startedAt: Date.now() - 60000,
        createdAt: Date.now() - 60000
      });

      // Battle with 0 spectators but most recent
      global.agentBattles.set('battle3', {
        state: 'running',
        players: [
          { userId: 5, loadoutId: 'loadout5', loadout: { model: 'haiku', language: 'rust' } },
          { userId: 6, loadoutId: 'loadout6', loadout: { model: 'sonnet', language: 'go' } }
        ],
        problem: { id: 'palindrome', title: 'Palindrome Check', difficulty: 'easy' },
        spectators: new Set(),
        startedAt: Date.now(),
        createdAt: Date.now()
      });

      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(3);
      expect(response.body.battles[0].id).toBe('battle2'); // 10 spectators
      expect(response.body.battles[1].id).toBe('battle1'); // 5 spectators
      expect(response.body.battles[2].id).toBe('battle3'); // 0 spectators but most recent
    });

    it('should include player details with ELO and loadout names', async () => {
      // Mock db.get to return values based on the query
      db.get.mockImplementation((query, params) => {
        // Player queries
        if (query.includes('FROM users')) {
          if (params[0] === 1) return Promise.resolve({ id: 1, username: 'ProCoder', avatar: 'avatar1.jpg' });
          if (params[0] === 2) return Promise.resolve({ id: 2, username: 'CodeMaster', avatar: 'avatar2.jpg' });
        }
        // Loadout queries
        if (query.includes('FROM agent_loadouts')) {
          if (params[0] === 'loadout1') return Promise.resolve({ id: 'loadout1', name: 'Speed Demon', elo: 1500, is_public: 1 });
          if (params[0] === 'loadout2') return Promise.resolve({ id: 'loadout2', name: 'Careful Calculator', elo: 1450, is_public: 1 });
        }
        return Promise.resolve(null);
      });

      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 1, loadoutId: 'loadout1', loadout: { model: 'sonnet', language: 'python' }, passedCount: 3, totalTests: 5 },
          { userId: 2, loadoutId: 'loadout2', loadout: { model: 'opus', language: 'typescript' }, passedCount: 2, totalTests: 5 }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'medium' },
        spectators: new Set([10]),
        startedAt: Date.now() - 30000,
        createdAt: Date.now() - 30000
      });

      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(1);

      const battle = response.body.battles[0];
      expect(battle.players).toHaveLength(2);

      expect(battle.players[0].username).toBe('ProCoder');
      expect(battle.players[0].avatar).toBe('avatar1.jpg');
      expect(battle.players[0].elo).toBe(1500);
      expect(battle.players[0].loadoutName).toBe('Speed Demon');
      expect(battle.players[0].model).toBe('sonnet');
      expect(battle.players[0].language).toBe('python');
      expect(battle.players[0].passedCount).toBe(3);
      expect(battle.players[0].totalTests).toBe(5);

      expect(battle.players[1].username).toBe('CodeMaster');
      expect(battle.players[1].avatar).toBe('avatar2.jpg');
      expect(battle.players[1].elo).toBe(1450);
      expect(battle.players[1].loadoutName).toBe('Careful Calculator');
    });

    it('should respect limit parameter', async () => {
      // Mock database responses for 3 battles
      for (let i = 0; i < 6; i++) {
        db.get
          .mockResolvedValueOnce({ id: i * 2 + 1, username: `player${i * 2 + 1}`, avatar: null })
          .mockResolvedValueOnce({ id: i * 2 + 2, username: `player${i * 2 + 2}`, avatar: null })
          .mockResolvedValueOnce({ id: `loadout${i * 2 + 1}`, name: `Agent ${i * 2 + 1}`, elo: 1200, is_public: 1 })
          .mockResolvedValueOnce({ id: `loadout${i * 2 + 2}`, name: `Agent ${i * 2 + 2}`, elo: 1250, is_public: 1 });
      }

      // Create 3 running battles
      for (let i = 1; i <= 3; i++) {
        global.agentBattles.set(`battle${i}`, {
          state: 'running',
          players: [
            { userId: i * 2 - 1, loadoutId: `loadout${i * 2 - 1}`, loadout: { model: 'sonnet', language: 'python' } },
            { userId: i * 2, loadoutId: `loadout${i * 2}`, loadout: { model: 'haiku', language: 'javascript' } }
          ],
          problem: { id: `problem${i}`, title: `Problem ${i}`, difficulty: 'easy' },
          spectators: new Set(),
          startedAt: Date.now(),
          createdAt: Date.now()
        });
      }

      const response = await request(app)
        .get('/api/agent/battles/live?limit=2')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(2);
      expect(response.body.total).toBe(3);
    });

    it('should handle database errors gracefully without crashing', async () => {
      // Mock database to always throw error
      db.get.mockRejectedValue(new Error('Database connection failed'));

      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 100, loadoutId: 'loadout100', loadout: { model: 'sonnet', language: 'python' } },
          { userId: 101, loadoutId: 'loadout101', loadout: { model: 'haiku', language: 'javascript' } }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'easy' },
        spectators: new Set(),
        startedAt: Date.now(),
        createdAt: Date.now()
      });

      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      // Should handle error gracefully and return success with empty array
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.battles)).toBe(true);
      // Battles with errors are skipped, so we get empty array
      expect(response.body.battles.length).toBe(0);
    });

    it('should calculate elapsed time correctly', async () => {
      const startTime = Date.now() - 90000; // 90 seconds ago

      db.get
        .mockResolvedValueOnce({ id: 1, username: 'player1', avatar: null })
        .mockResolvedValueOnce({ id: 2, username: 'player2', avatar: null })
        .mockResolvedValueOnce({ id: 'loadout1', name: 'Agent 1', elo: 1200, is_public: 1 })
        .mockResolvedValueOnce({ id: 'loadout2', name: 'Agent 2', elo: 1250, is_public: 1 });

      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 1, loadoutId: 'loadout1', loadout: { model: 'sonnet', language: 'python' } },
          { userId: 2, loadoutId: 'loadout2', loadout: { model: 'haiku', language: 'javascript' } }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'easy' },
        spectators: new Set(),
        startedAt: startTime,
        createdAt: startTime
      });

      const response = await request(app)
        .get('/api/agent/battles/live')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(1);

      const battle = response.body.battles[0];
      expect(battle.elapsedTime).toBeGreaterThanOrEqual(90000);
      expect(battle.elapsedTime).toBeLessThan(95000); // Allow some margin
    });
  });

  describe('GET /api/agent/battles/active', () => {
    it('should return both running and matched battles', async () => {
      global.agentBattles.set('battle1', {
        state: 'running',
        players: [
          { userId: 1, username: 'player1', loadout: { model: 'sonnet', language: 'python' }, passedCount: 2, totalTests: 5 },
          { userId: 2, username: 'player2', loadout: { model: 'haiku', language: 'javascript' }, passedCount: 3, totalTests: 5 }
        ],
        problem: { id: 'two-sum', title: 'Two Sum', difficulty: 'easy' },
        spectators: new Set([10]),
        startedAt: Date.now() - 60000,
        createdAt: Date.now() - 60000
      });

      global.agentBattles.set('battle2', {
        state: 'matched',
        players: [
          { userId: 3, username: 'player3', loadout: { model: 'opus', language: 'python' } },
          { userId: 4, username: 'player4', loadout: { model: 'sonnet', language: 'java' } }
        ],
        problem: { id: 'reverse-string', title: 'Reverse String', difficulty: 'easy' },
        spectators: new Set(),
        createdAt: Date.now()
      });

      const response = await request(app)
        .get('/api/agent/battles/active')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });
  });
});
