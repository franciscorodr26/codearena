/**
 * Integration tests for Agent Training Mode
 * Uses mocked dependencies to avoid ESM issues
 */

const request = require('supertest');
const express = require('express');
const db = require('../db');

// Mock agentRunner
jest.mock('../services/agentRunner', () => ({
  runAgent: jest.fn().mockResolvedValue({
    success: true,
    code: 'def solve(): return [0,1]',
    testResults: [{ passed: true }],
    passedCount: 1,
    totalTests: 1,
    executionTimeMs: 100,
    tokensUsed: 200
  })
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock auth - variable must be prefixed with 'mock' for jest.mock()
let mockTestUserId = 1;
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { sub: mockTestUserId };
    next();
  }
}));

const agentTrainingRouter = require('../routes/agentTraining');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/training', agentTrainingRouter);
  return app;
}

describe('Agent Training Integration Tests', () => {
  let app;
  let userId;
  let loadoutId;

  beforeAll(async () => {
    app = createTestApp();

    // Create test user in real DB
    const userResult = await db.run(
      `INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?, datetime('now'))`,
      ['training-int-test-' + Date.now(), 'training-int@test.com', 'hash']
    );
    userId = userResult.lastID;
    mockTestUserId = userId;

    // Create test loadout
    loadoutId = 'int-loadout-' + Date.now();
    await db.run(
      `INSERT INTO agent_loadouts (id, user_id, name, model, system_prompt, language, tools, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [loadoutId, userId, 'Int Test Loadout', 'sonnet', 'Test', 'python', '[]']
    );
  });

  afterAll(async () => {
    await db.run('DELETE FROM users WHERE id = ?', [userId]);
    await db.run('DELETE FROM agent_loadouts WHERE id = ?', [loadoutId]);
    await db.run('DELETE FROM agent_training_runs WHERE user_id = ?', [userId]);
  });

  describe('Complete Training Flow', () => {
    it('should list problems', async () => {
      const res = await request(app)
        .get('/api/agent/training/problems')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.problems).toBeDefined();
    });

    it('should run training with loadout ID', async () => {
      const res = await request(app)
        .post('/api/agent/training/run')
        .set('Authorization', 'Bearer test')
        .send({ problemId: 'win-streak', loadoutId });

      expect(res.status).toBe(200);
      expect(res.body.trainingRunId).toBeDefined();
    });

    it('should get training history', async () => {
      const res = await request(app)
        .get('/api/agent/training/history')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.runs).toBeDefined();
    });

    it('should get training stats', async () => {
      const res = await request(app)
        .get('/api/agent/training/stats')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.overall).toBeDefined();
    });
  });
});
