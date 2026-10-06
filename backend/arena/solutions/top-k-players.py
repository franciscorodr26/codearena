def top_players(entries, k):
    return [name for name, _ in sorted(entries, key=lambda e: (-e[1], e[0]))[:k]]
