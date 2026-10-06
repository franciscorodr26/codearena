def settle_loot(changes):
    totals = {}
    for item, n in changes:
        totals[item] = totals.get(item, 0) + n
    return [[item, n] for item, n in sorted(totals.items()) if n > 0]
