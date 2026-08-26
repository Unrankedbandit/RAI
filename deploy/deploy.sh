#!/usr/bin/env bash
# deploy.sh — deploy the RAI live stack. Runs ON the deploy host, invoked by
# .github/workflows/deploy.yml: the self-hosted runner executes it locally, or
# the SSH fallback streams it ("ssh bob@<host> 'REF=main bash -s' < deploy.sh").
# Idempotent; refuses to clobber tracked local edits unless FORCE=1.
#
# Live topology on the deploy host (bob):
#   repo      ~/sites/RAI              "clean main" checkout that feeds the live
#                                      stack. Dev work lives in
#                                      ~/hackathons/rai/RAI — never touched here.
#   backend   rai-api-live.service     uvicorn on 127.0.0.1:8010, behind the
#                                      rai-api-public CORS proxy (:8891) which
#                                      is what rai-live-api.josephbissell.com hits
#   frontend  rai-site.service         next start on 127.0.0.1:8860 (PORT env in
#                                      the unit), exposed as rai-live via the gate
#   secrets   agent_backend/.env       never read or written by deploys
#
# Env (all optional):
#   REF         branch / tag / sha to deploy     (default: main)
#   DEPLOY_PATH live checkout on the host        (default: ~/sites/RAI)
#   FORCE       1 = reset tracked local edits    (default: refuse)
#   API_PORT    backend health port              (default: 8010)
#   WEB_PORT    frontend health port             (default: 8860)
set -euo pipefail

REF="${REF:-main}"
DEPLOY_PATH="${DEPLOY_PATH:-$HOME/sites/RAI}"
FORCE="${FORCE:-0}"
API_PORT="${API_PORT:-8010}"
WEB_PORT="${WEB_PORT:-8860}"

step() { printf '\n=== %s ===\n' "$*"; }

step "fetch ($DEPLOY_PATH @ $REF)"
cd "$DEPLOY_PATH"
git fetch origin --prune --quiet

# Runtime artifacts land in this checkout (agent_backend/reports/*.json, the
# .venv symlink) — untracked files are expected and fine. Only tracked edits
# block a deploy.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  if [ "$FORCE" = "1" ]; then
    echo "tracked local edits present — FORCE=1, resetting"
    git reset --hard --quiet
  else
    echo "ERROR: $DEPLOY_PATH has uncommitted changes to tracked files:"
    git status --short --untracked-files=no
    echo "Commit/stash them on the box, or rerun the Deploy workflow with force=true."
    exit 1
  fi
fi

LOCAL="$(git rev-parse HEAD)"
git checkout --quiet "$REF"
# Fast-forward when REF is a branch; detached checkout is fine for tags/SHAs.
if git show-ref --verify --quiet "refs/remotes/origin/$REF"; then
  git merge --ff-only --quiet "origin/$REF"
fi
REMOTE="$(git rev-parse HEAD)"
echo "deploying $(git rev-parse --short "$REMOTE") — $(git log -1 --pretty=%s "$REMOTE")"
CHANGED="$(git diff --name-only "$LOCAL" "$REMOTE" 2>/dev/null || true)"

step "backend deps"
# .venv here is a symlink into the dev clone's venv — shared interpreter, same
# requirements. Only pay the pip cost when the manifest actually changed.
if echo "$CHANGED" | grep -q '^agent_backend/requirements\.txt$'; then
  ./.venv/bin/pip install --quiet -r agent_backend/requirements.txt
  echo "requirements.txt changed — deps refreshed"
else
  echo "requirements unchanged — skipping pip"
fi
[ -f agent_backend/.env ] || echo "WARNING: agent_backend/.env missing — /api/health will report llm.configured=false"

step "frontend build"
# Build exactly like the proven path (rai_deploy.sh): no NEXT_PUBLIC_* override
# — the frontend's baked-in default API URL is what the live site already uses.
cd frontend
npm ci --silent
npm run build
cd ..

step "restart services"
# User units with linger on; both restart so the served code always matches
# HEAD. Restarting the backend cancels any in-flight public run — runs are
# short and demo-grade (same policy as the old webhook deployer).
systemctl --user restart rai-api-live.service rai-site.service

step "health wait"
wait_up() { # url name timeout_s
  for i in $(seq 1 "$3"); do
    if curl -sf "$1" >/dev/null 2>&1; then echo "$2 up ($1)"; return 0; fi
    sleep 1
  done
  echo "ERROR: $2 never came up on $1 — check: journalctl --user -u rai-api-live -u rai-site"
  return 1
}
wait_up "http://127.0.0.1:$API_PORT/api/health" "backend" 30
# The frontend restart outlives a 30s window when the box is busy (systemd stop
# of next start can eat most of its 90s TimeoutStopSec before the new instance
# boots) — give it 120s before declaring failure.
wait_up "http://127.0.0.1:$WEB_PORT/" "frontend" 120

step "done"
echo "Deployed $REF ($(git rev-parse --short HEAD)) to the live stack."
echo "  web: https://rai-live.josephbissell.com      -> 127.0.0.1:$WEB_PORT"
echo "  api: https://rai-live-api.josephbissell.com  -> 127.0.0.1:$API_PORT (via :8891 proxy)"
