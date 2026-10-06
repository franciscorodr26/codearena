// GDPR export must read the columns that actually exist. Before this fix the
// battles and practice queries referenced columns from an older schema and
// the export threw at runtime for every user.
const db = require('../db');

describe('exportUserData', () => {
  test('exports battles and practice attempts for a user with history', async () => {
    const stamp = Date.now();
    const me = await db.createUser(`export-me-${stamp}@example.test`, 'hash', `exportme${stamp}`);
    const them = await db.createUser(`export-them-${stamp}@example.test`, 'hash', `exportthem${stamp}`);
    const myId = me.id || me.lastID || me;
    const theirId = them.id || them.lastID || them;

    await db.saveBattleResult({
      battleUuid: `export-${stamp}`,
      problemId: 'win-streak',
      winnerId: myId,
      loserId: theirId,
      winnerTime: 95,
      loserTime: 180,
      winnerLanguage: 'python',
      loserLanguage: 'javascript'
    });
    await db.recordPracticeAttempt(myId, { problemId: 'fair-pairs', language: 'python', solved: true, solveTime: 120, solutionCode: 'x' });

    const data = await db.exportUserData(myId);

    expect(data).toBeTruthy();
    const battles = data.battles || data.battleHistory || data.battles_history;
    expect(Array.isArray(battles)).toBe(true);
    expect(battles.length).toBeGreaterThanOrEqual(1);
    expect(battles[0]).toMatchObject({ problem_id: 'win-streak', result: 'won', opponent_id: theirId, language: 'python' });
    const practice = data.practiceAttempts || data.practice_attempts || data.practice;
    expect(Array.isArray(practice)).toBe(true);
    expect(practice[0]).toMatchObject({ problem_id: 'fair-pairs', solved: 1, language: 'python' });

    const theirs = await db.exportUserData(theirId);
    const theirBattles = theirs.battles || theirs.battleHistory || theirs.battles_history;
    expect(theirBattles[0]).toMatchObject({ problem_id: 'win-streak', result: 'lost', opponent_id: myId, language: 'javascript' });
  });
});
