export function normalizeRating(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 1000
}

export function rankProgress(rating, minimum, nextMinimum) {
  if (nextMinimum == null) return 100
  if (nextMinimum <= minimum) return 0
  return Math.max(0, Math.min(100, ((normalizeRating(rating) - minimum) / (nextMinimum - minimum)) * 100))
}
