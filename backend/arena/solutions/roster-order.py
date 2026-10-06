def roster_order(names):
    return sorted(names, key=lambda n: (len(n), n.lower()))
