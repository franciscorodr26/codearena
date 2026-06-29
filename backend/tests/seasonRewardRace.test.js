/**
 * Regression test for Bug M2: Season reward double-claim race.
 *
 * Verifies that concurrent calls to claimSeasonRewards for the same
 * (user, season, loadout) only grant the reward exactly once — even when 5
 * requests race to the UPDATE.
 *
 * The fix relies on a single atomic
 *   UPDATE agent_season_rankings SET reward_claimed = 1
 *   WHERE id = ? AND reward_claimed = 0
 * and uses changes === 1 as the "I won the race" signal. If that predicate
 * is dropped, more than one caller will return success and the badge/ELO
 * grants will run multiple times.
 */

const db = require('../db');
const seasonService = require('../services/seasonService');

describe('claimSeasonRewards — double-claim race (Bug M2)', () => {
  let testUserId;
  let testLoadoutId;
  let testSeasonId;
  let testRankingId;

  // We always seed final_rank = 1 so the reward is { badge: 'season-champion',
  // eloBonus: 500 } — a fixed, large signal that's easy to count.
  const STARTING_ELO = 1000;
  const EXPECTED_BADGE_SLUG = 'season-champion';
  const EXPECTED_ELO_BONUS = 500;

  beforeAll(async () => {
    await db.init();

    // Clean any stale data from prior runs.
    await db.run(
      'DELETE FROM agent_season_rankings WHERE user_id IN (SELECT id FROM users WHERE email LIKE "season-race-%@test.com")'
    );
    await db.run(
      'DELETE FROM agent_loadouts WHERE user_id IN (SELECT id FROM users WHERE email LIKE "season-race-%@test.com")'
    );
    await db.run(
      'DELETE FROM user_badges WHERE user_id IN (SELECT id FROM users WHERE email LIKE "season-race-%@test.com")'
    );
    await db.run('DELETE FROM users WHERE email LIKE "season-race-%@test.com"');
    await db.run('DELETE FROM agent_seasons WHERE name = "Race Test Season"');
  });

  beforeEach(async () => {
    // Fresh user + loadout + season + ranking per test so the prior test's
    // already-claimed state doesn't bleed in.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await db.createUser(
      `season-race-${suffix}@test.com`,
      'password',
      `season_race_${suffix}`
    );
    testUserId = user.id;

    const loadout = await db.createAgentLoadout({
      userId: testUserId,
      name: 'Race Loadout',
      model: 'haiku',
      language: 'python',
      systemPrompt: 'test',
      tools: '[]'
    });
    testLoadoutId = loadout.id;
    await db.run('UPDATE agent_loadouts SET elo = ? WHERE id = ?', [
      STARTING_ELO,
      testLoadoutId
    ]);

    const seasonRes = await db.run(
      `INSERT INTO agent_seasons (season_number, name, starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, 0)`,
      [
        9000 + Math.floor(Math.random() * 1000),
        'Race Test Season',
        new Date(Date.now() - 86400000).toISOString(),
        new Date().toISOString()
      ]
    );
    testSeasonId = seasonRes.lastID;

    const rankRes = await db.run(
      `INSERT INTO agent_season_rankings
        (season_id, user_id, loadout_id, final_elo, final_rank, wins, losses, best_streak, reward_claimed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [testSeasonId, testUserId, testLoadoutId, STARTING_ELO, 1, 10, 0, 5]
    );
    testRankingId = rankRes.lastID;
  });

  afterEach(async () => {
    // Targeted cleanup so concurrent jest workers don't trample each other.
    if (testRankingId) {
      await db.run('DELETE FROM agent_season_rankings WHERE id = ?', [testRankingId]);
    }
    if (testLoadoutId) {
      await db.run('DELETE FROM agent_loadouts WHERE id = ?', [testLoadoutId]);
    }
    if (testUserId) {
      await db.run('DELETE FROM user_badges WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM user_stats WHERE user_id = ?', [testUserId]);
      await db.run('DELETE FROM users WHERE id = ?', [testUserId]);
    }
    if (testSeasonId) {
      await db.run('DELETE FROM agent_seasons WHERE id = ?', [testSeasonId]);
    }
  });

  test('baseline: single call grants the reward exactly once', async () => {
    const result = await seasonService.claimSeasonRewards(testUserId, testSeasonId);

    expect(result.success).toBe(true);
    expect(result.rewards.badge).toBe(EXPECTED_BADGE_SLUG);
    expect(result.rewards.eloBonus).toBe(EXPECTED_ELO_BONUS);

    const ranking = await db.get(
      'SELECT reward_claimed FROM agent_season_rankings WHERE id = ?',
      [testRankingId]
    );
    expect(ranking.reward_claimed).toBe(1);

    const badgeCount = await db.get(
      `SELECT COUNT(*) as count FROM user_badges ub
       JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = ? AND b.slug = ?`,
      [testUserId, EXPECTED_BADGE_SLUG]
    );
    expect(badgeCount.count).toBe(1);

    const loadout = await db.get('SELECT elo FROM agent_loadouts WHERE id = ?', [
      testLoadoutId
    ]);
    expect(loadout.elo).toBe(STARTING_ELO + EXPECTED_ELO_BONUS);
  });

  test('baseline: a second sequential call is rejected', async () => {
    const first = await seasonService.claimSeasonRewards(testUserId, testSeasonId);
    expect(first.success).toBe(true);

    const second = await seasonService.claimSeasonRewards(testUserId, testSeasonId);
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already claimed/i);

    const loadout = await db.get('SELECT elo FROM agent_loadouts WHERE id = ?', [
      testLoadoutId
    ]);
    // ELO bonus applied exactly once, not twice.
    expect(loadout.elo).toBe(STARTING_ELO + EXPECTED_ELO_BONUS);
  });

  test('5 concurrent calls grant the reward exactly once', async () => {
    const results = await Promise.all([
      seasonService.claimSeasonRewards(testUserId, testSeasonId),
      seasonService.claimSeasonRewards(testUserId, testSeasonId),
      seasonService.claimSeasonRewards(testUserId, testSeasonId),
      seasonService.claimSeasonRewards(testUserId, testSeasonId),
      seasonService.claimSeasonRewards(testUserId, testSeasonId)
    ]);

    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);
    failures.forEach(f => {
      expect(f.error).toMatch(/already claimed/i);
    });

    // Ranking flipped exactly once.
    const ranking = await db.get(
      'SELECT reward_claimed FROM agent_season_rankings WHERE id = ?',
      [testRankingId]
    );
    expect(ranking.reward_claimed).toBe(1);

    // Badge granted exactly once (user_badges has UNIQUE(user_id, badge_id),
    // but we still want to assert it explicitly — and on a buggy version this
    // would be 1 anyway, while the ELO assertion below would fail).
    const badgeCount = await db.get(
      `SELECT COUNT(*) as count FROM user_badges ub
       JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = ? AND b.slug = ?`,
      [testUserId, EXPECTED_BADGE_SLUG]
    );
    expect(badgeCount.count).toBe(1);

    // ELO bonus applied exactly once — this is the load-bearing assertion
    // that catches the original bug, since ELO has no UNIQUE constraint to
    // hide the double-grant.
    const loadout = await db.get('SELECT elo FROM agent_loadouts WHERE id = ?', [
      testLoadoutId
    ]);
    expect(loadout.elo).toBe(STARTING_ELO + EXPECTED_ELO_BONUS);
  });
});
