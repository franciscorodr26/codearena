def merge_sessions(sessions):
    if not sessions:
        return []
    events = sorted(sessions)
    out = []
    start, end = events[0]
    for s, e in events[1:]:
        if s > end:
            out.append([start, end])
            start, end = s, e
        elif e > end:
            end = e
    out.append([start, end])
    return out
