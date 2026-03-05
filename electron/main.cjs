const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const UI_URL = "http://127.0.0.1:4317";
const SETTINGS_FILE = path.join(__dirname, "..", "data", "ui_settings.json");

function readPersistedSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return {};
    }
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch (error) {
    console.error("[settings] failed to read ui_settings.json", error);
    return {};
  }
}

function writePersistedSettings(partial) {
  try {
    const current = readPersistedSettings();
    const next = { ...current, ...partial };
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("[settings] failed to write ui_settings.json", error);
  }
}

let mainWindow = null;
let appTray = null;
let isQuitting = false;
let minimizeToTrayOnClose = false;

const FEATHER_TRAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ece5f0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4c-4 0-8 2-10.5 5.4c-2.1 2.7-3.2 5.9-3.2 9.3v1.3h1.3c3.4 0 6.6-1.1 9.3-3.2C20 14.3 22 10 22 6V4z"/><path d="M6.3 19.9l8.2-8.2"/></svg>`;
const FEATHER_TRAY_ICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FEATHER_TRAY_SVG)}`;

function showMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#2C2A4A",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs")
    }
  });
  win.loadURL(UI_URL);

  win.on("close", (event) => {
    if (minimizeToTrayOnClose && !isQuitting) {
      event.preventDefault();
      if (ensureTray()) {
        win.setSkipTaskbar(true);
        win.hide();
      } else {
        win.minimize();
      }
    }
  });

  mainWindow = win;
}

function ensureTray() {
  if (appTray) {
    return true;
  }
  if (!app.isReady()) {
    return false;
  }
  let icon = nativeImage.createFromDataURL(FEATHER_TRAY_ICON_DATA_URL);
  icon = icon.resize({ width: 16, height: 16 });
  if (icon.isEmpty()) {
    console.error("[tray] feather icon generation failed");
    return false;
  }
  try {
    appTray = new Tray(icon);
  } catch (error) {
    console.error("[tray] failed to create tray icon", error);
    return false;
  }
  appTray.setToolTip("Time Tracker");
  appTray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => showMainWindow()
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  appTray.on("double-click", () => showMainWindow());
  return true;
}

app.whenReady().then(createWindow);

ipcMain.on("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.minimize();
  }
});

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (minimizeToTrayOnClose) {
      if (ensureTray()) {
        win.setSkipTaskbar(true);
        win.hide();
      } else {
        win.minimize();
      }
      return;
    }
    isQuitting = true;
    win.close();
  }
});

ipcMain.on("settings:start-on-boot", (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
  });
  writePersistedSettings({ startOnBoot: Boolean(enabled) });
  console.log(`[settings] startOnBoot=${Boolean(enabled)}`);
});

ipcMain.on("settings:minimize-to-tray", (_event, enabled) => {
  minimizeToTrayOnClose = Boolean(enabled);
  if (minimizeToTrayOnClose) {
    ensureTray();
  }
  writePersistedSettings({ minimizeToTrayOnClose });
  console.log(`[settings] minimizeToTrayOnClose=${minimizeToTrayOnClose}`);
});

ipcMain.on("settings:applied", (_event, payload) => {
  if (payload && typeof payload === "object") {
    writePersistedSettings(payload);
  }
  console.log("[settings] applied", payload);
});

ipcMain.handle("settings:read", () => {
  const settings = readPersistedSettings();
  minimizeToTrayOnClose = Boolean(settings.minimizeToTrayOnClose);
  return settings;
});

ipcMain.handle("settings:update", (_event, payload) => {
  if (payload && typeof payload === "object") {
    writePersistedSettings(payload);
    if (Object.prototype.hasOwnProperty.call(payload, "minimizeToTrayOnClose")) {
      minimizeToTrayOnClose = Boolean(payload.minimizeToTrayOnClose);
    }
  }
  return { ok: true };
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
