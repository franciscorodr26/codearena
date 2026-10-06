def fastest_lap(laps):
    best = 0
    for i in range(1, len(laps)):
        if laps[i] < laps[best]:
            best = i
    return best
