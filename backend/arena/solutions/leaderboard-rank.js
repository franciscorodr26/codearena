function denseRank(scores, score) {
  const higher = new Set(scores.filter(s => s > score))
  return higher.size + 1
}
