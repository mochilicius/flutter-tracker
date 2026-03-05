# Activity Tracking App

## Project Summary

This project is a desktop activity tracking app for Windows. Users define activity categories (for example: studying, gaming, entertainment) and map apps/processes to those categories. The app tracks how long mapped apps are open and how long they are actively focused (foreground window).

## Goals

- Help users understand daily computer usage by category.
- Separate passive app-open time from active focused time.
- Keep all tracking data local on the user device.

## Tech Stack

- **Desktop Shell:** Python + `pywebview`
- **UI:** Local HTML/CSS/JavaScript (loaded in `pywebview`)
- **Tracking Service:** Python (Windows APIs + local bridge methods)
- **Database:** SQLite

## High-Level Architecture

1. Python starts a `pywebview` desktop window.
2. The window loads a local HTML UI file.
3. JavaScript calls Python methods through the `pywebview` JS API bridge.
4. Python tracker monitors active window/process state on Windows.
5. Tracking events are stored in SQLite and returned directly to the UI.

## Core Features (MVP)

- Define and manage activity categories.
- Map process names to categories (example: `code.exe -> studying`).
- Track:
	- **Open time:** app process exists.
	- **Focused time:** app is foreground/selected window.
- Display daily totals per category.
- View recent activity sessions.

## Tracking Logic

- Use event-driven timing: start a timer on focus gained, stop on focus lost, and add end - start.
    - On Windows, this is typically done with SetWinEventHook for foreground/window focus changes.
    - Safety net: occasional heartbeat (e.g., every 30–60s) to recover from missed events, crashes, sleep/resume, or lock/unlock transitions.
- Detect focused window with Windows APIs (`win32gui` + process ID lookup).
- Resolve process details with `psutil`.
- Attribute each second to matching category rules.
- Handle day rollover, app close/open transitions, and idle gaps safely.

## Local Bridge Methods (Example)

- `get_today_totals()` - daily category totals
- `get_recent_sessions()` - recent session records
- `get_rules()` - rule list
- `add_rule(process_name, category)` - create rule
- `update_rule(rule_id, process_name, category)` - update rule
- `delete_rule(rule_id)` - remove rule

## Suggested Folder Layout

np
activity-tracking-app/
	UI/                  # Local HTML/CSS/JS UI assets
	service/             # Python app + tracker + JS bridge
	data/                # SQLite database (local)
	docs/                # notes and project docs
```

## Development Notes

- Run the app directly with `pipenv run python .\service\main.py`.
- Keep UI as local files and communicate through the JS bridge.
- Package with `pyinstaller` for Windows distribution.

## Privacy & Security Principles

- Store data locally only (no cloud sync by default).
- Do not log keystrokes, clipboard, or page content.
- Track only process/window metadata needed for time attribution.

## Future Enhancements

- Weekly/monthly charts and trend analysis.
- Idle detection and break insights.
- Export reports to CSV.
- Optional reminders or goals by category.