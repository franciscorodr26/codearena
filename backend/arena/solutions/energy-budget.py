def longest_affordable_run(costs, budget):
    best = total = left = 0
    for right, c in enumerate(costs):
        total += c
        while total > budget:
            total -= costs[left]
            left += 1
        best = max(best, right - left + 1)
    return best
