from __future__ import annotations

import atexit
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
import threading
import time

import os

import psutil
import uvicorn
import win32api
import win32gui
import win32process
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_FILE = Path(__file__).parent.parent / "data" / "tracker_state.json"


def _friendly_name(exe_name: str) -> str:
    """Try to get a human-readable product name from the exe on disk."""
    for proc in psutil.process_iter(["name", "exe"]):
        if (proc.info.get("name") or "").lower() == exe_name.lower():
            exe_path = proc.info.get("exe")
            if exe_path and os.path.isfile(exe_path):
                try:
                    info = win32api.GetFileVersionInfo(exe_path, "\\")
                    lang_page = win32api.GetFileVersionInfo(
                        exe_path, "\\VarFileInfo\\Translation"
                    )
                    if lang_page:
                        lang, codepage = lang_page[0]
                        key = f"\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"
                        desc = win32api.GetFileVersionInfo(exe_path, key)
                        if desc and desc.strip():
                            return desc.strip()
                except Exception:
                    pass
            break
    return exe_name.removesuffix(".exe").replace("_", " ").replace("-", " ").title()


@dataclass
class TrackerState:
    running: bool = True
    active_process: str = ""
    active_since: float = 0.0


class RuleBody(BaseModel):
    process_name: str
    category: str


class Tracker:
    def __init__(self, state: TrackerState):
        self._state = state
        self._rules: dict[str, str] = {}
        self._totals_seconds: dict[str, float] = {}
        self._app_totals_seconds: dict[str, float] = {}

    # ── Persistence ──────────────────────────────────────────────────────────

    def load(self, path: Path) -> None:
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self._rules = {k.lower(): v for k, v in data.get("rules", {}).items()}
            self._totals_seconds = data.get("totals_seconds", {})
            self._app_totals_seconds = data.get("app_totals_seconds", {})
        except Exception:
            pass

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({
                "rules": self._rules,
                "totals_seconds": self._totals_seconds,
                "app_totals_seconds": self._app_totals_seconds,
            }, indent=2),
            encoding="utf-8",
        )

    # ── Rules ────────────────────────────────────────────────────────────────

    def get_rules(self) -> list[dict[str, str]]:
        return [
            {"process": name, "category": cat}
            for name, cat in sorted(self._rules.items())
        ]

    def get_running_processes(self) -> list[dict[str, str]]:
        seen: set[str] = set()
        result: list[dict[str, str]] = []
        for proc in psutil.process_iter(["name"]):
            name = (proc.info.get("name") or "").strip()
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            result.append({"exe": name, "name": _friendly_name(name)})
        return sorted(result, key=lambda p: p["name"].lower())

    def add_rule(self, process_name: str, category: str) -> bool:
        key = process_name.strip().lower()
        value = category.strip()
        if not key or not value:
            return False
        if self._rules.get(key) == value:
            return False  # already in this exact category — duplicate
        self._rules[key] = value
        self._totals_seconds.setdefault(value, 0.0)
        return True

    def delete_rule(self, process_name: str) -> bool:
        key = process_name.strip().lower()
        if key in self._rules:
            del self._rules[key]
            return True
        return False

    # ── Totals ───────────────────────────────────────────────────────────────

    def get_today_totals(self) -> dict:
        return {
            "date": date.today().isoformat(),
            "totals_seconds": {
                cat: round(secs, 1)
                for cat, secs in sorted(self._totals_seconds.items())
            },
            "app_totals_seconds": {
                app: round(secs, 1)
                for app, secs in sorted(self._app_totals_seconds.items())
            },
            "active_process": self._state.active_process,
        }

    def tick(self, process_name: str, elapsed: float) -> None:
        key = process_name.lower()
        cat = self._rules.get(key)
        if cat:
            self._totals_seconds[cat] = self._totals_seconds.get(cat, 0.0) + elapsed
            self._app_totals_seconds[key] = self._app_totals_seconds.get(key, 0.0) + elapsed


def get_foreground_process_name() -> str:
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return ""
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    if not pid:
        return ""
    try:
        return (psutil.Process(pid).name() or "").strip()
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return ""


def run_tracker(tracker: Tracker, state: TrackerState) -> None:
    last_save = time.time()
    while state.running:
        now = time.time()
        current = get_foreground_process_name()
        if state.active_process and state.active_since > 0:
            tracker.tick(state.active_process, max(0.0, now - state.active_since))
        state.active_process = current
        state.active_since = now
        if now - last_save >= 60:
            tracker.save(DATA_FILE)
            last_save = now
        time.sleep(1.0)


state = TrackerState()
tracker = Tracker(state)
tracker.load(DATA_FILE)
atexit.register(tracker.save, DATA_FILE)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _start_tracker() -> None:
    threading.Thread(target=run_tracker, args=(tracker, state), daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/rules")
def get_rules():
    return tracker.get_rules()


@app.post("/rules")
def add_rule(body: RuleBody):
    return {"ok": tracker.add_rule(body.process_name, body.category)}


@app.delete("/rules/{process_name}")
def delete_rule(process_name: str):
    return {"ok": tracker.delete_rule(process_name)}


@app.get("/processes")
def get_processes():
    return tracker.get_running_processes()


@app.get("/totals")
def get_totals():
    return tracker.get_today_totals()


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
