#!/usr/bin/env bash
# deploy.sh — server-side deploy for the RAI live stack.
# Streamed over SSH by .github/workflows/deploy.yml:
#   ssh bob@<host> "REF=main bash -s" < deploy/deploy.sh
# Safe to run by hand on the box too. Idempotent; refuses to clobber a dirty
# working tree unless FORCE=1.
#
# Env (all optional):
#   REF            branch / tag / sha to deploy          (default: main)
#   DEPLOY_PATH    repo clone on the server              (default: ~/hackathons/rai/RAI)
#   FORCE          1 = deploy even with uncommitted changes (git reset --hard)
#   API_PORT       uvicorn port                          (default: 8000)
#   WEB_PORT       next start port                       (default: 3000)
#   NEXT_PUBLIC_AGENT_API  baked into the frontend build (default: https://rai-live-api.josephbissell.com)
#
# Secrets (BRIGHTDATA_API_TOKEN, LLM keys) are NEVER deployed — they live in
# agent_backend/.env on the server, created once by deploy/bootstrap.sh.
set -euo pipefail

REF="${REF:-main}"
DEPLOY_PATH="${DEPLOY_PATH:-$HOME/hackathons/rai/RAI}"
FORCE="${FORCE:-0}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
export NEXT_PUBLIC_AGENT_API="${NEXT_PUBLIC_AGENT_API:-https://rai-live-api.josephbissell.com}"

step() { printf '\n=== %s ===\n' "$*"; }

step "fetch ($DEPLOY_PATH @ $REF)"
cd "$DEPLOY_PATH"
git fetch origin --prune --quiet

if [ -n "$(git status --porcelain)" ]; then
  if [ "$FORCE" = "1" ]; then
    echo "working tree dirty — FORCE=1, resetting"
    git reset --hard --quiet
  else
    echo "ERROR: $DEPLOY_PATH has uncommitted changes. Commit/stash them on the"
    echo "box, or rerun the Deploy workflow with force=true. Local changes:"
    git status --short
    exit 1
  fi
fi

git checkout --quiet "$REF"
# Fast-forward when REF is a branch; detached checkout is fine for tags/SHAs.
if git show-ref --verify --quiet "refs/remotes/origin/$REF"; then
  git merge --ff-only --quiet "origin/$REF"
fi
echo "deploying $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

step "backend deps"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r agent_backend/requirements.txt
if [ ! -f agent_backend/.env ]; then
  echo "WARNING: agent_backend/.env missing — LLM/Bright Data keys are not set."
  echo "         Create it on the box (see deploy/README.md); /api/health will"
  echo "         report llm.configured=false and post-deploy smoke will fail."
fi

step "frontend build (NEXT_PUBLIC_AGENT_API=$NEXT_PUBLIC_AGENT_API)"
cd frontend
npm ci --silent
npm run build
cd ..

step "restart services"
LOGDIR="$HOME/hackathons/rai/logs"
mkdir -p "$LOGDIR"

start_nohup() {
  # Box convention (see AGENTS.md): setsid nohup … & so processes survive the
  # SSH session. Used when systemd user units aren't installed.
  pkill -f "uvicorn agent_backend.main:app" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  sleep 1
  ( setsid nohup ./.venv/bin/python -m uvicorn agent_backend.main:app \
      --host 127.0.0.1 --port "$API_PORT" >> "$LOGDIR/api.log" 2>&1 & )
  ( cd frontend && setsid nohup ./node_modules/.bin/next start \
      -H 127.0.0.1 -p "$WEB_PORT" >> "$LOGDIR/web.log" 2>&1 & )
  echo "started via nohup (logs in $LOGDIR)"
}

if systemctl --user status rai-api.service >/dev/null 2>&1; then
  systemctl --user restart rai-api.service rai-web.service
  echo "restarted systemd user units (rai-api, rai-web)"
else
  start_nohup
fi

step "health wait"
wait_up() { # url name
  for i in $(seq 1 30); do
    if curl -sf "$1" >/dev/null 2>&1; then echo "$2 up ($1)"; return 0; fi
    sleep 1
  done
  echo "ERROR: $2 never came up on $1 — check logs ($LOGDIR or journalctl --user -u rai-*)"
  return 1
}
wait_up "http://127.0.0.1:$API_PORT/api/health" "backend"
wait_up "http://127.0.0.1:$WEB_PORT/" "frontend"

step "done"
echo "Deployed $REF ($(git rev-parse --short HEAD))."
echo "Public routes (cloudflared gate, configured once by bootstrap.sh):"
echo "  web: https://rai-live.josephbissell.com      -> 127.0.0.1:$WEB_PORT"
echo "  api: https://rai-live-api.josephbissell.com  -> 127.0.0.1:$API_PORT"
