'use strict';

// Grades player code with the arena runner and reports results in the row
// shape the battle, practice and bot paths already consume:
//   { input, expected, actual, passed, error?, stdout?, executionTime?,
//     executionUnavailable?, isCompileError?, timedOut? }
//
// A runner outage is reported with executionUnavailable on every row so the
// caller returns "retry" instead of scoring the attempt. allTestsPassed() is
// the only way to decide a win: an empty result is never a pass.

const { runTests, executorFromEnv } = require('../arena/runner');
const problemsLoader = require('../problemsLoader');

let executor = null;
function getExecutor() {
  if (!executor) executor = executorFromEnv();
  return executor;
}

// Tests only: swap the executor (for example localExecutor()).
function setExecutor(fn) {
  executor = fn;
}

function allTests(problem) {
  return [...(problem.examples || []), ...(problem.tests || [])];
}

function stringify(value) {
  return value === undefined ? '' : JSON.stringify(value);
}

function failedRows(problem, message, flags = {}) {
  return problem.testCases.map(row => ({
    input: row.input,
    expected: row.expected,
    actual: message,
    passed: false,
    error: message,
    ...flags
  }));
}

async function validateSolution(code, testCases, language, problemId) {
  const problem = problemsLoader.getById(problemId);
  if (!problem) return [];
  const tests = allTests(problem);
  if (!tests.length) return [];

  const result = await runTests({ execute: getExecutor(), problem, language, code, tests });

  if (result.status === 'unavailable') {
    return failedRows(problem, result.error || 'Execution temporarily unavailable', { executionUnavailable: true });
  }
  if (result.status === 'invalid') {
    return failedRows(problem, result.error || 'Invalid submission');
  }
  if (result.status === 'compile_error') {
    return failedRows(problem, result.error || 'Compilation Error', { isCompileError: true, executionTime: result.timeMs });
  }
  if (result.status === 'time_limit') {
    return failedRows(problem, 'Time Limit Exceeded', { timedOut: true, executionTime: result.timeMs });
  }
  if (result.status === 'runtime_error' || !result.cases.length) {
    return failedRows(problem, result.error || 'Runtime Error', { executionTime: result.timeMs });
  }

  return result.cases.map((testCase, i) => ({
    input: problem.testCases[i].input,
    expected: problem.testCases[i].expected,
    actual: testCase.error ? testCase.error : stringify(testCase.actual),
    passed: testCase.passed,
    error: testCase.error || undefined,
    executionTime: result.timeMs,
    // Console output is captured once for the whole run; show it on the first row.
    stdout: i === 0 && result.consoleOutput ? result.consoleOutput : undefined
  }));
}

// Custom input is the argument list as JSON text ("[1,2,3], 2" or a JSON array).
function parseCustomArgs(customInput, arity) {
  let args;
  if (Array.isArray(customInput)) {
    args = customInput;
  } else {
    // Allow the readable example form "nums = [1, 2], target = 3" as well.
    const text = String(customInput ?? '').trim().replace(/(^|,)\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*/g, '$1');
    if (!text) throw new Error('Enter the arguments to run with');
    try {
      args = JSON.parse(`[${text}]`);
    } catch {
      throw new Error('Arguments must be valid JSON values separated by commas, for example: [1, 2, 3], 2');
    }
    // A single array argument given as "[1,2,3]" for a one-parameter function
    // parses as [[1,2,3]], which is right. For a 2-parameter function the user
    // may have pasted the whole list "[[1,2],3]"; unwrap it in that case.
    if (args.length === 1 && Array.isArray(args[0]) && args[0].length === arity && arity > 1) args = args[0];
  }
  if (args.length !== arity) {
    throw new Error(`This function takes ${arity} argument${arity === 1 ? '' : 's'}, got ${args.length}`);
  }
  return args;
}

async function runSingleTest(code, language, problemId, customInput) {
  const problem = problemsLoader.getById(problemId);
  if (!problem) return { success: false, stdout: '', stderr: 'Problem not found', executionTime: 0 };

  let args;
  try {
    args = parseCustomArgs(customInput, problem.function.params.length);
  } catch (error) {
    return { success: false, stdout: '', stderr: error.message, executionTime: 0, invalidInput: true };
  }

  const result = await runTests({ execute: getExecutor(), problem, language, code, tests: [{ args, expected: undefined }] });
  const testCase = result.cases[0];
  const ran = Boolean(testCase) && !testCase.error;
  return {
    success: ran,
    output: ran ? stringify(testCase.actual) : '',
    stdout: result.consoleOutput || '',
    stderr: ran ? '' : (testCase && testCase.error) || result.error || '',
    executionTime: result.timeMs || 0,
    timedOut: result.status === 'time_limit',
    isCompileError: result.status === 'compile_error',
    executionUnavailable: result.status === 'unavailable'
  };
}

function allTestsPassed(results) {
  return Array.isArray(results) && results.length > 0 && results.every(r => r.passed);
}

function executionWasUnavailable(results) {
  return Array.isArray(results) && results.some(r => r && r.executionUnavailable);
}

module.exports = {
  validateSolution,
  runSingleTest,
  allTestsPassed,
  executionWasUnavailable,
  getLanguageRejection: problemsLoader.getLanguageRejection,
  parseCustomArgs,
  setExecutor
};
