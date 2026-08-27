#!/usr/bin/env python3
"""Hatchet workflow worker — runs the RAI pipeline as durable Hatchet steps.

Started as a separate process by main.py's lifespan handler when
HATCHET_CLIENT_TOKEN is set. Must run as its own process (not a daemon
thread) because signal.signal() can only be called from the main thread.

Logs to /tmp/hatchet-worker.log.
"""
from __future__ import annotations

import os
import sys

# Ensure the project root is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env if present (systemd EnvironmentFile doesn't apply when run directly)
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

# Hatchet Lite runs insecure gRPC on IPv4 — the client must match.
os.environ.setdefault("HATCHET_CLIENT_TLS_STRATEGY", "none")
os.environ.setdefault("HATCHET_CLIENT_HOST_PORT", "127.0.0.1:7077")


def main() -> None:
    from agent_backend.hatchet_workflow import get_hatchet, get_workflow

    client = get_hatchet()
    wf = get_workflow()
    if client is None or wf is None:
        print("[hatchet] HATCHET_CLIENT_TOKEN not set — exiting")
        sys.exit(0)

    print("[hatchet] starting worker (rai-pipeline, 4 slots)")
    client.worker("rai-pipeline", slots=4, workflows=[wf]).start()


if __name__ == "__main__":
    main()
