# CodeArena arena kit

The open code runner and original problem set for CodeArena.

- `runner/` grades a player's JavaScript or Python function against tests. Code
  runs on a [Judge0](https://github.com/judge0/judge0) server (`JUDGE0_URL`).
  The local executor (`CODEARENA_RUNNER=local`) is not a sandbox and is only
  for development and validating reference solutions.
- `problems/` holds the original problem set; `solutions/` holds a JavaScript and a
  Python reference for each.
- A runner outage is reported as `unavailable` and must never count against a
  player.

From `backend/`:

```bash
npm test                   # includes the runner tests (tests/arenaRunner.test.js, tests/arenaValidate.test.js)
npm run validate:problems  # both references must pass every problem
```

See [docs/problems.md](docs/problems.md) to add a problem.
