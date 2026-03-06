const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	minimizeWindow: () => ipcRenderer.send("window:minimize"),
	closeWindow: () => ipcRenderer.send("window:close"),
	setStartOnBoot: (enabled) => ipcRenderer.send("settings:start-on-boot", Boolean(enabled)),
	setMinimizeToTrayOnClose: (enabled) => ipcRenderer.send("settings:minimize-to-tray", Boolean(enabled)),
	logSettingsApplied: (payload) => ipcRenderer.send("settings:applied", payload),
	readSettings: () => ipcRenderer.invoke("settings:read"),
	updateSettings: (payload) => ipcRenderer.invoke("settings:update", payload),
	onAppQuitting: (callback) => ipcRenderer.on("app:quitting", callback)
});
