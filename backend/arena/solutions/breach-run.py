import heapq
def breach_run(grid, charges):
    R, C = len(grid), len(grid[0])
    # Dijkstra on (steps, charges used); keep the best charges-used per cell per step bound.
    best = {}
    heap = [(0, 0, 0, 0)]
    while heap:
        steps, used, r, c = heapq.heappop(heap)
        if (r, c) == (R - 1, C - 1):
            return steps
        if best.get((r, c, used), 1 << 30) < steps:
            continue
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C:
                nu = used + (grid[nr][nc] == "#")
                if nu > charges:
                    continue
                if steps + 1 < best.get((nr, nc, nu), 1 << 30):
                    best[(nr, nc, nu)] = steps + 1
                    heapq.heappush(heap, (steps + 1, nu, nr, nc))
    return -1
