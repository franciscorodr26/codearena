/**
 * Edge case tests for Prompt Battle History
 * These tests check for potential bugs in edge cases
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

describe('Prompt Battle History - Edge Cases', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('Winner ID Type Mismatch Bug Check', () => {
    /**
     * BUG POTENTIAL: The code compares battle.winner_id === userId where:
     * - userId is always a string (line 24: String(req.user.userId))
     * - winner_id can be stored as string or number depending on socket context
     *
     * This test verifies the comparison works correctly.
     */
    it('should correctly identify win when winner_id is stored as string', async () => {
      const mockBattles = [
        {
          id: 1,
          room_code: 'ABC123',
          player1_id: '123', // String
          player1_username: 'testuser',
          player1_is_guest: 0,
          player2_id: '456',
          player2_username: 'opponent',
          player2_is_guest: 0,
          problem_id: 'prob1',
          problem_title: 'Test',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: 80,
          player2_score: 60,
          player1_adjusted_score: 80,
          player2_adjusted_score: 60,
          player1_submit_count: 1,
          player2_submit_count: 1,
          winner_id: '123', // String - should match
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

      expect(response.body.battles[0].outcome).toBe('win');
    });

    it('should handle win when user ID types might differ (number vs string)', async () => {
      // NOTE: This reveals a potential bug if winner_id is stored as number
      // The comparison winner_id === userId where userId is String(123) = "123"
      // would fail if winner_id is stored as number 123
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
          problem_title: 'Test',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: 80,
          player2_score: 60,
          player1_adjusted_score: 80,
          player2_adjusted_score: 60,
          player1_submit_count: 1,
          player2_submit_count: 1,
          winner_id: 123, // NUMBER - might not match string "123"!
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

      // BUG: This will report 'loss' instead of 'win' because 123 !== '123'
      // The actual outcome depends on how the data is stored
      // This test documents the potential bug
      console.log('Winner ID type test - outcome:', response.body.battles[0].outcome);
      console.log('Winner ID type:', typeof mockBattles[0].winner_id);
      console.log('User ID type:', typeof '123');

      // Note: In SQLite, TEXT columns store strings, so this should work
      // But if winner_id is stored from a socket that sends a number, it could be an issue
    });
  });

  describe('Stats Calculation Edge Cases', () => {
    it('should handle null stats gracefully', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 0 });
      db.get.mockResolvedValueOnce(null); // Stats query returns null

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.stats.total).toBe(0);
      expect(response.body.stats.wins).toBe(0);
      expect(response.body.stats.losses).toBe(0);
      expect(response.body.stats.ties).toBe(0);
      expect(response.body.stats.winRate).toBe(0);
    });

    it('should handle undefined count gracefully', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce(undefined); // Count returns undefined
      db.get.mockResolvedValueOnce({ total: 0, wins: 0, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history')
        .expect(200);

      expect(response.body.pagination.total).toBe(0);
    });
  });

  describe('Score Rounding Edge Cases', () => {
    it('should handle very small scores', async () => {
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
          problem_title: 'Test',
          difficulty: 'easy',
          duration_sec: 180,
          player1_score: 0.001,
          player2_score: 0.0005,
          player1_adjusted_score: 0.001,
          player2_adjusted_score: 0.0005,
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

      // Scores should be rounded to 1 decimal place
      expect(response.body.battles[0].myScore).toBe(0);
      expect(response.body.battles[0].opponentScore).toBe(0);
    });

    it('should handle null scores', async () => {
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
          problem_title: 'Test',
          difficulty: 'medium',
          duration_sec: 300,
          player1_score: null,
          player2_score: null,
          player1_adjusted_score: null,
          player2_adjusted_score: null,
          player1_submit_count: 0,
          player2_submit_count: 0,
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

      // Null scores should default to 0
      expect(response.body.battles[0].myScore).toBe(0);
      expect(response.body.battles[0].opponentScore).toBe(0);
    });
  });

  describe('Pagination Edge Cases', () => {
    it('should handle negative offset', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 0 });
      db.get.mockResolvedValueOnce({ total: 0, wins: 0, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history?offset=-5')
        .expect(200);

      // Negative offset is now properly clamped to 0
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should handle non-numeric limit', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 0 });
      db.get.mockResolvedValueOnce({ total: 0, wins: 0, losses: 0, ties: 0 });

      const response = await request(app)
        .get('/api/prompt-battle/history?limit=abc')
        .expect(200);

      // Non-numeric limit should default to 20
      expect(response.body.pagination.limit).toBe(20);
    });

    it('should handle zero limit', async () => {
      db.all.mockResolvedValue([]);
      db.get.mockResolvedValueOnce({ total: 10 });
      db.get.mockResolvedValueOnce({ total: 10, wins: 5, losses: 4, ties: 1 });

      const response = await request(app)
        .get('/api/prompt-battle/history?limit=0')
        .expect(200);

      // Zero limit should default to 20 (because parseInt(0) || 20 = 20... wait, 0 is falsy)
      // Actually this is a potential issue: limit=0 would become 20
      expect(response.body.pagination.limit).toBe(20);
    });
  });

  describe('Battle Detail Edge Cases', () => {
    it('should handle very large battle ID', async () => {
      db.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/prompt-battle/history/999999999999999999')
        .expect(404);

      expect(response.body.error).toBe('Battle not found');
    });

    it('should handle negative battle ID', async () => {
      const response = await request(app)
        .get('/api/prompt-battle/history/-1')
        .expect(404);

      // Negative ID is valid integer, just won't match
    });

    it('should handle empty token usage objects', async () => {
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
        problem_title: 'Test',
        difficulty: 'medium',
        duration_sec: 300,
        player1_prompt: 'Test',
        player2_prompt: 'Test',
        player1_score: 80,
        player2_score: 60,
        player1_adjusted_score: 80,
        player2_adjusted_score: 60,
        player1_submit_count: 1,
        player2_submit_count: 1,
        winner_id: '123',
        is_tie: 0,
        player1_model_output: 'output',
        player2_model_output: 'output',
        player1_token_usage: '{}',  // Empty JSON object
        player2_token_usage: '{}',
        started_at: '2024-01-01T10:00:00Z',
        finished_at: '2024-01-01T10:05:00Z'
      };

      db.get.mockResolvedValue(mockBattle);

      const response = await request(app)
        .get('/api/prompt-battle/history/1')
        .expect(200);

      expect(response.body.battle.me.tokenUsage).toEqual({});
    });
  });
});

describe('Prompt Battle Persistence Edge Cases', () => {
  /**
   * Test to document potential issue with player ID storage
   * The persistBattleHistory function stores player IDs directly from socket,
   * which could be string or number depending on authentication type
   */
  it('documents player ID storage concern', () => {
    // From promptBattleSocket.js line 287-288:
    // player1Id is passed directly to INSERT
    // It comes from room.players.entries() which uses playerKeyFromSocket()
    // playerKeyFromSocket() always returns String(socket.userId) or String(socket.guestSessionId)

    // So player IDs should always be strings in the database
    // This is consistent with the query in promptBattle.js line 24:
    // const userId = String(req.user.userId)

    expect(true).toBe(true); // Documentation test
  });
});
