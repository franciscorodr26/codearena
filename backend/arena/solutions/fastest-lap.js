function fastestLap(laps) {
  let best = 0
  for (let i = 1; i < laps.length; i++) if (laps[i] < laps[best]) best = i
  return best
}
