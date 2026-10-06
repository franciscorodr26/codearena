function comboDamage(hits) {
  let total = 0, streak = 0
  for (const h of hits) {
    if (h === 0) { streak = 0; continue }
    streak++
    total += streak % 3 === 0 ? h * 2 : h
  }
  return total
}
