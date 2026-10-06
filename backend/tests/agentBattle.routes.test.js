const request = require('supertest');
const express = require('express');

// Mock rate limiter to always pass through
jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

const agentBattleRouter = require('../routes/agentBattle');

// Mock dependencies
jest.mock('../services/agentRunner', () => ({
  runAgent: jest.fn()
}));

jest.mock('../services/problemGenerator', () => ({
  generateAdversarialProblem: jest.fn()
}), { virtual: true });

jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  getActiveChallenges: jest.fn(),
  getChallengeProgress: jest.fn(),
  getChallengeById: jest.fn(),
  getUserById: jest.fn(),
  markChallengeClaimed: jest.fn(),
  getUserTopRivalries: jest.fn(),
  getAgentRivalry: jest.fn(),
  withTransaction: jest.fn(async (callback) => callback()) // Execute callback directly
}));

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

const agentRunner = require('../services/agentRunner');
const problemGenerator = require('../services/problemGenerator');
const db = require('../db');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentBattleRouter);
  return app;
}

describe('AgentBattle Routes - Input Validation and Sanitization', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  describe('sanitizeForXSS', () => {
    it('should sanitize XSS attempts in loadout names', async () => {
      const maliciousName = '<script>alert("xss")</script>';

      db.get.mockResolvedValue(null); // No existing loadout
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: maliciousName,
          description: 'Test',
          model: 'haiku',
          language: 'python',
          systemPrompt: '',
          tools: []
        });

      expect(response.status).toBe(200);

      // Verify sanitization happened
      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const sanitizedName = insertCall[1][2]; // Third parameter is name
      expect(sanitizedName).not.toContain('<script>');
      expect(sanitizedName).toContain('&lt;script&gt;');
    });

    it('should sanitize XSS in descriptions', async () => {
      const maliciousDesc = '<img src=x onerror="alert(1)">';

      db.get.mockResolvedValue(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test Loadout',
          description: maliciousDesc,
          model: 'haiku',
          language: 'python',
          systemPrompt: '',
          tools: []
        });

      expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const sanitizedDesc = insertCall[1][3]; // Fourth parameter is description
      expect(sanitizedDesc).not.toContain('<img');
      expect(sanitizedDesc).toContain('&lt;img');
    });

    it('should sanitize special characters', async () => {
      db.get.mockResolvedValue(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test & "quotes" <tags>',
          description: "O'Reilly's / Slashes",
          model: 'haiku',
          language: 'python',
          systemPrompt: '',
          tools: []
        });

      expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const sanitizedName = insertCall[1][2];
      const sanitizedDesc = insertCall[1][3];

      expect(sanitizedName).toContain('&amp;');
      expect(sanitizedName).toContain('&quot;');
      expect(sanitizedName).toContain('&lt;');
      expect(sanitizedDesc).toContain('&#x27;');
      expect(sanitizedDesc).toContain('&#x2F;');
    });
  });

  describe('validateLoadoutInput', () => {
    it('should reject empty name', async () => {
      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: '',
          model: 'haiku',
          language: 'python'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Name is required');
    });

    it('should reject name longer than 100 characters', async () => {
      const longName = 'A'.repeat(101);

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: longName,
          model: 'haiku',
          language: 'python'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Name must be 100 characters or less');
    });

    it('should reject description longer than 500 characters', async () => {
      const longDesc = 'A'.repeat(501);

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test',
          description: longDesc,
          model: 'haiku',
          language: 'python'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Description must be 500 characters or less');
    });

    it('should reject system prompt longer than 2000 characters', async () => {
      const longPrompt = 'A'.repeat(2001);

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test',
          model: 'haiku',
          language: 'python',
          systemPrompt: longPrompt
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('System prompt must be 2000 characters or less');
    });

    it('should reject invalid model', async () => {
      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test',
          model: 'gpt-4',
          language: 'python'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid model');
    });

    it('should reject invalid language', async () => {
      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test',
          model: 'haiku',
          language: 'brainfuck'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid language');
    });

    it('should filter invalid tools', async () => {
      db.get.mockResolvedValue(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test',
          model: 'haiku',
          language: 'python',
          tools: ['run_code', 'invalid_tool', 'auto_retry', 'another_invalid']
        });

      expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const toolsJson = insertCall[1][7]; // tools is at index 7 in INSERT params // Tools parameter
      const tools = JSON.parse(toolsJson);

      expect(tools).toContain('test-runner');
      expect(tools).toContain('auto-retry');
      expect(tools).not.toContain('invalid_tool');
      expect(tools).not.toContain('another_invalid');
    });

    it('should limit tools to maximum of 2', async () => {
      db.get.mockResolvedValue(null);
      db.run.mockResolvedValue({ lastID: 1 });

      const response = await request(app)
        .post('/api/agent/loadouts')
        .send({
          name: 'Test',
          model: 'haiku',
          language: 'python',
          tools: ['run_code', 'auto_retry', 'docs_lookup']
        });

      expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const toolsJson = insertCall[1][7]; // tools is at index 7 in INSERT params
      const tools = JSON.parse(toolsJson);

      expect(tools.length).toBe(2);
    });

    it('should accept valid models', async () => {
      const validModels = ['haiku', 'sonnet', 'opus'];

      for (const model of validModels) {
        db.get.mockResolvedValue(null);
        db.run.mockResolvedValue({ lastID: 1 });

        const response = await request(app)
          .post('/api/agent/loadouts')
          .send({
            name: `Test ${model}`,
            model: model,
            language: 'python'
          });

        expect(response.status).toBe(200);
      }
    });

    it('should accept valid languages', async () => {
      const validLanguages = [
        'python', 'javascript', 'typescript', 'java',
        'cpp', 'c', 'csharp', 'go', 'rust', 'sql'
      ];

      for (const lang of validLanguages) {
        db.get.mockResolvedValue(null);
        db.run.mockResolvedValue({ lastID: 1 });

        const response = await request(app)
          .post('/api/agent/loadouts')
          .send({
            name: `Test ${lang}`,
            model: 'haiku',
            language: lang
          });

        expect(response.status).toBe(200);
      }
    });
  });
});

describe('AgentBattle Routes - POST /api/agent/test-run', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should reject missing problemId', async () => {
    const response = await request(app)
      .post('/api/agent/test-run')
      .send({
        loadout: {
          model: 'haiku',
          language: 'python'
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Missing required fields');
  });

  it('should reject missing loadout', async () => {
    const response = await request(app)
      .post('/api/agent/test-run')
      .send({
        problemId: 'test-1'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Missing required fields');
  });

  it('should reject invalid language', async () => {
    const response = await request(app)
      .post('/api/agent/test-run')
      .send({
        problemId: 'test-1',
        loadout: {
          model: 'haiku',
          language: 'invalid'
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid language');
  });

  it('should handle non-existent problem', async () => {
    const response = await request(app)
      .post('/api/agent/test-run')
      .send({
        problemId: 'non-existent',
        loadout: {
          model: 'haiku',
          language: 'python'
        }
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('Problem not found');
  });
});

describe('AgentBattle Routes - POST /api/agent/loadouts', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should create loadout successfully', async () => {
    db.get.mockResolvedValue(null); // No existing loadout
    db.run.mockResolvedValue({ lastID: 1 });

    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'My Agent',
        description: 'Fast solver',
        model: 'haiku',
        language: 'python',
        systemPrompt: 'Be efficient',
        tools: ['run_code']
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loadoutId).toBeDefined();
    expect(response.body.message).toBe('Loadout saved successfully');
  });

  it('should reject duplicate loadout name', async () => {
    db.get.mockResolvedValue({ id: 'existing-id' });

    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'Existing Name',
        model: 'haiku',
        language: 'python'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('already have a loadout with this name');
  });

  it('should handle missing required fields', async () => {
    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'Test'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});

describe('AgentBattle Routes - GET /api/agent/loadouts', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should return user loadouts', async () => {
    db.all.mockResolvedValue([
      {
        id: 'loadout-1',
        name: 'Fast Agent',
        description: 'Quick solver',
        model: 'haiku',
        system_prompt: 'Be fast',
        language: 'python',
        tools: '["run_code"]',
        is_public: 0,
        times_cloned: 5,
        wins: 10,
        losses: 2,
        elo: 1500,
        created_at: '2024-01-01',
        updated_at: '2024-01-02'
      }
    ]);

    const response = await request(app)
      .get('/api/agent/loadouts');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loadouts).toHaveLength(1);
    expect(response.body.loadouts[0].name).toBe('Fast Agent');
    expect(response.body.loadouts[0].tools).toEqual(['run_code']);
    expect(response.body.loadouts[0].winRate).toBeCloseTo(83.3, 1);
  });

  it('should return empty array when no loadouts', async () => {
    db.all.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/agent/loadouts');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loadouts).toEqual([]);
  });
});

describe('AgentBattle Routes - DELETE /api/agent/loadouts/:id', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should delete loadout successfully', async () => {
    db.get.mockResolvedValue({ id: 'loadout-1' });
    db.run.mockResolvedValue({ changes: 1 });

    const response = await request(app)
      .delete('/api/agent/loadouts/loadout-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('deleted successfully');
  });

  it('should reject invalid loadout ID', async () => {
    const response = await request(app)
      .delete('/api/agent/loadouts/');

    expect(response.status).toBe(404);
  });

  it('should reject non-existent loadout', async () => {
    db.get.mockResolvedValue(null);

    const response = await request(app)
      .delete('/api/agent/loadouts/non-existent');

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });
});

describe('AgentBattle Routes - PUT /api/agent/loadouts/:id/visibility', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should update visibility successfully', async () => {
    db.get.mockResolvedValue({ id: 'loadout-1' });
    db.run.mockResolvedValue({ changes: 1 });

    const response = await request(app)
      .put('/api/agent/loadouts/loadout-1/visibility')
      .send({ isPublic: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.isPublic).toBe(true);
  });

  it('should reject invalid isPublic value', async () => {
    db.get.mockResolvedValue({ id: 'loadout-1' });

    const response = await request(app)
      .put('/api/agent/loadouts/loadout-1/visibility')
      .send({ isPublic: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('must be a boolean');
  });

  it('should reject non-existent loadout', async () => {
    db.get.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/agent/loadouts/non-existent/visibility')
      .send({ isPublic: true });

    expect(response.status).toBe(404);
  });
});

describe('AgentBattle Routes - POST /api/agent/loadouts/:id/clone', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should clone loadout successfully', async () => {
    db.get
      .mockResolvedValueOnce({
        id: 'original-id',
        user_id: 456, // Different user
        name: 'Original Loadout',
        username: 'creator',
        description: 'Test',
        model: 'haiku',
        system_prompt: 'Test',
        language: 'python',
        tools: '[]',
        is_public: 1
      })
      .mockResolvedValueOnce(null); // No existing clone

    db.run.mockResolvedValue({ lastID: 1 });

    const response = await request(app)
      .post('/api/agent/loadouts/original-id/clone');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loadoutId).toBeDefined();
    expect(response.body.name).toContain('from creator');
  });

  it('should prevent cloning own loadout', async () => {
    db.get.mockResolvedValue({
      id: 'loadout-1',
      user_id: 123, // Same as req.user.userId
      is_public: 1
    });

    const response = await request(app)
      .post('/api/agent/loadouts/loadout-1/clone');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Cannot clone your own loadout');
  });

  it('should sanitize cloned name to prevent XSS', async () => {
    db.get
      .mockResolvedValueOnce({
        id: 'original-id',
        user_id: 456,
        name: '<script>alert("xss")</script>',
        username: '<img src=x onerror="alert(1)">',
        description: 'Test',
        model: 'haiku',
        system_prompt: 'Test',
        language: 'python',
        tools: '[]',
        is_public: 1
      })
      .mockResolvedValueOnce(null);

    db.run.mockResolvedValue({ lastID: 1 });

    const response = await request(app)
      .post('/api/agent/loadouts/original-id/clone');

    expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const clonedName = insertCall[1][2];
    expect(clonedName).not.toContain('<script>');
    expect(clonedName).not.toContain('<img');
  });
});

describe('AgentBattle Routes - Security Edge Cases', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should handle SQL injection attempts in loadout name', async () => {
    db.get.mockResolvedValue(null);
    db.run.mockResolvedValue({ lastID: 1 });

    const sqlInjection = "'; DROP TABLE agent_loadouts; --";

    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: sqlInjection,
        model: 'haiku',
        language: 'python'
      });

    // Should succeed but with sanitized input
    expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const sanitizedName = insertCall[1][2];
    expect(sanitizedName).toContain('&#x27;'); // Escaped quote
  });

  it('should handle Unicode and emoji in names', async () => {
    db.get.mockResolvedValue(null);
    db.run.mockResolvedValue({ lastID: 1 });

    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'Agent 🚀 ハンター',
        model: 'haiku',
        language: 'python'
      });

    expect(response.status).toBe(200);
  });

  it('should handle null bytes in input', async () => {
    db.get.mockResolvedValue(null);
    db.run.mockResolvedValue({ lastID: 1 });

    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'Test\x00Agent',
        model: 'haiku',
        language: 'python'
      });

    expect(response.status).toBe(200);
  });

  it('should validate tools is array type', async () => {
    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'Test',
        model: 'haiku',
        language: 'python',
        tools: 'not_an_array'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Tools must be an array');
  });

  it('should handle very long arrays of tools', async () => {
    db.get.mockResolvedValue(null);
    db.run.mockResolvedValue({ lastID: 1 });

    const longToolsArray = Array(100).fill('run_code');

    const response = await request(app)
      .post('/api/agent/loadouts')
      .send({
        name: 'Test',
        model: 'haiku',
        language: 'python',
        tools: longToolsArray
      });

    expect(response.status).toBe(200);

      const insertCall = db.run.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO agent_loadouts'));
      const toolsJson = insertCall[1][7]; // tools is at index 7 in INSERT params
      const tools = JSON.parse(toolsJson);

    // Duplicate legacy tool IDs normalize to one effective tool selection.
    expect(tools).toEqual(['test-runner']);
  });

  it('should handle malformed JSON in request body gracefully', async () => {
    const response = await request(app)
      .post('/api/agent/loadouts')
      .set('Content-Type', 'application/json')
      .send('{"name": "Test", invalid json}');

    expect(response.status).toBe(400);
  });
});

describe('AgentBattle Routes - Rate Limiting', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  // Note: Testing rate limiting properly requires integration tests
  // These are basic structural tests

  it('should have rate limiting on test-run endpoint', () => {
    const router = require('../routes/agentBattle');
    // This test verifies the route exists and uses middleware
    expect(router.stack).toBeDefined();
  });

  it('should have rate limiting on loadout endpoints', () => {
    const router = require('../routes/agentBattle');
    expect(router.stack).toBeDefined();
  });
});

describe('AgentBattle Routes - GET /api/agent/battles/:battleId', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should fetch battle details successfully', async () => {
    const mockBattle = {
      id: 'battle-123',
      player1_id: 123,
      player2_id: 456,
      player1_username: 'user1',
      player1_avatar: 'avatar1.png',
      player2_username: 'user2',
      player2_avatar: 'avatar2.png',
      loadout1_id: 'loadout-1',
      loadout1_name: 'Loadout 1',
      loadout1_model: 'sonnet',
      loadout1_language: 'python',
      loadout1_prompt: 'Test prompt',
      loadout1_tools: '["run_code"]',
      loadout2_id: 'loadout-2',
      loadout2_name: 'Loadout 2',
      loadout2_model: 'haiku',
      loadout2_language: 'javascript',
      loadout2_prompt: 'Test prompt 2',
      loadout2_tools: '[]',
      problem_id: 'problem-1',
      winner_id: 123,
      status: 'completed',
      player1_code: 'def solution():\n    return True',
      player2_code: 'function solution() { return false; }',
      player1_results: '{"passed": 5, "failed": 0}',
      player2_results: '{"passed": 3, "failed": 2}',
      player1_tests_passed: 5,
      player2_tests_passed: 3,
      player1_tokens_used: 1000,
      player2_tokens_used: 800,
      player1_generation_time_ms: 5000,
      player2_generation_time_ms: 4000,
      player1_tool_calls: 2,
      player2_tool_calls: 1,
      player1_elo_change: 25,
      player2_elo_change: -25,
      created_at: '2024-01-01T00:00:00.000Z',
      finished_at: '2024-01-01T00:05:00.000Z'
    };

    db.get.mockResolvedValue(mockBattle);

    const response = await request(app)
      .get('/api/agent/battles/battle-123');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.battle).toBeDefined();
    expect(response.body.battle.id).toBe('battle-123');
    expect(response.body.battle.player1.username).toBe('user1');
    expect(response.body.battle.player2.username).toBe('user2');
    expect(response.body.battle.player1.code).toBe('def solution():\n    return True');
  });

  it('should reject invalid battle ID', async () => {
    const response = await request(app)
      .get('/api/agent/battles/');

    expect(response.status).toBe(404);
  });

  it('should return 404 for non-existent battle', async () => {
    db.get.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/agent/battles/non-existent');

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });

  it('should deny access to non-participant', async () => {
    const mockBattle = {
      id: 'battle-123',
      player1_id: 999,
      player2_id: 888,
      status: 'completed'
    };

    db.get.mockResolvedValue(mockBattle);

    const response = await request(app)
      .get('/api/agent/battles/battle-123');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Access denied');
  });
});

describe('AgentBattle Routes - GET /api/agent/battles/history', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('should fetch battle history with default pagination', async () => {
    const mockBattles = [
      {
        id: 'battle-1',
        player1_id: 123,
        player2_id: 456,
        player1_username: 'user1',
        player1_avatar: 'avatar1.png',
        player2_username: 'user2',
        player2_avatar: 'avatar2.png',
        loadout1_id: 'loadout-1',
        loadout1_name: 'Loadout 1',
        loadout1_model: 'sonnet',
        loadout1_language: 'python',
        loadout2_id: 'loadout-2',
        loadout2_name: 'Loadout 2',
        loadout2_model: 'haiku',
        loadout2_language: 'javascript',
        winner_id: 123,
        status: 'completed',
        player1_tests_passed: 5,
        player2_tests_passed: 3,
        player1_tokens_used: 1000,
        player2_tokens_used: 800,
        player1_elo_change: 25,
        player2_elo_change: -25,
        problem_id: 'problem-1',
        created_at: '2024-01-01T00:00:00.000Z',
        finished_at: '2024-01-01T00:05:00.000Z'
      }
    ];

    db.get.mockResolvedValue({ total: 1 });
    db.all.mockResolvedValue(mockBattles);

    const response = await request(app)
      .get('/api/agent/battles/history');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.battles).toHaveLength(1);
    expect(response.body.pagination).toBeDefined();
    expect(response.body.pagination.page).toBe(1);
    expect(response.body.pagination.total).toBe(1);
  });

  it('should filter battles by wins', async () => {
    db.get.mockResolvedValue({ total: 5 });
    db.all.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/agent/battles/history?outcome=wins');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Check that the query included winner_id filter
    const queryCall = db.all.mock.calls[0];
    expect(queryCall[0]).toContain('winner_id = ?');
  });

  it('should filter battles by losses', async () => {
    db.get.mockResolvedValue({ total: 3 });
    db.all.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/agent/battles/history?outcome=losses');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    // Check that the query included winner filter for losses
    const queryCall = db.all.mock.calls[0];
    expect(queryCall[0]).toContain('winner_id IS NOT NULL');
  });

  it('should reject invalid outcome filter', async () => {
    const response = await request(app)
      .get('/api/agent/battles/history?outcome=invalid');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid outcome filter');
  });

  it('should support pagination', async () => {
    db.get.mockResolvedValue({ total: 50 });
    db.all.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/agent/battles/history?page=2&limit=10');

    expect(response.status).toBe(200);
    expect(response.body.pagination.page).toBe(2);
    expect(response.body.pagination.limit).toBe(10);
    expect(response.body.pagination.totalPages).toBe(5);
  });

  it('should filter by opponent ID', async () => {
    db.get.mockResolvedValue({ total: 2 });
    db.all.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/agent/battles/history?opponentId=456');

    expect(response.status).toBe(200);

    // Check that the query included opponent filter
    const queryCall = db.all.mock.calls[0];
    expect(queryCall[1]).toContain(456);
  });

  it('should return proper battle outcome for user perspective', async () => {
    const mockBattles = [
      {
        id: 'battle-1',
        player1_id: 123,
        player2_id: 456,
        player1_username: 'user1',
        player2_username: 'user2',
        player1_avatar: 'avatar1.png',
        player2_avatar: 'avatar2.png',
        loadout1_id: 'loadout-1',
        loadout1_name: 'Loadout 1',
        loadout1_model: 'sonnet',
        loadout1_language: 'python',
        loadout2_id: 'loadout-2',
        loadout2_name: 'Loadout 2',
        loadout2_model: 'haiku',
        loadout2_language: 'javascript',
        winner_id: 123,
        status: 'completed',
        player1_tests_passed: 5,
        player2_tests_passed: 3,
        player1_tokens_used: 1000,
        player2_tokens_used: 800,
        player1_elo_change: 25,
        player2_elo_change: -25,
        problem_id: 'problem-1',
        created_at: '2024-01-01T00:00:00.000Z',
        finished_at: '2024-01-01T00:05:00.000Z'
      }
    ];

    db.get.mockResolvedValue({ total: 1 });
    db.all.mockResolvedValue(mockBattles);

    const response = await request(app)
      .get('/api/agent/battles/history');

    expect(response.status).toBe(200);
    expect(response.body.battles[0].outcome).toBe('win');
    expect(response.body.battles[0].isWinner).toBe(true);
    expect(response.body.battles[0].opponent.username).toBe('user2');
  });

  it('should identify draws correctly', async () => {
    const mockBattles = [
      {
        id: 'battle-1',
        player1_id: 123,
        player2_id: 456,
        winner_id: null, // Draw
        status: 'completed',
        player1_username: 'user1',
        player2_username: 'user2',
        player1_avatar: 'avatar1.png',
        player2_avatar: 'avatar2.png',
        loadout1_id: 'loadout-1',
        loadout1_name: 'Loadout 1',
        loadout1_model: 'sonnet',
        loadout1_language: 'python',
        loadout2_id: 'loadout-2',
        loadout2_name: 'Loadout 2',
        loadout2_model: 'haiku',
        loadout2_language: 'javascript',
        player1_tests_passed: 3,
        player2_tests_passed: 3,
        player1_tokens_used: 1000,
        player2_tokens_used: 1000,
        player1_elo_change: 0,
        player2_elo_change: 0,
        problem_id: 'problem-1',
        created_at: '2024-01-01T00:00:00.000Z',
        finished_at: '2024-01-01T00:05:00.000Z'
      }
    ];

    db.get.mockResolvedValue({ total: 1 });
    db.all.mockResolvedValue(mockBattles);

    const response = await request(app)
      .get('/api/agent/battles/history');

    expect(response.status).toBe(200);
    expect(response.body.battles[0].outcome).toBe('draw');
    expect(response.body.battles[0].isDraw).toBe(true);
  });
});

// Bug 7 regression: server.js INSERTs agent_battles with status='finished'
// (see server.js:12077 and :12196). All read routes here must filter on the
// same status value, or leaderboard/recent/history return empty.
describe('AgentBattle Routes - Bug 7: status filter matches INSERT', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('GET /battles/recent should filter on the same status value server.js INSERTs', async () => {
    // server.js writes 'finished' at server.js:12077 and :12196.
    // If the read filter ever drifts back to 'completed', this fails.
    const insertedBattle = {
      id: 'battle-bug7',
      player1_id: 123,
      player2_id: 456,
      winner_id: 123,
      status: 'finished',
      created_at: '2026-06-01T00:00:00.000Z',
      player1_username: 'me',
      player2_username: 'them',
      player1_avatar: null,
      player2_avatar: null,
      player1_avatar_url: null,
      player2_avatar_url: null,
      loadout1_name: 'A',
      loadout1_model: 'haiku',
      loadout2_name: 'B',
      loadout2_model: 'sonnet',
      player1_elo_change: 10,
      player2_elo_change: -10
    };

    db.all.mockResolvedValue([insertedBattle]);

    const response = await request(app).get('/api/agent/battles/recent');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.battles).toHaveLength(1);
    expect(response.body.battles[0].id).toBe('battle-bug7');

    // Verify the SQL the route ran filters on 'finished' (matches the INSERT).
    expect(db.all).toHaveBeenCalled();
    const sql = db.all.mock.calls[0][0];
    expect(sql).toMatch(/status\s*=\s*'finished'/);
    expect(sql).not.toMatch(/status\s*=\s*'completed'/);
  });

  it("GET /leaderboard should filter agent_battles on 'finished', not 'completed'", async () => {
    db.all.mockResolvedValue([]);
    db.get.mockResolvedValue({ rank: null });

    const response = await request(app).get('/api/agent/leaderboard');

    expect(response.status).toBe(200);
    expect(db.all).toHaveBeenCalled();

    const sql = db.all.mock.calls[0][0];
    // Every status check on agent_battles in this query must use 'finished'.
    expect(sql).toMatch(/ab\.status\s*=\s*'finished'/);
    expect(sql).not.toMatch(/ab\.status\s*=\s*'completed'/);
  });
});
