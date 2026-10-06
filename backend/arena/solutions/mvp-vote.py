def mvp_vote(votes):
    counts = {}
    for v in votes:
        counts[v] = counts.get(v, 0) + 1
    return min(counts, key=lambda name: (-counts[name], name))
