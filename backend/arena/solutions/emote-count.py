import re
def count_emotes(message):
    return sum(1 for w in message.split(" ") if re.fullmatch(r":[a-z]+:", w))
