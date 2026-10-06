// Signature is not authorization: every place that accepts a bearer token must
// also require a live session at the current credential generation, and must
// never accept a 2FA pending token. These tests prove it against the real
// database for the shared helper (used by sockets and optional-auth routes),
// two route-local helpers, the standard auth middleware and the 2FA verify step.
// otplib pulls in an ESM dependency Jest cannot parse; the 2FA verify test only
// needs the pending-login gate, so a code that never verifies is enough.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TEST-SECRET'),
  generateURI: jest.fn(() => 'otpauth://test'),
  verifySync: jest.fn(() => ({ valid: false }))
}));

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../db');
const { SECRET } = require('../config/jwt');
const { authenticateSessionToken, sessionUserFromRequest } = require('../utils/sessionAuthentication');

const hash = token => crypto.createHash('sha256').update(token).digest('hex');

async function newUserWithSession() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const user = await db.createUser(`session-${stamp}@example.test`, 'x', `sess${stamp}`.slice(0, 30));
  const tokenVersion = await db.getTokenVersion(user.id);
  const token = jwt.sign({ sub: user.id, username: user.username, tokenVersion }, SECRET, { expiresIn: '1h' });
  await db.createUserSession(user.id, hash(token), { ipAddress: '127.0.0.1' });
  const pending = jwt.sign({ sub: user.id, type: '2fa_pending', rememberMe: false, tokenVersion }, SECRET, { expiresIn: 300 });
  return { user, token, pending, tokenVersion };
}

function app(router, mount) {
  const a = express();
  a.use(express.json());
  a.use(mount, router);
  return a;
}

describe('session-checked bearer tokens', () => {
  beforeAll(async () => { await db.init(); });

  test('the shared helper accepts a live session and nothing else', async () => {
    const { user, token, pending } = await newUserWithSession();
    await expect(authenticateSessionToken(token, db, SECRET)).resolves.toMatchObject({ userId: user.id });
    await expect(authenticateSessionToken(pending, db, SECRET)).rejects.toThrow('Invalid session');
    const forged = jwt.sign({ sub: user.id, tokenVersion: 1 }, 'not-the-secret', { expiresIn: '1h' });
    await expect(authenticateSessionToken(forged, db, SECRET)).rejects.toThrow();
  });

  test('a logged-out token and a token from before a password change are rejected', async () => {
    const a = await newUserWithSession();
    await db.run('DELETE FROM user_sessions WHERE user_id = ?', [a.user.id]);
    await expect(authenticateSessionToken(a.token, db, SECRET)).rejects.toThrow('Invalid session');

    const b = await newUserWithSession();
    await db.incrementTokenVersion(b.user.id);
    await expect(authenticateSessionToken(b.token, db, SECRET)).rejects.toThrow('Invalid session');
  });

  test('optional-auth requests only see a user for a live session', async () => {
    const { user, token, pending } = await newUserWithSession();
    const req = t => ({ headers: { authorization: `Bearer ${t}` } });
    expect(await sessionUserFromRequest(req(token), db, SECRET)).toMatchObject({ userId: user.id, sub: user.id, id: user.id });
    expect(await sessionUserFromRequest(req(pending), db, SECRET)).toBeNull();
    expect(await sessionUserFromRequest({ headers: {} }, db, SECRET)).toBeNull();
  });

  test('route-local helpers: rewards and bug reports reject pending and logged-out tokens, accept live ones', async () => {
    const live = await newUserWithSession();
    const out = await newUserWithSession();
    await db.run('DELETE FROM user_sessions WHERE user_id = ?', [out.user.id]);

    const rewards = app(require('../routes/rewards'), '/api/rewards');
    expect((await request(rewards).get('/api/rewards/stats').set('Authorization', `Bearer ${live.token}`)).status).toBe(200);
    expect((await request(rewards).get('/api/rewards/stats').set('Authorization', `Bearer ${live.pending}`)).status).toBe(401);
    expect((await request(rewards).get('/api/rewards/stats').set('Authorization', `Bearer ${out.token}`)).status).toBe(401);

    const bugs = app(require('../routes/bugReports'), '/api/bug-reports');
    const body = { title: 'Timer bug', description: 'The battle timer kept running after I won.' };
    expect((await request(bugs).post('/api/bug-reports').set('Authorization', `Bearer ${live.pending}`).send(body)).status).toBe(401);
    expect((await request(bugs).post('/api/bug-reports').set('Authorization', `Bearer ${out.token}`).send(body)).status).toBe(401);
    expect((await request(bugs).post('/api/bug-reports').set('Authorization', `Bearer ${live.token}`).send(body)).status).toBe(200);
  });

  test('the standard auth middleware rejects a pending token even though it carries a valid version', async () => {
    const { token, pending } = await newUserWithSession();
    const a = express();
    a.get('/me', require('../routes/auth').authMiddleware, (req, res) => res.json({ id: req.user.sub }));
    expect((await request(a).get('/me').set('Authorization', `Bearer ${pending}`)).status).toBe(401);
    expect((await request(a).get('/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  test('a pending login started before a password change cannot be completed', async () => {
    const { user, tokenVersion } = await newUserWithSession();
    const authApp = app(require('../routes/auth'), '/api/auth');
    const issue = async () => {
      const pending = jwt.sign({ sub: user.id, type: '2fa_pending', rememberMe: false, tokenVersion: await db.getTokenVersion(user.id) }, SECRET, { expiresIn: 300 });
      await db.save2FAPendingToken(user.id, hash(pending), Math.floor(Date.now() / 1000) + 300);
      return pending;
    };
    // Current pending login passes the gate and fails later on the (unset) second factor.
    const current = await issue();
    const ok = await request(authApp).post('/api/auth/2fa/verify').send({ pendingToken: current, code: '123456' });
    expect(ok.status).toBe(400);

    const stale = await issue();
    await db.incrementTokenVersion(user.id);
    expect(await db.getTokenVersion(user.id)).toBe(tokenVersion + 1);
    const res = await request(authApp).post('/api/auth/2fa/verify').send({ pendingToken: stale, code: '123456' });
    expect(res.status).toBe(401);

    const untyped = jwt.sign({ sub: user.id, tokenVersion: await db.getTokenVersion(user.id) }, SECRET, { expiresIn: 300 });
    expect((await request(authApp).post('/api/auth/2fa/verify').send({ pendingToken: untyped, code: '123456' })).status).toBe(401);
  });

  test('no bearer check in the backend relies on the signature alone', () => {
    const root = path.join(__dirname, '..');
    const files = ['server.js', ...fs.readdirSync(path.join(root, 'routes')).filter(f => f.endsWith('.js')).map(f => `routes/${f}`)];
    const offenders = [];
    for (const file of files) {
      const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bjwt(Lib)?\.verify\(/.test(line)) return;
        const allowed =
          (file === 'server.js' && /algorithms: \['HS256'\]/.test(line)) || // rate-limit key only
          (file === 'routes/auth.js' && /jwt\.verify\((token|pendingToken), SECRET\)/.test(line)); // followed by session or pending checks
        if (!allowed) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    expect(server).toContain('await authenticateSessionToken(token, dbHelper, SECRET)');
    expect(server).toContain('async function extractUserFromToken(req)');
    expect(server).not.toMatch(/const authUser = extractUserFromToken\(req\)/);
  });
});
