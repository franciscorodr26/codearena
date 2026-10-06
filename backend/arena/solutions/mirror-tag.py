def is_mirror_tag(tag):
    s = [c for c in tag.lower() if c.isascii() and c.isalnum()]
    return s == s[::-1]
