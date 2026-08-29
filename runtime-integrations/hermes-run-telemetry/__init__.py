"""Best-effort, turn-level Run telemetry for the pinned Hermes runtime."""

from __future__ import annotations

import json
import os
import threading
import urllib.request
from datetime import datetime, timezone
from typing import Any


_started_at: dict[str, datetime] = {}
_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _run_id(kwargs: dict[str, Any]) -> str | None:
    value = kwargs.get("turn_id")
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized[:240] or None


def _trigger_type(platform: Any) -> str:
    normalized = str(platform or "").strip().lower()
    if normalized in {"cron", "scheduled", "scheduler"}:
        return "SCHEDULED"
    if normalized in {"api", "acp", "webhook"}:
        return "API"
    if normalized in {"delegation", "subagent"}:
        return "DELEGATION"
    return "USER"


def _post(payload: dict[str, Any]) -> None:
    endpoint = os.environ.get("TALI_RUN_TELEMETRY_ENDPOINT", "")
    token = os.environ.get("TALI_RUN_TELEMETRY_TOKEN", "")
    if not endpoint or not token:
        return
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status >= 400:
            raise RuntimeError(f"Run telemetry returned HTTP {response.status}")


def _deliver(payload: dict[str, Any]) -> None:
    def send() -> None:
        try:
            _post(payload)
        except Exception as error:
            print(f"[tali-run-telemetry] {error}", flush=True)

    # Keep the process alive for at most the request timeout so one-shot CLI
    # sessions cannot exit before their terminal event is delivered.
    threading.Thread(target=send, name="tali-run-telemetry").start()


def on_pre_llm_call(**kwargs: Any) -> None:
    """Start one Run before Hermes enters the turn's tool-calling loop."""
    run_id = _run_id(kwargs)
    if run_id is None:
        return
    now = _now()
    with _lock:
        _started_at[run_id] = now
    _deliver({
        "event": "started",
        "runId": run_id,
        "occurredAt": _iso(now),
        "triggerType": _trigger_type(kwargs.get("platform")),
    })


def on_session_end(**kwargs: Any) -> None:
    """Finish the Run after every run_conversation call, including interruption."""
    run_id = _run_id(kwargs)
    if run_id is None:
        return
    now = _now()
    with _lock:
        started = _started_at.pop(run_id, now)
    interrupted = bool(kwargs.get("interrupted"))
    completed = bool(kwargs.get("completed"))
    status = "CANCELLED" if interrupted else "SUCCEEDED" if completed else "FAILED"
    terminal_reason = (
        "CANCELLED" if interrupted else "COMPLETED" if completed else "RUNTIME_ERROR"
    )
    payload: dict[str, Any] = {
        "event": "finished",
        "runId": run_id,
        "occurredAt": _iso(now),
        "status": status,
        "terminalReason": terminal_reason,
        "durationMs": max(0, int((now - started).total_seconds() * 1000)),
    }
    if status == "FAILED":
        payload["errorCategory"] = "RUNTIME_ERROR"
    _deliver(payload)


def register(ctx: Any) -> None:
    """Register once-per-turn lifecycle hooks in Hermes v0.19."""
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("on_session_end", on_session_end)
