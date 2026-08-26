#!/usr/bin/env bash
# install-runner.sh — run ON the deploy box (bob) to turn it into a self-hosted
# GitHub Actions runner for this repo. After this, the "Deploy" workflow runs
# directly on the box — no inbound SSH, no ports, no keys in GitHub secrets.
#
# Why: the box is outbound-only behind cloudflared; GitHub-hosted runners (and
# laptops) can't SSH in. A self-hosted runner polls GitHub outbound, which fits
# the topology exactly.
#
# Requirements on the box: gh (already authed as Unrankedbandit), curl, jq,
# tar. Safe to re-run; it updates/reconfigures in place.
#
#   bash ~/hackathons/rai/RAI/deploy/install-runner.sh
set -euo pipefail

REPO="Unrankedbandit/RAI"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-rai}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname)-rai}"

step() { printf '\n=== %s ===\n' "$*"; }

step "preflight"
for tool in gh curl jq tar; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool missing"; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated (gh auth login)"; exit 1; }

step "download latest runner (linux-x64)"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
# Via gh (box-authenticated): avoids anonymous API rate limits and the
# jq|head SIGPIPE race under `set -o pipefail`.
asset_url="$(gh api repos/actions/runner/releases/latest \
  --jq '[.assets[] | select(.name | test("linux-x64.tar.gz")) | .browser_download_url][0]')"
[ -n "$asset_url" ] || { echo "ERROR: could not resolve runner download URL"; exit 1; }
curl -fsSL "$asset_url" -o runner.tar.gz
tar xzf runner.tar.gz
rm runner.tar.gz

step "register with GitHub ($REPO as '$RUNNER_NAME')"
# Token is minted on the box with the box's own gh auth — nothing secret ever
# leaves the box or passes through chat.
reg_token="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
./config.sh --url "https://github.com/$REPO" --token "$reg_token" \
  --name "$RUNNER_NAME" --work _work --unattended --replace

step "install as a user service"
UNITDIR="$HOME/.config/systemd/user"
mkdir -p "$UNITDIR"
cat > "$UNITDIR/gh-runner-rai.service" <<EOF
[Unit]
Description=GitHub Actions runner ($REPO)
After=network.target

[Service]
WorkingDirectory=$RUNNER_DIR
ExecStart=$RUNNER_DIR/runsvc.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
if systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable --now gh-runner-rai.service
  loginctl enable-linger "$USER" 2>/dev/null \
    || echo "NOTE: run 'sudo loginctl enable-linger $USER' so the runner survives logout"
else
  echo "systemd --user unavailable — starting detached instead (survives until reboot):"
  ( setsid nohup "$RUNNER_DIR/runsvc.sh" >> "$HOME/actions-runner-rai.log" 2>&1 & )
fi

step "verify"
sleep 3
gh api "repos/$REPO/actions/runners" --jq '.runners[] | "\(.name): \(.status)"'
echo
echo "Done. The 'Deploy' workflow will now route to this box automatically."
