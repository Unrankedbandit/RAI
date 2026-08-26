# Deploy — gated CD for the live stack

`Actions → Deploy → Run workflow` ships a ref to the live box, rebuilds,
restarts the live services, waits on local health, then gates on
`scripts/smoke.py` against the public URLs. CI must be green on the ref
(override: `force=true`).

| Piece | File | Runs |
|---|---|---|
| Workflow (manual trigger) | `.github/workflows/deploy.yml` | GitHub → the box |
| Server-side deploy | `deploy/deploy.sh` | on the box |
| Runner setup (one-time) | `deploy/install-runner.sh` | on the box, once |
| Generic bootstrap (other hosts only) | `deploy/bootstrap.sh` + `rai-api/rai-web.service` | not needed on bob |

## Live topology (bob)

- Live checkout: **`~/sites/RAI`** (clean main; the dev clone
  `~/hackathons/rai/RAI` is never touched by deploys)
- `rai-api-live.service` — uvicorn on `127.0.0.1:8010`; public API is the
  `rai-api-public` CORS proxy on `:8891` → `rai-live-api.josephbissell.com`
- `rai-site.service` — `next start` on `127.0.0.1:3200` →
  `rai-live.josephbissell.com` via the cloudflared gate
- `rai-guardian.service` — babysits the public backend (not part of deploys)

The box is outbound-only behind cloudflared, so deploys ride a **self-hosted
Actions runner on the box** (outbound poll — nothing inbound, no SSH keys in
secrets). SSH remains as a fallback route (`SSH_PRIVATE_KEY` + `DEPLOY_HOST`
repo config) for other hosts.

## One-time setup

On the box (`gh` is authenticated there):

```bash
git -C ~/hackathons/rai/RAI pull
bash ~/hackathons/rai/RAI/deploy/install-runner.sh
```

Registers the box as a self-hosted runner (token minted locally via `gh` —
no secrets leave the box) as systemd user service `gh-runner-rai`. Then
`Actions → Deploy → Run workflow`.

`rai-hook.service` (the old push webhook → `~/sites/rai_deploy.sh`) is
**retired** — it deployed ungated on every push, racing the guarded workflow.
To re-enable in an emergency:
`systemctl --user enable --now rai-hook.service`.

## How a deploy works

1. `guard` — resolves the ref, requires the latest CI run on that SHA green
   (`force=true` overrides).
2. `strategy` — online self-hosted runner → run on the box; else SSH if
   configured; else skip green (fork-friendly, same convention as `smoke.yml`).
3. `deploy_*` — runs `deploy/deploy.sh`: fetch → checkout → pip only if
   `requirements.txt` changed → `npm ci` + `next build` → restart
   `rai-api-live` + `rai-site` → wait for `127.0.0.1:8010/api/health` and
   `127.0.0.1:3200/`.
4. `smoke` — `scripts/smoke.py` against the public URLs; red smoke = red run.

Tracked local edits in `~/sites/RAI` block a deploy (runtime artifacts like
`agent_backend/reports/*.json` don't). Rerun with `force=true` to reset them.

## Related ops pieces on the box

- `gpu-power-cap.service` — 270W cap + 1800MHz SM clamp on both 3090s
  (PSU-transient mitigation, 2026-08-26)
- Run admission control — `PIPELINE_MAX_RUNS` / `PIPELINE_MAX_QUEUE` in
  `agent_backend/main.py`; live saturation visible in `/api/health.capacity`
