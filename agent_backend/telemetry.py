"""OpenTelemetry → SigNoz export for the agent backend.

This module is the only place that imports opentelemetry. `obs.py` bridges its
spans/events through the helpers here, so when telemetry is off the backend
behaves exactly as before — same console output, same SSE stream, zero added
overhead.

Enabled by setting EITHER:

  * `SIGNOZ_INGESTION_KEY` (+ `SIGNOZ_REGION`, default `us`) — SigNoz Cloud.
    The OTLP endpoint is derived: https://ingest.<region>.signoz.cloud:443
  * `OTEL_EXPORTER_OTLP_ENDPOINT` — anything OTLP/HTTP, e.g. a self-hosted
    SigNoz collector at http://localhost:4318. No ingestion key needed.

For local debugging without any backend, `TELEMETRY_CONSOLE=1` prints spans to
stdout instead of exporting.

Init is code-based (called from main.py at app construction) rather than the
`opentelemetry-instrument` wrapper, because the documented dev flow here is
`uvicorn --reload` — the wrapper spawns a child process that loses
instrumentation. Code init survives reloads; a module-level guard prevents the
reloader's double-import from registering a second provider.
"""
from __future__ import annotations

import os
import subprocess
import sys

_ENABLED = False
_TRIED = False

_SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "rai-backend")

# Attribute values must be OTel primitives; anything else is stringified and
# truncated so a blob of document text can never become a span attribute.
_ATTR_STR_LIMIT = 500


def _service_version() -> str:
    v = os.getenv("OTEL_SERVICE_VERSION")
    if v:
        return v
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=2,
        ).stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _endpoint_and_headers() -> tuple[str, dict[str, str]]:
    """SigNoz Cloud from key+region, or a raw OTLP endpoint for self-host."""
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
    key = os.getenv("SIGNOZ_INGESTION_KEY", "")
    if endpoint:
        headers = {}
        if key:
            headers["signoz-ingestion-key"] = key
        return endpoint, headers
    region = os.getenv("SIGNOZ_REGION", "us")
    return f"https://ingest.{region}.signoz.cloud:443", {"signoz-ingestion-key": key}


def init_telemetry(app=None) -> bool:
    """Configure the TracerProvider and auto-instrument FastAPI/httpx.

    Returns True if telemetry is live. Never raises — a broken observability
    setup must not take the backend down, and missing otel packages just mean
    "telemetry off"."""
    global _ENABLED, _TRIED
    if _TRIED:  # uvicorn --reload imports main twice per process
        return _ENABLED
    _TRIED = True

    console_mode = os.getenv("TELEMETRY_CONSOLE") == "1"
    want_otlp = bool(os.getenv("SIGNOZ_INGESTION_KEY") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
    if not console_mode and not want_otlp:
        return False

    try:
        from opentelemetry import trace as otel_trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
            SimpleSpanProcessor,
        )
    except ImportError:
        print("telemetry: opentelemetry packages not installed — tracing stays local. "
              "pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http "
              "opentelemetry-instrumentation-fastapi opentelemetry-instrumentation-httpx",
              file=sys.stderr)
        return False

    resource = Resource.create({
        "service.name": _SERVICE_NAME,
        # Per-build value → SigNoz renders deployment markers between versions.
        "service.version": _service_version(),
    })
    provider = TracerProvider(resource=resource)

    if console_mode:
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
        where = "stdout (TELEMETRY_CONSOLE=1)"
    else:
        endpoint, headers = _endpoint_and_headers()
        provider.add_span_processor(BatchSpanProcessor(
            OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces", headers=headers),
        ))
        where = endpoint

    otel_trace.set_tracer_provider(provider)

    # Logs pipeline: obs.py events export as OTel log records alongside the
    # spans, sharing the same endpoint. Emitted with the active span's context
    # so SigNoz links logs ↔ traces bidirectionally.
    try:
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.sdk._logs import LoggerProvider
        from opentelemetry.sdk._logs.export import (
            BatchLogRecordProcessor,
            ConsoleLogExporter,
            SimpleLogRecordProcessor,
        )

        logger_provider = LoggerProvider(resource=resource)
        if console_mode:
            logger_provider.add_log_record_processor(
                SimpleLogRecordProcessor(ConsoleLogExporter()))
        else:
            logger_provider.add_log_record_processor(BatchLogRecordProcessor(
                OTLPLogExporter(endpoint=f"{endpoint}/v1/logs", headers=headers),
            ))
        set_logger_provider(logger_provider)
    except ImportError:
        print("telemetry: otel logs API unavailable — spans only", file=sys.stderr)

    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            FastAPIInstrumentor.instrument_app(app)
        except Exception as e:
            print(f"telemetry: FastAPI auto-instrumentation failed ({e})", file=sys.stderr)
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
        HTTPXClientInstrumentor().instrument()
    except Exception as e:
        print(f"telemetry: httpx auto-instrumentation failed ({e})", file=sys.stderr)

    _ENABLED = True
    print(f"telemetry: OTel spans exporting to {where} as service '{_SERVICE_NAME}'",
          file=sys.stderr)
    return True


def enabled() -> bool:
    return _ENABLED


def get_tracer():
    from opentelemetry import trace as otel_trace
    return otel_trace.get_tracer(_SERVICE_NAME)


def get_event_logger():
    """Logger for obs.py events → SigNoz Logs. Only call when enabled()."""
    from opentelemetry._logs import get_logger
    return get_logger(_SERVICE_NAME)


# obs.py level names → OTel severity numbers
SEVERITY = {
    "debug": "DEBUG",
    "info": "INFO",
    "warn": "WARN",
    "error": "ERROR",
}


def sanitize_attrs(data: dict) -> dict:
    """Coerce arbitrary event data into OTel-safe attribute values."""
    out = {}
    for k, v in data.items():
        if v is None:
            continue
        if isinstance(v, bool):
            out[k] = v
        elif isinstance(v, (int, float)):
            out[k] = v
        else:
            out[k] = str(v)[:_ATTR_STR_LIMIT]
    return out
