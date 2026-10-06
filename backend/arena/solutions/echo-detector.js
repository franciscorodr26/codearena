function longestEcho(log) {
  const n = log.length
  const M1 = 1000000007, M2 = 998244353, B = 131
  const mulmod = (x, y, m) => Number((BigInt(x) * BigInt(y)) % BigInt(m))
  const h1 = [0], h2 = [0], p1 = [1], p2 = [1]
  for (let i = 0; i < n; i++) {
    const c = log.charCodeAt(i)
    h1.push((mulmod(h1[i], B, M1) + c) % M1)
    h2.push((mulmod(h2[i], B, M2) + c) % M2)
    p1.push(mulmod(p1[i], B, M1))
    p2.push(mulmod(p2[i], B, M2))
  }
  const part = (h, p, m, i, len) => ((h[i + len] - mulmod(h[i], p[len], m)) % m + m) % m
  // A block of length L repeating means one of length L - 1 does too, so binary search L.
  const repeats = len => {
    const seen = new Set()
    for (let i = 0; i + len <= n; i++) {
      const key = part(h1, p1, M1, i, len) + ',' + part(h2, p2, M2, i, len)
      if (seen.has(key)) return true
      seen.add(key)
    }
    return false
  }
  let lo = 0, hi = Math.max(0, n - 1)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (repeats(mid)) lo = mid; else hi = mid - 1
  }
  return lo
}
