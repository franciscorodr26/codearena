function fewestTokens(tokens, amount) {
  const best = new Array(amount + 1).fill(Infinity)
  best[0] = 0
  for (let a = 1; a <= amount; a++) {
    for (const t of tokens) if (t <= a && best[a - t] + 1 < best[a]) best[a] = best[a - t] + 1
  }
  return best[amount] === Infinity ? -1 : best[amount]
}
