def longest_echo(log):
    n = len(log)
    # longest common prefix of two suffixes, computed for every pair (i < j)
    best = 0
    prev = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        cur = [0] * (n + 1)
        ci = log[i]
        for j in range(n - 1, i, -1):
            if ci == log[j]:
                v = prev[j + 1] + 1
                cur[j] = v
                if v > best:
                    best = v
        prev = cur
    return best
