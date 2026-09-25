'use strict';

// Problem set for battles, practice and the weekly challenge.
//
// Problems come from the open set in arena/problems plus, optionally, a private
// set a hosted instance keeps out of git: CODEARENA_PRIVATE_PROBLEMS_DIR points
// at a directory laid out like arena/ (problems/*.json and solutions/*).
// Every problem file follows arena/docs/problems.md. Callers get the same
// surface the previous loader exposed (getAll, getById, loadByDifficulty,
// getVisibleProblem, ...) so the rest of the server does not care where the
// problems live.

const fs = require('fs');
const path = require('path');
const { loadProblems, validateShape } = require('./arena/runner/problems');
const { starterCode, LANGUAGES } = require('./arena/runner/harness');
const logger = require('./utils/logger');

const BUNDLED_DIR = path.join(__dirname, 'arena', 'problems');
const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const RUNNABLE_LANGUAGES = Object.freeze(Object.keys(LANGUAGES));

// Legacy constant: callers that still split results by a fixed count get the
// most common example count. Prefer visibleCount(problem).
const VISIBLE_TEST_CASES = 3;

let cache = null;

function normalizeDifficulty(value) {
  const key = String(value || '').trim().toLowerCase();
  return DIFFICULTY_LABEL[key] || null;
}

function titleCase(text) {
  return String(text || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

// "nums = [1, 2], target = 3": the readable form shown in examples.
function formatArgs(problem, args) {
  const params = problem.function.params;
  return args
    .map((arg, i) => `${params[i] ? params[i].name + ' = ' : ''}${JSON.stringify(arg)}`)
    .join(', ');
}

// "[1, 2], 3": the argument list as JSON text, which is also what the custom
// input box accepts, so the UI can prefill it from testCases[0].input.
function formatArgList(args) {
  return args.map(arg => JSON.stringify(arg)).join(', ');
}

function toLegacyCase(problem, testCase) {
  return {
    input: formatArgList(testCase.args),
    expected: JSON.stringify(testCase.expected),
    args: testCase.args,
    expectedValue: testCase.expected
  };
}

function prepare(raw) {
  const examples = raw.examples || [];
  const tests = raw.tests || [];
  return {
    ...raw,
    difficulty: DIFFICULTY_LABEL[raw.difficulty] || raw.difficulty,
    category: titleCase((raw.tags && raw.tags[0]) || 'General'),
    tags: raw.tags || [],
    constraints: raw.constraints || [],
    // Examples first, then the rest: result rows keep this order so the first
    // visibleCount rows are always the public examples.
    testCases: [...examples, ...tests].map(t => toLegacyCase(raw, t)),
    visibleCount: examples.length,
    runnableLanguages: RUNNABLE_LANGUAGES
  };
}

function problemDirs() {
  const dirs = [BUNDLED_DIR];
  const extra = process.env.CODEARENA_PRIVATE_PROBLEMS_DIR;
  if (extra) {
    const extraProblems = path.join(extra, 'problems');
    if (fs.existsSync(extraProblems)) dirs.push(extraProblems);
    else logger.warn(`[PROBLEMS] CODEARENA_PRIVATE_PROBLEMS_DIR has no problems/ directory: ${extra}`);
  }
  return dirs;
}

function load() {
  if (cache) return cache;
  const seen = new Set();
  const loaded = [];
  for (const dir of problemDirs()) {
    for (const raw of loadProblems(dir)) {
      const errors = validateShape(raw);
      if (errors.length) throw new Error(`[PROBLEMS] ${dir}/${raw.id}.json: ${errors.join('; ')}`);
      if (seen.has(raw.id)) throw new Error(`[PROBLEMS] duplicate problem id: ${raw.id}`);
      seen.add(raw.id);
      loaded.push(prepare(raw));
    }
  }
  if (loaded.length === 0) throw new Error('[PROBLEMS] no problems found');
  cache = loaded;
  return cache;
}

function getAll() {
  return load();
}

function loadByDifficulty(difficulty) {
  const label = normalizeDifficulty(difficulty);
  return label ? load().filter(p => p.difficulty === label) : [];
}

function getById(id) {
  if (id === undefined || id === null) return null;
  const key = String(id);
  return load().find(p => p.id === key) || null;
}

function getRandom(difficulty) {
  const pool = difficulty ? loadByDifficulty(difficulty) : load();
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getByCategory(category, difficulty) {
  const wanted = String(category || '').toLowerCase();
  const pool = difficulty ? loadByDifficulty(difficulty) : load();
  return pool.filter(p =>
    String(p.category).toLowerCase() === wanted ||
    p.tags.some(tag => String(tag).toLowerCase() === wanted)
  );
}

function count() {
  return load().length;
}

function clearCache() {
  cache = null;
}

function visibleCount(problem) {
  return problem && Number.isInteger(problem.visibleCount) ? problem.visibleCount : VISIBLE_TEST_CASES;
}

function getLanguages() {
  return RUNNABLE_LANGUAGES.map(id => ({ id, label: LANGUAGES[id].label }));
}

// What a player may see before and during an attempt. Hidden tests are never
// included; only their count.
function getVisibleProblem(problem) {
  if (!problem) return null;
  const visible = visibleCount(problem);
  const starter = {};
  for (const language of RUNNABLE_LANGUAGES) starter[language] = starterCode(problem, language);
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    category: problem.category,
    tags: problem.tags,
    description: problem.description,
    examples: (problem.examples || []).map(example => ({
      input: formatArgs(problem, example.args),
      output: JSON.stringify(example.expected)
    })),
    constraints: problem.constraints,
    testCases: problem.testCases.slice(0, visible).map(({ input, expected }) => ({ input, expected })),
    hiddenTestCases: Math.max(0, problem.testCases.length - visible),
    totalTests: problem.testCases.length,
    runnableLanguages: problem.runnableLanguages,
    starterCode: starter,
    function: problem.function
  };
}

function getByIdForFrontend(id) {
  return getVisibleProblem(getById(id));
}

function getLanguageRejection(problem, language) {
  if (!problem) return null;
  if (problem.runnableLanguages.includes(language)) return null;
  return {
    error: `${language} is not available for this problem`,
    languageRestricted: true,
    runnableLanguages: problem.runnableLanguages
  };
}

module.exports = {
  VISIBLE_TEST_CASES,
  RUNNABLE_LANGUAGES,
  getAll,
  loadByDifficulty,
  getById,
  getRandom,
  getByCategory,
  count,
  clearCache,
  visibleCount,
  getLanguages,
  getVisibleProblem,
  getByIdForFrontend,
  getLanguageRejection,
  normalizeDifficulty,
  formatArgs,
  formatArgList
};
