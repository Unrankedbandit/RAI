# Deploy — manual CD for the live stack

`Actions → Deploy → Run workflow` ships a ref to the box, restarts the stack,
waits for local health, then runs `scripts/smoke.py` against the public URLs as
a post-deploy gate. CI must be green on the ref (override: `force=true`).

| Piece | File | Runs |
|---|---|---|
| Workflow (manual trigger) | `.github/workflows/deploy.yml` | GitHub / the box |
| Server-side deploy | `deploy/deploy.sh` | on the box |
| Runner setup (one-time) | `deploy/install-runner.sh` | on the box, once |
| Legacy server setup (SSH route) | `deploy/bootstrap.sh` + `*.service` | on the box, once |

## Routes (picked automatically by the `strategy` job)

1. **Self-hosted runner — preferred.** The box is outbound-only behind
   cloudflared, so nothing can SSH in; the runner polls GitHub outbound
   instead. No inbound ports, no SSH keys in GitHub secrets.
2. **SSH — fallback.** Used only if no runner is online and
   `SSH_PRIVATE_KEY` + `DEPLOY_HOST` are configured (e.g. if port 22 ever gets
   opened, or for a different host). See the SSH section at the bottom.

## One-time setup (runner route)

On the box (`gh` is already authenticated there):

```bash
git -C ~/hackathons/rai/RAI pull
bash ~/hackathons/rai/RAI/deploy/install-runner.sh
```

This registers the box as a self-hosted runner (registration token is minted
locally via `gh` — no secrets leave the box) and installs it as a systemd user
service (`gh-runner-rai`). Then:

1. **Secrets on the box** — make sure `$DEPLOY_PATH/agent_backend/.env` has
   real keys (LLM bridge, Bright Data). Never committed or deployed.
2. **Smoke targets** — repo variables `SMOKE_BASE_URL` / `SMOKE_WEB_URL`
   (already set; used by both `smoke.yml` and the post-deploy gate).
3. `Actions → Deploy → Run workflow`.

If the stack has never run on the box before (no clone, no venv, no services),
run `deploy/bootstrap.sh` there first — it clones, installs deps, installs the
`rai-api`/`rai-web` systemd user units, enables linger, and registers the
public gate routes (`rai-live` → :3000, `rai-live-api` → :8000) via `puburl`.

## How a deploy works

1. `guard` — resolves the ref, requires the latest CI run on that SHA to be
   green (`force=true` overrides).
2. `strategy` — online self-hosted runner? → runner route. Else SSH if
   configured. Else skip green (fork-friendly, same convention as `smoke.yml`).
3. `deploy_*` — runs `deploy/deploy.sh`: fetch → checkout → `pip install` →
   `npm ci` + `next build` (with
   `NEXT_PUBLIC_AGENT_API=https://rai-live-api.josephbissell.com`) → restart
   (`systemctl --user restart rai-api rai-web`, or nohup fallback) → wait for
   `127.0.0.1:8000/api/health` and `127.0.0.1:3000/`.
4. `smoke` — `scripts/smoke.py` against the public URLs; a red smoke fails the
   run so a bad deploy is loud.

Server checkout refusing to move because of uncommitted local changes? Either
commit/stash them on the box, or rerun with `force=true` (`git reset --hard`).

## SSH route (fallback)

Repo secret `SSH_PRIVATE_KEY` (key authorized for the deploy user on the box)
+ variable `DEPLOY_HOST`; optional `DEPLOY_USER` (default `bob`),
`DEPLOY_PATH` (default `~/hackathons/rai/RAI`). With those set and no runner
online, `strategy` routes to SSH and streams `deploy/deploy.sh` to the box.
