function bestZone(n, boosts) {
  const diff = new Array(n + 1).fill(0)
  for (const [a, b, v] of boosts) { diff[a] += v; diff[b + 1] -= v }
  let run = 0, best = -Infinity, at = 0
  for (let i = 0; i < n; i++) {
    run += diff[i]
    if (run > best) { best = run; at = i }
  }
  return [best, at]
}
