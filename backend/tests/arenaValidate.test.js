const validate = require('../services/validateSolution');
const { localExecutor, judge0Executor, executorFromEnv, describeRunner } = require('../arena/runner');
const problemsLoader = require('../problemsLoader');

const PY_OK = 'def longest_win_streak(results):\n    return max([len(x) for x in results.split("L")] + [0])\n';
const JS_WRONG = 'function longestWinStreak() { return 1 }';

describe('validateSolution adapter over the arena runner', () => {
  beforeAll(() => validate.setExecutor(localExecutor()));

  test('a correct solution passes every row and rows carry legacy fields', async () => {
    const rows = await validate.validateSolution(PY_OK, [], 'python', 'win-streak');
    const problem = problemsLoader.getById('win-streak');
    expect(rows.length).toBe(problem.testCases.length);
    expect(validate.allTestsPassed(rows)).toBe(true);
    expect(rows[0]).toMatchObject({ input: '"WWLWWWL"', expected: '3', actual: '3', passed: true });
    expect(validate.executionWasUnavailable(rows)).toBe(false);
  });

  test('a wrong solution fails with actual values, not an outage', async () => {
    const rows = await validate.validateSolution(JS_WRONG, [], 'javascript', 'win-streak');
    expect(validate.allTestsPassed(rows)).toBe(false);
    expect(rows.some(r => r.passed === false && r.actual === '1')).toBe(true);
    expect(validate.executionWasUnavailable(rows)).toBe(false);
  });

  test('a syntax error is a compile error on every row', async () => {
    const rows = await validate.validateSolution('def longest_win_streak(:\n', [], 'python', 'win-streak');
    expect(rows.every(r => r.passed === false && r.isCompileError === true)).toBe(true);
  });

  test('an unknown problem or empty results can never pass', async () => {
    expect(await validate.validateSolution(PY_OK, [], 'python', 'does-not-exist')).toEqual([]);
    expect(validate.allTestsPassed([])).toBe(false);
  });

  test('a runner outage marks every row unavailable instead of failed', async () => {
    validate.setExecutor(judge0Executor({ url: 'http://judge0.invalid', fetcher: async () => { throw new Error('ECONNREFUSED'); } }));
    const rows = await validate.validateSolution(PY_OK, [], 'python', 'win-streak');
    expect(validate.executionWasUnavailable(rows)).toBe(true);
    expect(validate.allTestsPassed(rows)).toBe(false);
    validate.setExecutor(localExecutor());
  });

  test('custom input runs one call and reports the return value', async () => {
    const result = await validate.runSingleTest(PY_OK, 'python', 'win-streak', '"WWLW"');
    expect(result).toMatchObject({ success: true, output: '2', stderr: '' });
    const bad = await validate.runSingleTest(PY_OK, 'python', 'win-streak', 'not json');
    expect(bad).toMatchObject({ success: false, invalidInput: true });
    const arity = await validate.runSingleTest(PY_OK, 'python', 'win-streak', '"a", "b"');
    expect(arity.stderr).toMatch(/takes 1 argument/);
  });

  test('parseCustomArgs accepts arrays, comma lists and a pasted whole list', () => {
    expect(validate.parseCustomArgs('[1,2,3], 2', 2)).toEqual([[1, 2, 3], 2]);
    expect(validate.parseCustomArgs([[1, 2, 3], 2], 2)).toEqual([[1, 2, 3], 2]);
    expect(validate.parseCustomArgs('[[1,2,3], 2]', 2)).toEqual([[1, 2, 3], 2]);
    expect(validate.parseCustomArgs('"WWL"', 1)).toEqual(['WWL']);
    expect(validate.parseCustomArgs('nums = [1,2,3], target = 2', 2)).toEqual([[1, 2, 3], 2]);
    expect(validate.parseCustomArgs('results = "W=L"', 1)).toEqual(['W=L']);
    expect(() => validate.parseCustomArgs('', 1)).toThrow();
  });
});

describe('runner selection from the environment', () => {
  test('development falls back to the local runner and says so loudly', () => {
    expect(typeof executorFromEnv({ NODE_ENV: 'development' })).toBe('function');
    expect(describeRunner({ NODE_ENV: 'development' })).toMatch(/LOCAL fallback/);
    expect(describeRunner({ CODEARENA_RUNNER: 'local' })).toMatch(/CODEARENA_RUNNER=local/);
  });

  test('production refuses to start without a sandbox', () => {
    expect(() => executorFromEnv({ NODE_ENV: 'production' })).toThrow(/No code runner configured/);
    expect(() => executorFromEnv({ NODE_ENV: 'production', CODEARENA_RUNNER: 'local' })).toThrow(/not a sandbox/);
  });

  test('Judge0 settings are picked up from either variable', () => {
    expect(describeRunner({ JUDGE0_URL: 'http://localhost:2358' })).toBe('Code runner: Judge0 at http://localhost:2358');
    expect(describeRunner({ RAPIDAPI_KEY: 'k' })).toMatch(/judge0-ce\.p\.rapidapi\.com \(RapidAPI\)/);
  });
});
