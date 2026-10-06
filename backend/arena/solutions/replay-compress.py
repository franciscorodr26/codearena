from itertools import groupby
def compress_replay(moves):
    return "".join(k + str(len(list(g))) for k, g in groupby(moves))
