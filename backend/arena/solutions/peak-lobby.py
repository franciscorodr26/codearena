def peak_lobby(sessions):
    if not sessions:
        return 0
    lo = min(a for a, _ in sessions)
    hi = max(b for _, b in sessions)
    diff = {}
    for a, b in sessions:
        diff[a] = diff.get(a, 0) + 1
        diff[b] = diff.get(b, 0) - 1
    best = now = 0
    for t in sorted(diff):
        now += diff[t]
        best = max(best, now)
    return best
