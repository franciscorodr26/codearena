function roundTotals(points, queries) {
  const prefix = [0]
  for (const p of points) prefix.push(prefix[prefix.length - 1] + p)
  return queries.map(([a, b]) => prefix[b + 1] - prefix[a])
}
