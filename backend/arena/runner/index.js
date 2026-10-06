'use strict'

const { randomBytes } = require('node:crypto')
const { buildProgram, buildStdin, parseOutput, starterCode, LANGUAGES } = require('./harness')
const { matches } = require('./compare')
const { executorFromEnv, judge0Executor, localExecutor, describeRunner } = require('./executors')

const MAX_CODE_BYTES = 64 * 1024

// Runs a solution against a list of tests and grades each one.
// Returns { status, passed, total, cases, consoleOutput, error, timeMs }.
// status "unavailable" means the runner failed: callers must not score it.
async function runTests({ execute, problem, language, code, tests }) {
  if (!LANGUAGES[language]) return { status: 'invalid', error: `Unsupported language: ${language}`, passed: 0, total: tests.length, cases: [] }
  if (typeof code !== 'string' || !code.trim()) return { status: 'invalid', error: 'Write some code first', passed: 0, total: tests.length, cases: [] }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) return { status: 'invalid', error: 'Code is too long', passed: 0, total: tests.length, cases: [] }

  const nonce = randomBytes(12).toString('hex')
  const source = buildProgram({ language, code, problem, nonce })
  const run = await execute({ language, source, stdin: buildStdin(tests) })
  const { consoleOutput, results } = parseOutput(run.stdout, nonce)
  const base = { total: tests.length, consoleOutput: consoleOutput.slice(0, 4000), timeMs: run.timeMs }

  if (run.status === 'unavailable') return { ...base, status: 'unavailable', passed: 0, cases: [], error: 'Code runner is unavailable. This attempt was not counted.' }
  if (run.status === 'compile_error') return { ...base, status: 'compile_error', passed: 0, cases: [], error: trimError(run.stderr) }
  if (run.status === 'time_limit') return { ...base, status: 'time_limit', passed: 0, cases: [], error: 'Time limit exceeded' }
  if (!results || results.length !== tests.length) {
    return { ...base, status: 'runtime_error', passed: 0, cases: [], error: trimError(run.stderr) || 'Your program exited before finishing the tests' }
  }

  const cases = tests.map((test, i) => {
    const result = results[i]
    const passed = Boolean(result.ok) && matches(result.value, test.expected, problem.compare)
    return {
      passed,
      args: test.args,
      expected: test.expected,
      actual: result.ok ? result.value : null,
      error: result.ok ? null : result.error,
    }
  })
  const passed = cases.filter(c => c.passed).length
  return { ...base, status: passed === tests.length ? 'passed' : 'failed', passed, cases }
}

function trimError(text) {
  return String(text || '').split('\n').slice(-12).join('\n').slice(0, 2000)
}

// Strips grading data a player should not receive mid-battle.
function publicProblem(problem) {
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags,
    description: problem.description,
    examples: problem.examples,
    function: problem.function,
    starterCode: {
      javascript: starterCode(problem, 'javascript'),
      python: starterCode(problem, 'python'),
    },
    totalTests: problem.examples.length + problem.tests.length,
  }
}

module.exports = { runTests, publicProblem, executorFromEnv, judge0Executor, localExecutor, describeRunner, LANGUAGES }
