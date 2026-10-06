def count_islands(map):
    R = len(map)
    C = len(map[0]) if R else 0
    parent = {}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    for r in range(R):
        for c in range(C):
            if map[r][c] == "#":
                parent[(r, c)] = (r, c)
    for r in range(R):
        for c in range(C):
            if map[r][c] != "#":
                continue
            if r + 1 < R and map[r + 1][c] == "#":
                union((r, c), (r + 1, c))
            if c + 1 < C and map[r][c + 1] == "#":
                union((r, c), (r, c + 1))
    return len({find(x) for x in parent})
