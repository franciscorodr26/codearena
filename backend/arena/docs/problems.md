# Writing a CodeArena problem

Every problem is one JSON file in `problems/` plus two reference solutions in
`solutions/`, one in JavaScript and one in Python. A problem is accepted only
when both references pass every example and test. Write the two solutions
independently: when they disagree, one of them (or a test) is wrong.

## File format

```json
{
  "id": "win-streak",
  "title": "Win Streak",
  "difficulty": "easy",
  "tags": ["strings"],
  "description": "Markdown shown to players.",
  "function": {
    "name": "longestWinStreak",
    "pythonName": "longest_win_streak",
    "params": [{ "name": "results", "type": "string" }],
    "returns": "integer"
  },
  "compare": { "mode": "exact" },
  "examples": [{ "args": ["WWLW"], "expected": 2 }],
  "tests": [{ "args": [""], "expected": 0 }]
}
```

- `examples` are shown to players. `tests` are run when they submit.
- `compare.mode` is `exact`, `float` (with optional `tolerance`) or `unordered`
  (the returned list may be in any order).
- Arguments and results must be plain JSON: numbers, strings, booleans, null,
  lists and objects.
- Include edge cases (empty input, single item, ties) and at least one large
  test that rules out a too-slow approach when the problem asks for one.

## Checking your problem

From `backend/`:

```bash
node arena/scripts/validate-problems.js --fill my-problem   # fills missing "expected" from the JS reference
npm run validate:problems                                   # every problem, both languages
```

`--fill` only fills values that are missing. Review the filled values: the
Python reference must then agree with them.

## Originality

Problems must be your own work. Do not copy statements or tests from other
sites or from any private problem bank.

## Public tests and hosted instances

Everything in this repository is public, including tests, so a determined
player could hard-code answers. A hosted instance that runs ranked battles
should also load a private set of extra tests that is never published.
