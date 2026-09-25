# CodeArena

Practice coding and prompting with friends, battle other developers live, climb the rankings and build community games.

CodeArena is an open-source project (AGPL-3.0). It runs the public site at [codearena.co](https://codearena.co) and you can host your own copy. Source: [github.com/sennaicodes/codearena](https://github.com/sennaicodes/codearena).

## What is in the box

- **Battles.** Two players, one problem, a shared timer. First to pass every test wins. Ratings move with each match.
- **Matchmaking and bots.** Queue for an opponent at your rating, or fight a bot that submits a real solution.
- **Practice warm-ups.** Quick problems while you wait in the queue, before a battle, or after one to retry without a clock.
- **Prompt battles and prompt practice.** Write the prompt, a model answers, the reply is scored. Needs a model API key; without one the mode says so and stays off.
- **Friends, challenges, messages, tournaments, rankings, badges.** The social layer that makes it a place rather than a tool.
- **CreatorArena.** Make small browser games with AI help and publish them to the gallery.

## Quick start

You need Node 22+, and a [Judge0](https://github.com/judge0/judge0) server to run player code safely. For development you can skip Judge0 and run code directly on your machine (not safe for anything public).

```bash
# backend
cd backend
cp .env.example .env            # set JWT_SECRET; everything else is optional
npm ci
CODEARENA_RUNNER=local npm run dev   # http://localhost:3001

# frontend, in another terminal
cd frontend
cp .env.example .env.local
npm ci
npm run dev                     # http://localhost:3000
```

To run player code in a real sandbox, start Judge0 and point the backend at it:

```bash
# edit judge0.conf first and change both passwords
docker compose -f docker-compose.judge0.yml up -d
# in backend/.env
JUDGE0_URL=http://localhost:2358
```

Judge0 CE on RapidAPI also works: set `RAPIDAPI_KEY` instead of `JUDGE0_URL`.

## Configuration

Everything is read from environment variables; `backend/.env.example` and `frontend/.env.example` list them with comments. The short version:

| Variable | Needed for |
|---|---|
| `JWT_SECRET` | Everything. Generate a long random string. |
| `JUDGE0_URL` or `RAPIDAPI_KEY` | Running player code (battles, practice). |
| `CODEARENA_RUNNER=local` | Development only: runs code on the host with no sandbox. Refused in production. |
| `ANTHROPIC_API_KEY` | Prompt battles, prompt practice, complexity feedback, CreatorArena generation. |
| `RESEND_API_KEY` | Email: verification, password reset, notifications. |
| `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`/`_SECRET` | Social sign-in. |
| `STRIPE_*` | CreatorArena credit packs. Leave unset to disable purchases. |
| `CODEARENA_PRIVATE_PROBLEMS_DIR` | Extra problems a hosted instance keeps out of git (see below). |
| `CODEARENA_DAILY_*`, `CODEARENA_GLOBAL_DAILY_*` | Fair-use limits per user and per server, in UTC days. |

Self-hosted copies send no telemetry. Sentry and Mixpanel only activate when you set their keys.

## Problems

The problem set lives in `backend/arena/problems`, one JSON file per problem, with a JavaScript and a Python reference solution in `backend/arena/solutions`. A problem is accepted only when both references pass every test:

```bash
cd backend
npm run validate:problems
```

Adding a problem is the best first contribution. [backend/arena/docs/problems.md](backend/arena/docs/problems.md) explains the format. Problems must be your own work.

Everything in this repository is public, including tests, so a determined player could hard-code answers. If you run ranked battles, keep an extra private set in a directory laid out like `backend/arena/` and set `CODEARENA_PRIVATE_PROBLEMS_DIR` to it. The bots will find solutions there too.

Supported languages at launch: JavaScript, Python and TypeScript. Adding a language means adding a driver in `backend/arena/runner/harness.js`.

## How it is built

- **backend/**: Node, Express, Socket.io, SQLite. `server.js` holds the battle and matchmaking engine; `routes/` the REST API; `db.js` the schema and queries; `arena/` the code runner and problems.
- **frontend/**: Next.js, React, Tailwind, Monaco editor. `components/practice/ArenaPractice.js` is the warm-up surface.
- **Code execution** goes through Judge0. A runner outage is reported as such and never counts against a player.
- **Tests**: `cd backend && npm test`, `cd frontend && npm test`. CI runs both plus a boot smoke test and `scripts/check-boundary.js`, which fails the build on credentials, personal data or files that must not be published.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and problem submissions are the most useful things you can bring. Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE). You can run, study, change and share CodeArena, including commercially; if you run a modified version as a service, you must offer its source to your users under the same license.

## Credits

CodeArena was built by Sennai Kaffl with Tanish Thumbraguddi, Vincent Lo, Bradley Tsou, Teoman Yavuzkurt, Evan Xie, Soham Goswami and Ethan Massey, plus everyone who played, tested and reported bugs along the way. [CONTRIBUTORS.md](CONTRIBUTORS.md) has each person's commits, lines and areas; the commit history credits each author's files. Parts of the code were written with AI coding assistants. Thanks to the [Judge0](https://judge0.com) project for the sandbox that makes the battles possible.
