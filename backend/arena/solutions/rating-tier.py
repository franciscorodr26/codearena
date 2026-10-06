def rating_tiers(ratings):
    out = []
    for r in ratings:
        if r < 1000: out.append("Bronze")
        elif r < 1400: out.append("Silver")
        elif r < 1800: out.append("Gold")
        elif r < 2200: out.append("Platinum")
        else: out.append("Diamond")
    return out
