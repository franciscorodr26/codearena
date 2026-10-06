def fastest_laps(laps, k):
    everything = [t for lane in laps for t in lane]
    everything.sort()
    return everything[:k]
