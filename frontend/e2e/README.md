# End-to-end proof

`open-edition.spec.ts` drives real browsers through the product against a running local stack: practice warm-up, the problem library, a private battle between two signed-in users, a bot battle, the matchmaking queue with "practice while you wait", prompt practice with no model key, and a console-error smoke of every page.

Start the stack with two dev users enabled, then run the spec from `frontend/`:

```bash
# backend
cd backend && PORT=3201 DB_PATH=/tmp/codearena-e2e.sqlite JWT_SECRET=e2e-only CODEARENA_RUNNER=local \
  CODEARENA_DEV_AUTO_LOGIN=1 FRONTEND_URL=http://localhost:3200 CORS_ALLOWED_ORIGINS=http://localhost:3200 node server.js

# frontend
cd frontend && NEXT_PUBLIC_BACKEND_URL=http://localhost:3201 NEXT_PUBLIC_FRONTEND_URL=http://localhost:3200 \
  NEXT_PUBLIC_CODEARENA_DEV_AUTO_LOGIN=1 npx next dev -p 3200

# the proof
cd frontend && E2E_SHOTS=/tmp/codearena-e2e-shots npx playwright test -c e2e/open-edition.config.ts
```

`matchmaking-preferences.spec.ts` covers the queue preferences UI and runs with the default `playwright.config.ts`.
