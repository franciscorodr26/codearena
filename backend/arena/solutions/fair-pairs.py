def max_fair_pairs(ratings, k):
    r = sorted(ratings)
    pairs = i = 0
    while i + 1 < len(r):
        if r[i + 1] - r[i] <= k:
            pairs += 1
            i += 2
        else:
            i += 1
    return pairs
