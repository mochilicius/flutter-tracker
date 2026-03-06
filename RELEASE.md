# Release Notes — v0.1.0

**Initial release of Activity Tracker for Windows.**

Track where your time actually goes — by category, per day, right on your desktop.

---

## What's included

### Core tracking
- Monitors active Windows processes using `pywin32` and `psutil`.
- Records **open time** (process is running) and **focused time** (app is the foreground window) separately.
- Live display of the currently tracked active process.

### Category management
- Create and name custom activity categories (e.g. Studying, Gaming, Creative Work).
- Assign a custom accent colour to each category.
- Map application executable names to categories — tracking time is attributed automatically.

### Settings
- **Ping interval** — configure how often the tracker checks for window changes (default 1000 ms).
- **Start on system boot** — optionally register the app to launch on Windows sign-in.
- **Minimize to tray on close** — keep tracking silently in the system tray.
- **Data retention** — choose how many days of logs to keep; older records are pruned on startup.
- **State file tools** — reload the tracker cache from disk or import a JSON state file.

### Privacy & storage
- All data is stored locally in an SQLite database.
- No network requests, no accounts, no telemetry.
- Only process name and focus state are recorded — no keystrokes, clipboard, or screen content.

---

## Installation

Download `ActivityTracker-Setup.exe` from the assets below and run it.

Requirements: Windows 10 or later (x64).

---

## Known limitations

- Windows only (macOS / Linux support not planned at this time).
- Stats / charts view is not yet implemented — coming in a future release.
- The app must be running in the background for time to be recorded.

---

## What's coming next

- Weekly and monthly activity charts
- Idle / away detection
- CSV export
- Per-category goals and reminders
