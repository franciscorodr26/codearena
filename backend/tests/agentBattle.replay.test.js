/**
 * Agent Battle Replay Tests
 *
 * Uses mocked dependencies to avoid ESM import issues with otplib/@scure/base
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Mock database
const mockDb = {
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  isUserBanned: jest.fn().mockResolvedValue(null),
  isTokenVersionValid: jest.fn().mockResolvedValue(true)
};
jest.mock('../db', () => mockDb);

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock services
jest.mock('../services/agentRunner', () => ({}));
jest.mock('../services/problemGenerator', () => ({}), { virtual: true });
jest.mock('../services/seasonService', () => ({}));
jest.mock('../services/agentChallenges', () => ({}));

// Mock auth middleware
let mockUserId = null;
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (!mockUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { sub: mockUserId };
    next();
  }
}));

// Import router after mocks
const agentBattleRouter = require('../routes/agentBattle');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentBattleRouter);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

describe('Agent Battle Replay System', () => {
  let app;
  let userId1 = 1;
  let userId2 = 2;
  let userId3 = 3;
  let battleId;
  let loadout1Id;
  let loadout2Id;

  beforeAll(() => {
    app = createTestApp();
    battleId = uuidv4();
    loadout1Id = uuidv4();
    loadout2Id = uuidv4();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = userId1;
  });

  describe('GET /api/agent/battles/:id/replay', () => {
    const getMockBattle = (winnerId = userId1) => ({
      id: battleId,
      player1_id: userId1,
      player2_id: userId2,
      loadout1_id: loadout1Id,
      loadout2_id: loadout2Id,
      problem_id: 'two-sum',
      winner_id: winnerId,
      status: 'finished',
      created_at: new Date().toISOString(),
      player1_username: 'player1',
      player2_username: 'player2',
      loadout1_name: 'Loadout 1',
      loadout1_model: 'haiku',
      loadout1_language: 'python',
      loadout2_name: 'Loadout 2',
      loadout2_model: 'sonnet',
      loadout2_language: 'python'
    });

    const getMockEvents = () => [
      {
        event_type: 'battle_start',
        player_id: 0,
        event_data: JSON.stringify({ problem: { id: 'two-sum', title: 'Two Sum' } }),
        timestamp_ms: 0
      },
      {
        event_type: 'code_chunk',
        player_id: userId1,
        event_data: JSON.stringify({ chunk: 'def solve():' }),
        timestamp_ms: 100
      },
      {
        event_type: 'result',
        player_id: userId1,
        event_data: JSON.stringify({ status: 'completed', passedCount: 10, totalTests: 10 }),
        timestamp_ms: 2000
      }
    ];

    test('should return replay data for a participant', async () => {
      mockDb.get.mockResolvedValue(getMockBattle());
      mockDb.all.mockResolvedValue(getMockEvents());

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.battle).toBeDefined();
      expect(res.body.events).toBeDefined();
      expect(res.body.battle.id).toBe(battleId);
      expect(res.body.battle.player1.id).toBe(userId1);
      expect(res.body.events.length).toBe(3);
    });

    test('should allow player2 to view replay', async () => {
      mockUserId = userId2;
      mockDb.get.mockResolvedValue(getMockBattle());
      mockDb.all.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    test('should deny access to non-participants', async () => {
      mockUserId = userId3;
      mockDb.get.mockResolvedValue(getMockBattle());

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(403);

      expect(res.body.error).toContain('Access denied');
    });

    test('should return 404 for non-existent battle', async () => {
      mockDb.get.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/agent/battles/${uuidv4()}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(404);

      expect(res.body.error).toContain('Battle not found');
    });

    test('should return 404 for invalid battle ID format', async () => {
      mockDb.get.mockResolvedValue(null);
      const res = await request(app)
        .get('/api/agent/battles/invalid-id/replay')
        .set('Authorization', 'Bearer test')
        .expect(404);

      expect(res.body.error).toBeDefined();
    });

    test('should require authentication', async () => {
      mockUserId = null;
      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .expect(401);

      expect(res.body.error).toBeDefined();
    });

    test('should parse event_data as JSON', async () => {
      mockDb.get.mockResolvedValue(getMockBattle());
      mockDb.all.mockResolvedValue(getMockEvents());

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      res.body.events.forEach(event => {
        expect(typeof event.event_data).toBe('object');
      });
    });

    test('should include required battle metadata', async () => {
      mockDb.get.mockResolvedValue(getMockBattle());
      mockDb.all.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      const { battle } = res.body;
      expect(battle.player1).toHaveProperty('id');
      expect(battle.player1).toHaveProperty('username');
      expect(battle.player1.loadout).toHaveProperty('model');
      expect(battle.player2).toHaveProperty('id');
      expect(battle).toHaveProperty('winnerId');
      expect(battle).toHaveProperty('status');
    });

    test('should handle draw (no winner)', async () => {
      mockDb.get.mockResolvedValue(getMockBattle(null));
      mockDb.all.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      expect(res.body.battle.winnerId).toBeNull();
    });

    test('should handle empty events', async () => {
      mockDb.get.mockResolvedValue(getMockBattle());
      mockDb.all.mockResolvedValue([]);

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      expect(res.body.events).toEqual([]);
    });

    test('should preserve event chronological order', async () => {
      mockDb.get.mockResolvedValue(getMockBattle());
      mockDb.all.mockResolvedValue(getMockEvents());

      const res = await request(app)
        .get(`/api/agent/battles/${battleId}/replay`)
        .set('Authorization', 'Bearer test')
        .expect(200);

      for (let i = 1; i < res.body.events.length; i++) {
        expect(res.body.events[i].timestamp_ms)
          .toBeGreaterThanOrEqual(res.body.events[i-1].timestamp_ms);
      }
    });
  });
});
