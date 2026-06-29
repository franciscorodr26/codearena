/**
 * Regression test for Bug 2: Monthly credit double-grant on parallel page loads.
 *
 * Before the fix, grantMonthlyCredits did a JS-side check of "is the stored
 * timestamp in the current month?" and THEN issued an unconditional UPDATE
 * that just added +PRO_MONTHLY_CREDITS to the balance. Two parallel callers
 * (e.g. two tabs both hitting GET /api/ai/credits at the same time) would
 * both pass the JS check and both apply the grant, yielding a 2x (or worse)
 * balance bump per month.
 *
 * The fix collapses the check + write into a single atomic statement:
 *
 *   UPDATE user_credits
 *     SET balance = balance + ?, last_monthly_grant = ?, ...
 *     WHERE user_id = ?
 *       AND (last_monthly_grant IS NULL OR last_monthly_grant != ?)
 *
 * Whichever caller wins the race flips last_monthly_grant to the current
 * month; the others see changes === 0 and return { granted: false }. This
 * test fires 5 parallel grant calls against a row seeded with last month's
 * value and asserts the balance is bumped exactly once, not five times.
 */

const db = require('../db');

describe('grantMonthlyCredits — parallel double-grant race (Bug 2)', () => {
  // We don't import PRO_MONTHLY_CREDITS — instead we derive the expected
  // grant amount from a single successful baseline call, so this test stays
  // correct even if the constant value changes.
  let GRANT_AMOUNT;
  let testUserId;

  beforeAll(async () => {
    await db.init();

    // Determine the actual monthly grant amount the implementation uses by
    // running one isolated grant against a throwaway user. This makes the
    // test independent of the constant's literal value.
    const probeUser = await db.createUser(
      `monthly-credit-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`,
      'password',
      `mc_probe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    );
    await db.getUserCredits(probeUser.id); // ensure user_credits row exists
    const before = await db.get(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [probeUser.id]
    );
    const probeResult = await db.grantMonthlyCredits(probeUser.id, true);
    const after = await db.get(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [probeUser.id]
    );
    expect(probeResult.granted).toBe(true);
    GRANT_AMOUNT = after.balance - before.balance;
    expect(GRANT_AMOUNT).toBeGreaterThan(0);

    // Cleanup probe user.
    await db.run('DELETE FROM credit_transactions WHERE user_id = ?', [probeUser.id]);
    await db.run('DELETE FROM user_credits WHERE user_id = ?', [probeUser.id]);
    await db.run('DELETE FROM user_stats WHERE user_id = ?', [probeUser.id]);
    await db.run('DELETE FROM users WHERE id = ?', [probeUser.id]);
  });

  beforeEach(async () => {
    // Fresh user per test so prior runs (and the JS-set "last month" value)
    // don't bleed in.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.createUser(
      `monthly-credit-race-${suffix}@test.com`,
      'password',
      `mc_race_${suffix}`
    );
    testUserId = user.id;

    // Force a known starting state: balance = 0, last_monthly_grant set to
    // LAST MONTH (so the grant is eligible to fire this month). The bugged
    // implementation would happily add the grant 5 times from this state.
    await db.getUserCredits(testUserId); // creates the user_credits row
    const now = new Date();
    const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonthKey = `${lastMonthDate.getUTCFullYear()}-${String(
      lastMonthDate.getUTCMonth() + 1
    ).padStart(2, '0')}`;
    await db.run(
      `UPDATE user_credits
         SET balance = 0,
             lifetime_earned = 0,
             last_monthly_grant = ?
       WHERE user_id = ?`,
      [lastMonthKey, testUserId]
    );
  });

  afterEach(async () => {
    if (testUserId) {
      await db.run('DELETE FROM credit_transactions WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM user_credits WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM user_stats WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM users WHERE id = ?', [testUserId]);
    }
  });

  test('5 parallel grant calls add the monthly amount exactly once', async () => {
    const results = await Promise.all([
      db.grantMonthlyCredits(testUserId, true),
      db.grantMonthlyCredits(testUserId, true),
      db.grantMonthlyCredits(testUserId, true),
      db.grantMonthlyCredits(testUserId, true),
      db.grantMonthlyCredits(testUserId, true)
    ]);

    // Exactly one caller wins the race and reports a grant.
    const granted = results.filter(r => r && r.granted);
    const skipped = results.filter(r => r && !r.granted);
    expect(granted).toHaveLength(1);
    expect(skipped).toHaveLength(4);

    // Final balance bumped by exactly one grant — this is the load-bearing
    // assertion that catches the original bug. On the buggy implementation
    // this would be 5 * GRANT_AMOUNT.
    const credits = await db.get(
      'SELECT balance, lifetime_earned FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    expect(credits.balance).toBe(GRANT_AMOUNT);
    expect(credits.lifetime_earned).toBe(GRANT_AMOUNT);

    // The winner's reported newBalance matches the row.
    expect(granted[0].newBalance).toBe(GRANT_AMOUNT);

    // Exactly one 'monthly_grant' credit_transactions row was written.
    const txRow = await db.get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM credit_transactions
        WHERE user_id = ? AND type = 'monthly_grant'`,
      [testUserId]
    );
    expect(txRow.count).toBe(1);
    expect(txRow.total).toBe(GRANT_AMOUNT);
  });

  test('a second sequential call within the same month is a no-op', async () => {
    const first = await db.grantMonthlyCredits(testUserId, true);
    expect(first.granted).toBe(true);
    expect(first.newBalance).toBe(GRANT_AMOUNT);

    const second = await db.grantMonthlyCredits(testUserId, true);
    expect(second.granted).toBe(false);
    expect(second.newBalance).toBeUndefined();

    const credits = await db.get(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    expect(credits.balance).toBe(GRANT_AMOUNT);
  });
});
