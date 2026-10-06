function settleLoot(changes) {
  const totals = new Map()
  for (const [item, n] of changes) totals.set(item, (totals.get(item) || 0) + n)
  return [...totals].filter(([, n]) => n > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1))
}
