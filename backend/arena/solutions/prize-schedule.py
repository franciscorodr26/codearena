from functools import lru_cache
import bisect, sys
def max_prize(events):
    ev = sorted(events)
    starts = [e[0] for e in ev]
    n = len(ev)
    best = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        j = bisect.bisect_left(starts, ev[i][1])
        best[i] = max(best[i + 1], ev[i][2] + best[j])
    return best[0]
