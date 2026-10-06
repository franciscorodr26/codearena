// A two-factor code is single-use: once a time step is accepted, the same step
// (or an older one) is refused, so a phished or overheard code cannot be replayed.
const fs = require('fs');
const path = require('path');
const db = require('../db');

describe('two-factor code replay', () => {
  let userId;
  beforeAll(async () => {
    await db.init();
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const user = await db.createUser(`totp-${stamp}@example.test`, 'hash', `totp${stamp}`.slice(0, 20));
    userId = user.id;
  });

  test('each time step is accepted once, older steps never', async () => {
    expect(await db.claimTotpStep(userId, 59710387)).toBe(true);
    expect(await db.claimTotpStep(userId, 59710387)).toBe(false);
    expect(await db.claimTotpStep(userId, 59710386)).toBe(false);
    expect(await db.claimTotpStep(userId, 59710388)).toBe(true);
    expect(await db.claimTotpStep(userId, 'not-a-step')).toBe(false);
  });

  test('every code check in the auth routes goes through the replay guard', () => {
    const source = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
    expect((source.match(/await verifyFreshTotp\(userId, (code|totpCode), secret\)/g) || []).length).toBe(5);
    // verifySync may only appear inside the guard itself
    expect((source.match(/verifySync\(/g) || []).length).toBe(1);
  });

  test('sign-out events reach the realtime layer from every session-ending route', () => {
    const auth = fs.readFileSync(path.join(__dirname, '../routes/auth.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect((auth.match(/notifySessionsChanged\(/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(server).toContain("securityEvents.on('sessions-changed'");
    expect(server).toContain('socket.disconnect(true)');
  });
});
