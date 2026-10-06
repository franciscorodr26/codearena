def min_upload_rate(sizes, hours):
    def hours_needed(r):
        return sum(-(-s // r) for s in sizes)
    # exponential search for an upper bound, then bisect
    hi = 1
    while hours_needed(hi) > hours:
        hi *= 2
    lo = hi // 2 + 1 if hi > 1 else 1
    while lo < hi:
        mid = (lo + hi) // 2
        if hours_needed(mid) <= hours:
            hi = mid
        else:
            lo = mid + 1
    return lo
