def unpaired_player(ids):
    seen = set()
    for i in ids:
        seen ^= {i}
    return seen.pop()
