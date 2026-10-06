/**
 * Tests for the cost-bomb fix in POST /api/agent/training/:runId/execute
 *
 * Bug 3 (cost amplification):
 *   - The execute route looped over every easy + medium + hard problem and
 *     called real Claude per problem (agentRunner.runAgent) with NO spend
 *     gate, and the express-rate-limit was keyed on req.user.userId which
 *     auth never populates (auth sets `sub` and `id`) — falling back to a
 *     per-IP key.
 *
 * Fix verified here:
 *   1. reserveSpending is called per problem and the loop STOPS when it
 *      returns { ok: false } — returning partial results + 402.
 *   2. A hard cap (MAX_PROBLEMS_PER_RUN = 10) prevents a single POST from
 *      kicking off >10 paid Claude calls even when budget is available.
 *   3. Audit log entry emitted per reserved problem.
 */

const request = require('supertest');
const express = require('express');

// ---- Mocks --------------------------------------------------------------

// Bypass express-rate-limit so the route's per-user limiter doesn't 429 us
// between tests in the same suite (the trainingExecuteLimiter shares state
// across requests).
jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

const mockDb = {
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  isUserPro: jest.fn().mockResolvedValue(false)
};
jest.mock('../db', () => mockDb);

const mockAgentRunner = {
  runAgent: jest.fn()
};
jest.mock('../services/agentRunner', () => mockAgentRunner);

const mockReserveSpending = jest.fn();
jest.mock('../services/agentSpendingLimiter', () => ({
  reserveSpending: (...args) => mockReserveSpending(...args)
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};
jest.mock('../utils/logger', () => mockLogger);

// Stub auth so we control req.user identity exactly as the real shim does
// (decoded.sub copied to req.user.id).
let mockUserId = 'user-cost-bomb-1';
jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (!mockUserId) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { sub: mockUserId, id: mockUserId };
    next();
  }
}));

// Avoid importing the real problem-file loader / shared utils side effects.
jest.mock('../routes/agentBattleUtils', () => ({
  loadoutLimiter: (req, res, next) => next(),
  parseStoredModules: () => []
}));

// Stub the filesystem so problem files return a large fixed list; this lets
// us assert the hard cap kicks in.
const fakeProblems = (count, prefix = 'p') =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `Problem ${i}`,
    difficulty: 'easy'
  }));

// Prefix with `mock` so jest.mock's factory allow-list permits the reference.
let mockProblemFixture = [];
// Open edition: problems come from problemsLoader instead of JSON files on disk.
jest.mock('../problemsLoader', () => ({
  getAgentProblems: jest.fn(() => mockProblemFixture)
}));

// Router must be required AFTER all jest.mock() calls above.
const agentTrainingRoutes = require('../routes/agentTrainingRoutes');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/training', agentTrainingRoutes);
  // Surface errors as 500 JSON.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

// ---- Tests --------------------------------------------------------------

describe('POST /api/agent/training/:runId/execute - cost cap + spend gate', () => {
  const runId = 'run-cost-bomb';
  const loadoutId = 'loadout-cost-bomb';
  let app;

  beforeAll(() => {
    app = makeApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'user-cost-bomb-1';
    mockDb.isUserPro.mockResolvedValue(false);

    // The route does:
    //   db.get(... agent_training_runs ...)  -> trainingRun
    //   db.get(... agent_loadouts ...)       -> loadout
    mockDb.get
      .mockResolvedValueOnce({
        id: runId,
        user_id: mockUserId,
        loadout_id: loadoutId,
        status: 'running',
        difficulty_filter: 'easy'
      })
      .mockResolvedValueOnce({
        id: loadoutId,
        user_id: mockUserId,
        model: 'sonnet',
        system_prompt: '',
        language: 'python',
        tools: '[]'
      });

    mockDb.run.mockResolvedValue({ changes: 1, lastID: 1 });

    mockAgentRunner.runAgent.mockResolvedValue({
      success: true,
      code: 'return [0,1]',
      testResults: [{ passed: true }],
      passedCount: 1,
      totalTests: 1,
      tokensUsed: 100,
      executionTimeMs: 50
    });
  });

  it('stops calling runAgent and returns 402 with partial results when reserveSpending fails after 3 calls', async () => {
    mockProblemFixture = fakeProblems(8); // budget would be the limiter, not the cap

    // Allow 3 reservations, then deny.
    let calls = 0;
    mockReserveSpending.mockImplementation(async () => {
      calls += 1;
      if (calls <= 3) {
        return {
          ok: true,
          reservationId: `res-${calls}`,
          cost: 0.03,
          dailySpend: 0.03 * calls,
          dailyLimit: 1.0,
          monthlySpend: 0.03 * calls,
          monthlyLimit: 10.0
        };
      }
      return {
        ok: false,
        reason: 'Daily spending limit reached ($1.00). Resets in 5 hours.',
        cost: 0.03,
        dailySpend: 1.0,
        dailyLimit: 1.0,
        monthlySpend: 1.0,
        monthlyLimit: 10.0
      };
    });

    const res = await request(app)
      .post(`/api/agent/training/${runId}/execute`)
      .set('Authorization', 'Bearer test')
      .send({});

    expect(res.status).toBe(402);
    expect(res.body.partial).toBe(true);
    expect(res.body.error).toMatch(/spending limit/i);

    // Exactly 3 LLM calls happened — the 4th reservation denial broke the loop
    // BEFORE runAgent was called.
    expect(mockAgentRunner.runAgent).toHaveBeenCalledTimes(3);
    expect(mockReserveSpending).toHaveBeenCalledTimes(4);

    // Partial results reflect the 3 problems that did run.
    expect(res.body.results).toHaveLength(3);
    expect(res.body.summary.problemsAttempted).toBe(3);
    expect(res.body.summary.partial).toBe(true);

    // Run was marked partial in the DB update (4th db.run call is the UPDATE
    // of agent_training_runs).
    const updateCall = mockDb.run.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('UPDATE agent_training_runs')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe('partial');
  });

  it('runs all problems (up to the hard cap) when budget always allows', async () => {
    // Way more problems than the cap allows.
    mockProblemFixture = fakeProblems(50);

    mockReserveSpending.mockResolvedValue({
      ok: true,
      reservationId: 'res-ok',
      cost: 0.01,
      dailySpend: 0.5,
      dailyLimit: 10.0,
      monthlySpend: 0.5,
      monthlyLimit: 100.0
    });

    const res = await request(app)
      .post(`/api/agent/training/${runId}/execute`)
      .set('Authorization', 'Bearer test')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Hard cap: never more than 10 paid Claude calls per POST.
    expect(mockAgentRunner.runAgent).toHaveBeenCalledTimes(10);
    expect(mockReserveSpending).toHaveBeenCalledTimes(10);
    expect(res.body.results).toHaveLength(10);
    expect(res.body.summary.wasCapped).toBe(true);
    expect(res.body.summary.totalAvailable).toBe(50);
    expect(res.body.summary.cappedAt).toBe(10);
    expect(res.body.summary.partial).toBe(false);

    // Audit log: an info entry per reserved problem ("Spend reserved...").
    const auditLogs = mockLogger.info.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('Spend reserved')
    );
    expect(auditLogs).toHaveLength(10);
  });

  it('runs all available problems when count is under the cap and budget allows', async () => {
    mockProblemFixture = fakeProblems(4);

    mockReserveSpending.mockResolvedValue({
      ok: true,
      reservationId: 'res-ok',
      cost: 0.01,
      dailySpend: 0.04,
      dailyLimit: 10.0,
      monthlySpend: 0.04,
      monthlyLimit: 100.0
    });

    const res = await request(app)
      .post(`/api/agent/training/${runId}/execute`)
      .set('Authorization', 'Bearer test')
      .send({});

    expect(res.status).toBe(200);
    expect(mockAgentRunner.runAgent).toHaveBeenCalledTimes(4);
    expect(mockReserveSpending).toHaveBeenCalledTimes(4);
    expect(res.body.summary.wasCapped).toBe(false);
    expect(res.body.summary.totalAvailable).toBe(4);
  });

  it('reserveSpending is invoked with (userId, model, isPro=false) for free users', async () => {
    mockProblemFixture = fakeProblems(1);
    mockDb.isUserPro.mockResolvedValue(false);

    mockReserveSpending.mockResolvedValue({
      ok: true,
      reservationId: 'res-ok',
      cost: 0.03,
      dailySpend: 0.03,
      dailyLimit: 1.0,
      monthlySpend: 0.03,
      monthlyLimit: 10.0
    });

    await request(app)
      .post(`/api/agent/training/${runId}/execute`)
      .set('Authorization', 'Bearer test')
      .send({});

    expect(mockReserveSpending).toHaveBeenCalledWith(
      'user-cost-bomb-1',
      'sonnet',
      false
    );
  });

  it('reserveSpending is invoked with isPro=true for pro users', async () => {
    mockProblemFixture = fakeProblems(1);
    mockDb.isUserPro.mockResolvedValue(true);

    mockReserveSpending.mockResolvedValue({
      ok: true,
      reservationId: 'res-ok',
      cost: 0.03,
      dailySpend: 0.03,
      dailyLimit: 10.0,
      monthlySpend: 0.03,
      monthlyLimit: 100.0
    });

    await request(app)
      .post(`/api/agent/training/${runId}/execute`)
      .set('Authorization', 'Bearer test')
      .send({});

    expect(mockReserveSpending).toHaveBeenCalledWith(
      'user-cost-bomb-1',
      'sonnet',
      true
    );
  });

  it('returns 402 with zero runAgent calls when reservation fails on the very first problem', async () => {
    mockProblemFixture = fakeProblems(5);

    mockReserveSpending.mockResolvedValue({
      ok: false,
      reason: 'Monthly spending limit reached ($10.00). Resets in 12 days.',
      cost: 0.03,
      dailySpend: 1.0,
      dailyLimit: 1.0,
      monthlySpend: 10.0,
      monthlyLimit: 10.0
    });

    const res = await request(app)
      .post(`/api/agent/training/${runId}/execute`)
      .set('Authorization', 'Bearer test')
      .send({});

    expect(res.status).toBe(402);
    expect(mockAgentRunner.runAgent).not.toHaveBeenCalled();
    expect(res.body.results).toHaveLength(0);
    expect(res.body.partial).toBe(true);
  });
});
