const { contextBridge, ipcRenderer } = require("electron");

const APP_FILES = new Set(["index.html"]);
const INTERNAL_FILES = new Set(["newtab.html", "extensions.html"]);

const APP_INVOKE_CHANNELS = new Set([
  "add-new-profile",
  "check-for-updates",
  "clear-history-range",
  "clear-other-tabs",
  "close-tab",
  "create-tab",
  "open-incognito-window",
  "find-in-page",
  "get-app-version",
  "get-updater-state",
  "go-back",
  "go-forward",
  "load-extension",
  "navigate-to",
  "reload-page",
  "select-extension-folder",
  "stop-find-in-page",
  "switch-profile",
  "switch-tab",
  "update-adblock-rules"
]);

const APP_SEND_CHANNELS = new Set([
  "apply-browser-color",
  "fetch-and-show-history",
  "renderer-ready",
  "set-chrome-metrics",
  "toggle-browser-view",
  "update-default-search-engine",
  "rename-profile"
]);

const APP_ON_CHANNELS = new Set([
  "active-tab-changed",
  "download-started",
  "download-updated",
  "find-result",
  "history-data-received",
  "history-loaded",
  "history-updated",
  "keyboard-shortcut",
  "profile-changed",
  "profile-list-updated",
  "tab-closed",
  "tab-created",
  "tab-switched",
  "updater-status",
  "view-event"
]);

const INTERNAL_INVOKE_CHANNELS = new Set([
  "get-extensions",
  "load-extension",
  "navigate-to",
  "remove-extension",
  "select-extension-folder"
]);

function getPageFile() {
  try {
    const url = new URL(window.location.href);
    if (url.protocol !== "file:") return null;
    return url.pathname.split("/").pop().toLowerCase();
  } catch (e) {
    return null;
  }
}

function buildApi(allowedInvoke, allowedSend, allowedOn) {
  return {
    invoke: (channel, ...args) => {
      if (!allowedInvoke || !allowedInvoke.has(channel)) return undefined;
      return ipcRenderer.invoke(channel, ...args);
    },
    send: (channel, ...args) => {
      if (!allowedSend || !allowedSend.has(channel)) return;
      ipcRenderer.send(channel, ...args);
    },
    on: (channel, listener) => {
      if (!allowedOn || !allowedOn.has(channel)) return () => {};
      // Mirror Electron's ipcRenderer.on signature: (event, ...args).
      const subscription = (event, ...args) => listener(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  };
}

const fileName = getPageFile();
if (APP_FILES.has(fileName)) {
  contextBridge.exposeInMainWorld(
    "electron",
    Object.freeze(buildApi(APP_INVOKE_CHANNELS, APP_SEND_CHANNELS, APP_ON_CHANNELS))
  );
} else if (INTERNAL_FILES.has(fileName)) {
  contextBridge.exposeInMainWorld(
    "electron",
    Object.freeze(buildApi(INTERNAL_INVOKE_CHANNELS, null, null))
  );
}
