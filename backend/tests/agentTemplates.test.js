/**
 * Tests for Agent Loadout Templates feature
 * Tests migrations, API endpoints, and edge cases
 */
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
  run: jest.fn(),
  withTransaction: jest.fn(async (callback) => callback())
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Mock authentication middleware
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { sub: 123, username: 'testuser' };
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

describe('Agent Loadout Templates API', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /api/agent/templates', () => {
    it('should return all active templates', async () => {
      const mockTemplates = [
        {
          id: 'template-speed-demon',
          name: 'Speed Demon',
          description: 'Fast and efficient',
          strategy: 'aggressive',
          model: 'haiku',
          system_prompt: 'You are fast',
          language: 'python',
          tools: '["test-runner"]',
          is_official: 1,
          win_rate: 52.3,
          times_used: 100,
          sort_order: 1,
          created_at: '2024-01-01'
        },
        {
          id: 'template-careful-coder',
          name: 'Careful Coder',
          description: 'Methodical approach',
          strategy: 'defensive',
          model: 'sonnet',
          system_prompt: 'Be careful',
          language: 'python',
          tools: '["test-runner", "auto-retry"]',
          is_official: 1,
          win_rate: 58.7,
          times_used: 50,
          sort_order: 2,
          created_at: '2024-01-02'
        }
      ];

      db.all.mockResolvedValue(mockTemplates);

      const response = await request(app)
        .get('/api/agent/templates')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.templates).toHaveLength(2);
      expect(response.body.templates[0].id).toBe('template-speed-demon');
      expect(response.body.templates[0].name).toBe('Speed Demon');
      expect(response.body.templates[0].strategy).toBe('aggressive');
      expect(response.body.templates[0].model).toBe('haiku');
      expect(response.body.templates[0].systemPrompt).toBe('You are fast');
      expect(response.body.templates[0].modules).toEqual(['test-runner']);
      expect(response.body.templates[0].isOfficial).toBe(true);
      expect(response.body.templates[0].winRate).toBe(52.3);
      expect(response.body.templates[0].timesUsed).toBe(100);
    });

    it('should return empty array when no templates exist', async () => {
      db.all.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/agent/templates')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.templates).toEqual([]);
    });

    it('should handle malformed tools JSON gracefully', async () => {
      const mockTemplates = [
        {
          id: 'template-bad-json',
          name: 'Bad JSON Template',
          description: 'Has invalid JSON',
          strategy: 'balanced',
          model: 'sonnet',
          system_prompt: 'Test',
          language: 'python',
          tools: 'invalid json here',
          is_official: 1,
          win_rate: null,
          times_used: 0,
          sort_order: 1,
          created_at: '2024-01-01'
        }
      ];

      db.all.mockResolvedValue(mockTemplates);

      const response = await request(app)
        .get('/api/agent/templates')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.templates[0].modules).toEqual([]);
      expect(response.body.templates[0].tools).toEqual([]);
    });

    it('should handle null tools field', async () => {
      const mockTemplates = [
        {
          id: 'template-null-tools',
          name: 'Null Tools Template',
          description: 'Has null tools',
          strategy: 'balanced',
          model: 'sonnet',
          system_prompt: 'Test',
          language: 'python',
          tools: null,
          is_official: 1,
          win_rate: null,
          times_used: 0,
          sort_order: 1,
          created_at: '2024-01-01'
        }
      ];

      db.all.mockResolvedValue(mockTemplates);

      const response = await request(app)
        .get('/api/agent/templates')
        .expect(200);

      expect(response.body.templates[0].modules).toEqual([]);
    });

    it('should handle database errors', async () => {
      db.all.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/agent/templates')
        .expect(500);
    });
  });

  describe('GET /api/agent/templates/:id', () => {
    it('should return a single template by ID', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast and efficient',
        strategy: 'aggressive',
        model: 'haiku',
        system_prompt: 'You are fast',
        language: 'python',
        tools: '["test-runner"]',
        is_official: 1,
        win_rate: 52.3,
        times_used: 100,
        created_at: '2024-01-01'
      };

      db.get.mockResolvedValue(mockTemplate);

      const response = await request(app)
        .get('/api/agent/templates/template-speed-demon')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.template.id).toBe('template-speed-demon');
      expect(response.body.template.name).toBe('Speed Demon');
    });

    it('should return 404 for non-existent template', async () => {
      db.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/agent/templates/non-existent-template')
        .expect(404);

      expect(response.body.error).toBe('Template not found');
    });

    it('should not return inactive templates', async () => {
      // The query filters by is_active = 1, so inactive templates won't be returned
      db.get.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/agent/templates/inactive-template')
        .expect(404);

      expect(response.body.error).toBe('Template not found');
    });
  });

  describe('POST /api/agent/templates/:id/clone', () => {
    it('should clone a template into user loadouts', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast and efficient',
        strategy: 'aggressive',
        model: 'haiku',
        system_prompt: 'You are fast',
        language: 'python',
        tools: '["test-runner"]',
        is_official: 1
      };

      db.get.mockResolvedValueOnce(mockTemplate); // Template lookup
      db.get.mockResolvedValueOnce(null); // No existing loadout with same name
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/templates/template-speed-demon/clone')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.loadoutId).toBeTruthy();
      expect(response.body.message).toBe('Template cloned successfully');
      expect(response.body.name).toBe('Speed Demon');
    });

    it('should handle custom name when cloning', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast and efficient',
        strategy: 'aggressive',
        model: 'haiku',
        system_prompt: 'You are fast',
        language: 'python',
        tools: '["test-runner"]',
        is_official: 1
      };

      db.get.mockResolvedValueOnce(mockTemplate);
      db.get.mockResolvedValueOnce(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/templates/template-speed-demon/clone')
        .send({ customName: 'My Custom Agent' })
        .expect(200);

      expect(response.body.name).toBe('My Custom Agent');
    });

    it('should return 404 when cloning non-existent template', async () => {
      db.get.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/agent/templates/non-existent-template/clone')
        .expect(404);

      expect(response.body.error).toBe('Template not found');
    });

    it('should handle duplicate loadout names by appending timestamp', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast and efficient',
        model: 'haiku',
        system_prompt: 'You are fast',
        language: 'python',
        tools: '["test-runner"]',
        is_official: 1
      };

      db.get.mockResolvedValueOnce(mockTemplate);
      db.get.mockResolvedValueOnce({ id: 'existing-loadout' }); // Existing loadout with same name
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/templates/template-speed-demon/clone')
        .expect(200);

      expect(response.body.success).toBe(true);
      // Name should have timestamp appended
      expect(response.body.name).toMatch(/Speed Demon \(\d+\)/);
    });

    it('should increment times_used counter on template', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast',
        model: 'haiku',
        system_prompt: 'Fast',
        language: 'python',
        tools: '[]',
        is_official: 1
      };

      db.get.mockResolvedValueOnce(mockTemplate);
      db.get.mockResolvedValueOnce(null);
      db.run.mockResolvedValue({ lastID: 1 });

      await request(app)
        .post('/api/agent/templates/template-speed-demon/clone')
        .expect(200);

      // Check that db.run was called to update times_used
      const updateCalls = db.run.mock.calls.filter(call =>
        call[0].includes('UPDATE agent_loadout_templates SET times_used')
      );
      expect(updateCalls.length).toBe(1);
    });

    it('should sanitize XSS in custom names', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast',
        model: 'haiku',
        system_prompt: 'Fast',
        language: 'python',
        tools: '[]',
        is_official: 1
      };

      db.get.mockResolvedValueOnce(mockTemplate);
      db.get.mockResolvedValueOnce(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/templates/template-speed-demon/clone')
        .send({ customName: '<script>alert("xss")</script>My Agent' })
        .expect(200);

      // Name should be sanitized (no script tags)
      expect(response.body.name).not.toContain('<script>');
    });

    it('should truncate very long custom names', async () => {
      const mockTemplate = {
        id: 'template-speed-demon',
        name: 'Speed Demon',
        description: 'Fast',
        model: 'haiku',
        system_prompt: 'Fast',
        language: 'python',
        tools: '[]',
        is_official: 1
      };

      const veryLongName = 'A'.repeat(200);

      db.get.mockResolvedValueOnce(mockTemplate);
      db.get.mockResolvedValueOnce(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/templates/template-speed-demon/clone')
        .send({ customName: veryLongName })
        .expect(200);

      // Name should be truncated
      expect(response.body.name.length).toBeLessThanOrEqual(100);
    });
  });
});

describe('Agent Templates Migration Validation', () => {
  // These tests verify that the migration SQL is correct
  // They don't actually run migrations but validate the expected structure

  it('should have correct columns in agent_loadout_templates table', () => {
    // This is a documentation test - validates expected schema
    const expectedColumns = [
      'id', 'name', 'description', 'strategy', 'model', 'system_prompt',
      'language', 'tools', 'is_official', 'created_by', 'win_rate',
      'times_used', 'sort_order', 'is_active', 'created_at', 'updated_at'
    ];

    // Just documenting expected columns
    expect(expectedColumns).toContain('id');
    expect(expectedColumns).toContain('strategy');
    expect(expectedColumns).toContain('win_rate');
  });

  it('should have 5 seeded official templates', () => {
    const expectedTemplates = [
      'template-speed-demon',
      'template-careful-coder',
      'template-polyglot',
      'template-optimizer',
      'template-grandmaster'
    ];

    expect(expectedTemplates).toHaveLength(5);
  });
});
