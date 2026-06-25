/**
 * Tiered deterministic scoring for assistant/model output (prompt-engineering battles).
 * `modelOutputScoring.tiers` is ordered; score = highest `scorePercent` where ALL checks
 * in tier 1 through k pass. Stops at first failed tier.
 */

function runCheck(c, text) {
  const t = typeof text === 'string' ? text : ''

  if (c.type === 'minLength') {
    const min = c.min ?? 0
    return t.length >= min
  }
  if (c.type === 'maxLength') {
    const max = c.max ?? Infinity
    return t.length <= max
  }
  if (c.type === 'requireAny') {
    const hay = c.caseInsensitive ? t.toLowerCase() : t
    const needles = (c.needles || []).map((n) => (c.caseInsensitive ? String(n).toLowerCase() : String(n)))
    return needles.some((n) => hay.includes(n))
  }
  if (c.type === 'requireAll') {
    const hay = c.caseInsensitive ? t.toLowerCase() : t
    const needles = (c.needles || []).map((n) => (c.caseInsensitive ? String(n).toLowerCase() : String(n)))
    return needles.length > 0 && needles.every((n) => hay.includes(n))
  }
  if (c.type === 'requireMinCount') {
    const hay = c.caseInsensitive ? t.toLowerCase() : t
    const needles = (c.needles || []).map((n) => (c.caseInsensitive ? String(n).toLowerCase() : String(n)))
    const hits = needles.filter((n) => hay.includes(n)).length
    return hits >= (c.min ?? 1)
  }
  return false
}

function checkDetail(c, text) {
  const pass = runCheck(c, text)
  const base = { id: c.id, type: c.type, pass }
  if (c.type === 'minLength') return { ...base, detail: `${(text || '').length}/${c.min}` }
  if (c.type === 'requireMinCount') {
    const hay = c.caseInsensitive ? String(text).toLowerCase() : String(text)
    const needles = (c.needles || []).map((n) => (c.caseInsensitive ? String(n).toLowerCase() : String(n)))
    const hits = needles.filter((n) => hay.includes(n)).length
    return { ...base, detail: `${hits}/${c.min} needles` }
  }
  return base
}

/**
 * @param {object} problem - Entry from prompt-engineering.json (must include modelOutputScoring)
 * @param {string} modelOutputText - Final assistant message(s) concatenated or single reply
 * @returns {{ scorePercent: number, maxScorePercent: number, passedTierId: string|null, tierResults: object[] }}
 */
function evaluateModelOutputTiered(problem, modelOutputText) {
  const mos = problem?.modelOutputScoring
  if (!mos || mos.mode !== 'tieredDeterministic' || !Array.isArray(mos.tiers)) {
    return {
      scorePercent: 0,
      maxScorePercent: 100,
      passedTierId: null,
      tierResults: [],
      detail: 'Missing modelOutputScoring.tieredDeterministic'
    }
  }

  const text = typeof modelOutputText === 'string' ? modelOutputText : ''
  const tierResults = []
  let scorePercent = 0
  let passedTierId = null

  for (const tier of mos.tiers) {
    const checks = tier.checks || []
    const checkResults = checks.map((c) => checkDetail(c, text))
    const tierPass = checks.length > 0 && checkResults.every((r) => r.pass)

    tierResults.push({
      tierId: tier.id,
      label: tier.label,
      scorePercent: tier.scorePercent,
      pass: tierPass,
      checks: checkResults
    })

    if (!tierPass) break
    scorePercent = tier.scorePercent
    passedTierId = tier.id
  }

  return {
    scorePercent,
    maxScorePercent: 100,
    passedTierId,
    tierResults,
    detail: `scorePercent=${scorePercent} (highest tier fully passed)`
  }
}

module.exports = {
  runCheck,
  evaluateModelOutputTiered
}
