import { normalizeRating, rankProgress } from '../utils/dashboardRating'

test('zero rating stays zero instead of showing the starting rating', () => {
  expect(normalizeRating(0)).toBe(0)
  expect(rankProgress(0, 0, 1200)).toBe(0)
})

test.each([undefined, null, NaN, Infinity])('missing or invalid rating %s has a finite starting value', value => {
  expect(normalizeRating(value)).toBe(1000)
  expect(rankProgress(value, 0, 1200)).toBeCloseTo(83.3333)
})

test('tier progress uses the same minimum and target as its labels', () => {
  expect(rankProgress(1000, 0, 1200)).toBeCloseTo(83.3333)
  expect(rankProgress(1200, 1200, 1400)).toBe(0)
  expect(rankProgress(1300, 1200, 1400)).toBe(50)
  expect(rankProgress(1399, 1200, 1400)).toBe(99.5)
})

test('progress stays bounded and the highest tier has no remaining target', () => {
  expect(rankProgress(-100, 0, 1200)).toBe(0)
  expect(rankProgress(1600, 1200, 1400)).toBe(100)
  expect(rankProgress(2400, 2200, undefined)).toBe(100)
  expect(rankProgress(1000, 1200, 1200)).toBe(0)
})
