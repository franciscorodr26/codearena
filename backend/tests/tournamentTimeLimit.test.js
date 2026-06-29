/**
 * Regression test for Bug 8 — Tournament battles never time out.
 *
 * server.js previously created tournament battles with `timeLimit: 600000`,
 * while every other battle creation site uses `timeLimit: 600` (seconds).
 * The timer sweep at ~line 3596 treats `timeLimit` as SECONDS:
 *
 *     const elapsed = (Date.now() - battle.serverStartTime) / 1000;
 *     const timeRemaining = Math.max(0, battle.timeLimit - elapsed);
 *
 * So `600000` → ~166 hours, freezing the bracket for nearly a week if a
 * player stalled. This test locks in the fix at the source level by
 * extracting the tournament-battle creation block from server.js and
 * asserting `timeLimit === 600`, matching its siblings.
 *
 * The tournament-match-ready socket handler in server.js is not directly
 * exported / unit-testable without spinning up the full Express+Socket.io
 * stack, so we verify the literal in the source file. This also catches
 * accidental regressions where someone re-introduces ms by adding trailing
 * zeros (e.g. 60000, 600000).
 */

const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');

describe('Bug 8: tournament battle timeLimit is in seconds (not ms)', () => {
  let serverSource;

  beforeAll(() => {
    serverSource = fs.readFileSync(SERVER_PATH, 'utf8');
  });

  test('tournament battle creation uses timeLimit: 600 (seconds), matching siblings', () => {
    // Locate the tournament battle creation block — the one with
    // `isTournament: true`. Pull the surrounding context so we can inspect
    // its timeLimit literal.
    const idx = serverSource.indexOf('isTournament: true');
    expect(idx).toBeGreaterThan(-1);

    // Look at the 600 chars *before* the marker — that window contains the
    // battle object literal including its timeLimit.
    const window = serverSource.slice(Math.max(0, idx - 600), idx);

    // Must contain `timeLimit: 600` (no trailing zeros).
    expect(window).toMatch(/timeLimit:\s*600\b/);

    // Must NOT contain the buggy `timeLimit: 600000` (or other ms values
    // like 60000) within this block.
    expect(window).not.toMatch(/timeLimit:\s*600000\b/);
    expect(window).not.toMatch(/timeLimit:\s*60000\b/);
  });

  test('all battle creation sites in server.js use timeLimit in seconds (<= 3600)', () => {
    // Defense-in-depth: every literal `timeLimit: <number>` in server.js
    // should be a small seconds value, not a ms value. A 1-hour cap is
    // generous — real battles are 10 minutes (600).
    const literalRe = /timeLimit:\s*(\d+)\b/g;
    const offenders = [];
    let match;
    while ((match = literalRe.exec(serverSource)) !== null) {
      const value = parseInt(match[1], 10);
      if (value > 3600) {
        // Find the line number for a helpful failure message.
        const before = serverSource.slice(0, match.index);
        const line = before.split('\n').length;
        offenders.push({ line, value });
      }
    }

    expect(offenders).toEqual([]);
  });
});
