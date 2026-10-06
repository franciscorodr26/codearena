def standings(matches):
    wins = {}
    for a, b, w in matches:
        wins.setdefault(a, 0)
        wins.setdefault(b, 0)
        wins[w] += 1
    return [[n, c] for n, c in sorted(wins.items(), key=lambda e: (-e[1], e[0]))]
