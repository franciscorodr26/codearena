def shielded_run(grid):
    R, C = len(grid), len(grid[0])
    NEG = float("-inf")
    # best[r][c][s]: best total reaching (r, c) having used the shield s times
    best = [[[NEG, NEG] for _ in range(C)] for _ in range(R)]
    for r in range(R):
        for c in range(C):
            v = grid[r][c]
            for s in (0, 1):
                if r == 0 and c == 0:
                    prev = 0 if s == 0 else NEG
                else:
                    up = best[r - 1][c][s] if r > 0 else NEG
                    left = best[r][c - 1][s] if c > 0 else NEG
                    prev = max(up, left)
                best[r][c][s] = max(best[r][c][s], prev + v)
            if v < 0:
                if r == 0 and c == 0:
                    best[r][c][1] = max(best[r][c][1], 0)
                else:
                    up = best[r - 1][c][0] if r > 0 else NEG
                    left = best[r][c - 1][0] if c > 0 else NEG
                    best[r][c][1] = max(best[r][c][1], max(up, left))
    return int(max(best[R - 1][C - 1]))
