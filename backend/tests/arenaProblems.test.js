const fs = require('fs');
const os = require('os');
const path = require('path');

describe('problemsLoader (open problem set)', () => {
  let loader;
  beforeEach(() => {
    jest.resetModules();
    delete process.env.CODEARENA_PRIVATE_PROBLEMS_DIR;
    loader = require('../problemsLoader');
    loader.clearCache();
  });

  test('loads the bundled set with capitalised difficulties and legacy test rows', () => {
    const all = loader.getAll();
    expect(all.length).toBeGreaterThanOrEqual(25);
    for (const p of all) {
      expect(['Easy', 'Medium', 'Hard']).toContain(p.difficulty);
      expect(p.testCases.length).toBe(p.examples.length + p.tests.length);
      expect(p.visibleCount).toBe(p.examples.length);
      expect(typeof p.testCases[0].input).toBe('string');
      expect(typeof p.testCases[0].expected).toBe('string');
    }
    expect(loader.loadByDifficulty('easy')).toEqual(loader.loadByDifficulty('Easy'));
    expect(loader.loadByDifficulty('nope')).toEqual([]);
  });

  test('public view carries starter code and languages but never hidden tests', () => {
    const problem = loader.getById('win-streak');
    const view = loader.getVisibleProblem(problem);
    expect(view.testCases.length).toBe(problem.examples.length);
    expect(view.hiddenTestCases).toBe(problem.tests.length);
    expect(view.totalTests).toBe(problem.testCases.length);
    expect(view.tests).toBeUndefined();
    expect(view.compare).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('"args"');
    expect(view.runnableLanguages).toEqual(['javascript', 'python', 'typescript']);
    expect(view.starterCode.javascript).toContain('function longestWinStreak(results)');
    expect(view.starterCode.python).toContain('def longest_win_streak(results)');
    expect(view.starterCode.typescript).toContain('results: string');
    expect(view.examples[0]).toEqual({ input: 'results = "WWLWWWL"', output: '3' });
    expect(view.testCases[0]).toEqual({ input: '"WWLWWWL"', expected: '3' });
    expect(loader.getByIdForFrontend('win-streak')).toEqual(view);
    expect(loader.getByIdForFrontend('missing')).toBeNull();
  });

  test('battle history titles: known ids use the title, retired ids read as words', () => {
    expect(loader.displayTitle('win-streak')).toBe('Win Streak');
    expect(loader.displayTitle('two-sum')).toBe('Two Sum');
    expect(loader.displayTitle('longest-common-subsequence')).toBe('Longest Common Subsequence');
    expect(loader.displayTitle('')).toBe('Unknown problem');
  });

  test('language rejection only for languages the runner does not have', () => {
    const problem = loader.getById('win-streak');
    expect(loader.getLanguageRejection(problem, 'python')).toBeNull();
    expect(loader.getLanguageRejection(problem, 'cobol')).toMatchObject({ languageRestricted: true });
  });

  test('a private problem directory is loaded alongside the bundled set and bots find its solutions', () => {
    const bundledCount = loader.count();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codearena-private-'));
    fs.mkdirSync(path.join(root, 'problems'));
    fs.mkdirSync(path.join(root, 'solutions'));
    const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'arena', 'problems', 'win-streak.json'), 'utf8'));
    fs.writeFileSync(path.join(root, 'problems', 'private-one.json'), JSON.stringify({ ...bundled, id: 'private-one', title: 'Private One' }));
    fs.writeFileSync(path.join(root, 'solutions', 'private-one.py'), 'def longest_win_streak(r):\n    return 0\n');
    process.env.CODEARENA_PRIVATE_PROBLEMS_DIR = root;
    jest.resetModules();
    const fresh = require('../problemsLoader');
    expect(fresh.count()).toBe(bundledCount + 1);
    expect(fresh.getById('private-one').title).toBe('Private One');
    const botService = require('../services/botService');
    expect(botService.getBotSolution('private-one', 'python')).toContain('return 0');
    expect(botService.getBotSolution('win-streak', 'typescript')).toContain('longestWinStreak');
    expect(botService.getBotSolution('../etc/passwd', 'python')).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('duplicate ids across sets fail loudly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codearena-private-'));
    fs.mkdirSync(path.join(root, 'problems'));
    fs.copyFileSync(path.join(__dirname, '..', 'arena', 'problems', 'win-streak.json'), path.join(root, 'problems', 'win-streak.json'));
    process.env.CODEARENA_PRIVATE_PROBLEMS_DIR = root;
    jest.resetModules();
    expect(() => require('../problemsLoader').getAll()).toThrow(/duplicate problem id/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
