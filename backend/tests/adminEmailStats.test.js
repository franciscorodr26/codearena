const request = require('supertest');
const express = require('express');

// Match the mock surface admin.test.js uses so requiring routes/admin.js does not blow up.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verifySync: jest.fn()
}));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

jest.mock('../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  getUserById: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (req.headers.authorization) {
      req.user = { sub: 1, userId: 1 };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }
}));

const adminRouter = require('../routes/admin');
const db = require('../db');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('GET /api/admin/emails/stats', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();
  });

  it('returns 403 for non-admin users', async () => {
    db.getUserById.mockResolvedValue({ id: 2, is_admin: 0 });

    const res = await request(app)
      .get('/api/admin/emails/stats')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 403 with "User not found" when user lookup returns null', async () => {
    db.getUserById.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/admin/emails/stats')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/emails/stats');
    expect(res.status).toBe(401);
    expect(db.getUserById).not.toHaveBeenCalled();
  });

  it('returns subscriber counts per email type for admin', async () => {
    db.getUserById.mockResolvedValue({ id: 1, is_admin: 1 });

    // Sequence must match the order queries run in the handler:
    //  1. verified users total
    //  2. weekly_challenge count
    //  3. marketing (registered users) count
    //  4. progress_digest count
    //  5. tournament_notifications count
    //  6. activity_reminders count
    //  7. creator_arena_emails count
    //  8. message_digest count
    //  9. newsletter-only (non-user) count
    db.get
      .mockResolvedValueOnce({ count: 1000 }) // verifiedUsers
      .mockResolvedValueOnce({ count: 980 })  // weekly_challenge
      .mockResolvedValueOnce({ count: 380 })  // marketing
      .mockResolvedValueOnce({ count: 990 })  // progress_digest
      .mockResolvedValueOnce({ count: 320 })  // tournament_notifications
      .mockResolvedValueOnce({ count: 970 })  // activity_reminders
      .mockResolvedValueOnce({ count: 960 })  // creator_arena_emails
      .mockResolvedValueOnce({ count: 950 })  // message_digest
      .mockResolvedValueOnce({ count: 32 });  // newsletter-only

    const res = await request(app)
      .get('/api/admin/emails/stats')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verifiedUsers).toBe(1000);

    const byType = Object.fromEntries(res.body.stats.map(s => [s.type, s]));
    expect(byType.weekly_challenge.subscribers).toBe(980);
    expect(byType.progress_digest.subscribers).toBe(990);
    expect(byType.tournament_notifications.subscribers).toBe(320);
    expect(byType.activity_reminders.subscribers).toBe(970);
    expect(byType.creator_arena_emails.subscribers).toBe(960);
    expect(byType.message_digest.subscribers).toBe(950);

    // Marketing combines registered users + newsletter-only signups
    expect(byType.marketing.registeredUsers).toBe(380);
    expect(byType.marketing.newsletterOnly).toBe(32);
    expect(byType.marketing.subscribers).toBe(412);
  });

  it('handles DB errors with a 500', async () => {
    db.getUserById.mockResolvedValue({ id: 1, is_admin: 1 });
    db.get.mockRejectedValueOnce(new Error('db blew up'));

    const res = await request(app)
      .get('/api/admin/emails/stats')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(500);
  });
});
