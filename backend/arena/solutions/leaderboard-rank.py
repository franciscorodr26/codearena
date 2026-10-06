def dense_rank(scores, score):
    return len({s for s in scores if s > score}) + 1
