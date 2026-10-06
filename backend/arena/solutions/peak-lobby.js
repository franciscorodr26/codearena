function peakLobby(sessions) {
  const events = []
  for (const [a, b] of sessions) { events.push([a, 1]); events.push([b, -1]) }
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let now = 0, best = 0
  for (const [, delta] of events) { now += delta; if (now > best) best = now }
  return best
}
