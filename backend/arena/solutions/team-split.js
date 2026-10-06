function minTeamGap(ratings) {
  const total = ratings.reduce((s, r) => s + r, 0)
  const half = Math.floor(total / 2)
  const can = new Uint8Array(half + 1)
  can[0] = 1
  for (const r of ratings) for (let s = half; s >= r; s--) if (can[s - r]) can[s] = 1
  for (let s = half; s >= 0; s--) if (can[s]) return total - 2 * s
  return total
}
