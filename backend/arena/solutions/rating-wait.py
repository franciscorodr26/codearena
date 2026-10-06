def days_until_higher(ratings):
    n = len(ratings)
    wait = [0] * n
    # scan from the right, jumping along already computed answers
    for i in range(n - 2, -1, -1):
        j = i + 1
        while j < n and ratings[j] <= ratings[i]:
            if wait[j] == 0:
                j = n
                break
            j += wait[j]
        wait[i] = j - i if j < n else 0
    return wait
