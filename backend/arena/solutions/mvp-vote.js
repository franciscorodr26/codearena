function mvpVote(votes) {
  const counts = new Map()
  for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1)
  let best = null
  for (const [name, n] of counts) {
    if (best === null || n > counts.get(best) || (n === counts.get(best) && name < best)) best = name
  }
  return best
}
