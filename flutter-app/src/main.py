from __future__ import annotations

import atexit
import base64
import ctypes
import ctypes.wintypes as wintypes
import json
import struct
import zlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
import threading
import time

import os

import psutil
import uvicorn
import win32api
import win32gui
import win32process
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_FILE = Path(__file__).parent.parent / "data" / "tracker_state.json"

DEFAULT_CATEGORY_COLORS: dict[str, str] = {
    "Development":   "#E9BCB5",
    "Browsing":      "#927AD4",
    "Entertainment": "#ECE5F0",
    "System":        "#52508B",
}


def _rgba_to_png(width: int, height: int, rgba: bytes) -> bytes:
    """Minimal PNG encoder for raw RGBA pixel data."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _icon_to_png_base64(exe_path: str, size: int = 32) -> str | None:
    """Extract the first icon from an exe and return as a PNG data URL."""
    try:
        user32 = ctypes.windll.user32
        gdi32 = ctypes.windll.gdi32

        large = (ctypes.c_void_p * 1)()
        small = (ctypes.c_void_p * 1)()
        n = ctypes.windll.shell32.ExtractIconExW(exe_path, 0, large, small, 1)
        if n == 0 or not large[0]:
            return None
        hicon = large[0]

        hdc_screen = user32.GetDC(None)
        hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)

        class _BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [
                ("biSize",          wintypes.DWORD),
                ("biWidth",         ctypes.c_int),
                ("biHeight",        ctypes.c_int),
                ("biPlanes",        wintypes.WORD),
                ("biBitCount",      wintypes.WORD),
                ("biCompression",   wintypes.DWORD),
                ("biSizeImage",     wintypes.DWORD),
                ("biXPelsPerMeter", ctypes.c_int),
                ("biYPelsPerMeter", ctypes.c_int),
                ("biClrUsed",       wintypes.DWORD),
                ("biClrImportant",  wintypes.DWORD),
            ]

        bmi = _BITMAPINFOHEADER()
        bmi.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
        bmi.biWidth = size
        bmi.biHeight = -size   # negative = top-down
        bmi.biPlanes = 1
        bmi.biBitCount = 32
        bmi.biCompression = 0  # BI_RGB

        p_bits = ctypes.c_void_p()
        hbmp = gdi32.CreateDIBSection(hdc_screen, ctypes.byref(bmi), 0, ctypes.byref(p_bits), None, 0)
        old = gdi32.SelectObject(hdc_mem, hbmp)

        user32.DrawIconEx(hdc_mem, 0, 0, hicon, size, size, 0, None, 3)  # DI_NORMAL = 3

        buf = (ctypes.c_ubyte * (size * size * 4))()
        ctypes.memmove(buf, p_bits, size * size * 4)

        # BGRA → RGBA
        rgba = bytearray(size * size * 4)
        for i in range(size * size):
            rgba[i * 4]     = buf[i * 4 + 2]  # R
            rgba[i * 4 + 1] = buf[i * 4 + 1]  # G
            rgba[i * 4 + 2] = buf[i * 4]      # B
            rgba[i * 4 + 3] = buf[i * 4 + 3]  # A

        gdi32.SelectObject(hdc_mem, old)
        gdi32.DeleteObject(hbmp)
        gdi32.DeleteDC(hdc_mem)
        user32.ReleaseDC(None, hdc_screen)
        user32.DestroyIcon(hicon)

        return "data:image/png;base64," + base64.b64encode(_rgba_to_png(size, size, bytes(rgba))).decode()
    except Exception:
        return None


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


class RetentionBody(BaseModel):
    retention_days: int


class ImportStateBody(BaseModel):
    state: dict


class CategoryColorBody(BaseModel):
    category: str
    color: str


class Tracker:
    def __init__(self, state: TrackerState):
        self._state = state
        self._rules: dict[str, str] = {}
        self._totals_seconds: dict[str, float] = {}
        self._app_totals_seconds: dict[str, float] = {}
        self._daily_totals_seconds: dict[str, dict[str, float]] = {}
        self._daily_app_totals_seconds: dict[str, dict[str, float]] = {}
        self._daily_hourly_seconds: dict[str, dict[str, list[float]]] = {}
        self._category_colors: dict[str, str] = {}
        self._retention_days = 30

    # ── Persistence ──────────────────────────────────────────────────────────

    def load(self, path: Path) -> None:
        if not path.exists():
            self._category_colors = dict(DEFAULT_CATEGORY_COLORS)
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            self._rules = {k.lower(): v for k, v in data.get("rules", {}).items()}
            self._totals_seconds = data.get("totals_seconds", {})
            self._app_totals_seconds = data.get("app_totals_seconds", {})
            self._daily_totals_seconds = data.get("daily_totals_seconds", {})
            self._daily_app_totals_seconds = data.get("daily_app_totals_seconds", {})
            self._daily_hourly_seconds = self._normalize_hourly_map(data.get("daily_hourly_seconds", {}))
            self._category_colors = {
                str(k): str(v)
                for k, v in data.get("category_colors", {}).items()
                if isinstance(k, str) and isinstance(v, str)
            }
            self._retention_days = self._normalize_retention_days(data.get("retention_days", 30))
        except Exception:
            pass

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.export_state(), indent=2),
            encoding="utf-8",
        )

    def export_state(self) -> dict:
        return {
            "rules": self._rules,
            "totals_seconds": self._totals_seconds,
            "app_totals_seconds": self._app_totals_seconds,
            "daily_totals_seconds": self._daily_totals_seconds,
            "daily_app_totals_seconds": self._daily_app_totals_seconds,
            "daily_hourly_seconds": self._daily_hourly_seconds,
            "category_colors": self._category_colors,
            "retention_days": self._retention_days,
        }

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

    def get_category_colors(self) -> dict[str, str]:
        return dict(sorted(self._category_colors.items()))

    def set_category_color(self, category: str, color: str) -> bool:
        cat = category.strip()
        if not cat:
            return False
        if not self._is_valid_hex_color(color):
            return False
        self._category_colors[cat] = color.upper()
        return True

    # ── Totals ───────────────────────────────────────────────────────────────

    def get_today_totals(self) -> dict:
        today = date.today().isoformat()
        todays_totals = self._daily_totals_seconds.get(today, {})
        todays_app_totals = self._daily_app_totals_seconds.get(today, {})
        return {
            "date": today,
            "totals_seconds": {
                cat: round(secs, 1)
                for cat, secs in sorted(todays_totals.items())
            },
            "app_totals_seconds": {
                app: round(secs, 1)
                for app, secs in sorted(todays_app_totals.items())
            },
            "active_process": self._state.active_process,
        }

    def get_all_daily_totals(self) -> dict:
        return {
            "daily_totals_seconds": {
                day: {cat: round(secs, 1) for cat, secs in totals.items()}
                for day, totals in sorted(self._daily_totals_seconds.items())
            },
            "daily_app_totals_seconds": {
                day: {app: round(secs, 1) for app, secs in totals.items()}
                for day, totals in sorted(self._daily_app_totals_seconds.items())
            },
            "daily_hourly_seconds": {
                day: {
                    cat: [round(s, 1) for s in hours]
                    for cat, hours in cats.items()
                }
                for day, cats in sorted(self._daily_hourly_seconds.items())
            },
            "category_colors": self._category_colors,
        }

    def tick(self, process_name: str, elapsed: float) -> None:
        key = process_name.lower()
        cat = self._rules.get(key)
        if cat:
            today = date.today().isoformat()
            hour = datetime.now().hour
            day_totals = self._daily_totals_seconds.setdefault(today, {})
            day_app_totals = self._daily_app_totals_seconds.setdefault(today, {})
            day_hourly = self._daily_hourly_seconds.setdefault(today, {})

            self._totals_seconds[cat] = self._totals_seconds.get(cat, 0.0) + elapsed
            self._app_totals_seconds[key] = self._app_totals_seconds.get(key, 0.0) + elapsed
            day_totals[cat] = day_totals.get(cat, 0.0) + elapsed
            day_app_totals[key] = day_app_totals.get(key, 0.0) + elapsed
            if cat not in day_hourly:
                day_hourly[cat] = [0.0] * 24
            day_hourly[cat][hour] += elapsed

    def set_retention_days(self, days: int) -> int:
        self._retention_days = self._normalize_retention_days(days)
        return self._retention_days

    def get_retention_days(self) -> int:
        return self._retention_days

    def on_startup(self) -> None:
        removed_days = self.clear_old_dated_logs()
        print(f"[startup] retention_days={self._retention_days}, removed_dated_logs={removed_days}")

    def reload_from_disk(self, path: Path) -> None:
        self._rules = {}
        self._totals_seconds = {}
        self._app_totals_seconds = {}
        self._daily_totals_seconds = {}
        self._daily_app_totals_seconds = {}
        self._daily_hourly_seconds = {}
        self._category_colors = {}
        self._retention_days = 30
        self.load(path)

    def import_state(self, imported: dict) -> bool:
        if not isinstance(imported, dict):
            return False

        self._rules = {
            str(k).lower(): str(v)
            for k, v in imported.get("rules", {}).items()
            if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
        }
        self._totals_seconds = self._normalize_number_map(imported.get("totals_seconds", {}))
        self._app_totals_seconds = self._normalize_number_map(imported.get("app_totals_seconds", {}))
        self._daily_totals_seconds = self._normalize_nested_number_map(imported.get("daily_totals_seconds", {}))
        self._daily_app_totals_seconds = self._normalize_nested_number_map(imported.get("daily_app_totals_seconds", {}))
        self._daily_hourly_seconds = self._normalize_hourly_map(imported.get("daily_hourly_seconds", {}))
        self._category_colors = {
            str(k): str(v).upper()
            for k, v in imported.get("category_colors", {}).items()
            if isinstance(k, str) and isinstance(v, str) and self._is_valid_hex_color(v)
        }
        self._retention_days = self._normalize_retention_days(imported.get("retention_days", 30))
        self.on_startup()
        return True

    def clear_old_dated_logs(self) -> int:
        cutoff = date.today() - timedelta(days=self._retention_days)
        before = len(self._daily_totals_seconds)
        self._daily_totals_seconds = {
            day: totals
            for day, totals in self._daily_totals_seconds.items()
            if self._is_on_or_after_cutoff(day, cutoff)
        }
        self._daily_app_totals_seconds = {
            day: totals
            for day, totals in self._daily_app_totals_seconds.items()
            if self._is_on_or_after_cutoff(day, cutoff)
        }
        self._daily_hourly_seconds = {
            day: cats
            for day, cats in self._daily_hourly_seconds.items()
            if self._is_on_or_after_cutoff(day, cutoff)
        }
        after = len(self._daily_totals_seconds)
        return max(0, before - after)

    def clear_all_data(self) -> None:
        """Clear all tracked activity data."""
        self._totals_seconds = {}
        self._app_totals_seconds = {}
        self._daily_totals_seconds = {}
        self._daily_app_totals_seconds = {}
        self._daily_hourly_seconds = {}
        self._rules = {}
        self._category_colors = {}
        self._retention_days = 30

    def clear_time_data(self) -> None:
        """Clear only tracked time data, preserving rules and category colors."""
        self._totals_seconds = {}
        self._app_totals_seconds = {}
        self._daily_totals_seconds = {}
        self._daily_app_totals_seconds = {}
        self._daily_hourly_seconds = {}

    def _normalize_retention_days(self, days: int) -> int:
        try:
            parsed = int(days)
        except Exception:
            return 30
        return max(1, parsed)

    def _is_on_or_after_cutoff(self, day: str, cutoff: date) -> bool:
        try:
            parsed = datetime.strptime(day, "%Y-%m-%d").date()
        except ValueError:
            return False
        return parsed >= cutoff

    def _normalize_number_map(self, value: dict) -> dict[str, float]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, float] = {}
        for key, raw in value.items():
            if not isinstance(key, str):
                continue
            try:
                result[key] = float(raw)
            except Exception:
                continue
        return result

    def _normalize_nested_number_map(self, value: dict) -> dict[str, dict[str, float]]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, dict[str, float]] = {}
        for day, totals in value.items():
            if not isinstance(day, str):
                continue
            result[day] = self._normalize_number_map(totals)
        return result

    def _normalize_hourly_map(self, value: dict) -> dict[str, dict[str, list[float]]]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, dict[str, list[float]]] = {}
        for day, cats in value.items():
            if not isinstance(day, str) or not isinstance(cats, dict):
                continue
            day_result: dict[str, list[float]] = {}
            for cat, hours in cats.items():
                if not isinstance(cat, str) or not isinstance(hours, list):
                    continue
                hour_list = [0.0] * 24
                for i, v in enumerate(hours[:24]):
                    try:
                        hour_list[i] = float(v)
                    except Exception:
                        pass
                day_result[cat] = hour_list
            result[day] = day_result
        return result

    def _is_valid_hex_color(self, color: str) -> bool:
        if not isinstance(color, str):
            return False
        if len(color) != 7 or not color.startswith("#"):
            return False
        hex_part = color[1:]
        return all(ch in "0123456789abcdefABCDEF" for ch in hex_part)


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
    allow_origins=[
        "null",
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://localhost:4317",
        "http://127.0.0.1:4317",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _start_tracker() -> None:
    tracker.on_startup()
    tracker.save(DATA_FILE)
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


@app.get("/daily-totals")
def get_daily_totals():
    return tracker.get_all_daily_totals()


@app.post("/settings/retention-days")
def set_retention_days(body: RetentionBody):
    days = tracker.set_retention_days(body.retention_days)
    removed_days = tracker.clear_old_dated_logs()
    tracker.save(DATA_FILE)
    print(f"[settings] retention_days={days}, removed_dated_logs={removed_days}")
    return {"ok": True, "retention_days": days}


@app.post("/settings/reload-cache")
def reload_cache():
    tracker.reload_from_disk(DATA_FILE)
    tracker.on_startup()
    tracker.save(DATA_FILE)
    print("[settings] cache reloaded from tracker_state.json")
    return {"ok": True}


@app.post("/settings/import-state")
def import_state(body: ImportStateBody):
    ok = tracker.import_state(body.state)
    if not ok:
        return {"ok": False}
    tracker.save(DATA_FILE)
    print("[settings] imported state from file")
    return {"ok": True}


@app.post("/settings/clear-data")
def clear_data():
    tracker.clear_all_data()
    tracker.save(DATA_FILE)
    print("[settings] cleared all tracked activity data")
    return {"ok": True}


@app.post("/settings/clear-time-data")
def clear_time_data():
    tracker.clear_time_data()
    tracker.save(DATA_FILE)
    print("[settings] cleared time data (rules and colors preserved)")
    return {"ok": True}


@app.get("/settings/export-cache")
def export_cache():
    return tracker.export_state()


@app.get("/category-colors")
def get_category_colors():
    return tracker.get_category_colors()


@app.post("/category-colors")
def set_category_color(body: CategoryColorBody):
    ok = tracker.set_category_color(body.category, body.color)
    if ok:
        tracker.save(DATA_FILE)
    return {"ok": ok}


@app.get("/app-icon/{exe_name}")
def get_app_icon(exe_name: str):
    """Return the first icon of an exe as a PNG data URL, found via running processes."""
    exe_path: str | None = None
    for proc in psutil.process_iter(["name", "exe"]):
        try:
            if (proc.info.get("name") or "").lower() == exe_name.lower():
                p = proc.info.get("exe")
                if p and os.path.isfile(p):
                    exe_path = p
                    break
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    if not exe_path:
        raise HTTPException(status_code=404, detail="Process not found")

    data_url = _icon_to_png_base64(exe_path)
    if not data_url:
        raise HTTPException(status_code=404, detail="Could not extract icon")

    return {"data_url": data_url}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_config=None)
