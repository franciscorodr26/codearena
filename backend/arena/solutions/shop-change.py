from collections import deque
def fewest_tokens(tokens, amount):
    dist = {0: 0}
    q = deque([0])
    while q:
        x = q.popleft()
        if x == amount:
            return dist[x]
        for t in tokens:
            y = x + t
            if y <= amount and y not in dist:
                dist[y] = dist[x] + 1
                q.append(y)
    return -1
