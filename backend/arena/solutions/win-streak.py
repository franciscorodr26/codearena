def longest_win_streak(results):
    best = run = 0
    for c in results:
        run = run + 1 if c == "W" else 0
        best = max(best, run)
    return best
