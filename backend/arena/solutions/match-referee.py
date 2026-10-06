TRANSITIONS = {
    ("waiting", "start"): "running",
    ("running", "pause"): "paused",
    ("paused", "resume"): "running",
    ("running", "end"): "over",
    ("paused", "end"): "over",
}
def referee_match(events):
    state = "waiting"
    score = {"A": 0, "B": 0}
    for e in events:
        if e.startswith("goal ") and state == "running":
            score[e[5:]] += 1
        else:
            state = TRANSITIONS.get((state, e), state)
    return [score["A"], score["B"], state]
