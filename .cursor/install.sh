#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for RAI (FastAPI backend + Next.js frontend).
# Runs after the repo is checked out. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Python venv support — the base image ships python3.12 without the venv
#    module (ensurepip). The repo's tooling (CLAUDE.md, check-all) expects
#    .venv/bin/python, so make the module available. No-op once installed.
if ! dpkg -s python3.12-venv >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3.12-venv
fi

# 2. Node >=22.18 — scripts/test-adapter-parity.mjs imports a .ts module
#    directly, which needs Node's default type-stripping (22.18+). The base
#    image's default node is older, so pin a known-good v22 at /usr/local.
NODE_VERSION="v22.23.2"
node_ok() { [ -x /usr/local/bin/node ] && /usr/local/bin/node -e \
  'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }
if ! node_ok; then
  case "$(uname -m)" in x86_64) NA=x64;; aarch64) NA=arm64;; *) NA=x64;; esac
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NA}.tar.xz" -o /tmp/node.tar.xz
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
fi

# 3. Backend: virtualenv + Python dependencies.
python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install -r agent_backend/requirements.txt

# 4. Frontend: install from the lockfile.
(cd frontend && npm ci)

echo "RAI install complete: $(.venv/bin/python --version), node $(/usr/local/bin/node --version)"
