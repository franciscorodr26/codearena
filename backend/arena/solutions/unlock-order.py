import heapq
def unlock_order(n, requires):
    need = [set() for _ in range(n)]
    unlocks = [[] for _ in range(n)]
    for a, b in requires:
        need[b].add(a)
        unlocks[a].append(b)
    ready = [v for v in range(n) if not need[v]]
    heapq.heapify(ready)
    order = []
    while ready:
        v = heapq.heappop(ready)
        order.append(v)
        for w in unlocks[v]:
            need[w].discard(v)
            if not need[w]:
                heapq.heappush(ready, w)
    return order if len(order) == n else []
