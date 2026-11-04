"""Bounded listening chunks; preserve source tokens and protected expressions."""
import re

MAX_WORDS, MAX_CHARS = 28, 180


def split_source(sentence, notes=(), max_words=MAX_WORDS, max_chars=MAX_CHARS):
    tokens = list(re.finditer(r'\S+', sentence['s']))
    n = len(tokens)
    if not n:
        return []
    protected = set()
    for note in notes:
        expression = note['expr'].lower()
        begin = sentence['s'].lower().find(expression)
        if begin >= 0:
            protected.update(i for i in range(1, n) if begin < tokens[i].start() < begin + len(expression))
    score, prior = [float('inf')] * (n + 1), [-1] * (n + 1)
    score[0] = 0
    for stop in range(1, n + 1):
        if stop < n and stop in protected:
            continue
        for start in range(max(0, stop - max_words), stop):
            text = sentence['s'][tokens[start].start():tokens[stop - 1].end()]
            if len(text) > max_chars:
                continue
            count = stop - start
            boundary = 0 if stop == n else 2 if re.search(r'[,;:!?\.][\"\']?$', text) else 6 if tokens[stop][0].lower().strip(',') in {'and', 'but', 'because', 'so', 'which', 'when', 'where', 'if', 'while', 'although', 'or'} else 22
            cost = score[start] + 12 + boundary + .018 * (count - 18) ** 2 + max(0, 5 - count) * 5
            if cost < score[stop]:
                score[stop], prior[stop] = cost, start
    if prior[n] < 0:
        raise ValueError('Cannot split without breaking an expression: ' + sentence['s'])
    ranges, stop = [], n
    while stop:
        start = prior[stop]
        ranges.append((start, stop))
        stop = start
    return [(sentence['s'][tokens[a].start():tokens[b - 1].end()], a, b) for a, b in reversed(ranges)]
