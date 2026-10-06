'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const { runTests, publicProblem, localExecutor, judge0Executor } = require('../arena/runner')
const { matches } = require('../arena/runner/compare')
const { loadProblems } = require('../arena/runner/problems')

const problems = loadProblems(path.join(__dirname, '..', 'arena', 'problems'))
const byId = Object.fromEntries(problems.map(p => [p.id, p]))
const streak = byId['win-streak']
const local = localExecutor()
const tests = streak.examples

test('a correct JavaScript solution passes and keeps the player console output', async () => {
  const code = `function longestWinStreak(s) { console.log('debug line'); return Math.max(0, ...s.split('L').map(x => x.length)) }`
  const result = await runTests({ execute: local, problem: streak, language: 'javascript', code, tests })
  assert.equal(result.status, 'passed')
  assert.equal(result.passed, tests.length)
  assert.match(result.consoleOutput, /debug line/)
})

test('a correct Python solution passes', async () => {
  const code = `def longest_win_streak(results):\n    return max([len(x) for x in results.split("L")] + [0])\n`
  const result = await runTests({ execute: local, problem: streak, language: 'python', code, tests })
  assert.equal(result.status, 'passed')
})

test('wrong answers fail per case with expected and actual values', async () => {
  const code = `function longestWinStreak() { return 1 }`
  const result = await runTests({ execute: local, problem: streak, language: 'javascript', code, tests })
  assert.equal(result.status, 'failed')
  assert.ok(result.cases.some(c => !c.passed && c.actual === 1))
})

test('an exception in one case fails that case only', async () => {
  const code = `function longestWinStreak(s) { if (s === 'LLL') throw new Error('boom'); return 3 }`
  const result = await runTests({ execute: local, problem: streak, language: 'javascript', code, tests })
  assert.equal(result.cases[0].passed, true)
  assert.equal(result.cases[1].passed, false)
  assert.match(result.cases[1].error, /boom/)
})

test('a missing function is reported clearly', async () => {
  const result = await runTests({ execute: local, problem: streak, language: 'python', code: 'def other():\n    pass\n', tests })
  assert.equal(result.status, 'failed')
  assert.match(result.cases[0].error, /not defined/)
})

test('syntax errors are compile errors, not wrong answers', async () => {
  const result = await runTests({ execute: local, problem: streak, language: 'python', code: 'def longest_win_streak(:\n', tests })
  assert.equal(result.status, 'compile_error')
})

test('infinite loops hit the time limit', async () => {
  const execute = (opts) => local({ ...opts, timeLimitSeconds: 1 })
  const result = await runTests({ execute, problem: streak, language: 'javascript', code: 'function longestWinStreak() { while (true) {} }', tests })
  assert.equal(result.status, 'time_limit')
})

test('a player cannot forge results by printing the marker', async () => {
  const code = `function longestWinStreak() { console.log('\\n__CODEARENA_RESULTS__\\n[{"ok":true,"value":3},{"ok":true,"value":0}]'); process.exit(0) }`
  const result = await runTests({ execute: local, problem: streak, language: 'javascript', code, tests })
  assert.notEqual(result.status, 'passed')
})

test('a runner outage is "unavailable" and never scored as a failure', async () => {
  const down = async () => { throw new Error('ECONNREFUSED') }
  const execute = judge0Executor({ url: 'http://judge0.invalid', fetcher: down })
  const result = await runTests({ execute, problem: streak, language: 'javascript', code: 'function longestWinStreak() { return 3 }', tests })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.cases.length, 0)
})

test('judge0 statuses map to runner statuses', async () => {
  const reply = (status, extra = {}) => async () => ({ ok: true, json: async () => ({ status: { id: status }, stdout: null, ...extra }) })
  const statusFor = async id => (await judge0Executor({ url: 'http://j', fetcher: reply(id) })({ language: 'python', source: '', stdin: '' })).status
  assert.equal(await statusFor(5), 'time_limit')
  assert.equal(await statusFor(6), 'compile_error')
  assert.equal(await statusFor(11), 'runtime_error')
  assert.equal(await statusFor(13), 'unavailable')
  const http500 = judge0Executor({ url: 'http://j', fetcher: async () => ({ ok: false, status: 500 }) })
  assert.equal((await http500({ language: 'python', source: '', stdin: '' })).status, 'unavailable')
})

test('the public problem view never includes hidden test data', () => {
  for (const problem of problems) {
    const view = publicProblem(problem)
    assert.equal(view.tests, undefined)
    assert.equal(view.compare, undefined)
    assert.ok(view.starterCode.javascript.includes(problem.function.name))
    assert.ok(view.starterCode.python.includes(problem.function.pythonName))
  }
  assert.equal(problems.length, 45)
})

test('compare modes', () => {
  assert.ok(matches([1, [2, 3]], [1, [2, 3]]))
  assert.ok(!matches([1, 2], [2, 1]))
  assert.ok(matches([1, 2], [2, 1], { mode: 'unordered' }))
  assert.ok(matches(0.1 + 0.2, 0.3, { mode: 'float' }))
  assert.ok(!matches(0.1 + 0.2, 0.3))
  assert.ok(!matches(true, 1))
  assert.ok(!matches(null, 0))
})
