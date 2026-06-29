/**
 * Regression test for tournament bracket seeding.
 *
 * Previously generateBracket paired (i, N-1-i) which produced an order like
 * [(1,N), (2,N-1), (3,N-2), ...]. With this pairing seeds 1 and 2 ended up
 * on the same half of the bracket and collided in the semifinal — not the
 * final. The fix switches to the canonical recursive "fold" seeding so the
 * top seeds are spread across opposite halves.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `codearena-bracket-seed-${Date.now()}-${process.pid}.sqlite`
);
process.env.DB_PATH = TEST_DB_PATH;

const db = require('../db');

async function seedUsers(n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const suffix = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    const u = await db.createUser(
      `bracket-${suffix}@test.com`,
      'password',
      `bracket_${suffix}`
    );
    ids.push(u.id);
  }
  return ids;
}

async function setRatings(userIds, ratings) {
  const now = new Date().toISOString();
  for (let i = 0; i < userIds.length; i++) {
    await db.run(
      `INSERT INTO user_stats (user_id, rating, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      [userIds[i], ratings[i], now]
    );
  }
}

async function makeTournamentWithPlayers(playerIds) {
  const t = await db.createTournament({
    name: `t-${Date.now()}`,
    description: 'bracket test',
    startTime: new Date(Date.now() + 60_000).toISOString(),
    registrationDeadline: new Date(Date.now() + 30_000).toISOString(),
    format: 'single_elimination',
    maxPlayers: playerIds.length,
    minPlayers: 2,
    prizeDescription: '',
    isProOnly: false,
    isPrivate: false,
    createdBy: playerIds[0]
  });

  for (const userId of playerIds) {
    await db.run(
      `INSERT INTO tournament_participants (tournament_id, user_id, language, checked_in)
       VALUES (?, ?, ?, 1)`,
      [t.id, userId, 'python']
    );
  }

  return t.id;
}

async function firstRoundMatches(tournamentId) {
  return await db.all(
    `SELECT match_number, player1_id, player2_id
     FROM tournament_matches
     WHERE tournament_id = ? AND round = 1
     ORDER BY match_number`,
    [tournamentId]
  );
}

describe('generateBracket — standard fold seeding', () => {
  beforeAll(async () => {
    await db.init();
  });

  afterAll(async () => {
    try {
      fs.unlinkSync(TEST_DB_PATH);
      fs.existsSync(TEST_DB_PATH + '-wal') && fs.unlinkSync(TEST_DB_PATH + '-wal');
      fs.existsSync(TEST_DB_PATH + '-shm') && fs.unlinkSync(TEST_DB_PATH + '-shm');
    } catch (_) { /* ignore */ }
  });

  test('N=4: round 1 pairs seed 1 vs seed 4, and seed 2 vs seed 3', async () => {
    const ids = await seedUsers(4);
    // Ratings descending so ids[0] is seed 1, ids[3] is seed 4.
    await setRatings(ids, [2000, 1800, 1600, 1400]);
    const tid = await makeTournamentWithPlayers(ids);
    await db.generateBracket(tid);

    const matches = await firstRoundMatches(tid);
    expect(matches).toHaveLength(2);
    // match 1: seed 1 (highest rating) vs seed 4 (lowest rating)
    expect(matches[0]).toMatchObject({ player1_id: ids[0], player2_id: ids[3] });
    // match 2: seed 2 vs seed 3
    expect(matches[1]).toMatchObject({ player1_id: ids[1], player2_id: ids[2] });
  });

  test('N=8: canonical fold order is (1,8) (4,5) (2,7) (3,6)', async () => {
    const ids = await seedUsers(8);
    await setRatings(ids, [2000, 1900, 1800, 1700, 1600, 1500, 1400, 1300]);
    const tid = await makeTournamentWithPlayers(ids);
    await db.generateBracket(tid);

    const matches = await firstRoundMatches(tid);
    expect(matches).toHaveLength(4);
    // Pairs in order: seeds (1,8) (4,5) (2,7) (3,6).
    expect(matches[0]).toMatchObject({ player1_id: ids[0], player2_id: ids[7] });
    expect(matches[1]).toMatchObject({ player1_id: ids[3], player2_id: ids[4] });
    expect(matches[2]).toMatchObject({ player1_id: ids[1], player2_id: ids[6] });
    expect(matches[3]).toMatchObject({ player1_id: ids[2], player2_id: ids[5] });
  });

  test('N=8: top two seeds are in opposite halves of the bracket', async () => {
    const ids = await seedUsers(8);
    await setRatings(ids, [2000, 1900, 1800, 1700, 1600, 1500, 1400, 1300]);
    const tid = await makeTournamentWithPlayers(ids);
    await db.generateBracket(tid);

    const matches = await firstRoundMatches(tid);
    // Seed 1 (ids[0]) is in match 1; seed 2 (ids[1]) is in match 3.
    // In an 8-bracket, matches 1+2 feed semifinal A and matches 3+4 feed
    // semifinal B, so seeds 1 and 2 cannot meet until the final.
    const seed1Match = matches.findIndex(m =>
      m.player1_id === ids[0] || m.player2_id === ids[0]
    );
    const seed2Match = matches.findIndex(m =>
      m.player1_id === ids[1] || m.player2_id === ids[1]
    );
    // Halves are matches {0,1} and matches {2,3}.
    const seed1Half = Math.floor(seed1Match / 2);
    const seed2Half = Math.floor(seed2Match / 2);
    expect(seed1Half).not.toBe(seed2Half);
  });

  test('N=8: top four seeds spread across all four quarters', async () => {
    const ids = await seedUsers(8);
    await setRatings(ids, [2000, 1900, 1800, 1700, 1600, 1500, 1400, 1300]);
    const tid = await makeTournamentWithPlayers(ids);
    await db.generateBracket(tid);

    const matches = await firstRoundMatches(tid);
    const findMatch = uid => matches.findIndex(m =>
      m.player1_id === uid || m.player2_id === uid
    );
    // Each of the top 4 seeds should be in a different match.
    const slots = [ids[0], ids[1], ids[2], ids[3]].map(findMatch);
    expect(new Set(slots).size).toBe(4);
  });
});
