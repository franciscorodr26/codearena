/**
 * Tests for Agent Training API
 *
 * Uses mocked dependencies to avoid ESM import issues with otplib/@scure/base
 */

const request = require('supertest');
const express = require('express');

// Mock database
const mockDb = {
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn()
};
jest.mock('../db', () => mockDb);

// Mock agentRunner service
const mockAgentRunner = {
  runAgent: jest.fn()
};
jest.mock('../services/agentRunner', () => mockAgentRunner);

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

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
const agentTrainingRouter = require('../routes/agentTraining');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/training', agentTrainingRouter);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// Test data
const MOCK_PROBLEMS = {
  easy: [{
    id: 'win-streak',
    title: 'Two Sum',
    difficulty: 'easy',
    description: 'Find two numbers that add up to target',
    testCases: [
      { input: [[2,7,11,15], 9], expected: [0,1] },
      { input: [[3,2,4], 6], expected: [1,2] }
    ]
  }],
  medium: [],
  hard: [],
  'prompt-engineering': []
};

describe('Agent Training API', () => {
  let app;
  let userId = 123;
  let loadoutId = 'loadout-1';

  beforeAll(() => {
    app = createTestApp();
    mockUserId = userId;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = userId;
  });

  describe('GET /api/agent/training/problems', () => {
    it('should return training problems', async () => {
      const response = await request(app)
        .get('/api/agent/training/problems')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('problems');
      expect(response.body).toHaveProperty('total');
    });

    it('should require authentication', async () => {
      mockUserId = null;
      const response = await request(app)
        .get('/api/agent/training/problems');
      expect(response.status).toBe(401);
    });

    it('should filter by difficulty', async () => {
      const response = await request(app)
        .get('/api/agent/training/problems?difficulty=easy')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('problems');
    });

    it('should reject invalid difficulty filter', async () => {
      const response = await request(app)
        .get('/api/agent/training/problems?difficulty=invalid')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid difficulty');
    });

    it('should handle file loading errors gracefully', async () => {
      const response = await request(app)
        .get('/api/agent/training/problems')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('problems');
    });
  });

  describe('POST /api/agent/training/run', () => {
    const mockResult = {
      success: true,
      code: 'def solution(): return [0,1]',
      testResults: [{ passed: true }],
      passedCount: 1,
      totalTests: 1,
      executionTimeMs: 100,
      tokensUsed: 200
    };

    beforeEach(() => {
      mockAgentRunner.runAgent.mockResolvedValue(mockResult);
      mockDb.run.mockResolvedValue({ changes: 1, lastID: 1 });
      mockDb.get.mockResolvedValue({
        id: loadoutId,
        user_id: userId,
        model: 'sonnet',
        system_prompt: 'Test',
        language: 'python',
        tools: '[]'
      });
    });

    it('should run training with loadout ID', async () => {
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('trainingRunId');
    });

    it('should run training with inline loadout', async () => {
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({
          problemId: 'win-streak',
          loadout: { model: 'haiku', systemPrompt: 'Test', language: 'python', tools: [] }
        });

      expect(response.status).toBe(200);
    });

    it('should require problemId', async () => {
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ loadoutId });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Problem ID is required');
    });

    it('should require either loadoutId or loadout config', async () => {
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('loadoutId or loadout configuration');
    });

    it('should return 404 for missing loadout', async () => {
      mockDb.get.mockResolvedValue(null);
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId: 'missing' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Loadout not found');
    });

    it('should return 404 for non-existent problem', async () => {
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'non-existent', loadoutId });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Problem not found');
    });

    it('should handle JSON tools parsing', async () => {
      mockDb.get.mockResolvedValue({
        id: loadoutId,
        user_id: userId,
        model: 'sonnet',
        system_prompt: 'Test',
        language: 'python',
        tools: '["auto_retry"]'
      });

      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(response.status).toBe(200);
    });

    it('should handle malformed tools JSON', async () => {
      mockDb.get.mockResolvedValue({
        id: loadoutId,
        user_id: userId,
        model: 'sonnet',
        system_prompt: 'Test',
        language: 'python',
        tools: 'invalid-json'
      });

      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(response.status).toBe(200);
    });

    it('should handle agent runner failures', async () => {
      mockAgentRunner.runAgent.mockRejectedValue(new Error('Agent execution failed'));

      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.errorMessage).toBe('Agent execution failed');
    });

    it('should record failed training runs', async () => {
      mockAgentRunner.runAgent.mockRejectedValue(new Error('Timeout'));

      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.passedCount).toBe(0);
    });

    it('should use auto_retry when tool is enabled', async () => {
      mockDb.get.mockResolvedValue({
        id: loadoutId,
        user_id: userId,
        model: 'sonnet',
        system_prompt: 'Test',
        language: 'python',
        tools: '["auto_retry"]'
      });

      await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(mockAgentRunner.runAgent).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ tools: ['auto_retry'] }),
        expect.objectContaining({ maxRetries: 2 })
      );
    });

    it('should not use retries when auto_retry is disabled', async () => {
      await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(mockAgentRunner.runAgent).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ maxRetries: 0 })
      );
    });

    it('should handle inline loadout with tools array', async () => {
      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({
          problemId: 'win-streak',
          loadout: {
            model: 'haiku',
            systemPrompt: 'Test',
            language: 'python',
            tools: ['auto_retry']
          }
        });

      expect(response.status).toBe(200);
    });

    it('should require authentication', async () => {
      mockUserId = null;
      const response = await request(app)
        .post('/api/agent/training/run')
        .send({ problemId: 'win-streak', loadoutId });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/agent/training/history', () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({ total: 1 });
      mockDb.all.mockResolvedValue([{
        id: 'run-1',
        user_id: userId,
        loadout_id: loadoutId,
        status: 'completed',
        total_problems: 1,
        problems_solved: 1,
        total_tests_passed: 10,
        total_tests_failed: 2
      }]);
    });

    it('should return training history', async () => {
      const response = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('runs');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('stats');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/agent/training/history?limit=5&offset=0')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should cap pagination limit at 100', async () => {
      const response = await request(app)
        .get('/api/agent/training/history?limit=999')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(100);
    });

    it('should filter by loadoutId', async () => {
      const response = await request(app)
        .get(`/api/agent/training/history?loadoutId=${loadoutId}`)
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
    });

    it('should filter by difficulty', async () => {
      const response = await request(app)
        .get('/api/agent/training/history?difficulty=easy')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
    });

    it('should ignore invalid difficulty filter', async () => {
      const response = await request(app)
        .get('/api/agent/training/history?difficulty=invalid')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
    });

    it('should calculate success rate correctly', async () => {
      const response = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.stats).toHaveProperty('averageSuccessRate');
    });

    it('should handle empty history', async () => {
      mockDb.get.mockResolvedValue({ total: 0 });
      mockDb.all.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.runs).toHaveLength(0);
      expect(response.body.stats.averageSuccessRate).toBe(0);
    });

    it('should parse test results JSON', async () => {
      mockDb.all
        .mockResolvedValueOnce([{
          id: 'run-1',
          user_id: userId,
          loadout_id: loadoutId,
          status: 'completed'
        }])
        .mockResolvedValueOnce([{
          test_results: '{"passed":true}'
        }]);

      const response = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
    });

    it('should handle null test results', async () => {
      mockDb.all
        .mockResolvedValueOnce([{
          id: 'run-1',
          user_id: userId,
          loadout_id: loadoutId,
          status: 'completed'
        }])
        .mockResolvedValueOnce([{
          test_results: null
        }]);

      const response = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
    });

    it('should calculate pagination hasMore correctly', async () => {
      mockDb.get.mockResolvedValue({ total: 50 });

      const response = await request(app)
        .get('/api/agent/training/history?limit=20&offset=0')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.pagination.hasMore).toBe(true);
    });

    it('should indicate no more pages when at end', async () => {
      mockDb.get.mockResolvedValue({ total: 5 });

      const response = await request(app)
        .get('/api/agent/training/history?limit=20&offset=0')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.pagination.hasMore).toBe(false);
    });

    it('should require authentication', async () => {
      mockUserId = null;
      const response = await request(app)
        .get('/api/agent/training/history');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/agent/training/stats', () => {
    beforeEach(() => {
      mockDb.get.mockResolvedValue({
        total_runs: 10,
        total_problems: 20,
        total_solved: 15,
        total_tests_passed: 100,
        total_tests_failed: 20,
        total_tokens_used: 5000,
        avg_execution_time: 1500.5
      });
      mockDb.all.mockResolvedValue([]);
    });

    it('should return training stats', async () => {
      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('overall');
      expect(response.body).toHaveProperty('byDifficulty');
      expect(response.body).toHaveProperty('byLoadout');
      expect(response.body).toHaveProperty('recentActivity');
    });

    it('should calculate success rate correctly', async () => {
      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.overall.success_rate).toBe(83); // 100/(100+20) * 100
    });

    it('should handle zero tests', async () => {
      mockDb.get.mockResolvedValue({
        total_runs: 10,
        total_problems: 20,
        total_solved: 0,
        total_tests_passed: 0,
        total_tests_failed: 0,
        total_tokens_used: 0,
        avg_execution_time: 0
      });

      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.overall.success_rate).toBe(0);
    });

    it('should round average execution time', async () => {
      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.overall.avg_execution_time).toBe(1501); // rounded
    });

    it('should include difficulty stats with success rates', async () => {
      mockDb.all.mockResolvedValueOnce([
        { difficulty_filter: 'easy', runs: 5, solved: 4, total: 5 },
        { difficulty_filter: 'hard', runs: 3, solved: 1, total: 3 }
      ]);

      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.byDifficulty).toHaveLength(2);
      expect(response.body.byDifficulty[0].success_rate).toBe(80);
      expect(response.body.byDifficulty[1].success_rate).toBe(33);
    });

    it('should include loadout stats', async () => {
      mockDb.all
        .mockResolvedValueOnce([]) // difficulty stats
        .mockResolvedValueOnce([  // loadout stats
          { id: 'l1', name: 'Test', model: 'sonnet', runs: 10, solved: 8, total: 10 }
        ]);

      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.byLoadout).toHaveLength(1);
      expect(response.body.byLoadout[0].success_rate).toBe(80);
    });

    it('should include recent activity', async () => {
      mockDb.all
        .mockResolvedValueOnce([]) // difficulty stats
        .mockResolvedValueOnce([]) // loadout stats
        .mockResolvedValueOnce([  // recent activity
          { date: '2026-03-20', runs: 5, solved: 4 },
          { date: '2026-03-19', runs: 3, solved: 2 }
        ]);

      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.recentActivity).toHaveLength(2);
    });

    it('should handle null values in overall stats', async () => {
      mockDb.get.mockResolvedValue({
        total_runs: 0,
        total_problems: null,
        total_solved: null,
        total_tests_passed: null,
        total_tests_failed: null,
        total_tokens_used: null,
        avg_execution_time: null
      });

      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.overall.success_rate).toBe(0);
      expect(response.body.overall.avg_execution_time).toBe(0);
    });

    it('should require authentication', async () => {
      mockUserId = null;
      const response = await request(app)
        .get('/api/agent/training/stats');

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /api/agent/training/history/:runId', () => {
    it('should delete a training run', async () => {
      mockDb.get.mockResolvedValue({ id: 'run-1' });
      mockDb.run.mockResolvedValue({ changes: 1 });

      const response = await request(app)
        .delete('/api/agent/training/history/run-1')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent run', async () => {
      mockDb.get.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/agent/training/history/missing')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Training run not found');
    });

    it('should verify ownership before deletion', async () => {
      mockDb.get.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/agent/training/history/run-1')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(404);
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.any(String),
        ['run-1', userId]
      );
    });

    it('should require authentication', async () => {
      mockUserId = null;
      const response = await request(app)
        .delete('/api/agent/training/history/run-1');

      expect(response.status).toBe(401);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors in /problems', async () => {
      const response = await request(app)
        .get('/api/agent/training/problems')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(200);
    });

    it('should handle database errors in /history', async () => {
      mockDb.get.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(500);
    });

    it('should handle database errors in /stats', async () => {
      mockDb.get.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(500);
    });

    it('should handle database errors in DELETE', async () => {
      mockDb.get.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .delete('/api/agent/training/history/run-1')
        .set('Authorization', 'Bearer test');

      expect(response.status).toBe(500);
    });

    it('should handle database errors in /run', async () => {
      mockDb.run.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({
          problemId: 'win-streak',
          loadout: { model: 'haiku', systemPrompt: 'Test', language: 'python' }
        });

      expect(response.status).toBe(500);
    });
  });
});
