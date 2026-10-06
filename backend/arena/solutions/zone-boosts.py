def best_zone(n, boosts):
    starts = {}
    for a, b, v in boosts:
        starts.setdefault(a, 0)
        starts[a] += v
        starts.setdefault(b + 1, 0)
        starts[b + 1] -= v
    best = None
    at = 0
    run = 0
    for i in range(n):
        run += starts.get(i, 0)
        if best is None or run > best:
            best, at = run, i
    return [best, at]
