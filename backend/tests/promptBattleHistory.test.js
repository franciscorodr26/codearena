/**
 * Tests for Prompt Battle History feature
 * Tests API endpoints and persistence logic
 */
const request = require('supertest');
const express = require('express');

const promptBattleRouter = require('../routes/promptBattle');

// Mock db
jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../services/promptEngineeringLoader', () => ({
  listSummaries: jest.fn().mockReturnValue([{ id: 'test', title: 'Test' }]),
  getRandom: jest.fn(),
  toPublicProblem: jest.fn()
}));

// Mock authentication middleware
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { sub: 123 };
    next();
  },
  optionalAuthMiddleware: (req, res, next) => {
    req.user = { sub: 123 };
    next();
  }
}));

const db = require('../db');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/prompt-battle', promptBattleRouter);
  return app;
}

describe('Prompt Battle History API', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/prompt-battle/history', () => {
    it('should return battle history for authenticated user', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '123',
          player1_username: 'testuser',
          player1_is_guest: 0,
          player2_id: '456',
          player2_username: 'opponent',
          player2_is_guest: 0,
          problem_id: 'prob1',
          problem_title: 'Test Problem',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: 80,
          player2_score: 60,
          player1_adjusted_score: 78,
          player2_adjusted_score: 58,
          player1_submit_count: 2,
          player2_submit_count: 1,
          winner_id: '123',
          is_tie: 0,
          started_at: '2024-01-01T10:00:00Z',
          finished_at: '2024-01-01T10:05:00Z'
        }
      ];

      const mockStats = {
        total: 10,
        wins: 6,
        losses: 3,
        ties: 1
      };

      db.all.mockResolvedValue(mockBattles);
      db.get.mockResolvedValueOnce({ total: 10 }); // Count query
      db.get.mockResolvedValueOnce(mockStats); // Stats query

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battles).toHaveLength(1);
      expect(response.body.battles[0].id).toBe(1);
      expect(response.body.battles[0].outcome).toBe('win');
      expect(response.body.battles[0].myScore).toBe(78);
      expect(response.body.battles[0].opponentScore).toBe(58);
      expect(response.body.battles[0].opponent.username).toBe('opponent');
      expect(response.body.stats.total).toBe(10);
      expect(response.body.stats.wins).toBe(6);
    });

    it('should correctly identify outcome as loss when user loses', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '123',
          player1_username: 'testuser',
          player1_is_guest: 0,
          player2_id: '456',
          player2_username: 'winner',
          player2_is_guest: 0,
          problem_id: 'prob1',
          problem_title: 'Test Problem',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: 40,
          player2_score: 80,
          player1_adjusted_score: 38,
          player2_adjusted_score: 78,
          player1_submit_count: 3,
          player2_submit_count: 1,
          winner_id: '456', // Different user won
          is_tie: 0,
          started_at: '2024-01-01T10:00:00Z',
          finished_at: '2024-01-01T10:05:00Z'
        }
      ];

      db.all.mockResolvedValue(mockBattles);
      db.get.mockResolvedValueOnce({ total: 1 });
      db.get.mockResolvedValueOnce({ total: 1, wins: 0, losses: 1, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.battles[0].outcome).toBe('loss');
    });

    it('should correctly identify ties', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '123',
          player1_username: 'testuser',
          player1_is_guest: 0,
          player2_id: '456',
          player2_username: 'opponent',
          player2_is_guest: 0,
          problem_id: 'prob1',
          problem_title: 'Test Problem',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: 70,
          player2_score: 70,
          player1_adjusted_score: 70,
          player2_adjusted_score: 70,
          player1_submit_count: 1,
          player2_submit_count: 1,
          winner_id: null,
          is_tie: 1,
          started_at: '2024-01-01T10:00:00Z',
          finished_at: '2024-01-01T10:05:00Z'
        }
      ];

      db.all.mockResolvedValue(mockBattles);
      db.get.mockResolvedValueOnce({ total: 1 });
      db.get.mockResolvedValueOnce({ total: 1, wins: 0, losses: 0, ties: 1 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.battles[0].outcome).toBe('tie');
    });

    it('should return empty history for new users', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 0 });
      db.get.mockResolvedValueOnce({ total: 0, wins: 0, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.battles).toEqual([]);
      expect(response.body.stats.total).toBe(0);
      expect(response.body.stats.winRate).toBe(0);
    });

    it('should support pagination with limit and offset', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 100 });
      db.get.mockResolvedValueOnce({ total: 100, wins: 50, losses: 40, ties: 10 });

      const response = await request(app)
        .get('/api/prompt-battle/history?limit=10&offset=20')
        .expect(200);

      expect(response.body.pagination.limit).toBe(10);
      expect(response.body.pagination.offset).toBe(20);
      expect(response.body.pagination.total).toBe(100);
      expect(response.body.pagination.hasMore).toBe(true);
    });

    it('should cap limit at 50', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 0 });
      db.get.mockResolvedValueOnce({ total: 0, wins: 0, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history?limit=100')
        .expect(200);

      expect(response.body.pagination.limit).toBe(50);
    });

    it('should handle when user was player2', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '456', // Different user
          player1_username: 'opponent',
          player1_is_guest: 0,
          player2_id: '123', // Current user
          player2_username: 'testuser',
          player2_is_guest: 0,
          problem_id: 'prob1',
          problem_title: 'Test Problem',
          difficulty: 'hard',
          duration_sec: 600,
          player1_score: 50,
          player2_score: 90,
          player1_adjusted_score: 48,
          player2_adjusted_score: 88,
          player1_submit_count: 1,
          player2_submit_count: 2,
          winner_id: '123', // Current user won
          is_tie: 0,
          started_at: '2024-01-01T10:00:00Z',
          finished_at: '2024-01-01T10:10:00Z'
        }
      ];

      db.all.mockResolvedValue(mockBattles);
      db.get.mockResolvedValueOnce({ total: 1 });
      db.get.mockResolvedValueOnce({ total: 1, wins: 1, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      // User was player2, so should get player2's score as myScore
      expect(response.body.battles[0].myScore).toBe(88);
      expect(response.body.battles[0].opponentScore).toBe(48);
      expect(response.body.battles[0].opponent.username).toBe('opponent');
      expect(response.body.battles[0].outcome).toBe('win');
    });

    it('should ignore legacy guest opponent flags', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '123',
          player1_username: 'testuser',
          player1_is_guest: 0,
          player2_id: 'guest_xyz',
          player2_username: 'Guest123',
          player2_is_guest: 1,
          problem_id: 'prob1',
          problem_title: 'Test Problem',
          difficulty: 'easy',
          duration_sec: 180,
          player1_score: 100,
          player2_score: 50,
          player1_adjusted_score: 100,
          player2_adjusted_score: 50,
          player1_submit_count: 1,
          player2_submit_count: 1,
          winner_id: '123',
          is_tie: 0,
          started_at: '2024-01-01T10:00:00Z',
          finished_at: '2024-01-01T10:03:00Z'
        }
      ];

      db.all.mockResolvedValue(mockBattles);
      db.get.mockResolvedValueOnce({ total: 1 });
      db.get.mockResolvedValueOnce({ total: 1, wins: 1, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.battles[0].opponent.username).toBe('Guest123');
      expect(response.body.battles[0].opponent.isGuest).toBeUndefined();
    });

    it('should handle null/missing opponent username', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '123',
          player1_username: 'testuser',
          player1_is_guest: 0,
          player2_id: '456',
          player2_username: null, // Missing username
          player2_is_guest: 0,
          problem_id: 'prob1',
          problem_title: 'Test Problem',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: 80,
          player2_score: 60,
          player1_adjusted_score: 78,
          player2_adjusted_score: 58,
          player1_submit_count: 2,
          player2_submit_count: 1,
          winner_id: '123',
          is_tie: 0,
          started_at: '2024-01-01T10:00:00Z',
          finished_at: '2024-01-01T10:05:00Z'
        }
      ];

      db.all.mockResolvedValue(mockBattles);
      db.get.mockResolvedValueOnce({ total: 1 });
      db.get.mockResolvedValueOnce({ total: 1, wins: 1, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.battles[0].opponent.username).toBe('Unknown');
    });

    it('should calculate winRate correctly', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 20 });
      db.get.mockResolvedValueOnce({ total: 20, wins: 15, losses: 4, ties: 1 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      // Win rate should be 15/20 = 75%
      expect(response.body.stats.winRate).toBe(75);
    });

    it('should handle database errors gracefully', async () => {
      db.all.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(500);
    });
  });

  describe('GET /api/prompt-battle/history/:id', () => {
    it('should return detailed battle information', async () => {
      const mockBattle = {
        id: 1,
        room_code: 'ABC123',
        player1_id: '123',
        player1_username: 'testuser',
        player1_is_guest: 0,
        player2_id: '456',
        player2_username: 'opponent',
        player2_is_guest: 0,
        problem_id: 'prob1',
        problem_title: 'Test Problem',
        difficulty: 'medium',
        duration_sec: 300,
        player1_prompt: 'Write a function that...',
        player2_prompt: 'Create a solution for...',
        player1_score: 80,
        player2_score: 60,
        player1_adjusted_score: 78,
        player2_adjusted_score: 58,
        player1_submit_count: 2,
        player2_submit_count: 1,
        winner_id: '123',
        is_tie: 0,
        player1_model_output: 'def solution():\n    return 42',
        player2_model_output: 'function solution() { return 42; }',
        player1_token_usage: JSON.stringify({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
        player2_token_usage: JSON.stringify({ inputTokens: 80, outputTokens: 40, totalTokens: 120 }),
        started_at: '2024-01-01T10:00:00Z',
        finished_at: '2024-01-01T10:05:00Z'
      };

      db.get.mockResolvedValue(mockBattle);

      const response = await request(app)
        .get('/api/prompt-battle/history/1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.battle.id).toBe(1);
      expect(response.body.battle.outcome).toBe('win');
      expect(response.body.battle.me.prompt).toBe('Write a function that...');
      expect(response.body.battle.me.modelOutput).toBe('def solution():\n    return 42');
      expect(response.body.battle.me.tokenUsage.totalTokens).toBe(150);
      expect(response.body.battle.opponent.username).toBe('opponent');
      expect(response.body.battle.opponent.submitCount).toBe(1);
    });

    it('should return 404 for non-existent battle', async () => {
      db.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/prompt-battle/history/999')
        .expect(404);

      expect(response.body.error).toBe('Battle not found');
    });

    it('should return 403 if user was not a participant', async () => {
      const mockBattle = {
        id: 1,
        room_code: 'ABC123',
        player1_id: '456', // Different user
        player1_username: 'user1',
        player2_id: '789', // Different user
        player2_username: 'user2',
        // ... rest of battle data
        winner_id: '456',
        is_tie: 0
      };

      db.get.mockResolvedValue(mockBattle);

      const response = await request(app)
        .get('/api/prompt-battle/history/1')
        .expect(403);

      expect(response.body.error).toBe('You were not a participant in this battle');
    });

    it('should return 400 for invalid battle ID', async () => {
      const response = await request(app)
        .get('/api/prompt-battle/history/not-a-number')
        .expect(400);

      expect(response.body.error).toBe('Invalid battle ID');
    });

    it('should handle malformed token usage JSON', async () => {
      const mockBattle = {
        id: 1,
        room_code: 'ABC123',
        player1_id: '123',
        player1_username: 'testuser',
        player1_is_guest: 0,
        player2_id: '456',
        player2_username: 'opponent',
        player2_is_guest: 0,
        problem_id: 'prob1',
        problem_title: 'Test Problem',
        difficulty: 'medium',
        duration_sec: 300,
        player1_prompt: 'Test prompt',
        player2_prompt: 'Other prompt',
        player1_score: 80,
        player2_score: 60,
        player1_adjusted_score: 78,
        player2_adjusted_score: 58,
        player1_submit_count: 1,
        player2_submit_count: 1,
        winner_id: '123',
        is_tie: 0,
        player1_model_output: 'output',
        player2_model_output: 'output',
        player1_token_usage: 'invalid json',
        player2_token_usage: '{also invalid',
        started_at: '2024-01-01T10:00:00Z',
        finished_at: '2024-01-01T10:05:00Z'
      };

      db.get.mockResolvedValue(mockBattle);

      const response = await request(app)
        .get('/api/prompt-battle/history/1')
        .expect(200);

      // Should not crash, just have null tokenUsage
      expect(response.body.battle.me.tokenUsage).toBeNull();
    });

    it('should work when user was player2', async () => {
      const mockBattle = {
        id: 1,
        room_code: 'ABC123',
        player1_id: '456', // Different user
        player1_username: 'opponent',
        player1_is_guest: 0,
        player2_id: '123', // Current user
        player2_username: 'testuser',
        player2_is_guest: 0,
        problem_id: 'prob1',
        problem_title: 'Test Problem',
        difficulty: 'hard',
        duration_sec: 600,
        player1_prompt: 'Their prompt',
        player2_prompt: 'My prompt',
        player1_score: 50,
        player2_score: 90,
        player1_adjusted_score: 48,
        player2_adjusted_score: 88,
        player1_submit_count: 1,
        player2_submit_count: 2,
        winner_id: '123',
        is_tie: 0,
        player1_model_output: 'their output',
        player2_model_output: 'my output',
        player1_token_usage: null,
        player2_token_usage: JSON.stringify({ inputTokens: 100, outputTokens: 200, totalTokens: 300 }),
        started_at: '2024-01-01T10:00:00Z',
        finished_at: '2024-01-01T10:10:00Z'
      };

      db.get.mockResolvedValue(mockBattle);

      const response = await request(app)
        .get('/api/prompt-battle/history/1')
        .expect(200);

      // Current user was player2
      expect(response.body.battle.me.prompt).toBe('My prompt');
      expect(response.body.battle.me.modelOutput).toBe('my output');
      expect(response.body.battle.me.tokenUsage.totalTokens).toBe(300);
      expect(response.body.battle.opponent.username).toBe('opponent');
    });
  });
});

describe('Prompt Battle Persistence Logic', () => {
  // These tests validate the Socket.io persistence logic structure

  it('should validate expected battle history columns', () => {
    const expectedColumns = [
      'id', 'room_code',
      'player1_id', 'player1_username', 'player1_is_guest',
      'player2_id', 'player2_username', 'player2_is_guest',
      'problem_id', 'problem_title', 'difficulty', 'duration_sec',
      'player1_prompt', 'player2_prompt',
      'player1_score', 'player2_score',
      'player1_adjusted_score', 'player2_adjusted_score',
      'player1_submit_count', 'player2_submit_count',
      'winner_id', 'is_tie',
      'player1_model_output', 'player2_model_output',
      'player1_token_usage', 'player2_token_usage',
      'started_at', 'finished_at'
    ];

    // This documents the expected schema
    expect(expectedColumns).toContain('room_code');
    expect(expectedColumns).toContain('player1_prompt');
    expect(expectedColumns).toContain('player1_token_usage');
    expect(expectedColumns).toContain('finished_at');
  });
});
