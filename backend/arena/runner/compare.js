'use strict'

// Compares a returned value with the expected one.
// Modes: "exact" (deep equality), "float" (numbers within tolerance, deeply),
// "unordered" (top-level list compared as a multiset of deep-equal items).

function deepEqual(a, b, tolerance) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (tolerance > 0) return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b))
    return a === b
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i], tolerance))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).sort()
    const keysB = Object.keys(b).sort()
    if (!deepEqual(keysA, keysB, 0)) return false
    return keysA.every(key => deepEqual(a[key], b[key], tolerance))
  }
  return a === b
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function matches(actual, expected, compare = { mode: 'exact' }) {
  const mode = compare.mode || 'exact'
  if (mode === 'float') return deepEqual(actual, expected, compare.tolerance ?? 1e-6)
  if (mode === 'unordered') {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false
    if (actual.length !== expected.length) return false
    const a = actual.map(canonical).sort()
    const b = expected.map(canonical).sort()
    return a.every((item, i) => item === b[i])
  }
  return deepEqual(actual, expected, 0)
}

module.exports = { matches, deepEqual }
