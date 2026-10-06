import heapq
def max_quests(quests):
    chosen = []  # max-heap via negated durations
    time = 0
    for duration, deadline in sorted(quests, key=lambda q: q[1]):
        if time + duration <= deadline:
            heapq.heappush(chosen, -duration)
            time += duration
        elif chosen and -chosen[0] > duration:
            time += duration + heapq.heappushpop(chosen, -duration)
    return len(chosen)
