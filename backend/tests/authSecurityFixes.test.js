/**
 * Security fix coverage for:
 *   - Bug 9:  req.user.id normalization (sub <-> id compatibility shim)
 *   - Bug M4: IDOR on coaching insight dismiss + coding session update/end
 *   - Bug L1: token-version fail-closed in authMiddleware
 *
 * These tests exercise the route layer directly (no real DB), with db calls
 * mocked so we can verify ownership enforcement and middleware behavior
 * without spinning up the full app.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const mockSessionUsersByHash = new Map();

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const { SECRET } = require('../config/jwt');

// --- Mocks ---------------------------------------------------------------

// otplib pulls in @scure/base which is an ESM module Jest can't parse without
// a transform. We don't exercise 2FA in this suite, so stub it out.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TEST-SECRET'),
  generateURI: jest.fn(() => 'otpauth://test'),
  verifySync: jest.fn(() => ({ delta: 0 }))
}));

jest.mock('express-rate-limit', () => {
  // Pass-through so we don't get 429s during tests.
  return () => (req, res, next) => next();
});

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock the db module. We only need a small surface for these routes.
jest.mock('../db', () => ({
  get: jest.fn(),
  run: jest.fn(),
  all: jest.fn(),
  isTokenVersionValid: jest.fn(),
  getSessionByTokenHash: jest.fn(async tokenHash => ({
    id: 44,
    user_id: mockSessionUsersByHash.get(tokenHash)
  })),
  updateSessionLastActive: jest.fn().mockResolvedValue(true),
  isUserBanned: jest.fn().mockResolvedValue(null),
  isUserPro: jest.fn().mockResolvedValue(true),
  dismissInsight: jest.fn().mockResolvedValue(undefined),
  updateCodingSession: jest.fn().mockResolvedValue(undefined),
  endCodingSession: jest.fn().mockResolvedValue(undefined),
  getActiveInsights: jest.fn().mockResolvedValue([]),
  getUserWebhooks: jest.fn(),
  // Anything that auth.js touches at module load that we don't care about:
  getTokenVersion: jest.fn().mockResolvedValue(1),
  getPracticeStats: jest.fn().mockResolvedValue({}),
  getUserStats: jest.fn().mockResolvedValue({}),
  getUserCodingSessions: jest.fn().mockResolvedValue([])
}));


const db = require('../db');
const { authMiddleware } = require('../routes/auth');
const feedbackRouter = require('../routes/feedback');

// --- Helpers -------------------------------------------------------------

function signToken(payload, opts = {}) {
  const token = jwt.sign(payload, SECRET, { expiresIn: '1h', ...opts });
  mockSessionUsersByHash.set(
    crypto.createHash('sha256').update(token).digest('hex'),
    payload.sub
  );
  return token;
}

function makeAppWithAuthOnly() {
  const app = express();
  app.use(express.json());
  app.get('/whoami', authMiddleware, (req, res) => {
    res.json({ user: req.user });
  });
  return app;
}


function makeFeedbackApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/feedback', feedbackRouter);
  return app;
}

// =========================================================================
// Bug L1 — token-version fail-closed
// =========================================================================
describe('Bug L1: token-version fail-closed', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    db.isUserBanned.mockResolvedValue(null);
    app = makeAppWithAuthOnly();
  });

  it('rejects a token that omits tokenVersion (401)', async () => {
    const token = signToken({ sub: 42, email: 'a@b.com' }); // no tokenVersion
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_MISSING_CLAIM');
    // isTokenVersionValid should NOT be consulted when the claim is absent.
    expect(db.isTokenVersionValid).not.toHaveBeenCalled();
  });

  it('accepts a token whose tokenVersion matches the DB (200)', async () => {
    db.isTokenVersionValid.mockResolvedValue(true);
    const token = signToken({ sub: 42, email: 'a@b.com', tokenVersion: 3 });
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(db.isTokenVersionValid).toHaveBeenCalledWith(42, 3);
  });

  it('rejects a token whose tokenVersion does NOT match the DB (401)', async () => {
    db.isTokenVersionValid.mockResolvedValue(false);
    const token = signToken({ sub: 42, email: 'a@b.com', tokenVersion: 1 });
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALIDATED');
  });

  it('rejects a valid signed token after its server-side session is revoked', async () => {
    db.isTokenVersionValid.mockResolvedValue(true);
    db.getSessionByTokenHash.mockResolvedValueOnce(null);
    const token = signToken({ sub: 42, email: 'a@b.com', tokenVersion: 3 });
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Session revoked',
      code: 'SESSION_REVOKED'
    });
    expect(db.isTokenVersionValid).toHaveBeenCalledWith(42, 3);
    expect(db.isUserBanned).not.toHaveBeenCalled();
    expect(db.updateSessionLastActive).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Bug 9 — req.user.id normalization (sub -> id shim)
// =========================================================================
describe('Bug 9: req.user.id shim from decoded.sub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.isUserBanned.mockResolvedValue(null);
    db.isTokenVersionValid.mockResolvedValue(true);
    db.getSessionByTokenHash.mockImplementation(async tokenHash => ({
      id: 44,
      user_id: mockSessionUsersByHash.get(tokenHash)
    }));
  });

  it('authMiddleware exposes req.user.id === decoded.sub', async () => {
    const app = makeAppWithAuthOnly();
    const token = signToken({ sub: 777, email: 'x@y.z', tokenVersion: 1 });
    const res = await request(app)
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(777);
    expect(res.body.user.sub).toBe(777);
  });
});

// =========================================================================
// CodeArena boundary — behavioral session collection is retired
// =========================================================================
describe('CodeArena behavioral session boundary', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    db.isUserBanned.mockResolvedValue(null);
    db.isTokenVersionValid.mockResolvedValue(true);
    db.getSessionByTokenHash.mockImplementation(async tokenHash => ({
      id: 44,
      user_id: mockSessionUsersByHash.get(tokenHash)
    }));
    db.isUserPro.mockResolvedValue(true);
    app = makeFeedbackApp();
  });

  const userAToken = () =>
    signToken({ sub: 1001, email: 'a@a.a', tokenVersion: 1 });
  it.each([
    ['/api/feedback/session/start', { problemId: 'x', sessionType: 'battle', language: 'python' }],
    ['/api/feedback/session/55/update', { keystrokes: 10 }],
    ['/api/feedback/session/77/end', { solved: true, finalCode: 'x' }]
  ])('returns 404 for %s without touching session storage', async (path, body) => {
    const res = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${userAToken()}`)
      .send(body);

    expect(res.status).toBe(404);
    expect(db.updateCodingSession).not.toHaveBeenCalled();
    expect(db.endCodingSession).not.toHaveBeenCalled();
  });
});
