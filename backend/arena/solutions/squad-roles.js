function bestSquad(skill) {
  const n = skill.length
  const full = 1 << n
  const best = new Array(full).fill(-1)
  best[0] = 0
  for (let mask = 0; mask < full; mask++) {
    if (best[mask] < 0) continue
    let p = 0
    for (let m = mask; m; m &= m - 1) p++ // players already placed
    if (p === n) continue
    for (let r = 0; r < n; r++) {
      if (mask & (1 << r)) continue
      const next = mask | (1 << r)
      const value = best[mask] + skill[p][r]
      if (value > best[next]) best[next] = value
    }
  }
  return best[full - 1]
}
