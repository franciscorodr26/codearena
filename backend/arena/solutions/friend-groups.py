def count_friend_groups(n, friendships):
    adj = [[] for _ in range(n)]
    for a, b in friendships:
        adj[a].append(b)
        adj[b].append(a)
    seen = [False] * n
    groups = 0
    for s in range(n):
        if seen[s]:
            continue
        groups += 1
        seen[s] = True
        stack = [s]
        while stack:
            x = stack.pop()
            for y in adj[x]:
                if not seen[y]:
                    seen[y] = True
                    stack.append(y)
    return groups
