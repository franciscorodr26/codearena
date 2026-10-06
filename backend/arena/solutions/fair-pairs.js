function maxFairPairs(ratings, k) {
  const r = [...ratings].sort((a, b) => a - b)
  let pairs = 0
  for (let i = 0; i + 1 < r.length;) {
    if (r[i + 1] - r[i] <= k) { pairs++; i += 2 } else i++
  }
  return pairs
}
