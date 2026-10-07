# Maintaining CodeArena

A guide for maintainers: how the project fits together, how changes reach codearena.co, what to check before merging, and what to do when something breaks. Contributors should start with [CONTRIBUTING.md](CONTRIBUTING.md).

## The shape of it

| Part | Where | Notes |
|---|---|---|
| Backend | `backend/` | Node, Express, Socket.io, SQLite. `server.js` holds battles, matchmaking and sockets; `routes/` the REST API; `db.js` schema, migrations and queries. |
| Code runner | `backend/arena/` | Builds a program from a player's code plus a small driver, runs it on Judge0, compares results. One driver per language in `runner/harness.js`. |
| Problems | `backend/arena/problems/` | One JSON file per problem, with JavaScript and Python reference solutions in `arena/solutions/`. |
| Frontend | `frontend/` | Next.js, React, Tailwind, Monaco. |
| Shared | `shared/` | Code both sides use, such as fair-use limits (`codearenaProductMode.js`). |

## How a change reaches codearena.co

1. A pull request runs CI (`.github/workflows/ci.yml`):
   - the publish boundary check;
   - backend: problem validation, a boot and health probe, and every test;
   - frontend: lint, tests and a production build.
2. Merging to `main` deploys automatically:
   - **backend** on Railway, using `railway.toml` at the repo root. Keep the service's Root Directory **empty**: the build and start commands already point into `backend/`.
   - **frontend** on Vercel, with Root Directory `frontend`.
3. Railway waits for `GET /health` to pass before switching traffic, so a build that crashes on boot never replaces the running version.

**`main` is production.** Merge only what you would deploy.

## Before you merge a pull request

- CI is green.
- The change is something you understand. Ask the author to explain anything unclear; that is normal in review.
- **New dependency?** Check it is maintained and widely used. Dependabot opens security updates on its own.
- **New environment variable?** It is documented in `backend/.env.example` (or `frontend/.env.example`). Optional features stay off when their variable is unset.
- **Database change?** It is a new migration at the end of the `migrations` list in `backend/db.js` with the next id, recorded with `npm run migrations:ledger`. Never edit or reorder an existing migration: live databases have already run it.
- **New problem?** `npm run validate:problems` passes (both reference solutions pass every test), and it is the author's own work.
- **Anything that costs money per use** (model calls, code runs) goes through the fair-use limits in `shared/codearenaProductMode.js`.

## Costs and safety limits

Every paid service has a cap, so a busy day cannot become a large bill.

| Service | Used for | Cap |
|---|---|---|
| Judge0 (RapidAPI) | Running player code | `CODEARENA_GLOBAL_DAILY_CODE_EXECUTION_LIMIT` runs per day, plus per-player daily limits |
| Anthropic | Claude models in prompt battles and other AI features | Workspace spend limit, plus `CODEARENA_GLOBAL_DAILY_PROMPT_EVALUATION_LIMIT` |
| OpenAI, Gemini, DeepSeek | Extra prompt battle models | Prepaid credit or free tier; each model hides itself when its key is unset |
| Resend | Email | Key restricted to the codearena.co domain |

Pricier models count more against the daily prompt budget (Opus 5, Sonnet 3, the rest 1), in `backend/services/promptBattleRunner.js`.

## When something breaks

- **Site down or acting strangely:** check `https://api.codearena.co/health`. It reports the running version (commit) and whether the database and websockets are up.
- **A bad deploy:**
  - frontend: in Vercel, promote the previous deployment (Instant Rollback);
  - backend: in Railway, redeploy the previous deployment;
  - then revert the commit on `main` so the next push does not bring it back.
- **"Code execution unavailable":** Judge0 is down or the daily cap is reached. It never counts against players. Check the RapidAPI dashboard and the cap.
- **A model errors in prompt battles:** usually a wrong model name or exhausted credit. Model names come from variables (`GEMINI_MODEL`, `OPENAI_PREMIUM_MODEL`, and so on); see `backend/.env.example`.
- **Security report:** handle it privately as described in [SECURITY.md](SECURITY.md). Do not discuss it in public issues until it is fixed.

## Moderation

- Players can report users. Usernames go through a profanity filter.
- Gallery games run in a sandboxed frame (`sandbox="allow-scripts"`, no same-origin access), so a game cannot touch a player's account.
- Publishing a game runs automated checks first.

Act on reports promptly. Remove content that breaks the [Terms](https://codearena.co/terms).

## Known quirks

- Older accounts show 0 wins and 0 losses on the dashboard and friends list, while their profile shows their real record. The stats table was never backfilled from the battle history. A one-off backfill would fix it.
- All ratings sit at 1000 because ranked play has been quiet.
- Every problem and test is public, so ranked results can be gamed. A hosted instance can keep an extra private set in `CODEARENA_PRIVATE_PROBLEMS_DIR` (see the README).
- Booting a fresh database logs "migration statement skipped: duplicate column" warnings. They come from old migrations re-adding columns that already exist and are harmless.

## Good next things

- Languages: [Java #1](https://github.com/sennaicodes/codearena/issues/1), [C++ #2](https://github.com/sennaicodes/codearena/issues/2), [Go #3](https://github.com/sennaicodes/codearena/issues/3).
- More problems (the best first contribution for newcomers).
- The win/loss backfill above.
- A private problem set for ranked play.
- Issue and pull request templates, and labels such as `good first issue`.

## Running the checks locally

```bash
cd backend && npm test && npm run validate:problems
cd frontend && npm run lint && npm test
node scripts/check-boundary.js
```
