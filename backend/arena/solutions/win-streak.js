function longestWinStreak(results) {
  let best = 0, run = 0
  for (const c of results) { run = c === 'W' ? run + 1 : 0; if (run > best) best = run }
  return best
}
