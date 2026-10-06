import bisect
def count_by_prefix(handles, prefixes):
    ordered = sorted(handles)
    out = []
    for p in prefixes:
        lo = bisect.bisect_left(ordered, p)
        hi = bisect.bisect_left(ordered, p + "\U0010ffff")
        out.append(hi - lo)
    return out
