'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DIFFICULTIES = ['easy', 'medium', 'hard']
const COMPARE_MODES = ['exact', 'float', 'unordered']
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

function loadProblems(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
}

// Returns a list of human-readable problems with a problem file's shape.
function validateShape(problem, { requireExpected = true } = {}) {
  const errors = []
  const need = (cond, message) => { if (!cond) errors.push(message) }
  need(typeof problem.id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(problem.id), 'id must be kebab-case')
  need(typeof problem.title === 'string' && problem.title.trim(), 'title is required')
  need(DIFFICULTIES.includes(problem.difficulty), `difficulty must be one of ${DIFFICULTIES.join(', ')}`)
  need(Array.isArray(problem.tags), 'tags must be a list')
  need(typeof problem.description === 'string' && problem.description.length >= 40, 'description is too short')
  const fn = problem.function || {}
  need(IDENT.test(fn.name || ''), 'function.name must be a valid identifier')
  need(IDENT.test(fn.pythonName || ''), 'function.pythonName must be a valid identifier')
  need(Array.isArray(fn.params) && fn.params.every(p => IDENT.test(p.name || '') && typeof p.type === 'string'), 'function.params must be [{name, type}]')
  need(COMPARE_MODES.includes((problem.compare || {}).mode), `compare.mode must be one of ${COMPARE_MODES.join(', ')}`)
  need(Array.isArray(problem.examples) && problem.examples.length >= 1, 'at least one example is required')
  need(Array.isArray(problem.tests) && problem.tests.length >= 3, 'at least three tests are required')
  const arity = (fn.params || []).length
  for (const [label, list] of [['example', problem.examples || []], ['test', problem.tests || []]]) {
    list.forEach((t, i) => {
      need(Array.isArray(t.args) && t.args.length === arity, `${label} ${i} must have ${arity} args`)
      if (requireExpected) need('expected' in t, `${label} ${i} is missing expected`)
    })
  }
  return errors
}

module.exports = { loadProblems, validateShape }
