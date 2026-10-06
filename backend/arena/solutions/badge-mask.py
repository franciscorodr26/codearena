def badge_mask(earned):
    return sum(2 ** i for i in set(earned))
