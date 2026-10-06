function longestClimb(ratings) {
  const tails = []
  for (const x of ratings) {
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < x) lo = mid + 1; else hi = mid }
    tails[lo] = x
  }
  return tails.length
}
