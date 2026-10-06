def min_team_gap(ratings):
    total = sum(ratings)
    reach = 1
    for r in ratings:
        reach |= reach << r
    best = total
    s = 0
    while reach:
        if reach & 1:
            best = min(best, abs(total - 2 * s))
        reach >>= 1
        s += 1
    return best
