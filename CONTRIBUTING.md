# Contributing to CodeArena

Thanks for helping. The two most useful contributions are bug reports with steps to reproduce, and new problems.

## Before you start

- Open an issue first for anything bigger than a small fix, so nobody duplicates work.
- Keep pull requests focused on one change.
- Match the code style around your change. No reformatting of files you did not otherwise touch.

## Adding a problem

1. Read [backend/arena/docs/problems.md](backend/arena/docs/problems.md).
2. Create `backend/arena/problems/<id>.json` and two reference solutions, `backend/arena/solutions/<id>.js` and `<id>.py`, written independently.
3. Run `cd backend && npm run validate:problems`. Both references must pass every example and test.
4. Problems must be your own work. Do not copy statements or tests from other sites or from any private problem bank.

## Adding a language

Players can write Python, JavaScript or TypeScript today. Java, C++ and Go
are open for contributors, each with a full guide in its issue:
[Java (#1)](https://github.com/sennaicodes/codearena/issues/1),
[C++ (#2)](https://github.com/sennaicodes/codearena/issues/2) and
[Go (#3)](https://github.com/sennaicodes/codearena/issues/3), which is the easiest place to start.

## Running the checks

```bash
cd backend && npm test
cd frontend && npm test && npm run lint
node scripts/check-boundary.js
```

The boundary check fails on credentials, personal email addresses, local file paths and anything that must not be published. CI runs the same checks on every pull request.

## Code of conduct

Be kind. This is a place to practice, so people here are learning in public; treat mistakes gently. Harassment is not tolerated. Maintainers may remove comments, commits or contributors that break this.

## Licensing of contributions

By submitting a pull request you agree that your contribution is your own work (or you have the right to submit it) and that it will be licensed under the project's license.
