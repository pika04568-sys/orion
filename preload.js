const { contextBridge, ipcRenderer } = require("electron");

const ORION_PROTOCOL = "orion:";
const ORION_HOST = "app";

const APP_INVOKE_CHANNELS = Object.freeze([
  "add-new-profile",
  "check-for-updates",
  "clear-history-range",
  "clear-other-tabs",
  "close-tab",
  "create-tab",
  "delete-history-item",
  "find-in-page",
  "get-app-version",
  "get-language-settings",
  "get-updater-state",
  "get-window-bootstrap-state",
  "go-back",
  "go-forward",
  "navigate-to",
  "open-incognito-window",
  "reload-page",
  "reopen-closed-tab",
  "set-language",
  "stop-find-in-page",
  "switch-profile",
  "switch-tab",
  "update-adblock-rules"
]);

const APP_SEND_CHANNELS = Object.freeze([
  "apply-browser-color",
  "fetch-and-show-history",
  "renderer-ready",
  "rename-profile",
  "set-chrome-metrics",
  "toggle-browser-view",
  "update-default-search-engine"
]);

const APP_ON_CHANNELS = Object.freeze([
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

function getAppPageFileName(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    let file = null;
    if (parsed.protocol === ORION_PROTOCOL && parsed.hostname === ORION_HOST) {
      file = (parsed.pathname || "").split("/").filter(Boolean).pop();
    } else if (parsed.protocol === "file:") {
      const decodedPath = decodeURIComponent(parsed.pathname || "").replace(/\\/g, "/");
      file = decodedPath.split("/").filter(Boolean).pop();
    } else {
      return null;
    }
    return file ? file.toLowerCase() : null;
  } catch (_error) {
    return null;
  }
}

function createIndexBridge() {
  const canUseChannel = (method, channel) => {
    if (typeof channel !== "string" || !channel) return false;
    const allowed = method === "invoke"
      ? APP_INVOKE_CHANNELS
      : method === "send"
        ? APP_SEND_CHANNELS
        : APP_ON_CHANNELS;
    return allowed.includes(channel);
  };

  return Object.freeze({
    invoke: (channel, ...args) => {
      if (!canUseChannel("invoke", channel)) return undefined;
      return ipcRenderer.invoke(channel, ...args);
    },
    send: (channel, ...args) => {
      if (!canUseChannel("send", channel)) return;
      ipcRenderer.send(channel, ...args);
    },
    on: (channel, listener) => {
      if (!canUseChannel("on", channel) || typeof listener !== "function") return () => {};
      const subscription = (event, ...args) => listener(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  });
}

function createInternalBridge(page) {
  const newtabBridge = {
    getLanguageSettings: () => ipcRenderer.invoke("get-language-settings"),
    navigateTo: (value) => ipcRenderer.invoke("navigate-to", value)
  };

  if (page === "extensions.html") {
    return Object.freeze({
      getExtensions: () => ipcRenderer.invoke("get-extensions"),
      getLanguageSettings: () => ipcRenderer.invoke("get-language-settings"),
      loadExtension: (extensionPath) => ipcRenderer.invoke("load-extension", extensionPath),
      removeExtension: (id) => ipcRenderer.invoke("remove-extension", id),
      selectExtensionFolder: () => ipcRenderer.invoke("select-extension-folder")
    });
  }

  if (page === "offline.html") {
    return Object.freeze({
      navigateTo: (value) => ipcRenderer.invoke("navigate-to", value)
    });
  }

  return Object.freeze(newtabBridge);
}

const currentPage = getAppPageFileName(window.location.href);

if (currentPage === "index.html") {
  contextBridge.exposeInMainWorld("electron", createIndexBridge());
} else if (currentPage === "newtab.html" || currentPage === "offline.html" || currentPage === "extensions.html") {
  contextBridge.exposeInMainWorld("orionPage", createInternalBridge(currentPage));
}
