const request = require('supertest');
const express = require('express');

// Mock rate limiter to always pass through
jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

// Mock dependencies
jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  init: jest.fn().mockResolvedValue(true),
  withTransaction: jest.fn(async (callback) => callback()) // Execute callback directly
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock authentication middleware
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { userId: 123, sub: 123 };
    next();
  }
}));

const db = require('../db');
const agentBattleRouter = require('../routes/agentBattle');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentBattleRouter);
  return app;
}

/**
 * Agent Loadout Versioning Tests
 * Tests the versioning system for agent loadouts
 */

describe('Agent Loadout Versioning', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/agent/loadouts/:id/versions', () => {
    it('should return all versions for a loadout', async () => {
      // Mock loadout ownership check
      db.get.mockResolvedValueOnce({ id: 1, user_id: 123, name: 'Test Loadout' });

      // Mock versions list
      db.all.mockResolvedValueOnce([
        { id: 2, loadout_id: 1, version_number: 2, model: 'haiku', is_active: 1, wins: 5, losses: 2, created_at: '2024-01-02' },
        { id: 1, loadout_id: 1, version_number: 1, model: 'sonnet', is_active: 0, wins: 10, losses: 5, created_at: '2024-01-01' }
      ]);

      const response = await request(app)
        .get('/api/agent/loadouts/1/versions')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.versions).toHaveLength(2);
      expect(response.body.versions[0].versionNumber).toBe(2);
      expect(response.body.versions[0].isActive).toBe(true);
      expect(response.body.versions[1].versionNumber).toBe(1);
      expect(response.body.versions[1].isActive).toBe(false);
    });

    it('should return 404 for non-existent loadout', async () => {
      db.get.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/agent/loadouts/999/versions')
        .set('Authorization', 'Bearer test-token')
        .expect(404);

      expect(response.body.error).toBeDefined();
    });

    it('should return error for loadout not owned by user', async () => {
      // The route queries with user_id in WHERE clause, so if not owned it returns null
      db.get.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/agent/loadouts/1/versions')
        .set('Authorization', 'Bearer test-token')
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/agent/loadouts/:id/versions/:versionId', () => {
    it('should return specific version details', async () => {
      // Mock loadout ownership
      db.get
        .mockResolvedValueOnce({ id: 1, user_id: 123, name: 'Test Loadout' })
        .mockResolvedValueOnce({
          id: 1,
          loadout_id: 1,
          version_number: 1,
          model: 'sonnet',
          language: 'python',
          system_prompt: 'You are a test agent',
          tools: '["test-runner"]',
          is_active: 0,
          wins: 10,
          losses: 5,
          created_at: '2024-01-01'
        });

      const response = await request(app)
        .get('/api/agent/loadouts/1/versions/1')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.version.versionNumber).toBe(1);
      expect(response.body.version.model).toBe('sonnet');
    });

    it('should return 404 for non-existent version', async () => {
      db.get
        .mockResolvedValueOnce({ id: 1, user_id: 123, name: 'Test Loadout' })
        .mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/agent/loadouts/1/versions/999')
        .set('Authorization', 'Bearer test-token')
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /api/agent/loadouts/:id/versions/:versionId/activate', () => {
    it('should activate a previous version', async () => {
      // Mock loadout ownership
      db.get
        .mockResolvedValueOnce({ id: 1, user_id: 123, name: 'Test Loadout' })
        .mockResolvedValueOnce({
          id: 1,
          loadout_id: 1,
          version_number: 1,
          model: 'sonnet',
          language: 'python',
          system_prompt: 'You are a test agent',
          tools: '["test-runner"]',
          is_active: 0
        });

      // Mock db.run for updates
      db.run.mockResolvedValue({ changes: 1 });

      const response = await request(app)
        .post('/api/agent/loadouts/1/versions/1/activate')
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(db.run).toHaveBeenCalled();
    });

    it('should return 404 for non-existent version', async () => {
      db.get
        .mockResolvedValueOnce({ id: 1, user_id: 123, name: 'Test Loadout' })
        .mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/agent/loadouts/1/versions/999/activate')
        .set('Authorization', 'Bearer test-token')
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });

  // Note: Compare endpoint tests skipped due to complex mock requirements
  // The endpoint is tested via integration tests
});

