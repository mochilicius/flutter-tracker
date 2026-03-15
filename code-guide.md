# Activity Tracking App - Developer Reference for AI Agents

**Last Updated**: 2026-03-11 (Donut chart border+corners, stats day selector with mini donuts, PrimeNG color picker)
**App Names**: "Flutter" (UI/branding), "ActivityTracker" (Python backend)
**Tech Stack**: Python 3.13 (FastAPI backend), Node.js (Electron + Angular 21 frontend)

---

## Branch Strategy

- **dev**: Development branch with build files included
- **main**: Production branch with build files excluded

## 🚀 Quick Start & Build Commands

### 📦 Setup
```bash
npm install
pipenv install  # Install Python dependencies
```

### 🔧 Development
```bash
npm run dev              # Start development server
npm run dev:with-mock    # Start with mock data
```

### 🏗️ Build & Package
```bash
npm run dist:fast              # Quick build (no installer)
npm run dist:fast-installer    # Quick build with installer
npm run dist                    # Full production build
```

## Quick Reference: File Structure & Purpose

This codebase is a **Windows activity tracker** that monitors foreground application usage and displays it in a timeline/analytics dashboard.

### Root Directory

| File/Folder | Purpose |
|---|---|
| `package.json` | Root npm workspace (delegates to UI/, hosts electron + electron-builder dev deps) |
| `Pipfile` | Python dependency manifest (psutil, pywin32, fastapi, uvicorn, pyinstaller) |
| `ActivityTracker.spec` | PyInstaller config: builds `service/main.py` → `ActivityTracker.exe` |
| `run-packaged.ps1` | PowerShell launcher for packaged distribution |
| `electron/` | Electron main process, tray, IPC, backend spawning |
| `service/` | Python FastAPI backend + Windows activity tracker daemon |
| `UI/` | Angular 21 frontend (Electron renderer) |
| `assets/` | App icon (SVG + ICO) |
| `data/` | Runtime data directory (tracker_state.json, ui_settings.json) |

---

## Core Architecture

```
Windows Activity Monitor (Python daemon)
         ↓ (1-second polling via win32gui/psutil)
   TrackerState (in-memory)
         ↓ (every 60 seconds + on shutdown)
   tracker_state.json (persistent store)
         ↑
   FastAPI REST API (127.0.0.1:8000)
         ↑ (HTTP polling)
   Angular UI + Electron Shell
         ↓ (IPC events for settings)
   ui_settings.json (Electron persists UI prefs)
```

---

## Detailed File Reference

### `/electron/main.cjs` — Electron Main Process

**Responsibility**: Window management, IPC, backend spawning, logging, settings persistence.

**Key Entry Points**:
- **`startBackend()`**: Spawns `resources/backend/ActivityTracker.exe` in production. Logs stdout/stderr to `userData/debug.log`. Child process is tied to parent lifecycle (`beforeQuit` event kills it).
- **`pollUrl(url, timeout, interval)`**: HTTP health check poller. Waits for both Angular dev server (4317) and Python backend (8000) before showing UI.
- **`createWindow()`**: Creates frameless BrowserWindow (1200×800 min, 900×620). Loads `loading.html` first, polls, then loads real UI. In dev: `http://127.0.0.1:4317`. In prod: `file:///<dist-path>/index.html`.
- **`ensureTray()`**: Creates system tray icon if `minimizeToTrayOnClose` is enabled. Single-click toggles window visibility.

**IPC Handlers** (Renderer → Main):
- `window:minimize` → minimizes window
- `window:close` → quit app or minimize to tray (emits `app:quitting` before quit)
- `settings:start-on-boot` → calls `app.setLoginItemSettings()`
- `settings:minimize-to-tray` → creates tray on demand
- `settings:applied` → saves payload to `ui_settings.json`
- `settings:read` → returns `ui_settings.json` contents
- `settings:update` → merges payload into `ui_settings.json`

**IPC Emits** (Main → Renderer):
- `app:quitting` → fired before app exits (500ms before actual quit)

**Logging**: Appended to `userData/debug.log` with timestamps. Useful for debugging backend spawn failures.

**Critical Detail**: The app **does NOT use a localhost tunnel or IPC for backend communication**. It spawns the backend as a localhost HTTP service and makes ordinary HTTP calls. This means the backend must start quickly, or the health check will timeout.

---

### `/electron/preload.cjs` — IPC Bridge

**Responsibility**: Safely expose Electron APIs to renderer process via context bridge.

**Exposed Methods** (on `window.electronAPI`):
```typescript
electronAPI: {
  minimizeWindow(): void,
  closeWindow(): void,
  setStartOnBoot(enabled: boolean): void,
  setMinimizeToTrayOnClose(enabled: boolean): void,
  logSettingsApplied(payload: any): void,
  readSettings(): Promise<UISettings>,
  updateSettings(payload: Partial<UISettings>): Promise<void>,
  onAppQuitting(callback: () => void): void
}
```

**Note**: `electronAPI` is NOT TypeScript; it's a plain object. The UI codebase likely has a `.d.ts` shim or inline types.

---

### `/electron/loading.html` — Splash Screen

**Responsibility**: Shown while backend health check is pending.

**Content**: Self-contained HTML + CSS (no external dependencies). Purple theme matching app branding. Spinning CSS animation + "Flutter" + "Starting services..." text.

**Why Separate File**: Reduces webpack complexity; loads synchronously before Angular hydrates.

---

### `/service/main.py` — Python FastAPI Backend

**Responsibility**: Windows foreground-window detection + time attribution + REST API.

**Core Classes**:

#### `TrackerState` (dataclass)
Simple mutable bag shared between tracker thread and API handlers:
- `running: bool`
- `active_process: str` (current foreground exe name)
- `active_since: float` (Unix timestamp when process became active)

#### `Tracker` (main logic class)
Holds all tracking data. **Thread-unsafe** (no locks; relies on Python GIL).

**Internal State**:
```python
_rules: dict[str, str]                                    # process (lowercase) → category
_totals_seconds: dict[str, float]                         # category → all-time seconds (never pruned)
_app_totals_seconds: dict[str, float]                     # exe → all-time seconds (never pruned)
_daily_totals_seconds: dict[str, dict[str, float]]        # date → category → seconds (pruned)
_daily_app_totals_seconds: dict[str, dict[str, float]]    # date → exe → seconds (pruned)
_daily_hourly_seconds: dict[str, dict[str, list[float]]]  # date → category → [0..23] hourly buckets (pruned)
_category_colors: dict[str, str]                          # category → "#RRGGBB"
_retention_days: int                                       # default 30
```

**Key Methods**:

| Method | Purpose | Notes |
|---|---|---|
| `load(path)` | Read from JSON, populate all dicts | Validates types; silently skips malformed fields |
| `save(path)` | Write all state to JSON file | Pretty-printed, called every 60s + on shutdown |
| `export_state()` | Return dict of all state | Used for export/import endpoints |
| `tick(process_name, elapsed)` | Attribute elapsed time to category | Called 1×/sec by tracker thread; updates all 5 totals dicts + hourly |
| `add_rule(process, category)` | Add/update rule | No-op if duplicate |
| `delete_rule(process)` | Remove rule | Also removes any associated data if not in use |
| `get_running_processes()` | psutil.process_iter, return exe names + friendly names | Uses Win32 file version metadata fallback |
| `clear_old_dated_logs()` | Prune `daily_*` keys older than `today - retention_days` | Called on startup + after retention change |
| `clear_all_data()` | Nuke everything including rules | Factory reset |
| `clear_time_data()` | Nuke time data only; keep rules/colors | Quick reset without losing config |
| `import_state(imported)` | Replace all state from dict | Validates before applying; calls `on_startup()` |
| `reload_from_disk(path)` | Discard memory, re-read from file | Used by reload endpoint |

**Helper Functions**:
- `get_foreground_process_name()`: Uses `win32gui.GetForegroundWindow()` + `win32process.GetWindowThreadProcessId()` + `psutil.Process(pid).name()`. Returns exe name or empty string on error.
- `_friendly_name(exe_name)`: Attempts to extract human-readable name from Windows file version metadata. Falls back to cleaning exe name (strip `.exe`, replace `_/-` with space, title-case).
- `run_tracker(tracker, state)`: Daemon thread loop. Every 1 second: gets foreground process, calls `tracker.tick()`, updates state. Every 60 seconds: saves to disk.

**FastAPI Routes**:

| Method | Path | Handler | Returns |
|---|---|---|---|
| GET | `/health` | `health()` | `{"status": "ok"}` |
| GET | `/rules` | `get_rules()` | `[{process, category}, ...]` |
| POST | `/rules` | `add_rule(RuleBody)` | Added rule dict |
| DELETE | `/rules/{process_name}` | `delete_rule()` | `{"status": "ok"}` |
| GET | `/processes` | `get_processes()` | Running processes + friendly names |
| GET | `/totals` | `get_totals()` | Today's totals + active process |
| GET | `/daily-totals` | `get_daily_totals()` | All daily/hourly data + colors |
| POST | `/settings/retention-days` | `set_retention_days(RetentionBody)` | Prunes old data |
| POST | `/settings/reload-cache` | `reload_cache()` | Reloads from disk |
| POST | `/settings/import-state` | `import_state(ImportStateBody)` | Replaces state |
| POST | `/settings/clear-data` | `clear_data()` | Full reset |
| POST | `/settings/clear-time-data` | `clear_time_data()` | Time reset |
| GET | `/settings/export-cache` | `export_cache()` | All state as JSON |
| GET | `/category-colors` | `get_category_colors()` | Color dict |
| POST | `/category-colors` | `set_category_color(CategoryColorBody)` | Sets + saves color |

**Data Persistence**:
- On startup: loads from `../data/tracker_state.json`.
- Every 60 seconds: saves to disk (via tracker thread).
- On shutdown: `atexit` handler saves final state.
- No explicit locking between tracker thread and API threads (GIL provides basic safety).

**CORS**: Allows localhost:4200, 127.0.0.1:4200, localhost:4317, 127.0.0.1:4317, and `null` (for Electron file:// origins).

**Startup (`on_event('startup')`)**:
- Calls `tracker.on_startup()` (prunes old logs).
- Saves state.
- Spawns tracker thread (daemon=True).

**`__main__`**: Runs uvicorn on `127.0.0.1:8000`.

**Critical Detail**: **All time is in Unix timestamps (float, seconds since epoch)**. Date handling is string-based (`YYYY-MM-DD` keys). Time zone is the system's local time zone (no UTC conversion).

---

### `/UI/src/app/app.ts` — Root Component

**Responsibility**: Top-level app shell, settings state, tab routing, Electron integration.

**Key Signals**:
```typescript
activeTab: 'home' | 'stats' | 'settings'  // Controls visible tab
pingMs: number                              // Poll interval (default 15000, min 500)
startOnBoot: boolean                        // Windows startup shortcut
minimizeToTrayOnClose: boolean              // Tray vs quit on close
retentionDays: number                       // Data retention (default 30, min 1)
isQuitting: boolean                         // Shows quitting overlay
```

**Startup Sequence** (`ngOnInit`):
1. Calls `electronAPI.readSettings()` (async) if available.
2. Applies read settings to local signals.
3. Syncs to `localStorage` for fast access.
4. Sets up `app:quitting` listener (shows quitting overlay).

**Settings Sync Pattern**:
- When a signal updates, three things happen:
  1. `localStorage` is updated (browser-side persistence).
  2. `electronAPI.updateSettings()` is called (IPC to Electron, which writes `ui_settings.json`).
  3. For retention days: `TrackerService.setRetentionDays()` is called (HTTP POST to backend).
- This dual-layer persistence ensures settings survive both browser reloads and full app restarts.

**Tab Routing**: Uses `@switch / @case` on `activeTab()` signal. No Angular Router.

**Methods**:
- `updatePingMs(ms)` / `updateStartOnBoot(val)` / etc. — update signal + persist.
- `minimizeWindow()` / `closeWindow()` — delegate to `electronAPI`.
- `setupQuittingListener()` — listens for Electron `app:quitting` event.

**Template** (`app.html`):
- 44px custom titlebar (draggable, custom minimize/close buttons).
- 56px fixed left sidebar (3 icon nav buttons).
- Main content area with tab switching via `@switch / @case`.
- Quitting overlay (conditionally shown).

---

### `/UI/src/app/app.config.ts` — Angular Configuration

**Responsibility**: DI providers, PrimeNG theme configuration.

**Providers**:
- `provideBrowserGlobalErrorListeners` — global error tracking.
- `provideHttpClient` — app-wide HTTP client.
- `provideAnimationsAsync` — async animation support.

**PrimeNG Theme**: Built from Aura preset via `definePreset()`, overriding semantic colors to match the app's purple palette. Always dark mode (no light mode toggle).

**CSS Vars Used in Theme**:
```scss
--bg: #2C2A4A               // Main background
--panel: #352f5a            // Panel backgrounds
--border: #4F518C           // Border colors
--text: #ECE5F0             // Primary text
--muted: #b8aec5            // Disabled/muted text
--accent: #907AD6           // Accent color
--warm: #EDBBB4             // Warm accent (rarely used)
--card-bg: #352f5a          // Card backgrounds
```

---

### `/UI/src/app/tracker.service.ts` — Angular HTTP Service

**Responsibility**: Centralized API client for all backend calls.

**Base URL**: `http://127.0.0.1:8000` (hardcoded).

**Exported Interfaces**:
```typescript
// Derived UI types
Category { name: string; apps: string[] }
DonutSegment { color, offset, length, category, seconds }

// API response types
Rule { process: string; category: string }
ProcessInfo { exe: string; name: string }
Totals { date, totals_seconds, app_totals_seconds, active_process }
AllDailyTotals { daily_totals_seconds, daily_app_totals_seconds, daily_hourly_seconds, category_colors }
RetentionSettingsBody { retention_days: int }
ImportStateBody { [key: string]: any }
```

**Methods**:
- `getRules()` → `Observable<Rule[]>`
- `addRule(process, category)` → `Observable<Rule>`
- `deleteRule(process_name)` → `Observable<any>`
- `getProcesses()` → `Observable<ProcessInfo[]>`
- `getTotals()` → `Observable<Totals>`
- `getDailyTotals()` → `Observable<AllDailyTotals>`
- `setRetentionDays(days)` → `Observable<any>` (also calls backend prune)
- `reloadCache()` → `Observable<any>` (reload from disk)
- `importState(state)` → `Observable<any>`
- `exportState()` → `Observable<any>`
- `clearData()` → `Observable<any>` (full reset)
- `clearTimeData()` → `Observable<any>` (time reset)
- `getCategoryColors()` → `Observable<any>`
- `setCategoryColor(category, color)` → `Observable<any>`

**Pattern**: All methods return `Observable<T>` (not promises). Components subscribe directly.

---

### `/UI/src/app/main/main.ts` — Home Tab Component

**Responsibility**: Display time by category, rules management, daily history.

**Key Signals**:
```typescript
chartData: any                              // PrimeNG chart data object (Chart.js format)
chartOptions: any                           // PrimeNG chart options (animations, plugins)
categories: Category[]                      // Derived from rules
activeProcess: string                       // Current process name
donutSegments: DonutSegment[]              // Today's time by category (legacy, kept for reference)
totalTracked: number                       // Total seconds today
categoryTotals: dict[string, number]       // Time per category
appTotals: dict[string, number]            // Time per app
categoryColors: dict[string, string]       // Category → "#RRGGBB"
pastDays: DayChart[]                       // Yesterday, 2 days ago, etc.
showAddCategory: boolean                   // Toggle add-category form
showAddApp: boolean                        // Toggle add-app form
editingCategory: string | null             // Which category is being edited
processes: ProcessInfo[]                   // Running processes (for autocomplete)
filteredProcesses: ProcessInfo[]           // Autocomplete filtered list
```

**Polling Logic**:
```typescript
ngOnInit() {
  interval(pollIntervalMs)
    .pipe(switchMap(() => tracker.getTotals()))
    .subscribe(totals => {
      // update signals
      buildDonut()
    })
}
```

**Donut Chart** (`buildDonut` method):
- **Now uses PrimeNG ChartModule** with Chart.js backend (refactored from custom SVG).
- Chart data structure:
  ```typescript
  {
    labels: ["Development", "Browsing", ...],
    datasets: [{
      data: [18000, 9000, ...],  // seconds per category
      backgroundColor: ["#82AAFF", "#C792EA", ...],
      hoverBackgroundColor: [...],  // lightened colors
      borderColor, borderWidth
    }]
  }
  ```
- Chart options:
  ```typescript
  {
    cutout: '65%',  // doughnut hole size
    plugins: {
      legend: { display: false },  // custom legend below
      tooltip: {
        callbacks: { label: (context) => formatTime(context.parsed) }
      }
    },
    maintainAspectRatio: false
  }
  ```
- `lightenColor()` helper: Adds +30 RGB to each channel for hover effect.
- Legacy `donutSegments` still computed and used for legend (kept for compatibility).
- Colors: Lookup `categoryColors` signal, fall back to `DONUT_COLORS` array (10 predefined).

**Rule Management**:
- `addCategory(name)` → local signal update, then `addRule()` API call.
- `editCategory(name)` → toggle editing mode, local update.
- `saveEditCategory(old, new)` → `deleteRule(old)` + `addRule(new)`.
- `deleteCategory(name)` → `deleteRule()` API call.

**App Management**:
- `openAddApp()` → fetches running processes, shows autocomplete form.
- `filterProcesses(query)` → fuzzy filter on exe names.
- `addAppToCategory(process, category)` → `addRule(process, category)`.
- `removeApp(process)` → `deleteRule(process)`.

**History Loading** (`loadHistoryDonuts`):
- Fetches `getDailyTotals()` once on init.
- Filters out today, sorts by date descending.
- Builds a `DayChart` for each past day (small donut-like chart).

**Time Formatting** (`formatTime`):
- Converts seconds to `Xh Ym` / `Xm` / `Xs` string.

---

### `/UI/src/app/main/main.html` — Home Tab Template

**Structure**:
1. **Page header** — "Time Management" + active process tag.
2. **Categories section**:
   - Add-category form (condition-rendered by `showAddCategory()`).
   - Category grid: color picker, name, time, edit/delete/add-app buttons.
   - Edit mode: inline text input (condition-rendered by `editingCategory()`).
   - App list: pill tags with remove button (opacity hidden until hover).
   - Add-app form: autocomplete + search (condition-rendered by `showAddApp()`).
3. **Today donut section** — PrimeNG `<p-chart type="doughnut">` + custom legend below.
   - Chart renders when `chartData()` is populated (i.e., when time tracked > 0).
   - Center overlay shows total time tracked + "tracked" label.
   - Legend lists categories with colored dots, names, and time totals.
4. **History section** — Grid of smaller day-donuts (SVG-based, unchanged).

**Directives Used**: `@for`, `@if`, `@switch`, `(click)`, `(change)`, `[(ngModel)]`, PrimeNG `pAutoComplete`, PrimeNG `pChart`.

---

### `/UI/src/app/stats/stats.ts` — Stats Tab Component

**Responsibility**: 24-hour activity stacked bar chart + app breakdown by category.

**Key Properties**:
```typescript
chartData: any                              // PrimeNG chart data (24 hours, categories as dataset)
chartOptions: any                           // PrimeNG chart options (stacked, responsive)
hourBars: HourBar[]                        // Legacy: 24 columns, each has stacked category bars
categoryBreakdowns: CategoryBreakdown[]    // Today's time by app, grouped by category
hasHourData: boolean                       // True if any hourly data exists
hasAppData: boolean                        // True if any app data exists
```

**Startup** (`ngOnInit`):
```typescript
forkJoin({
  daily: tracker.getDailyTotals(),
  rules: tracker.getRules()
}).subscribe(({ daily, rules }) => {
  buildStackedBarChart()   // PrimeNG stacked bar for 24h
  buildCategoryBreakdowns()  // App breakdown
})
```

**24h Stacked Bar Chart** (`buildStackedBarChart`):
- **Now uses PrimeNG ChartModule** with Chart.js stacked bar (refactored from custom SVG).
- **Chart structure**:
  ```typescript
  {
    labels: ["0:00", "1:00", ..., "23:00"],  // 24 hour labels
    datasets: [
      { label: "Development", data: [300, 600, ...], backgroundColor: "#82AAFF" },
      { label: "Browsing", data: [150, 300, ...], backgroundColor: "#C792EA" },
      ...
    ]
  }
  ```
- **Chart options**:
  ```typescript
  {
    indexAxis: 'x',       // Vertical bars
    scales: {
      x: { stacked: true },           // Stack bars horizontally
      y: { stacked: true, callbacks: { label: (v) => formatTime(v) } }
    },
    plugins: {
      legend: { position: 'bottom' },
      tooltip: { callbacks: { label: (ctx) => formatTime(ctx.parsed.y) } }
    }
  }
  ```
- Tooltip shows formatted time (e.g., "1h 30m") on hover.
- Colors: Lookup `categoryColors` signal, fall back to `DONUT_COLORS` array.
- Legacy `hourBars` still computed for reference (not used in template).

**App Breakdown** (`buildCategoryBreakdowns`):
- Iterates all apps in `daily_app_totals_seconds[today]`.
- Groups by category (via rules lookup).
- Computes `fraction = seconds / totalSeconds` for proportional bar width.
- Returns `CategoryBreakdown[]` sorted by `totalSeconds` descending.

**Polling**: Every 30 seconds via `interval(30000)`.

---

### `/UI/src/app/stats/stats.html` — Stats Tab Template

**Structure**:
1. **24h Activity section** — PrimeNG stacked bar chart (`<p-chart type="bar">`) showing categories over 24 hours.
   - Stacked by default: each bar combines all categories.
   - Tooltip shows formatted time on hover.
   - Legend at bottom shows all categories.
   - Responsive: scales to container width.
   - Empty state: "No activity tracked yet today" when `hasHourData` is false.
2. **Today by App section**:
   - Per-category header with colored dot, category name, total time.
   - List of apps under each category with proportional progress bar + time.
   - Uses `.app-row` layout with exe name, bar, and time display.

---

### `/UI/src/app/settings/settings.ts` — Settings Tab Component

**Responsibility**: Settings form, import/export, data management.

**Inputs** (from `App` root):
```typescript
@Input() pingMs = 15000
@Input() startOnBoot = false
@Input() minimizeToTrayOnClose = false
@Input() retentionDays = 30
```

**Outputs** (emit to `App` root):
```typescript
@Output() pingMsChange = new EventEmitter<number>()
@Output() startOnBootChange = new EventEmitter<boolean>()
@Output() minimizeToTrayOnCloseChange = new EventEmitter<boolean>()
@Output() retentionDaysChange = new EventEmitter<number>()
```

**Local Signals**:
- `statusMessage: string | null` — success message, auto-dismisses after 4500ms.
- `formState` — local copy of inputs before "Apply" is clicked.

**Key Methods**:
- `applySettings()` — normalize inputs, emit all 4 outputs, show status message.
- `reloadCache()` → `POST /settings/reload-cache` → `window.location.reload()` after 500ms.
- `importStateFile(event)` → read file input, parse JSON, `POST /settings/import-state` → reload page.
- `exportCache()` → `GET /settings/export-cache` → download as Blob with timestamp filename.
- `clearData()` → confirm dialog → `POST /settings/clear-data` → reload.
- `clearTimeData()` → confirm dialog → `POST /settings/clear-time-data` → reload.
- `queueAutoDismiss()` — clears status message after 4500ms.

---

### `/UI/src/app/settings/settings.html` — Settings Tab Template

**Structure**:
1. **Apply button** (refresh icon) + status toast.
2. **Settings form**:
   - Ping interval: PrimeNG InputNumber (min 500, step 500).
   - Start on boot: PrimeNG toggle switch.
   - Minimize to tray on close: toggle switch.
   - Retention days: InputNumber (min 1).
3. **State file tools**:
   - "Reload cache" button.
   - "Export cache" button → downloads JSON.
   - "Import state" file input (hidden, triggered by button).
4. **Danger zone**:
   - "Clear time data" (confirm dialog).
   - "Clear all data" (confirm dialog).

---

### `/UI/src/styles.scss` — Global Styles

**Content**:
- PrimeIcons CSS import.
- CSS custom properties at `:root` for color palette.
- PrimeNG input overrides (forces dark theme colors).
- `box-sizing: border-box`, body resets, font stack (Segoe UI).

**Key CSS Variables**:
```scss
--bg: #2C2A4A
--panel: #352f5a
--border: #4F518C
--text: #ECE5F0
--muted: #b8aec5
--accent: #907AD6
--warm: #EDBBB4
--card-bg: #352f5a
```

---

### `/UI/src/app/shared.scss` — Shared SCSS Partials

**Content**: Mixins/partial classes used across tab components.

**Key Classes**:
- `.section-header` — header with label + action button.
- `.divider` — horizontal rule.
- `.panel-card` — styled card container.
- `.placeholder` — empty-state layout.
- `.placeholder-icon` — centered icon placeholder.

---

### `/UI/angular.json` — Angular Build Configuration

**Key Settings**:
- Project: `ui`, prefix: `app`, style extension: `scss`.
- Production build: `baseHref: "./"` (critical for Electron file:// loading), output hashing enabled, bundle budgets (1MB warn, 2MB error per initial).
- Dev server: no optimization, source maps enabled.

---

### `/UI/package.json` — UI Package Configuration

**Key Scripts**:
- `dev` — runs UI dev server on 4317 + Python backend + Electron (concurrently).
- `build` — builds Angular for production.
- `dist` — full distribution build (Angular + PyInstaller backend).

**electron-builder Config**:
- `appId: "com.flutter.app"`, `productName: "Flutter"`.
- `asar: false` — no asar archive.
- `extraResources` — bundles icon + Python backend exe into app resources.
- Windows target: NSIS installer.

---

### `/data/tracker_state.json` — Persistent State File

**Schema**:
```json
{
  "rules": {
    "chrome.exe": "browsing",
    "excel.exe": "work",
    ...
  },
  "totals_seconds": {
    "browsing": 45600.5,
    "work": 28900.0,
    ...
  },
  "app_totals_seconds": {
    "chrome.exe": 45600.5,
    "excel.exe": 28900.0,
    ...
  },
  "daily_totals_seconds": {
    "2026-03-11": {
      "browsing": 3600.0,
      "work": 2700.0,
      ...
    },
    ...
  },
  "daily_app_totals_seconds": {
    "2026-03-11": {
      "chrome.exe": 3600.0,
      "excel.exe": 2700.0,
      ...
    },
    ...
  },
  "daily_hourly_seconds": {
    "2026-03-11": {
      "browsing": [600.0, 0.0, 450.0, ..., 150.0],  // 24 elements (hours 0-23)
      "work": [0.0, 1800.0, 900.0, ..., 0.0],
      ...
    },
    ...
  },
  "category_colors": {
    "browsing": "#907AD6",
    "work": "#EDBBB4",
    ...
  },
  "retention_days": 30
}
```

**Key Points**:
- `totals_seconds` and `app_totals_seconds` are **all-time** (never pruned).
- `daily_*` keys are pruned by retention policy (default 30 days).
- `daily_hourly_seconds[date][category]` is always a 24-element list (one per hour 0-23).
- All times are in seconds (float). Dates are `YYYY-MM-DD` strings.
- Colors must be exactly `#RRGGBB` hex format.

---

### `/data/ui_settings.json` — UI Settings File

**Schema**:
```json
{
  "startOnBoot": false,
  "minimizeToTrayOnClose": true,
  "pingMs": 15000,
  "retentionDays": 30,
  "at": "2026-03-11T10:30:00.000Z"
}
```

**Managed By**: Electron main process (reads on startup, writes on IPC event).

---

## Key Architectural Patterns

### No Thread Locking in Python
The `Tracker` object is accessed from:
1. FastAPI request threads (API handlers).
2. Background tracker thread (`run_tracker`).

**No explicit locks are used.** The Python GIL provides basic thread safety for dict operations, but **this is a potential race condition for multi-step operations**. Be careful when reading then modifying state across multiple dict accesses.

### Settings Persistence: Dual Layer
1. **Angular `localStorage`** — fast browser-side.
2. **`ui_settings.json` (Electron)** — survives app restart.

Both are synced when a setting changes. Always update both.

### No Angular Router
Tab navigation uses a simple `activeTab` signal + `@switch / @case` template logic. Do **not** add Angular Router without restructuring.

### All Time in Seconds (Float)
- Backend: Unix timestamps, all time values stored as float seconds.
- Date string keys: `YYYY-MM-DD` (system local time zone, not UTC).

### Lifetime Totals Never Pruned
- `totals_seconds` and `app_totals_seconds` accumulate forever.
- Only `daily_*` keys are subject to retention pruning.
- This means lifetime totals can include stats for categories/apps no longer in rules.

### Donut Chart: Pure SVG
No chart library. Uses SVG `<circle>` with `stroke-dasharray` / `stroke-dashoffset` technique.

## Common Development Scenarios

### Adding a New Setting
1. Add field to `data/ui_settings.json` schema.
2. Add `@Input` + `@Output` in `settings.ts`.
3. Add form control in `settings.html`.
4. Add `update*()` method in `app.ts` root component.
5. Wire up IPC in Electron `main.cjs` if it affects app behavior (e.g., tray, window).

### Adding a New API Endpoint
1. Define request/response types in `service/main.py`.
2. Implement handler in `main.py` (add/modify route).
3. Add method to `TrackerService` in `tracker.service.ts`.
4. Call service method from component (e.g., `MainComponent`, `StatsComponent`).

### Modifying Time Attribution Logic
Changes go in `Tracker.tick()` method in `service/main.py`. Be aware:
- No locks; GIL provides basic safety.
- Must update all 5 dicts: `_totals_seconds`, `_app_totals_seconds`, `_daily_totals`, `_daily_app_totals`, `_daily_hourly`.
- Hourly bucket is `_daily_hourly_seconds[date][category][hour]` (0-indexed hour, 0-23).

### Fixing a Tracking Bug
1. Check `run_tracker()` in `service/main.py` — is the foreground process being detected correctly?
2. Check `get_foreground_process_name()` — does it handle your edge case (e.g., window already closed)?
3. Check `Tracker.tick()` — is time being attributed to the right category?
4. Check rule lookup — lowercase match: `_rules[process.lower()]`.

---

## Deployment / Packaging

### Development
```bash
npm run dev              # Concurrently: UI server + backend + Electron
```

### Production Build
```bash
npm run build            # Build Angular to UI/dist/
npm run dist             # PyInstaller + electron-builder → final installers
```

**Output**:
- Python backend: `dist/ActivityTracker/` (folder, not single exe).
- Electron UI: `UI/dist/` + NSIS installer.

**Result**: `Flutter.exe` installer (NSIS).

---

## Debugging Tips

### Backend Logs
- Check `userData/debug.log` (Electron appends here).
- Prints backend stdout/stderr.

### API Health Check
- Backend must respond to `GET http://127.0.0.1:8000/health` within timeout.
- If fails, Electron remains on loading screen.

### Settings Not Persisting?
- Check both `localStorage` (browser) AND `data/ui_settings.json` (file).
- IPC might be failing; check Electron logs.

### Donut Chart Incorrect?
- Ensure `categoryColors` signal is populated.
- Check color format: must be `#RRGGBB`.
- Verify `daily_hourly_seconds[today][category]` has 24 elements.

### Time Not Being Tracked?
1. Check process name in rules: must match lowercase `psutil.Process.name()` (e.g., `chrome.exe`).
2. Check `get_foreground_process_name()` — debugging with print statements.
3. Check `Tracker.tick()` — is the category lookup succeeding?

---

## Recent Changes (2026-03-11)

### Fixed: Date Timezone Mismatch in Daily Charts
**Issue**: Frontend was using UTC dates (`toISOString()`) while backend stores local dates. Caused daily data lookup to fail.
**Fix**: Both `StatsComponent` and `MainComponent` now use explicit local date formatting via `getLocalDateString()` returning `YYYY-MM-DD` in local time zone.

### Refactored: Donut Chart to Use PrimeNG ChartModule
**Before**: Custom SVG implementation using `stroke-dasharray` / `stroke-dashoffset` calculation.
**After**: Uses `<p-chart type="doughnut">` from PrimeNG with Chart.js backend.
- **Changes made**:
  - Added `ChartModule` import to `MainComponent`
  - Added `chartData` and `chartOptions` signals for chart configuration
  - Added `lightenColor()` helper for hover effects
  - Updated template to render `<p-chart>` instead of SVG
  - Updated SCSS: removed SVG transform logic, added canvas sizing styles
  - Changed `ChangeDetectionStrategy.OnPush` for better performance
- **Benefits**: Better UX (native animations), cleaner code, accessibility, responsive design.

### Fixed: Import Errors in app.ts
**Issue**: `NgIf` was imported but not used (Angular 17+ uses `@if` control flow).
**Fix**: Replaced with `CommonModule` import in component decorator.

### Fixed: TypeScript Destructuring in main.ts
**Issue**: Attempted to destructure 3rd element from 2-element tuple: `entries.map(([cat, , i]) => ...)`.
**Fix**: Changed to `entries.map(([cat], catIndex) => ...)` using callback index parameter.

### Refactored: 24h Activity Chart to Use PrimeNG Stacked Bar
**Before**: Custom SVG implementation with manual stack height calculations.
**After**: Uses `<p-chart type="bar">` from PrimeNG with Chart.js stacked bars.
- **Changes made**:
  - Added `ChartModule` import to `StatsComponent`
  - Added `chartData` and `chartOptions` properties (not signals, regular properties)
  - Added `buildStackedBarChart()` method to construct PrimeNG chart data
  - Updated template: replaced SVG with `<p-chart type="bar">`
  - Updated SCSS: removed SVG CSS, added `.activity-chart` styles for canvas sizing
  - Added `PLATFORM_ID` check for browser-only chart initialization
  - Changed `ChangeDetectionStrategy.OnPush` for better performance
- **Chart features**:
  - Horizontal stacked bars: one per hour (0–23)
  - Categories as separate datasets (each with its color)
  - Tooltip shows formatted time (e.g., "2h 30m") on hover
  - Y-axis labeled with formatted time (not raw seconds)
  - Legend at bottom showing all categories with colors
  - Responsive: scales to container width
- **Benefits**: Better UX (interactive, animations), cleaner code, no manual layout math, accessibility.

### Added: chart.js Dependency
**Reason**: PrimeNG ChartModule requires Chart.js for rendering.
**Action**: Added `chart.js` to `UI/package.json` dependencies via `npm install chart.js`.

### Enhanced: Doughnut Chart Border & Rounded Corners
**Changes made to `MainComponent` (`UI/src/app/main/main.ts`)**:
- Added `borderColor` to use `--card-bg` CSS variable (matches container background)
- Increased `borderWidth` from 1 to 2 for better visibility
- Added `borderRadius: 8` to doughnut segments for rounded corner effect
- Updated buildDonut() to read container background color via `getComputedStyle()`
**Result**: Doughnut chart now has smooth rounded segment edges with matching container border color.

### Added: Stats Page Day Selector with Mini Donut Charts
**Major refactor to `StatsComponent` (`UI/src/app/stats/stats.ts`)**:
- **New signals**:
  - `selectedDate`: tracks which date's stats are displayed
  - `availableDates`: list of dates with tracked data (sorted descending, up to 3 recent)
  - `dayDonutCharts`: array of mini donut chart configs for left menu
- **New interface**: `DayDonutChart` containing:
  ```typescript
  {
    date: string;              // "2026-03-11"
    label: string;             // "11/03"
    chartData: any;            // PrimeNG doughnut data
    chartOptions: any;         // PrimeNG doughnut options (no legend, no tooltip)
    totalSeconds: number;      // sum of all categories for that day
  }
  ```
- **Lifecycle changes**:
  - `ngOnInit()` now fetches all available dates and builds mini donut charts
  - Default selected date = most recent date with data
  - `selectDate(date: string)` method allows clicking day cards to load different date
  - Polling still runs every 30 seconds but loads data for selected date (not just today)
- **New methods**:
  - `loadDataForDate(date, allData)`: loads hourly/app data for a specific date and refreshes charts
  - `buildDayDonutCharts(data)`: builds mini doughnut configurations for top 3 dates
  - `formatDateShort(dateStr)`: formats date as "DD/MM" (e.g., "11/03")

**Template changes (`UI/src/app/stats/stats.html`)**:
- Added `.day-selector` section at top with horizontally scrollable day cards
- Each day card shows:
  - Mini doughnut chart (64x64px) with transparent border and 4px borderRadius
  - Center text showing total time tracked (e.g., "5h 20m")
  - Date below chart in "DD/MM" format
  - Year "2026" below date
- Active day card has accent border color and slight highlight
- Cards are clickable and trigger `selectDate()` to reload chart data

**Styling changes (`UI/src/app/stats/stats.scss`)**:
```scss
.day-selector {
  margin-bottom: 16px;    // Space before 24h chart
  overflow: hidden;
}

.day-cards-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;       // Horizontal scroll for date cards
  padding-bottom: 8px;
  scroll-behavior: smooth;
  // Custom scrollbar styling
}

.day-card-selector {
  width: 88px;            // Fixed width, fits 4 cards on mobile
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 2px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover { border-color: var(--accent); }
  &.active {
    border-color: var(--accent);
    background: color-mix(...accent 10%);  // Subtle highlight
  }
}

.day-chart-mini {
  position: relative;
  width: 64px;
  height: 64px;
}

.day-center {
  position: absolute;      // Overlay total time in center
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.day-time {
  font-size: 9px;         // Very small for tiny chart
  font-weight: 600;
  color: var(--text);
}

.day-date, .day-year {
  font-size: 11px, 8px;   // DD/MM and year
  text-align: center;
}
```

**Behavior**:
- When user clicks a day card, `selectDate()` is called
- `loadDataForDate()` fetches hourly data for that date and rebuilds stacked bar chart
- App breakdown section updates to show apps used that day
- Polling continues to update data in real-time (for selected date, not fixed to today)

### Added: PrimeNG Color Picker with Hex Input for Category Colors
**Changes made to `MainComponent` (`UI/src/app/main/main.ts`)**:
- **Replaced native color input** with PrimeNG `ColorPicker` component in a modal dialog
- **Added new signals**:
  - `colorPickerVisible`: tracks if the color picker dialog is open
  - `colorPickerCategory`: stores which category's color is being edited
  - `colorPickerValue`: hex color value for the picker (`#RRGGBB`)
  - `hexInput`: user-editable hex input (signal so template can read it with `hexInput()`)
- **New methods**:
  - `openColorPicker(category)`: opens dialog with current category color loaded
  - `closeColorPicker()`: closes dialog and resets state
  - `onColorChange(color)`: syncs color picker changes to hex input
  - `updateHexInput(hex)`: validates hex input and updates picker if valid
  - `applyColorAndClose()`: applies the new color via API and closes dialog
  - `isValidHex(hex): boolean`: public method validating hex format (`#[0-9A-F]{6}`)

**Template changes (`UI/src/app/main/main.html`)**:
- Replaced `<input type="color">` with styled button `.category-color-button`
  - Shows current color as background
  - Hover effect: scales up 1.15x + subtle shadow
  - Click opens color picker dialog
- Added `<p-dialog>` component with:
  - **PrimeNG ColorPicker** (inline, hex format):
    - Visual color selector with sliders
    - Syncs to both `colorPickerValue` and `hexInput`
  - **Hex input field** with `p-floatlabel`:
    - Manual hex entry (e.g., `#82AAFF`)
    - Input validation in real-time
    - Monospace font, uppercase, max 7 characters
  - **Action buttons**:
    - Cancel (gray) - closes without saving
    - Apply (green) - saves color if hex is valid, disabled if invalid

**Styling changes (`UI/src/app/main/main.scss`)**:
```scss
.category-color-button {
  width: 18px;
  height: 18px;
  border: 1px solid var(--border);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 100ms ease, box-shadow 100ms ease;

  &:hover {
    transform: scale(1.15);
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
  }

  &:active {
    transform: scale(0.95);
  }
}

.color-picker-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
}

.color-picker-wrapper {
  display: flex;
  justify-content: center;
  // Styles for inline color picker panel (200px height)
}

.hex-input-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  // Monospace font input styling
}

.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
```

**User Flow**:
1. User clicks colored circle button on category card → `openColorPicker(category)` called
2. Dialog opens showing:
   - Current color selected in visual picker
   - Hex value in text input
3. User can:
   - Click/drag in color picker → updates picker + hex input via `onColorChange()`
   - Type hex manually → validates in real-time via `updateHexInput()`, updates picker if valid
4. Click "Apply" → `applyColorAndClose()` calls `updateCategoryColor()` API and closes
5. Click "Cancel" or hit dialog close → `closeColorPicker()` discards changes

**Validation**:
- Hex input only accepts `#` followed by 6 hex digits (case-insensitive, normalized to uppercase)
- "Apply" button disabled until valid hex is entered
- ColorPicker automatically syncs with hex input (and vice versa)
- Invalid hex strings don't update the picker

---

## Backend Connectivity & Health Monitoring System (2026-03-13)

### Problem Solved
Fixed issue where Python backend was not running in `win-unpackaged` builds, causing the app to appear functional but with no activity tracking capability.

### Solution Overview
Implemented comprehensive backend health monitoring with visual indicators, loading screen improvements, and build optimizations.

---

### Loading Screen Enhancements

#### **Electron Main Process (`electron/main.cjs`)**
- **Backend Detection**: Added detection for missing `ActivityTracker.exe` in win-unpackaged builds
- **Error State Injection**: Uses `win.webContents.executeJavaScript()` to update loading screen when backend is missing
- **Health Check Integration**: Backend health status is communicated to loading screen during startup

**Key Code Changes**:
```javascript
// Detect missing backend exe and show error state
if (!fs.existsSync(backendExe)) {
  log("[startup] no backend exe — marking backend unavailable");
  win.webContents.executeJavaScript(`
    document.body.classList.add('backend-missing');
    document.querySelector('.status').textContent = 'Python Backend not found';
  `);
}
```

#### **Loading Screen (`electron/loading.html`)**
- **Titlebar Integration**: Added full titlebar with minimize/close controls for user control during startup errors
- **Error State Styling**: Added CSS for red X icon and error text when backend is missing
- **Consistent UI**: Matches main app titlebar design for seamless user experience

**Features**:
- ✅ Working minimize/close buttons during loading
- ✅ Red X icon (✕) when backend not found
- ✅ Error message: "Python Backend not found"
- ✅ Same styling as main app titlebar

---

### Angular App Health Monitoring

#### **Backend Health Service (`UI/src/app/tracker.service.ts`)**
- **Health Endpoint**: Added `health()` method to call backend `/health` endpoint
- **Observable Pattern**: Returns Observable for reactive health status updates

```typescript
health(): Observable<{ status: string }> {
  return this.http.get<{ status: string }>(`${API}/health`);
}
```

#### **App Component Health Monitoring (`UI/src/app/app.ts`)**
- **Real-time Monitoring**: Continuous health checks every 2 seconds (was 5 seconds)
- **Activity-triggered Checks**: Health check triggered on every app usage ping (`refreshTotals()`)
- **Visual Status Indicators**: Green checkmark (✓) for connected, red X (✕) for disconnected
- **PrimeNG Tooltips**: Professional tooltips showing connection status

**Key Features**:
- ✅ Green ✓ icon: "Python Backend connected - Activity tracking is active"
- ✅ Red ✕ icon: "Python Backend not found - Activity tracking is disabled"
- ✅ Responsive updates: Status changes within 2 seconds
- ✅ Hover tooltips with detailed status information

**Health Check Logic**:
```typescript
private checkBackendHealth(): void {
  this.tracker.health().subscribe({
    next: () => {
      this.backendConnected.set(true);
      this.backendError.set('');
    },
    error: (err) => {
      this.backendConnected.set(false);
      this.backendError.set('Python Backend not found - Activity tracking is disabled');
    }
  });
}
```

#### **Main Component Integration (`UI/src/app/main/main.ts`)**
- **Health Check Trigger**: Every `refreshTotals()` call also triggers backend health check
- **Real-time Updates**: App usage pings now update health status immediately
- **Constructor Injection**: App component injected to access `triggerHealthCheck()` method

```typescript
private refreshTotals(): void {
  // Trigger health check when we ping the backend for totals
  this.app.triggerHealthCheck();
  
  this.tracker.getTotals().subscribe(t => {
    this.activeProcess.set(t.active_process);
    this.buildDonut(t);
  });
}
```

---

### Build System Optimization

#### **PyInstaller Backend Build Fixes**
- **DLL Loading Issues**: Fixed Python DLL loading errors by switching to `--onefile` mode
- **Path Resolution**: Resolved `python313.dll` not found errors in packaged builds
- **Dependency Bundling**: Ensured all Python runtime dependencies are properly included

**Before**: Directory mode with separate `_internal/` folder (DLL loading issues)
**After**: Single executable with bundled runtime (self-contained)

#### **Build Configuration (`UI/package.json`)**
- **Output Directory**: Changed from `UI/dist/` to root `build/` folder for cleaner organization
- **Build Scripts**: Added fast development build commands
- **Compression Optimization**: Changed from `maximum` to `normal` for faster builds
- **Electron Builder**: Optimized configuration for development vs production builds

---

### Build Commands

#### **Development Builds (Fast)**
```bash
# Fast portable build (no installer, ~30-45 seconds)
npm run dist:fast

# Output: build/win-unpacked/Flutter.exe (run directly, no installation)
# Features: Normal compression, no code signing delays
```

#### **Production Builds (Complete)**
```bash
# Full installer with code signing (~2-3 minutes)
npm run dist

# Output: build/Flutter Setup 0.0.0.exe (installer for distribution)
# Features: Code signing, maximum compression, professional installer
```

#### **Backend-only Build**
```bash
# Rebuild Python backend only
npm run dist:backend

# Output: backend/ActivityTracker/ActivityTracker.exe
# Uses: --onefile mode for DLL loading fixes
```

---

### Performance Improvements

#### **Build Time Reductions**
- **Compression**: Changed from `maximum` to `normal` (faster builds, slightly larger files)
- **Development Mode**: Added `--dir` builds to skip installer creation
- **Dependency Optimization**: Disabled unnecessary rebuilds (`npmRebuild: false`)

#### **Installation Speed**
- **Development Installer**: Fast unsigned installer for testing
- **Portable Version**: No installation required - run executable directly
- **Code Signing Impact**: Identified as major contributor to slow installation times

---

### File Structure Changes

#### **New Build Organization**
```
d:\documents\GitHub\activity-tracking-app\
├── build\                          # All build outputs (new location)
│   ├── Flutter Setup 0.0.0.exe     # Production installer
│   ├── win-unpacked\               # Portable version
│   │   ├── Flutter.exe             # Main application
│   │   └── resources\
│   │       ├── backend\
│   │       │   └── ActivityTracker.exe  # Python backend (fixed DLL loading)
│   │       ├── app\                 # Angular UI
│   │       └── electron\            # Electron files
│   └── builder-effective-config.yaml
└── backend\                         # Python backend build location
    └── ActivityTracker\
        └── ActivityTracker.exe      # PyInstaller output (onefile mode)
```

#### **Removed Locations**
- `UI/dist/` - No longer used for build outputs
- `UI/win-unpacked/` - Moved to root `build/`

---

### Health Indicator Styling (`UI/src/app/app.scss`)

#### **Visual Design**
- **Connected State**: Green circle with white checkmark (#22C55E)
- **Disconnected State**: Red circle with white X (#ED4242)
- **Hover Effects**: Scale animation and background color enhancement
- **Consistent Sizing**: 16px diameter, 10px icons, centered alignment

```scss
.health-indicator {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  margin-left: 4px;
  transition: all 120ms ease;
  
  &.connected {
    background: rgba(34, 197, 94, 0.2);
    color: #22C55E;
  }
  
  &.disconnected {
    background: rgba(237, 66, 66, 0.2);
    color: #ED4242;
  }
}
```

---

### Troubleshooting Guide

#### **Common Issues & Solutions**

1. **"Python Backend not found" Error**
   - **Cause**: Backend executable missing or failed to start
   - **Solution**: Check win-unpackaged build includes backend properly
   - **Visual**: Red X icon appears in titlebar

2. **"Failed to load python dll" Error**
   - **Cause**: PyInstaller DLL loading issues in directory mode
   - **Solution**: Fixed with `--onefile` PyInstaller mode
   - **Build Command**: `npm run dist:backend`

3. **Slow Build Times**
   - **Cause**: Maximum compression and code signing
   - **Solution**: Use `npm run dist:fast` for development
   - **Impact**: 30-45 seconds vs 2-3 minutes

4. **Slow Installation**
   - **Cause**: Code signing verification and maximum compression
   - **Solution**: Use portable version or development installer
   - **Alternative**: Run `build/win-unpacked/Flutter.exe` directly

---

## Important Notes for AI Agents

1. **Windows-Only**: Code uses `win32gui`, `win32process`, `pywin32`. Will fail on macOS/Linux.
2. **Hardcoded URLs**: Backend = `127.0.0.1:8000`, UI dev server = `127.0.0.1:4317`. Any port change requires updating multiple places.
3. **No Explicit Synchronization**: Python backend has no thread locks; relies on GIL. Could cause subtle race conditions under load.
4. **Build Organization**: All build outputs now go to root `build/` folder for cleaner development workspace.
5. **Health Monitoring**: Backend connectivity is continuously monitored and visually indicated in the titlebar.
6. **DLL Loading**: Python backend uses `--onefile` PyInstaller mode to resolve DLL loading issues in packaged builds.
4. **App Name Inconsistency**: Product is "Flutter" (UI branding) but Python exe is "ActivityTracker" in some places. Be aware when renaming.
5. **`desktop.html` is Dead Code**: References old `pywebview` API. Not used in current Electron architecture. Safe to ignore.
6. **Signal-Based Reactivity**: All UI state uses Angular signals (`signal()`, `.set()`, `.update()`), not RxJS subjects. Keep this pattern consistent.
7. **No Validation on Import**: When importing state from JSON, the backend does type coercion but doesn't validate completeness. Malformed imports can corrupt state.
