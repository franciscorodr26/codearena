from itertools import accumulate
def round_totals(points, queries):
    prefix = [0] + list(accumulate(points))
    return [prefix[b + 1] - prefix[a] for a, b in queries]
