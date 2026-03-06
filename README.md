# Activity Tracker

A Windows desktop app that tracks how long your applications are open and actively focused, and groups that time into categories you define.

All data stays on your machine — no accounts, no cloud sync.

---

## Features

- **Category-based tracking** — Group apps into categories (e.g. Studying, Gaming, Entertainment) and see time totals per category each day.
- **Open vs. focused time** — Separately tracks time an app process is running vs. time it is the active foreground window.
- **Live active process display** — See which app is being tracked right now at a glance.
- **Custom accent colours** — Assign a colour to each category for quick visual recognition.
- **Configurable ping interval** — Tune how frequently the tracker polls for updates to balance accuracy and performance.
- **Start on system boot** — Optionally launch the app automatically when you sign in.
- **Minimize to tray** — Keep tracking silently in the background when you close the window.
- **Data retention control** — Choose how many days of history to keep; older logs are pruned automatically.
- **State file tools** — Reload the tracker cache from disk or import a JSON state file.
- **100% local storage** — SQLite database on your own device; no keystrokes, clipboard, or page content is ever recorded.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 40 |
| UI | Angular 21 + PrimeNG 21 |
| Backend service | Python (FastAPI + uvicorn) |
| Database | SQLite (SQLAlchemy) |
| Windows tracking | pywin32 + psutil |
| Packaging | PyInstaller + electron-builder |

---

## Quick Start (Windows)

### Prerequisites

```powershell
winget install -e --id Git.Git
winget install -e --id Python.Python.3.12
winget install -e --id OpenJS.NodeJS.LTS
```

Verify:

```powershell
git --version   # 2.x
python --version  # 3.12.x
node --version  # 22.x LTS
npm --version
```

### First-time setup

From the project root:

```powershell
python -m pip install --user pipenv
pipenv install
npm run install:ui
```

### Run in development mode

```powershell
npm run dev
```

This starts the Angular dev server, the Python API service, and the Electron window concurrently.

---

## Building a distributable

### 1 — Build the Angular UI

```powershell
npm run build
```

### 2 — Package the Python backend

From the `UI` folder:

```powershell
cd .\UI
pipenv run pyinstaller --noconfirm --windowed --name ActivityTracker ..\service\main.py
```

Output: `UI\dist\ActivityTracker\ActivityTracker.exe`

### 3 — Package the Electron shell

```powershell
npm run dist
```

---

## Project Structure

```
activity-tracking-app/
├── electron/        # Electron main process & preload scripts
├── service/         # Python FastAPI service + Windows tracking logic
├── UI/              # Angular 21 frontend
│   └── src/app/
│       ├── main/    # Categories, app mappings, daily totals
│       ├── stats/   # Charts & history (coming soon)
│       └── settings/
├── data/            # Local SQLite database & settings files
└── build/           # PyInstaller build artefacts
```

---

## Privacy

- Tracks only process name and window focus state.
- No keystrokes, clipboard content, URLs, or screenshots are recorded.
- All data is stored locally in `data/` — nothing leaves your machine.

---

## Roadmap

- [ ] Weekly / monthly charts and trends
- [ ] Idle detection and break insights
- [ ] CSV export
- [ ] Goals and reminders by category

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
