def final_health(start, max_hp, events):
    hp = start
    for e in events:
        if hp == 0:
            break
        hp = min(max_hp, max(0, hp + e))
    return hp
