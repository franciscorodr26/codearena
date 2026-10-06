'use strict'

// Checks every problem in problems/ against its two reference solutions.
//   node scripts/validate-problems.js            validate
//   node scripts/validate-problems.js --fill     fill missing "expected" values
//                                                from the JavaScript reference first
// A problem is valid only when the JavaScript AND Python references both pass
// every example and test. The two references are written independently, so a
// mistake in one shows up as a disagreement.

const fs = require('node:fs')
const path = require('node:path')
const { runTests, localExecutor } = require('../runner')
const { loadProblems, validateShape } = require('../runner/problems')

const ROOT = path.join(__dirname, '..')
const fill = process.argv.includes('--fill')
const only = process.argv.slice(2).filter(a => !a.startsWith('--'))
const execute = localExecutor()

async function main() {
  const problems = loadProblems(path.join(ROOT, 'problems')).filter(p => !only.length || only.includes(p.id))
  if (!problems.length) throw new Error('No problems found')
  let failures = 0

  for (const problem of problems) {
    const shapeErrors = validateShape(problem, { requireExpected: !fill })
    if (shapeErrors.length) {
      failures++
      console.log(`FAIL ${problem.id}: ${shapeErrors.join('; ')}`)
      continue
    }
    const all = [...problem.examples, ...problem.tests]
    const js = fs.readFileSync(path.join(ROOT, 'solutions', `${problem.id}.js`), 'utf8')
    const py = fs.readFileSync(path.join(ROOT, 'solutions', `${problem.id}.py`), 'utf8')

    if (fill && all.some(t => !('expected' in t))) {
      const run = await runTests({ execute, problem, language: 'javascript', code: js, tests: all.map(t => ({ args: t.args, expected: null })) })
      if (!run.cases.length) throw new Error(`${problem.id}: JS reference did not run: ${run.error}`)
      all.forEach((t, i) => { if (!('expected' in t)) t.expected = run.cases[i].actual })
      const file = path.join(ROOT, 'problems', `${problem.id}.json`)
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      raw.examples = problem.examples
      raw.tests = problem.tests
      fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n')
    }

    const problemErrors = []
    for (const [language, code] of [['javascript', js], ['python', py]]) {
      const result = await runTests({ execute, problem, language, code, tests: all })
      if (result.status !== 'passed') {
        const firstBad = result.cases.findIndex(c => !c.passed)
        problemErrors.push(`${language} ${result.status} ${result.passed}/${result.total}` +
          (firstBad >= 0 ? ` (case ${firstBad}: got ${JSON.stringify(result.cases[firstBad].actual)?.slice(0, 80)} ${result.cases[firstBad].error || ''})` : ` ${result.error || ''}`))
      }
      const starter = await runTests({ execute, problem, language, code: require('../runner/harness').starterCode(problem, language), tests: problem.examples })
      if (!['failed', 'passed'].includes(starter.status)) problemErrors.push(`${language} starter code does not run: ${starter.status} ${starter.error || ''}`)
    }
    if (problemErrors.length) {
      failures++
      console.log(`FAIL ${problem.id}: ${problemErrors.join(' | ')}`)
    } else {
      console.log(`ok   ${problem.id} (${all.length} cases, both references agree)`)
    }
  }

  // Non-vacuity: prove this validator actually ran on the whole set.
  console.log(`\n${problems.length - failures}/${problems.length} problems valid`)
  if (failures || problems.length === 0) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
