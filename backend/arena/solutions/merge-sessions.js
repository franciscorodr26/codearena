function mergeSessions(sessions) {
  const sorted = sessions.map(s => [s[0], s[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}
