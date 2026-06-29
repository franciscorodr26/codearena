const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({
  getUserById: jest.fn(),
  setUserProStatus: jest.fn()
}));

jest.mock('../routes/auth', () => ({
  authMiddleware: (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { sub: 1, userId: 1 };
    next();
  }
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../services/email', () => ({
  sendReportNotification: jest.fn()
}));

jest.mock('../analytics', () => ({
  Analytics: jest.fn().mockImplementation(() => ({
    trackEvent: jest.fn()
  }))
}));

jest.mock('../middleware/validation', () => ({
  chains: {
    report: (req, res, next) => next()
  }
}));

const db = require('../db');
const moderationRouter = require('../routes/moderation');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/moderation', moderationRouter);
  return app;
}

describe('Moderation Admin Pro grants', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    app = createTestApp();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('grants 3 months of Pro from now for a free user', async () => {
    db.getUserById
      .mockResolvedValueOnce({ id: 1, is_admin: 1 })
      .mockResolvedValueOnce({ id: 2, username: 'target', is_pro: 0, pro_expires_at: null });
    db.setUserProStatus.mockResolvedValue();

    const response = await request(app)
      .post('/api/moderation/admin/users/2/activate-pro')
      .set('Authorization', 'Bearer test-token')
      .send({ plan: 'three_month' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.expiresAt).toBe('2026-08-20T12:00:00.000Z');
    expect(db.setUserProStatus).toHaveBeenCalledWith(2, true, '2026-08-20T12:00:00.000Z');
  });

  it('extends an active Pro user from their current expiration', async () => {
    db.getUserById
      .mockResolvedValueOnce({ id: 1, is_admin: 1 })
      .mockResolvedValueOnce({
        id: 2,
        username: 'target',
        is_pro: 1,
        pro_expires_at: '2026-06-15T00:00:00.000Z'
      });
    db.setUserProStatus.mockResolvedValue();

    const response = await request(app)
      .post('/api/moderation/admin/users/2/activate-pro')
      .set('Authorization', 'Bearer test-token')
      .send({ plan: 'three_month' })
      .expect(200);

    expect(response.body.expiresAt).toBe('2026-09-15T00:00:00.000Z');
    expect(db.setUserProStatus).toHaveBeenCalledWith(2, true, '2026-09-15T00:00:00.000Z');
  });

  it('rejects invalid Pro grant plans', async () => {
    db.getUserById.mockResolvedValueOnce({ id: 1, is_admin: 1 });

    const response = await request(app)
      .post('/api/moderation/admin/users/2/activate-pro')
      .set('Authorization', 'Bearer test-token')
      .send({ plan: 'weekly' })
      .expect(400);

    expect(response.body.error).toBe('Invalid Pro plan');
    expect(db.setUserProStatus).not.toHaveBeenCalled();
  });
});
