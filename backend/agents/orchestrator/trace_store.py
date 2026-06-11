"""
Simple thread-safe file-based trace storage for the orchestrator pipeline.
Stores the steps of the last pipeline run.
"""
import json
import os
import threading

_lock = threading.Lock()
_TRACE_FILE = os.path.join(os.path.dirname(__file__), "_last_trace.json")


def clear_trace() -> None:
    """Clear the trace before a new pipeline run."""
    with _lock:
        _write([])


def append_step(agent: str, display_name: str, text: str) -> None:
    """Append a completed agent step to the trace."""
    with _lock:
        steps = _read()
        steps.append({
            "agent": agent,
            "display_name": display_name,
            "text": text,
        })
        _write(steps)


def get_trace() -> list:
    """Return all recorded steps from the last run."""
    with _lock:
        return _read()


def _read() -> list:
    if os.path.exists(_TRACE_FILE):
        try:
            with open(_TRACE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _write(steps: list) -> None:
    with open(_TRACE_FILE, "w", encoding="utf-8") as f:
        json.dump(steps, f, ensure_ascii=False, indent=2)
