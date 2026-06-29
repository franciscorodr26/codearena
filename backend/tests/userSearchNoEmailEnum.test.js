/**
 * Security regression: /api/users/search must require auth and must NOT
 * search by email so attackers cannot enumerate whether an email address
 * belongs to a registered account.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
const { SECRET } = require('../config/jwt');

// ---- Mocks ---------------------------------------------------------------

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TEST-SECRET'),
  generateURI: jest.fn(() => 'otpauth://test'),
  verifySync: jest.fn(() => ({ delta: 0 }))
}));

jest.mock('express-rate-limit', () => {
  return () => (req, res, next) => next();
});

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Rows returned by db.all when a username match exists
const USERNAME_MATCH_ROWS = [
  {
    id: 1,
    username: 'testuser',
    avatar: null,
    avatar_url: null,
    is_online: 1,
    rating: 1200,
    wins: 5,
    losses: 2
  }
];

jest.mock('../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
  isTokenVersionValid: jest.fn().mockResolvedValue(true),
  isUserBanned: jest.fn().mockResolvedValue(null),
  searchUsers: jest.fn(),
  // Extra stubs required by routes loaded transitively
  getTokenVersion: jest.fn().mockResolvedValue(1),
  getUserStats: jest.fn().mockResolvedValue({}),
  getPracticeStats: jest.fn().mockResolvedValue({}),
  getUserCodingSessions: jest.fn().mockResolvedValue([])
}));

const db = require('../db');
const usersRouter = require('../routes/users');

// ---- App factory ---------------------------------------------------------

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  // Simple error handler so 5xx surfaces clearly in tests
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// ---- Token helper --------------------------------------------------------

function validToken(userId = 42) {
  return jwt.sign(
    { sub: userId, email: 'user@example.com', tokenVersion: 1 },
    SECRET,
    { expiresIn: '1h' }
  );
}

// ==========================================================================
// Tests
// ==========================================================================

describe('GET /api/users/search — email enumeration prevention', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    db.isTokenVersionValid.mockResolvedValue(true);
    db.isUserBanned.mockResolvedValue(null);
    app = makeApp();
  });

  // -------------------------------------------------------------------------
  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .get('/api/users/search')
      .query({ q: 'test@example.com' });

    expect(res.status).toBe(401);
    // db.all must never be reached — no query executed without auth
    expect(db.all).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it('returns no rows for an email-substring query (email not searched)', async () => {
    // db.all returns empty because the route only searches by username and
    // "test@" doesn't match any username
    db.all.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/users/search')
      .set('Authorization', `Bearer ${validToken()}`)
      .query({ q: 'test@' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.users).toHaveLength(0);

    // Verify the SQL sent to db.all does NOT mention "email"
    expect(db.all).toHaveBeenCalledTimes(1);
    const sqlArg = db.all.mock.calls[0][0];
    expect(sqlArg).not.toMatch(/email/i);
  });

  // -------------------------------------------------------------------------
  it('returns matching users when searching by username substring', async () => {
    db.all.mockResolvedValue(USERNAME_MATCH_ROWS);

    const res = await request(app)
      .get('/api/users/search')
      .set('Authorization', `Bearer ${validToken()}`)
      .query({ q: 'testu' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].username).toBe('testuser');

    // Confirm the SQL uses a username LIKE clause
    const sqlArg = db.all.mock.calls[0][0];
    expect(sqlArg).toMatch(/username\s+LIKE/i);
    expect(sqlArg).not.toMatch(/email/i);
  });
});
