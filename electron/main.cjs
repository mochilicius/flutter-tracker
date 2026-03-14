const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const url = require("url");
const { spawn } = require("child_process");

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(app.getPath("userData"), "debug.log");
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
  logStream.write(line + "\n");
}
log("=== app start ===");
log("userData:", app.getPath("userData"));

// ── Paths ─────────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const DEV_URL = "http://127.0.0.1:4317";
const UI_FILE = path.join(__dirname, "dist", "flutter-app", "index.html");
const SETTINGS_FILE = path.join(__dirname, isDev ? ".." : "", "data", "ui_settings.json");
const ICON_PATH = isDev
  ? path.join(__dirname, "..", "assets", "icon.ico")
  : path.join(process.resourcesPath, "icon.ico");

log("isDev:", isDev, "__dirname:", __dirname);
log("UI_FILE:", UI_FILE);
log("ICON_PATH:", ICON_PATH);

// ── Settings ──────────────────────────────────────────────────────────────────
function readPersistedSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    log("[settings] read error:", e.message);
    return {};
  }
}

function writePersistedSettings(partial) {
  try {
    const next = { ...readPersistedSettings(), ...partial };
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (e) {
    log("[settings] write error:", e.message);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null;
let appTray = null;
let isQuitting = false;
let minimizeToTrayOnClose = false;
let backendProcess = null;

// ── Backend ───────────────────────────────────────────────────────────────────
function startBackend() {
  const exePath = path.join(process.resourcesPath, "backend", "ActivityTracker.exe");
  log("[backend] looking for exe:", exePath);
  if (!fs.existsSync(exePath)) {
    log("[backend] exe not found — skipping");
    return;
  }
  backendProcess = spawn(exePath, [], { detached: false, stdio: ["ignore", "pipe", "pipe"] });
  backendProcess.stdout.on("data", (d) => log("[backend:out]", d.toString().trim()));
  backendProcess.stderr.on("data", (d) => log("[backend:err]", d.toString().trim()));
  backendProcess.on("error", (e) => log("[backend] spawn error:", e.message));
  backendProcess.on("exit", (code) => log("[backend] exit:", code));
  log("[backend] started pid:", backendProcess.pid);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function createTrayIcon() {
  try {
    if (fs.existsSync(ICON_PATH)) {
      return nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
    }
    log("[tray] icon not found:", ICON_PATH);
  } catch (e) {
    log("[tray] icon error:", e.message);
  }
  return null;
}

function createAppIcon() {
  try {
    if (fs.existsSync(ICON_PATH)) return nativeImage.createFromPath(ICON_PATH);
  } catch (e) {
    log("[app] icon error:", e.message);
  }
  return null;
}

// ── HTTP poll ─────────────────────────────────────────────────────────────────
function pollUrl(targetUrl, timeoutMs = 60000, intervalMs = 600) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const req = http.get(targetUrl, (res) => { res.resume(); resolve(); });
      req.setTimeout(1500);
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() < deadline) setTimeout(attempt, intervalMs);
        else reject(new Error(`Timeout waiting for ${targetUrl}`));
      });
    }
    attempt();
  });
}

// ── Window ────────────────────────────────────────────────────────────────────
function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow() {
  log("[window] creating BrowserWindow");
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: true,
    titleBarStyle: "hidden",
    backgroundColor: "#2C2A4A",
    icon: createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = win;

  win.webContents.on("did-fail-load", (_e, code, desc, failedUrl) => {
    log("[window] did-fail-load:", code, desc, failedUrl);
  });

  // Open DevTools for live renderer + main-process console output (dev only)
  if (isDev) win.webContents.openDevTools({ mode: "detach" });

  const loadingUrl = url.format({ pathname: path.join(__dirname, "loading.html"), protocol: "file:", slashes: true });
  log("[window] loading screen:", loadingUrl);
  win.loadURL(loadingUrl);

  try {
    if (isDev) {
      log("[startup] polling dev server + backend...");
      await Promise.all([pollUrl(DEV_URL), pollUrl("http://127.0.0.1:8000/health")]);
      log("[startup] ready — loading dev URL");
      win.loadURL(DEV_URL);
    } else {
      const backendExe = path.join(process.resourcesPath, "backend", "ActivityTracker.exe");
      if (fs.existsSync(backendExe)) {
        log("[startup] polling backend health...");
        await pollUrl("http://127.0.0.1:8000/health");
        log("[startup] backend ready");
      } else {
        log("[startup] no backend exe — marking backend unavailable");
        win.webContents.executeJavaScript(`
          document.body.classList.add('backend-missing');
          document.querySelector('.status').textContent = 'Python Backend not found';
        `);
      }
      const uiUrl = url.format({ pathname: UI_FILE, protocol: "file:", slashes: true });
      log("[startup] loading UI:", uiUrl);
      win.loadURL(uiUrl);
    }
  } catch (e) {
    log("[startup] error:", e.message, "— loading UI anyway");
    if (isDev) {
      win.loadURL(DEV_URL);
    } else {
      win.webContents.executeJavaScript(`
        document.body.classList.add('backend-missing');
        document.querySelector('.status').textContent = 'Python Backend not found';
      `);
      win.loadURL(url.format({ pathname: UI_FILE, protocol: "file:", slashes: true }));
    }
  }

  win.on("close", () => log("[window] close, isQuitting:", isQuitting));
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function ensureTray() {
  if (appTray) return true;
  if (!app.isReady()) { log("[tray] not ready"); return false; }
  const icon = createTrayIcon();
  if (!icon) { log("[tray] no icon"); return false; }
  try {
    appTray = new Tray(icon);
  } catch (e) {
    log("[tray] create error:", e.message);
    return false;
  }
  appTray.setToolTip("Flutter");
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: () => showMainWindow() },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
  ]));
  appTray.on("double-click", () => showMainWindow());
  log("[tray] created");
  return true;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  log("[app] ready — isDev:", isDev);
  if (!isDev) startBackend();
  createWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  log("[app] before-quit");
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  log("[ipc:close] minimizeToTray:", minimizeToTrayOnClose);
  if (!win) return;
  if (minimizeToTrayOnClose) {
    if (ensureTray()) { win.minimize(); win.setSkipTaskbar(true); win.hide(); }
    else win.minimize();
    return;
  }
  win.webContents.send("app:quitting");
  isQuitting = true;
  setTimeout(() => win.close(), 800);
});

ipcMain.on("settings:start-on-boot", (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  writePersistedSettings({ startOnBoot: Boolean(enabled) });
});

ipcMain.on("settings:minimize-to-tray", (_e, enabled) => {
  minimizeToTrayOnClose = Boolean(enabled);
  if (minimizeToTrayOnClose) ensureTray();
  writePersistedSettings({ minimizeToTrayOnClose });
});

ipcMain.on("settings:applied", (_e, payload) => {
  if (payload && typeof payload === "object") writePersistedSettings(payload);
});

ipcMain.handle("settings:read", () => {
  const settings = readPersistedSettings();
  minimizeToTrayOnClose = Boolean(settings.minimizeToTrayOnClose);
  return settings;
});

ipcMain.handle("settings:update", (_e, payload) => {
  if (payload && typeof payload === "object") {
    writePersistedSettings(payload);
    if (Object.prototype.hasOwnProperty.call(payload, "minimizeToTrayOnClose")) {
      minimizeToTrayOnClose = Boolean(payload.minimizeToTrayOnClose);
    }
  }
  return { ok: true };
});
