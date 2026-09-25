const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'release-security-test-secret-at-least-32-chars';

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../db', () => ({
  getBugReportCountToday: jest.fn().mockResolvedValue(0),
  saveBugReport: jest.fn().mockResolvedValue({ id: 'saved-report' }),
  getUserById: jest.fn(),
  getAllBugReports: jest.fn(),
  getBugReportCount: jest.fn(),
  getBugReportById: jest.fn(),
  updateBugReportStatus: jest.fn(),
  deleteBugReport: jest.fn()
}));

const db = require('../db');
const { SECRET } = require('../config/jwt');
const { isValidAdminKey, requireAdminKey } = require('../utils/adminKeyGuard');
const problemsLoader = require('../problemsLoader');
const bugReportsRouter = require('../routes/bugReports');

function makeBugReportApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bug-reports', bugReportsRouter);
  return app;
}

function bearerToken(sub, overrides = {}) {
  return jwt.sign({
    sub,
    username: `user-${sub}`,
    email: `user-${sub}@example.com`,
    ...overrides
  }, SECRET);
}

describe('direct server admin-key guard', () => {
  const originalAdminKey = process.env.ADMIN_KEY;

  afterEach(() => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_KEY;
    } else {
      process.env.ADMIN_KEY = originalAdminKey;
    }
  });

  it('fails closed when ADMIN_KEY is unset or blank', () => {
    delete process.env.ADMIN_KEY;
    expect(isValidAdminKey(undefined)).toBe(false);
    expect(isValidAdminKey('anything')).toBe(false);

    process.env.ADMIN_KEY = '   ';
    expect(isValidAdminKey('   ')).toBe(false);
  });

  it('accepts only the configured key', () => {
    process.env.ADMIN_KEY = 'a-strong-admin-key-used-for-this-test';

    expect(isValidAdminKey('wrong-key')).toBe(false);
    expect(isValidAdminKey('a-strong-admin-key-used-for-this-test')).toBe(true);
  });

  it('returns 401 before an admin handler when the key is unavailable', () => {
    delete process.env.ADMIN_KEY;
    const req = { headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    requireAdminKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('routes every remaining direct admin endpoint through the shared guard', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const directAdminRoutes = source.match(/app\.(?:get|post|put|patch|delete)\('\/admin\/[^']+'[^\n]*/g) || [];

    expect(directAdminRoutes.length).toBeGreaterThan(0);
    directAdminRoutes.forEach(route => expect(route).toContain('requireAdminKey'));
    expect(source).not.toContain("req.headers['x-admin-key']");
    expect(source).not.toContain("req.headers['x-admin-secret']");
    expect(source).not.toContain("app.post('/api/admin/promote-user'");
    expect(source).not.toContain("app.post('/api/admin/send-changelog'");
  });

  it('requires an authenticated database admin for legacy feedback records', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    expect(source).toContain(
      "app.get('/feedback', authRouter.authMiddleware, requireUserAdmin"
    );
    expect(source).toContain(
      "app.delete('/feedback/:id', authRouter.authMiddleware, requireUserAdmin"
    );
  });

  it('never serializes full problem or player state in battle payloads', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const visibleProblemUses = source.match(
      /problem: problemsLoader\.getVisibleProblem\(battle\.problem\)/g
    ) || [];
    const publicRoute = source.slice(
      source.indexOf("app.get('/api/battle/:battleId'"),
      source.indexOf("app.post('/api/matchmaking/join'")
    );

    expect(visibleProblemUses.length).toBeGreaterThanOrEqual(2);
    expect(publicRoute).not.toContain('...battle');
    expect(publicRoute).not.toContain('code:');
    expect(publicRoute).not.toContain('keystroke');

    const legacy = (value) => ({ input: `s = ${JSON.stringify(value)}`, expected: JSON.stringify(value.slice(-1)) });
    const problem = {
      id: 'security-regression',
      title: 'Visible cases only',
      description: 'Test fixture',
      difficulty: 'Easy',
      category: 'Strings',
      tags: ['strings'],
      constraints: [],
      function: { name: 'f', pythonName: 'f', params: [{ name: 's', type: 'string' }], returns: 'string' },
      examples: [
        { args: ['visible-1'], expected: '1' },
        { args: ['visible-2'], expected: '2' },
        { args: ['visible-3'], expected: '3' }
      ],
      tests: [
        { args: ['hidden-4'], expected: '4' },
        { args: ['hidden-5'], expected: '5' }
      ],
      testCases: ['visible-1', 'visible-2', 'visible-3', 'hidden-4', 'hidden-5'].map(legacy),
      visibleCount: 3,
      runnableLanguages: problemsLoader.RUNNABLE_LANGUAGES
    };
    const serialized = JSON.stringify(problemsLoader.getVisibleProblem(problem));

    expect(serialized).toContain('visible-3');
    expect(serialized).not.toContain('hidden-4');
    expect(serialized).not.toContain('hidden-5');
    expect(JSON.parse(serialized).hiddenTestCases).toBe(2);
  });

  it('authenticates and bounds private battle creation before insertion', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const createRoute = source.slice(
      source.indexOf("app.post('/api/battle/create'"),
      source.indexOf("app.post('/api/battle/join/:battleId'")
    );

    expect(createRoute).toContain("authRouter.authMiddleware");
    expect(createRoute).toContain("creationKind: 'private'");
    expect(createRoute).toContain('if (battles.size >= MAX_BATTLES)');
    expect(createRoute).toContain('countActivePrivateBattlesForUser(authUser.userId)');
    expect(createRoute.indexOf('if (battles.size >= MAX_BATTLES)')).toBeLessThan(
      createRoute.indexOf('battles.set(battleId, battle)')
    );
  });

  it('checks socket ownership before subscribing to a battle room', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const roomJoin = source.slice(
      source.indexOf("socket.on('join-battle-room'"),
      source.indexOf("socket.on('join-battle'", source.indexOf("socket.on('join-battle-room'"))
    );

    expect(roomJoin).toContain('verifyPlayerOwnership(socket, player)');
    expect(roomJoin.indexOf('verifyPlayerOwnership(socket, player)')).toBeLessThan(
      roomJoin.indexOf('socket.join(battleId)')
    );
  });

  it('atomically reserves complexity AI quotas and retains a time fallback', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const completionAnalysis = source.slice(
      source.indexOf('// Analyze time complexity only after atomically reserving'),
      source.indexOf('// Send submission result to winner')
    );

    expect(completionAnalysis).toContain('tryConsumeConsumerDailyUsage([');
    expect(completionAnalysis).toContain("metric: 'complexity_analysis'");
    expect(completionAnalysis).toContain("metric: 'prompt_evaluation', subjectId: 'global'");
    expect(completionAnalysis).toContain('if (complexityQuota?.allowed)');
    expect(completionAnalysis).toContain('getTimeFallbackRating(winnerSolveTime)');
  });
});

describe('bug-report consumer route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getBugReportCountToday.mockResolvedValue(0);
    db.saveBugReport.mockResolvedValue({ id: 'saved-report' });
  });

  it('rejects unauthenticated submissions and uploads', async () => {
    const app = makeBugReportApp();

    const submission = await request(app)
      .post('/api/bug-reports')
      .send({ title: 'Bug', description: 'Something broke' });
    const upload = await request(app)
      .post('/api/bug-reports/upload');

    expect(submission.status).toBe(401);
    expect(upload.status).toBe(401);
    expect(db.saveBugReport).not.toHaveBeenCalled();
  });

  it('preserves normal reporting for an authenticated consumer', async () => {
    const app = makeBugReportApp();
    const token = bearerToken(101);

    const response = await request(app)
      .post('/api/bug-reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Battle issue', description: 'The timer did not stop.' });

    expect(response.status).toBe(200);
    expect(db.saveBugReport).toHaveBeenCalledWith(expect.objectContaining({
      userId: 101,
      username: 'user-101',
      email: 'user-101@example.com'
    }));
  });

  it('limits authenticated submission bursts per user', async () => {
    const app = makeBugReportApp();
    const token = bearerToken(202);
    const statuses = [];

    for (let i = 0; i < 6; i++) {
      const response = await request(app)
        .post('/api/bug-reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: `Bug ${i}`, description: 'A reproducible issue.' });
      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('orders authentication and throttling before multipart disk writes', () => {
    const source = fs.readFileSync(path.join(__dirname, '../routes/bugReports.js'), 'utf8');

    expect(source).toContain(
      "router.post('/upload', authMiddleware, bugReportUploadLimiter, upload.array('screenshots', 5)"
    );
    expect(source).toContain(
      "router.post('/', authMiddleware, bugReportSubmissionLimiter"
    );
    expect(source).not.toContain('optionalAuthMiddleware');
  });
});
