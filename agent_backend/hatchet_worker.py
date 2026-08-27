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

# Hatchet Lite runs insecure gRPC on IPv4 — the client must match.
# HATCHET_CLIENT_TLS_STRATEGY=none disables TLS.
# HATCHET_CLIENT_HOST_PORT forces IPv4 (localhost resolves to ::1 otherwise).
os.environ.setdefault("HATCHET_CLIENT_TLS_STRATEGY", "none")
os.environ.setdefault("HATCHET_CLIENT_HOST_PORT", "127.0.0.1:7077")

from agent_backend.hatchet_workflow import hatchet, pipeline_wf

if hatchet is None or pipeline_wf is None:
    print("[hatchet] HATCHET_CLIENT_TOKEN not set — exiting")
    sys.exit(0)

print("[hatchet] starting worker (rai-pipeline, 4 slots)")
hatchet.worker("rai-pipeline", slots=4, workflows=[pipeline_wf]).start()
