def best_squad(skill):
    n = len(skill)
    full = 1 << n
    best = [-1] * full  # mask = players already used; role = number of them
    best[0] = 0
    for mask in range(full):
        b = best[mask]
        if b < 0:
            continue
        role = bin(mask).count("1")
        if role == n:
            continue
        for p in range(n):
            if not (mask >> p) & 1:
                nxt = mask | (1 << p)
                v = b + skill[p][role]
                if v > best[nxt]:
                    best[nxt] = v
    return best[full - 1]
