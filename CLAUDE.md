# CLAUDE.md

Guidance for AI coding assistants working in this repository. Humans: see README.md.

## Commands

- Backend dev server: `cd backend && npm run dev` (port 3001). Tests: `npm test`. Problem set check: `npm run validate:problems`.
- Frontend dev server: `cd frontend && npm run dev` (port 3000). Tests: `npm test`. Lint: `npm run lint`. Build: `npx next build`.
- Both at once with dev auto-login: `./run.sh`.
- Publish boundary check (run before every push): `node scripts/check-boundary.js`.
- Local Judge0 sandbox: `docker compose -f docker-compose.judge0.yml up -d`, then `JUDGE0_URL=http://localhost:2358`.

## Layout

- `backend/server.js`: Express app plus every Socket.io handler for battles, matchmaking, friends, messages, challenges and tournaments.
- `backend/routes/`: REST API. `backend/db.js`: SQLite schema (append-only migrations array) and queries.
- `backend/arena/`: the code runner (`runner/`), the open problem set (`problems/`, one JSON per problem) and reference solutions (`solutions/`). `backend/problemsLoader.js` is the only module that reads problems; `backend/services/validateSolution.js` is the only module that grades code.
- `backend/data/prompting/prompts.json`: prompt-battle and prompt-practice challenges.
- `frontend/pages/`: Next.js routes. `frontend/components/practice/ArenaPractice.js` is the warm-up surface; `battle.js` the live battle.

## Rules

- Hidden tests never leave the server. Anything a player can fetch goes through `problemsLoader.getVisibleProblem`.
- A runner outage is `executionUnavailable`, never a failed submission. Decide wins only with `allTestsPassed`.
- Problems must be original and pass both reference solutions. Never add problems or solutions copied from elsewhere.
- Nothing from the hiring product this codebase once shared a repository with may come back; `backend/tests/codearenaProductBoundary.test.js` and `scripts/check-boundary.js` enforce it. Do not weaken either to make a change pass.
- Migrations are append-only: new schema gets a new id at the end of the array in `db.js`.
- Copy style: plain language, no em dashes.
