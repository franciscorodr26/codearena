/**
 * Regression test for the credit-overspend race in deductCredits.
 *
 * The original implementation did a read-balance / JS-check / UPDATE sequence
 * with no atomic guard:
 *
 *   const credits = await getUserCredits(userId);
 *   if (credits.balance < amount) return { success: false, ... };
 *   await run(`UPDATE user_credits SET balance = balance - ? ...`, ...);
 *
 * Under concurrent callers (the async sqlite3 driver interleaves awaits), two
 * requests could both see balance=1, both pass the check, and both run the
 * UPDATE — driving the stored balance to -1. Two free generations from one
 * credit.
 *
 * The fix replaces that with a single atomic conditional UPDATE:
 *
 *   UPDATE user_credits SET balance = balance - ?
 *   WHERE user_id = ? AND balance >= ?
 *
 * and rejects callers that see result.changes === 0. This test fires more
 * concurrent deducts than the seeded balance can support and verifies:
 *   1. balance never goes negative,
 *   2. exactly seededBalance/amount succeed,
 *   3. the rest are rejected with success: false.
 */

const db = require('../db');

describe('deductCredits — concurrent overspend race', () => {
  let testUserId;

  beforeAll(async () => {
    await db.init();

    // Clean any stale rows from prior runs.
    await db.run(
      `DELETE FROM user_credits WHERE user_id IN
         (SELECT id FROM users WHERE email LIKE 'credit-race-%@test.com')`
    );
    await db.run(
      `DELETE FROM credit_transactions WHERE user_id IN
         (SELECT id FROM users WHERE email LIKE 'credit-race-%@test.com')`
    );
    await db.run(
      `DELETE FROM users WHERE email LIKE 'credit-race-%@test.com'`
    );
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.createUser(
      `credit-race-${suffix}@test.com`,
      'password',
      `credit_race_${suffix}`
    );
    testUserId = user.id;

    // Force the row to exist with a known starting balance, overriding the
    // 5-credit free-trial grant in getUserCredits().
    await db.run(
      `INSERT INTO user_credits (user_id, balance, lifetime_earned, lifetime_spent)
       VALUES (?, 5, 5, 0)
       ON CONFLICT(user_id) DO UPDATE SET
         balance = 5, lifetime_earned = 5, lifetime_spent = 0`,
      [testUserId]
    );
  });

  afterEach(async () => {
    if (testUserId) {
      await db.run('DELETE FROM credit_transactions WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM user_credits WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM users WHERE id = ?', [testUserId]);
    }
  });

  test('baseline: single 1-credit deduct succeeds and lowers balance by 1', async () => {
    const result = await db.deductCredits(testUserId, 1, 'baseline');
    expect(result.success).toBe(true);
    expect(result.balance).toBe(4);

    const row = await db.get(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    expect(row.balance).toBe(4);
  });

  test('baseline: deduct from empty balance is rejected', async () => {
    await db.run('UPDATE user_credits SET balance = 0 WHERE user_id = ?', [testUserId]);

    const result = await db.deductCredits(testUserId, 1, 'overdraft');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient/i);

    const row = await db.get(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    // Balance must not have gone negative or otherwise mutated.
    expect(row.balance).toBe(0);
  });

  test('10 concurrent 1-credit deducts on balance=5: exactly 5 succeed, balance lands on 0', async () => {
    const PARALLEL = 10;
    const AMOUNT = 1;
    const STARTING = 5;

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        db.deductCredits(testUserId, AMOUNT, `race-${i}`)
      )
    );

    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    // Exactly STARTING/AMOUNT = 5 winners, the other 5 are rejected.
    expect(successes).toHaveLength(STARTING / AMOUNT);
    expect(failures).toHaveLength(PARALLEL - STARTING / AMOUNT);
    failures.forEach(f => {
      expect(f.error).toMatch(/insufficient/i);
    });

    // The load-bearing assertion: balance must be exactly 0 and never negative.
    const row = await db.get(
      'SELECT balance, lifetime_spent FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    expect(row.balance).toBe(0);
    expect(row.balance).toBeGreaterThanOrEqual(0);
    // lifetime_spent should reflect exactly the 5 successful debits.
    expect(row.lifetime_spent).toBe(STARTING);

    // And the transaction ledger should have exactly 5 game_creation entries,
    // matching the number of successful deducts.
    const txCount = await db.get(
      `SELECT COUNT(*) as count FROM credit_transactions
       WHERE user_id = ? AND type = 'game_creation'`,
      [testUserId]
    );
    expect(txCount.count).toBe(STARTING / AMOUNT);
  });

  test('concurrent deducts of amount=2 on balance=5: exactly 2 succeed, balance lands on 1', async () => {
    // Sanity check that the atomic guard handles amount > 1 correctly.
    const PARALLEL = 6;
    const AMOUNT = 2;
    const STARTING = 5;
    const EXPECTED_WINNERS = Math.floor(STARTING / AMOUNT); // 2

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        db.deductCredits(testUserId, AMOUNT, `race-2x-${i}`)
      )
    );

    const successes = results.filter(r => r.success);
    expect(successes).toHaveLength(EXPECTED_WINNERS);

    const row = await db.get(
      'SELECT balance FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    expect(row.balance).toBe(STARTING - EXPECTED_WINNERS * AMOUNT); // 1
    expect(row.balance).toBeGreaterThanOrEqual(0);
  });

  test('new CreatorArena accounts receive no automatic model credits', async () => {
    await db.run('DELETE FROM credit_transactions WHERE user_id = ?', [testUserId]);
    await db.run('DELETE FROM user_credits WHERE user_id = ?', [testUserId]);

    const credits = await db.getUserCredits(testUserId);
    expect(credits.balance).toBe(0);
    expect(credits.lifetime_earned).toBe(0);

    const trialTransactions = await db.get(
      `SELECT COUNT(*) AS count FROM credit_transactions
       WHERE user_id = ? AND type = 'trial_grant'`,
      [testUserId]
    );
    expect(trialTransactions.count).toBe(0);
  });

  test('concurrent fulfillment credits a provider payment exactly once', async () => {
    await db.run(
      'UPDATE user_credits SET balance = 0, lifetime_earned = 0 WHERE user_id = ?',
      [testUserId]
    );
    const paymentId = `pi_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => db.addPurchasedCredits(
        testUserId,
        100,
        paymentId,
        `Test credit pack (${paymentId})`
      ))
    );

    expect(results.filter(result => result.credited)).toHaveLength(1);
    expect(results.filter(result => !result.credited)).toHaveLength(7);

    const credits = await db.getUserCredits(testUserId);
    expect(credits.balance).toBe(100);
    expect(credits.lifetime_earned).toBe(100);

    const purchases = await db.get(
      `SELECT COUNT(*) AS count FROM credit_transactions
       WHERE provider_payment_id = ? AND type = 'purchase'`,
      [paymentId]
    );
    expect(purchases.count).toBe(1);
  });

  test('a failed generation reservation can be fully refunded', async () => {
    const reservation = await db.deductCredits(testUserId, 2, 'Creator reservation');
    expect(reservation).toMatchObject({ success: true, balance: 3 });

    const refund = await db.refundCredits(testUserId, 2, 'Creator provider failure');
    expect(refund).toMatchObject({ success: true, balance: 5 });

    const row = await db.get(
      'SELECT balance, lifetime_spent FROM user_credits WHERE user_id = ?',
      [testUserId]
    );
    expect(row).toEqual({ balance: 5, lifetime_spent: 0 });

    const ledger = await db.all(
      `SELECT type, amount FROM credit_transactions
       WHERE user_id = ? ORDER BY id ASC`,
      [testUserId]
    );
    expect(ledger).toEqual([
      expect.objectContaining({ type: 'game_creation', amount: -2 }),
      expect.objectContaining({ type: 'game_creation_refund', amount: 2 })
    ]);
  });

  test('a purchase refund creates credit debt when the pack was already spent', async () => {
    await db.run(
      'UPDATE user_credits SET balance = 2, lifetime_earned = 100 WHERE user_id = ?',
      [testUserId]
    );
    const reversalId = `credit-reversal:test-${Date.now()}`;

    const first = await db.revokePurchasedCredits(
      testUserId,
      100,
      reversalId,
      'Refunded test pack'
    );
    const duplicate = await db.revokePurchasedCredits(
      testUserId,
      100,
      reversalId,
      'Refunded test pack'
    );

    expect(first.revoked).toBe(100);
    expect(first.credits.balance).toBe(-98);
    expect(duplicate.revoked).toBe(0);
    expect(duplicate.credits.balance).toBe(-98);

    const ledger = await db.all(
      `SELECT amount, type FROM credit_transactions
       WHERE provider_payment_id = ?`,
      [reversalId]
    );
    expect(ledger).toEqual([{ amount: -100, type: 'purchase_reversal' }]);
  });

  test('a larger cumulative refund revokes only the additional credits', async () => {
    await db.run(
      'UPDATE user_credits SET balance = 100, lifetime_earned = 100 WHERE user_id = ?',
      [testUserId]
    );
    const reversalId = `credit-reversal:partial-${Date.now()}`;

    await db.revokePurchasedCredits(testUserId, 25, reversalId, 'Partial refund');
    const second = await db.revokePurchasedCredits(testUserId, 60, reversalId, 'Larger refund');

    expect(second.revoked).toBe(35);
    expect(second.credits.balance).toBe(40);
  });
});
