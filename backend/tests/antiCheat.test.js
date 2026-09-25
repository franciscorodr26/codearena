const { canonicalize, fingerprint, analyzeSubmission, generateViolationExplanation } = require('../services/antiCheat');

const SOLUTION = `function longestWinStreak(results) {
  // count the current run
  let best = 0, run = 0
  for (const c of results) { run = c === 'W' ? run + 1 : 0; if (run > best) best = run }
  return best
}`;

describe('open-edition battle integrity check', () => {
  test('reformatting and comments do not change the fingerprint', () => {
    const reformatted = SOLUTION.replace(/\n/g, '\n\n').replace('// count the current run', '/* mine */');
    expect(fingerprint(reformatted, 'javascript')).toBe(fingerprint(SOLUTION, 'javascript'));
    expect(canonicalize("x = 'a b'  # note", 'python')).toBe('x=""');
  });

  test('a real change produces a different fingerprint', () => {
    expect(fingerprint(SOLUTION.replace('best = 0', 'best = -1'), 'javascript')).not.toBe(fingerprint(SOLUTION, 'javascript'));
  });

  test('an exact copy of an earlier winning solution is flagged for review', () => {
    const stored = [{ fingerprint: fingerprint(SOLUTION, 'javascript'), battleId: 'b1' }];
    const result = analyzeSubmission({ code: SOLUTION, language: 'javascript', storedFingerprints: stored });
    expect(result.recommendation).toBe('flag');
    expect(result.violations[0]).toMatchObject({ type: 'exact_match', severity: 'critical' });
    expect(generateViolationExplanation(result.violations).appealable).toBe(true);
  });

  test('original code, and code too short to judge, is clean', () => {
    expect(analyzeSubmission({ code: SOLUTION, language: 'javascript', storedFingerprints: [] })).toMatchObject({ recommendation: 'clean', violations: [] });
    const short = analyzeSubmission({ code: 'return 1', language: 'javascript', storedFingerprints: [{ fingerprint: null }] });
    expect(short).toMatchObject({ recommendation: 'clean', fingerprint: null });
    expect(generateViolationExplanation([])).toBeNull();
  });

  test('typing, paste and timing data never produce a violation', () => {
    const result = analyzeSubmission({
      code: SOLUTION, language: 'javascript', storedFingerprints: [],
      keystrokeData: { keystrokes: 1, codeLength: 5000, activeTypingTime: 1, pastes: 9 }, solveTime: 2
    });
    expect(result.violations).toEqual([]);
  });
});
