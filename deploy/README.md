# Deploy — manual CD for the live stack

`Actions → Deploy → Run workflow` ships a ref to the box, restarts the stack,
waits for local health, then runs `scripts/smoke.py` against the public URLs as
a post-deploy gate. CI must be green on the ref (override: `force=true`).

| Piece | File | Runs |
|---|---|---|
| Workflow (manual trigger) | `.github/workflows/deploy.yml` | GitHub runner |
| Server-side deploy | `deploy/deploy.sh` | streamed to the box over SSH |
| One-time server setup | `deploy/bootstrap.sh` + `rai-api.service`, `rai-web.service` | on the box, once |

## One-time setup

1. **GitHub side** — repo *Settings → Secrets and variables → Actions*:
   - Secret `SSH_PRIVATE_KEY`: private key that can SSH to the box
     (`ssh-keygen -t ed25519 -C rai-deploy`, append `.pub` to the box's
     `~/.ssh/authorized_keys`).
   - Variable `DEPLOY_HOST`: box hostname/IP (port 22).
   - Optional variables: `DEPLOY_USER` (default `bob`),
     `DEPLOY_PATH` (default `~/hackathons/rai/RAI`).

2. **Box side, once** — from a checkout of this repo:
   ```bash
   scp deploy/bootstrap.sh deploy/rai-api.service deploy/rai-web.service bob@<host>:/tmp/
   ssh bob@<host> 'cd /tmp && bash bootstrap.sh'
   ```
   This clones the repo if needed, installs deps, installs + enables the
   systemd user units, turns on lingering, and registers the public gate
   routes (`rai-live` → :3000, `rai-live-api` → :8000) via `puburl`.

3. **Secrets on the box** — edit `$DEPLOY_PATH/agent_backend/.env`
   (template created by bootstrap): LLM bridge key, Bright Data token.
   This file is never committed or deployed.

4. **Smoke targets** — repo variables `SMOKE_BASE_URL` /
   `SMOKE_WEB_URL` (already set; used by both `smoke.yml` and the
   post-deploy gate).

## How a deploy works

1. `guard` — resolves the ref, requires the latest CI run on that SHA to be
   green (`force=true` overrides).
2. `deploy` — streams `deploy/deploy.sh` over SSH: fetch → checkout →
   `pip install` → `npm ci` + `next build` (with
   `NEXT_PUBLIC_AGENT_API=https://rai-live-api.josephbissell.com`) → restart
   (`systemctl --user restart rai-api rai-web`, or nohup fallback) → wait for
   `127.0.0.1:8000/api/health` and `127.0.0.1:3000/`.
3. `smoke` — `scripts/smoke.py` against the public URLs; a red smoke fails
   the run so a bad deploy is loud.

Server checkout refusing to move because of uncommitted local changes? Either
commit/stash them on the box, or rerun with `force=true` (does `git reset --hard`).

Without `SSH_PRIVATE_KEY`/`DEPLOY_HOST` configured the workflow skips green
(fork-friendly, same convention as `smoke.yml`).
