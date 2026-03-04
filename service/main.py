from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
import threading
import time

import psutil
import webview
import win32gui
import win32process


@dataclass
class TrackerState:
    running: bool = True
    active_process: str = ""
    active_since: float = 0.0


class DesktopApi:
    def __init__(self, tracker_state: TrackerState):
        self._tracker_state = tracker_state
        self._rules: dict[str, str] = {}
        self._totals_seconds: dict[str, float] = {}

    def health(self) -> dict[str, str]:
        return {"status": "ok", "mode": "pywebview"}

    def get_rules(self) -> list[dict[str, str]]:
        return [
            {"process": process_name, "category": category}
            for process_name, category in sorted(self._rules.items())
        ]

    def get_running_processes(self) -> list[str]:
        names: set[str] = set()
        for process in psutil.process_iter(["name"]):
            name = (process.info.get("name") or "").strip()
            if not name:
                continue
            names.add(name)
        return sorted(names, key=str.lower)

    def add_rule(self, process_name: str, category: str) -> dict[str, bool]:
        key = (process_name or "").strip().lower()
        value = (category or "").strip()
        if not key or not value:
            return {"ok": False}
        self._rules[key] = value
        self._totals_seconds.setdefault(value, 0.0)
        return {"ok": True}

    def delete_rule(self, process_name: str) -> dict[str, bool]:
        key = (process_name or "").strip().lower()
        if key in self._rules:
            del self._rules[key]
            return {"ok": True}
        return {"ok": False}

    def get_today_totals(self) -> dict[str, object]:
        return {
            "date": date.today().isoformat(),
            "totals_seconds": {
                category: round(seconds, 1)
                for category, seconds in sorted(self._totals_seconds.items())
            },
            "active_process": self._tracker_state.active_process,
        }

    def _tick_active_process(self, process_name: str, elapsed_seconds: float) -> None:
        category = self._rules.get(process_name.lower())
        if not category:
            return
        self._totals_seconds[category] = self._totals_seconds.get(category, 0.0) + elapsed_seconds


def get_foreground_process_name() -> str:
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return ""
    _, process_id = win32process.GetWindowThreadProcessId(hwnd)
    if not process_id:
        return ""
    try:
        process = psutil.Process(process_id)
        return (process.name() or "").strip()
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return ""


def run_tracker(api: DesktopApi, state: TrackerState) -> None:
    while state.running:
        now = time.time()
        current_process = get_foreground_process_name()

        if state.active_process and state.active_since > 0:
            elapsed = max(0.0, now - state.active_since)
            api._tick_active_process(state.active_process, elapsed)

        state.active_process = current_process
        state.active_since = now
        time.sleep(1.0)


def resolve_ui_file() -> Path:
    repo_root = Path(__file__).resolve().parents[1]
    return repo_root / "UI" / "desktop.html"


def main() -> None:
    ui_file = resolve_ui_file()
    if not ui_file.exists():
        raise FileNotFoundError(f"UI file not found: {ui_file}")

    tracker_state = TrackerState()
    api = DesktopApi(tracker_state)
    tracker_thread = threading.Thread(target=run_tracker, args=(api, tracker_state), daemon=True)
    tracker_thread.start()

    window = webview.create_window("Activity Tracker", ui_file.as_uri(), js_api=api, width=1100, height=760)
    webview.start()

    tracker_state.running = False
    if window:
        return


if __name__ == "__main__":
    main()
