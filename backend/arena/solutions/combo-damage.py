def combo_damage(hits):
    total = streak = 0
    for h in hits:
        if h == 0:
            streak = 0
            continue
        streak += 1
        total += h * 2 if streak % 3 == 0 else h
    return total
