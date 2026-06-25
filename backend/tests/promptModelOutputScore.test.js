const { evaluateModelOutputTiered, runCheck } = require('../services/promptModelOutputScore')

describe('promptModelOutputScore', () => {
  const problem = {
    modelOutputScoring: {
      mode: 'tieredDeterministic',
      tiers: [
        {
          id: 'tier-a',
          scorePercent: 60,
          checks: [
            { id: 'len', type: 'minLength', min: 10 },
            { id: 'x', type: 'requireAny', needles: ['foo'], caseInsensitive: true }
          ]
        },
        {
          id: 'tier-b',
          scorePercent: 70,
          checks: [{ id: 'y', type: 'requireAny', needles: ['bar'], caseInsensitive: true }]
        }
      ]
    }
  }

  test('runCheck minLength', () => {
    expect(runCheck({ type: 'minLength', min: 5 }, '12345')).toBe(true)
    expect(runCheck({ type: 'minLength', min: 5 }, '1234')).toBe(false)
  })

  test('stops at first failed tier', () => {
    const r = evaluateModelOutputTiered(problem, 'foo foo foo foo foo')
    expect(r.scorePercent).toBe(60)
    expect(r.passedTierId).toBe('tier-a')
    expect(r.tierResults).toHaveLength(2)
    expect(r.tierResults[1].pass).toBe(false)
  })

  test('passes all tiers', () => {
    const r = evaluateModelOutputTiered(problem, 'foo ' + 'x'.repeat(12) + ' bar')
    expect(r.scorePercent).toBe(70)
    expect(r.passedTierId).toBe('tier-b')
  })
})
