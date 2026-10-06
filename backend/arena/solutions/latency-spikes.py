def count_spikes(pings):
    return sum(1 for a, b, c in zip(pings, pings[1:], pings[2:]) if b > a and b > c)
