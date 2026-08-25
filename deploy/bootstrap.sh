#!/usr/bin/env bash
# bootstrap.sh — ONE-TIME server setup for the RAI live stack.
# Run on the box (e.g. stream it:  ssh bob@<host> 'bash -s' < deploy/bootstrap.sh)
# After this, the GitHub "Deploy" workflow handles everything.
#
# What it does:
#   1. clones the repo to $DEPLOY_PATH (default ~/hackathons/rai/RAI) if missing
#   2. creates .venv + installs backend deps, npm ci for the frontend
#   3. installs systemd --user units (rai-api, rai-web) and enables them
#   4. enables lingering so user units survive logout (may ask for sudo once)
#   5. registers the public cloudflared-gate routes via puburl
#   6. creates agent_backend/.env from template if absent (fill in real keys!)
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$HOME/hackathons/rai/RAI}"
REPO_URL="${REPO_URL:-https://github.com/Unrankedbandit/RAI.git}"
API_PORT=8000
WEB_PORT=3000

step() { printf '\n=== %s ===\n' "$*"; }

step "repo"
if [ ! -d "$DEPLOY_PATH/.git" ]; then
  mkdir -p "$(dirname "$DEPLOY_PATH")"
  git clone "$REPO_URL" "$DEPLOY_PATH"
fi
cd "$DEPLOY_PATH"

step "backend deps"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r agent_backend/requirements.txt

step "frontend deps"
( cd frontend && npm ci --silent )

step "secrets file"
if [ ! -f agent_backend/.env ]; then
  cat > agent_backend/.env <<'EOF'
# RAI live server secrets — fill these in (this file is never committed/deployed).
# LLM bridge key (hackathon.josephbissell.com) — per-app key, see team docs:
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=https://hackathon.josephbissell.com
# Bright Data (web research) — see root CLAUDE.md:
BRIGHTDATA_API_TOKEN=
BRIGHTDATA_ZONE=mcp_unlocker
EOF
  chmod 600 agent_backend/.env
  echo "created agent_backend/.env template — EDIT IT with real keys before smoke will pass"
else
  echo "agent_backend/.env already exists, left untouched"
fi

step "systemd user units"
UNITDIR="$HOME/.config/systemd/user"
mkdir -p "$UNITDIR"
for unit in rai-api rai-web; do
  sed "s|__DEPLOY_PATH__|$DEPLOY_PATH|g" "deploy/$unit.service" > "$UNITDIR/$unit.service"
done
if systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable --now rai-api.service rai-web.service
  loginctl enable-linger "$USER" 2>/dev/null \
    || echo "NOTE: could not enable linger without sudo — run: sudo loginctl enable-linger $USER"
  echo "units installed: systemctl --user status rai-api rai-web"
else
  echo "systemd --user unavailable — deploy.sh will fall back to nohup restarts."
fi

step "public routes (cloudflared gate)"
# puburl <port> <name> -> https://<name>.josephbissell.com (idempotent; live
# mappings in ~/.config/fw_routes.json). Never stops cloudflared.
if [ -x "$HOME/hackathons/bin/puburl" ]; then
  bash "$HOME/hackathons/bin/puburl" "$API_PORT" rai-live-api || echo "puburl api route failed — check ~/hackathons/bin/active_tunnels.log"
  bash "$HOME/hackathons/bin/puburl" "$WEB_PORT" rai-live     || echo "puburl web route failed — check ~/hackathons/bin/active_tunnels.log"
else
  echo "WARNING: ~/hackathons/bin/puburl not found on this box."
  echo "         Point the gate at 127.0.0.1:$API_PORT (rai-live-api) and 127.0.0.1:$WEB_PORT (rai-live) manually."
fi

step "done"
echo "Next: edit $DEPLOY_PATH/agent_backend/.env with real keys, then run the"
echo "GitHub 'Deploy' workflow (Actions tab) — or test locally: REF=main bash deploy/deploy.sh"
