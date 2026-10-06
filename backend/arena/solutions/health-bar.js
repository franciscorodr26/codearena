function finalHealth(start, max, events) {
  let hp = start
  for (const e of events) {
    if (hp === 0) break
    hp = Math.min(max, Math.max(0, hp + e))
  }
  return hp
}
