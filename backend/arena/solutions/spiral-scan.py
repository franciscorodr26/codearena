def spiral_scan(grid):
    out = []
    g = [row[:] for row in grid]
    while g:
        out.extend(g.pop(0))
        g = [list(row) for row in zip(*g)][::-1]
    return out
