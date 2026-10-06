from collections import deque
def rejected_messages(times, limit, window):
    q = deque()
    out = []
    for i, t in enumerate(times):
        while q and q[0] <= t - window:
            q.popleft()
        if len(q) < limit:
            q.append(t)
        else:
            out.append(i)
    return out
