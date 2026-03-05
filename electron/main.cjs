const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

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
  win.loadURL("http://localhost:4200");
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
    win.close();
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
