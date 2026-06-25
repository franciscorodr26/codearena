#!/usr/bin/env bash
# CodeArena MVP — start backend + frontend for local development
#
# Usage:
#   ./run.sh                  # dev servers, open browser, auto dev login (default)
#   ./run.sh --no-browser     # dev servers, no browser (CI / remote / Cursor)
#   ./run.sh --no-dev-login   # normal sign-in; no /auth/dev-session auto login
#   ./run.sh --production     # NODE_ENV=production (still uses dev servers; see note)
#   ./run.sh --help
#
# Notes:
#   - Defaults to NODE_ENV=development so Next.js `next dev` and local APIs behave normally.
#   - By default exports CODEARENA_DEV_AUTO_LOGIN + NEXT_PUBLIC_* so the app signs you in as
#     user localdev@codearena.local without visiting /login. Use --no-dev-login to disable.
#   - Press Ctrl+C once to stop both servers (trap cleanup).
#   - For backend auto-reload we use `npm run dev` (nodemon). Use `cd backend && npm start` if you want plain node.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PRODUCTION_MODE=false
OPEN_BROWSER=true
DEV_AUTO_LOGIN=true

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --no-browser     Do not open a browser (recommended in Cursor / SSH / headless)"
  echo "  --no-dev-login   Do not enable one-click dev guest login (use real accounts)"
  echo "  --production     Set NODE_ENV=production (analytics / guards; servers still dev commands)"
  echo "  --help, -h       Show this help"
  echo ""
  echo "Default: NODE_ENV=development, backend nodemon, frontend Next dev, browser opens on macOS/Linux."
}

for arg in "$@"; do
  case $arg in
    --production)
      PRODUCTION_MODE=true
      ;;
    --no-dev-login)
      DEV_AUTO_LOGIN=false
      ;;
    --no-browser)
      OPEN_BROWSER=false
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$SCRIPT_DIR/backend/node_modules" ] || [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
  echo "Dependencies missing. Install first, then re-run:" >&2
  echo "" >&2
  echo "  cd \"$SCRIPT_DIR/backend\" && npm install" >&2
  echo "  cd \"$SCRIPT_DIR/frontend\" && npm install" >&2
  echo "" >&2
  exit 1
fi

if [ "$PRODUCTION_MODE" = true ]; then
  export NODE_ENV=production
  echo "Starting CodeArena MVP (NODE_ENV=production)…"
  echo "Note: analytics and production-only code paths use production semantics."
else
  export NODE_ENV=development
  echo "Starting CodeArena MVP (NODE_ENV=development)…"
fi

if [ "$PRODUCTION_MODE" = true ] || [ "$DEV_AUTO_LOGIN" != true ]; then
  :
else
  export CODEARENA_DEV_AUTO_LOGIN=1
  export NEXT_PUBLIC_CODEARENA_DEV_AUTO_LOGIN=1
  echo "Dev guest login on (user localdev@codearena.local). Use --no-dev-login to require normal sign-in."
  echo "For two-player local matchmaking: start a second frontend with NEXT_PUBLIC_CODEARENA_DEV_LOGIN_SLOT=2 (and same dev-login env), or use --no-dev-login with two real accounts."
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down servers…"
  if [ -n "${BACKEND_PID:-}" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [ -n "${FRONTEND_PID:-}" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  if [ -n "${BACKEND_PID:-}" ]; then wait "$BACKEND_PID" 2>/dev/null || true; fi
  if [ -n "${FRONTEND_PID:-}" ]; then wait "$FRONTEND_PID" 2>/dev/null || true; fi
  exit 0
}

trap cleanup EXIT INT TERM

port_listening() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  # Bash built-in TCP probe (no nc required)
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

wait_for_port() {
  local port="$1" label="$2" max_seconds="${3:-90}"
  local i=0
  echo "Waiting for $label (port $port)…"
  while [ "$i" -lt "$max_seconds" ]; do
    if port_listening "$port"; then
      echo "  $label is up."
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "  Timed out waiting for $label on port $port." >&2
  return 1
}

echo "Starting backend (port 3001)…"
(
  cd "$SCRIPT_DIR/backend"
  if [ "$PRODUCTION_MODE" = true ]; then
    exec npm start
  else
    exec npm run dev
  fi
) &
BACKEND_PID=$!

wait_for_port 3001 "Backend" 90 || true

echo "Starting frontend (port 3000)…"
(
  cd "$SCRIPT_DIR/frontend"
  exec npm run dev
) &
FRONTEND_PID=$!

wait_for_port 3000 "Frontend" 120 || true

if [ "$OPEN_BROWSER" = true ]; then
  echo "Opening browser…"
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:3000" || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:3000" || true
  elif command -v start >/dev/null 2>&1; then
    start "http://localhost:3000" || true
  else
    echo "Could not find a browser launcher; open http://localhost:3000 manually."
  fi
else
  echo "Skipping browser (--no-browser)."
fi

echo ""
echo "Servers running:"
echo "  Frontend  http://localhost:3000"
echo "  Backend   http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both."
echo ""

# Block until both servers exit (no stdin capture — works in Cursor / non-TTY / CI)
set +e
wait "$BACKEND_PID"
wait "$FRONTEND_PID"
set -e
