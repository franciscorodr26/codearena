/**
 * Regression test for 2FA backup code double-consume race.
 *
 * The previous useBackupCode() implementation did a SELECT to find an
 * unused row, then issued an UPDATE that only filtered by row id. Two
 * concurrent verifications using the same backup code could therefore
 * both pass the SELECT, both flip used 0 -> 1, and both be reported as
 * successful — effectively making each backup code consumable twice.
 *
 * The fix narrows the UPDATE's WHERE clause to `id = ? AND used = 0`
 * and treats `result.changes === 1` as the "I won the race" signal.
 * Exactly one concurrent caller may succeed; everyone else must be
 * rejected.
 */

const db = require('../db');

describe('useBackupCode — double-consume race', () => {
  let testUserId;
  const codeHash = 'race-test-hash-deadbeef';

  beforeAll(async () => {
    await db.init();
    await db.run(
      'DELETE FROM users WHERE email LIKE "2fa-race-%@test.com"'
    );
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.createUser(
      `2fa-race-${suffix}@test.com`,
      'password',
      `tfa_race_${suffix}`
    );
    testUserId = user.id;

    // Seed exactly one unused backup code for this user.
    await db.saveBackupCodes(testUserId, [codeHash]);
  });

  afterEach(async () => {
    if (testUserId) {
      await db.run(
        'DELETE FROM two_factor_backup_codes WHERE user_id = ?',
        [testUserId]
      );
      await db.run('DELETE FROM user_stats WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM users WHERE id = ?', [testUserId]);
    }
  });

  test('baseline: a sequential second use is rejected', async () => {
    const first = await db.useBackupCode(testUserId, codeHash);
    expect(first).toBe(true);

    const second = await db.useBackupCode(testUserId, codeHash);
    expect(second).toBe(false);

    const row = await db.get(
      'SELECT used FROM two_factor_backup_codes WHERE user_id = ? AND code_hash = ?',
      [testUserId, codeHash]
    );
    expect(row.used).toBe(1);
  });

  test('two concurrent uses: exactly one succeeds, the other is rejected', async () => {
    const results = await Promise.all([
      db.useBackupCode(testUserId, codeHash),
      db.useBackupCode(testUserId, codeHash)
    ]);

    const successes = results.filter(r => r === true);
    const failures = results.filter(r => r === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Row was flipped exactly once.
    const row = await db.get(
      'SELECT used FROM two_factor_backup_codes WHERE user_id = ? AND code_hash = ?',
      [testUserId, codeHash]
    );
    expect(row.used).toBe(1);

    // Remaining unused count is zero — the code was burned, not skipped.
    const remaining = await db.getBackupCodesCount(testUserId);
    expect(remaining).toBe(0);
  });
});
