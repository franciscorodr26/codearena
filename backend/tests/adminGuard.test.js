/**
 * Admin guard tests for the four mass-email / divergence endpoints.
 *
 * Regression coverage for Bug 4: previously the guard short-circuited when
 * NODE_ENV !== 'production', so anyone could hit these in dev/staging. The
 * fix is default-deny: require ADMIN_KEY to be set AND a matching header.
 *
 * Endpoints covered:
 *   POST /api/notifications/send-weekly-challenge
 *   POST /api/notifications/send-tournament
 *   POST /api/notifications/send-changelog
 *   GET  /api/challenge/admin/divergence
 */

const request = require('supertest');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-guard-tests-32chars';

// Avoid hammering the in-process adminLimiter across endpoints/cases.
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

// ----- shared mocks -----------------------------------------------------------

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn().mockResolvedValue([]),
  run: jest.fn(),
  // notifications.js handlers — return safe empties so a successful auth
  // proceeds to a 2xx/4xx that's clearly not 403.
  getOrCreateArenaChallenge: jest.fn().mockResolvedValue({ problem_id: 'p1', challenge_date: '2026-06-01' }),
  getWeeklyChallengeSubscribers: jest.fn().mockResolvedValue([]),
  getTournamentById: jest.fn().mockResolvedValue(null),
  // challenge.js admin/divergence
  getDivergenceLeaderboard: jest.fn().mockResolvedValue([])
}));

jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    req.user = { sub: 1, userId: 1 };
    next();
  }
}));

jest.mock('../services/email', () => ({
  sendWeeklyChallengeNotification: jest.fn().mockResolvedValue({ success: true }),
  sendTournamentNotificationToAll: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  sendChangelogEmail: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../problemsLoader', () => ({
  getAll: jest.fn().mockReturnValue([{ id: 'p1', title: 'Test' }]),
  getById: jest.fn().mockReturnValue({ id: 'p1', title: 'Test', difficulty: 'easy' })
}));

// challenge.js pulls in several services we don't exercise — keep them inert.
jest.mock('../elo', () => ({}));
jest.mock('../services/badgeService', () => ({}));
jest.mock('../services/activityService', () => ({}));
jest.mock('../services/promptEngineeringLoader', () => ({}));
jest.mock('../services/promptBattleRunner', () => ({}));
jest.mock('../services/promptJudgeScore', () => ({ judgeModelOutput: jest.fn() }));

const notificationsRouter = require('../routes/notifications');
const challengeRouter = require('../routes/challenge');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/challenge', challengeRouter);
  return app;
}

const ADMIN_KEY_VALUE = 'super-secret-admin-key-for-tests';

// Definitions for each guarded endpoint. `send` runs the supertest call and
// returns the response so each guard case is structurally identical.
const ENDPOINTS = [
  {
    name: 'POST /api/notifications/send-weekly-challenge',
    send: (app, headers = {}) =>
      request(app).post('/api/notifications/send-weekly-challenge').set(headers).send({})
  },
  {
    name: 'POST /api/notifications/send-tournament',
    send: (app, headers = {}) =>
      request(app).post('/api/notifications/send-tournament').set(headers).send({
        tournamentName: 'Test Cup',
        startDate: '2026-07-01T00:00:00Z'
      })
  },
  {
    name: 'POST /api/notifications/send-changelog',
    send: (app, headers = {}) =>
      request(app).post('/api/notifications/send-changelog').set(headers).send({
        changes: ['something shipped'],
        dryRun: true
      })
  },
  {
    name: 'GET /api/challenge/admin/divergence',
    send: (app, headers = {}) =>
      request(app).get('/api/challenge/admin/divergence').set(headers)
  }
];

describe('admin mass-email / divergence guard (default-deny)', () => {
  let app;
  const ORIGINAL_ADMIN_KEY = process.env.ADMIN_KEY;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    app = makeApp();
  });

  afterEach(() => {
    if (ORIGINAL_ADMIN_KEY === undefined) {
      delete process.env.ADMIN_KEY;
    } else {
      process.env.ADMIN_KEY = ORIGINAL_ADMIN_KEY;
    }
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  ENDPOINTS.forEach(({ name, send }) => {
    describe(name, () => {
      it('returns 403 when ADMIN_KEY env is unset (regardless of supplied key)', async () => {
        delete process.env.ADMIN_KEY;
        // Even in dev — the old bug would have let this through.
        process.env.NODE_ENV = 'development';

        const res = await send(app, { 'x-admin-key': 'anything-you-want' });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns 403 when supplied key is wrong', async () => {
        process.env.ADMIN_KEY = ADMIN_KEY_VALUE;
        process.env.NODE_ENV = 'development';

        const res = await send(app, { 'x-admin-key': 'wrong-key' });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns 403 when no key is supplied at all', async () => {
        process.env.ADMIN_KEY = ADMIN_KEY_VALUE;
        process.env.NODE_ENV = 'development';

        const res = await send(app, {});
        expect(res.status).toBe(403);
      });

      it('proceeds past the guard when the supplied key matches ADMIN_KEY', async () => {
        process.env.ADMIN_KEY = ADMIN_KEY_VALUE;
        process.env.NODE_ENV = 'development';

        const res = await send(app, { 'x-admin-key': ADMIN_KEY_VALUE });
        // We don't care which downstream status comes back — just that the
        // guard let us through (no 403 Unauthorized).
        expect(res.status).not.toBe(403);
      });
    });
  });
});
