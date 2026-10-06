function standings(matches) {
  const wins = new Map()
  for (const [a, b, w] of matches) {
    if (!wins.has(a)) wins.set(a, 0)
    if (!wins.has(b)) wins.set(b, 0)
    wins.set(w, wins.get(w) + 1)
  }
  return [...wins].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
}
