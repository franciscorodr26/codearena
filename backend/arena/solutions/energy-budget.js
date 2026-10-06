function longestAffordableRun(costs, budget) {
  let best = 0, sum = 0, left = 0
  for (let right = 0; right < costs.length; right++) {
    sum += costs[right]
    while (sum > budget) sum -= costs[left++]
    best = Math.max(best, right - left + 1)
  }
  return best
}
