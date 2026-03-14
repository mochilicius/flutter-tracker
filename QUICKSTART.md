# Activity Tracker - Quick Start

A Windows desktop app that tracks foreground application usage by category with real-time stats and history.

## Tech Stack

- **Frontend**: Angular 21 + PrimeNG (Electron renderer)
- **Backend**: Python 3.13 + FastAPI (activity tracking daemon)
- **Desktop Shell**: Electron
- **Data**: JSON persistence (`tracker_state.json`)

## Prerequisites

- Node.js 18+
- Python 3.13+
- Git

## Dev Setup

```bash
# Install dependencies
npm install
cd flutter-app && npm install && cd ..

# Install Python deps
pip install -r requirements.txt
# or with pipenv:
pipenv install --dev
```

## Running

```bash
# Start dev environment (concurrently runs UI, backend, Electron)
npm run dev
```

This launches:
- Angular dev server (http://127.0.0.1:4317)
- FastAPI backend (http://127.0.0.1:8000)
- Electron UI wrapper

## Building

```bash
# Fast development build (portable, ~30-45 seconds)
npm run dist:fast

# Full production build (installer, ~2-3 minutes)  
npm run dist

# Fast installer build (for testing)
npm run dist:installer-fast
```

Outputs:
- Angular build: `flutter-app/dist/flutter-app/` (temporary)
- Python backend: `build/ActivityTrackerBuild/` (working directory)
- Electron portable: `build/win-unpacked/Flutter.exe`
- Electron installer: `build/Install-Flutter.exe` (NSIS)

## Architecture

**Tracking Flow:**
```
Windows Foreground Monitor (Python)
  ↓ (every 1 second)
TrackerState (in-memory)
  ↓ (every 60 seconds)
tracker_state.json (persistent)
  ↑
FastAPI REST API
  ↑ (HTTP polling)
Angular UI + Electron Shell
```

**Data Structure:**
- `rules`: process → category mapping
- `daily_totals_seconds`: per-category daily totals
- `daily_app_totals_seconds`: per-app daily totals
- `daily_hourly_seconds`: hourly breakdown per category
- `category_colors`: custom category colors

## Key Files

| File | Purpose |
|------|---------|
| `/flutter-app/src/main.py` | FastAPI backend + activity tracker |
| `/flutter-app/src/app/main/main.ts` | Tab: Time Management (categories, today's stats) |
| `/flutter-app/src/app/stats/stats.ts` | Tab: Stats (24h chart, app breakdown) |
| `/flutter-app/src/app/settings/settings.ts` | Tab: Settings (data, retention, import/export) |
| `/electron/main.cjs` | Electron main process, IPC, backend spawning |
| `/data/tracker_state.json` | Runtime state (categories, rules, tracking data) |

## Features

- **Category Management**: Create/edit categories and map processes
- **Daily Tracking**: Real-time doughnut chart and activity stats
- **24h Activity Chart**: Hourly breakdown by category
- **App Breakdown**: Time per app, grouped by category
- **History**: View past days' stats via mini donut selector
- **Color Picker**: Custom category colors with hex input
- **Data Export/Import**: Full state persistence and recovery
- **Retention Policy**: Auto-prune data older than N days (default 30)

## Debugging

**Backend logs**: Check Electron `userData/debug.log`

**API health check**: `curl http://127.0.0.1:8000/health`

**Reload data from disk**: Settings tab → "Reload cache"

**Clear data**: Settings tab → "Clear all data" or "Clear time data"

## More Details

See `code-guide.md` for detailed architecture and file reference.
