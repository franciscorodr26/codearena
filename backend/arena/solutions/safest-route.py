from collections import deque
def safest_route(n, roads):
    adj = [[] for _ in range(n)]
    for a, b, w in roads:
        adj[a].append((b, w))
        adj[b].append((a, w))
    # SPFA (queue-based Bellman-Ford); all weights are non-negative
    INF = float("inf")
    dist = [INF] * n
    dist[0] = 0
    queue = deque([0])
    queued = [False] * n
    queued[0] = True
    while queue:
        v = queue.popleft()
        queued[v] = False
        for w, cost in adj[v]:
            if dist[v] + cost < dist[w]:
                dist[w] = dist[v] + cost
                if not queued[w]:
                    queued[w] = True
                    queue.append(w)
    return -1 if dist[n - 1] == INF else dist[n - 1]
