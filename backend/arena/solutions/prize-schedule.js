function maxPrize(events) {
  const ev = [...events].sort((a, b) => a[1] - b[1])
  const ends = ev.map(e => e[1])
  const dp = new Array(ev.length + 1).fill(0)
  for (let i = 0; i < ev.length; i++) {
    let lo = 0, hi = i
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] <= ev[i][0]) lo = mid + 1; else hi = mid }
    dp[i + 1] = Math.max(dp[i], dp[lo] + ev[i][2])
  }
  return dp[ev.length]
}
