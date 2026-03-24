const { contextBridge, ipcRenderer } = require("electron");

const APP_INVOKE_CHANNELS = Object.freeze([
  "add-new-profile",
  "check-for-updates",
  "clear-history-range",
  "delete-history-item",
  "clear-other-tabs",
  "close-tab",
  "create-tab",
  "get-language-settings",
  "open-incognito-window",
  "find-in-page",
  "get-app-version",
  "get-updater-state",
  "go-back",
  "go-forward",
  "load-extension",
  "navigate-to",
  "reload-page",
  "reopen-closed-tab",
  "set-language",
  "select-extension-folder",
  "stop-find-in-page",
  "switch-profile",
  "switch-tab",
  "update-adblock-rules"
]);

const APP_SEND_CHANNELS = Object.freeze([
  "apply-browser-color",
  "fetch-and-show-history",
  "renderer-ready",
  "set-chrome-metrics",
  "toggle-browser-view",
  "update-default-search-engine",
  "rename-profile"
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

const INTERNAL_INVOKE_CHANNELS = Object.freeze([
  "get-language-settings",
  "get-extensions",
  "load-extension",
  "navigate-to",
  "remove-extension",
  "set-language",
  "select-extension-folder"
]);

const EMPTY_CHANNELS = Object.freeze({
  invoke: Object.freeze([]),
  send: Object.freeze([]),
  on: Object.freeze([])
});

const ELECTRON_PAGE_CHANNELS = Object.freeze({
  "index.html": Object.freeze({
    invoke: APP_INVOKE_CHANNELS,
    send: APP_SEND_CHANNELS,
    on: APP_ON_CHANNELS
  }),
  "newtab.html": Object.freeze({
    invoke: INTERNAL_INVOKE_CHANNELS,
    send: EMPTY_CHANNELS.send,
    on: EMPTY_CHANNELS.on
  }),
  "extensions.html": Object.freeze({
    invoke: INTERNAL_INVOKE_CHANNELS,
    send: EMPTY_CHANNELS.send,
    on: EMPTY_CHANNELS.on
  })
});

function getLocalPageFileName(url) {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return null;

    const decodedPath = decodeURIComponent(parsed.pathname || "").replace(/\\/g, "/");
    const file = decodedPath.split("/").filter(Boolean).pop();
    return file ? file.toLowerCase() : null;
  } catch (_error) {
    return null;
  }
}

function getPageChannels(fileName) {
  if (!fileName || typeof fileName !== "string") return EMPTY_CHANNELS;
  return ELECTRON_PAGE_CHANNELS[fileName.toLowerCase()] || EMPTY_CHANNELS;
}

const CURRENT_PAGE = getLocalPageFileName(window.location.href);

function canUseChannel(method, channel) {
  if (!channel || typeof channel !== "string") return false;
  const channels = getPageChannels(CURRENT_PAGE);
  const allowed = channels && channels[method];
  return Array.isArray(allowed) ? allowed.includes(channel) : false;
}

contextBridge.exposeInMainWorld(
  "electron",
  Object.freeze({
    invoke: (channel, ...args) => {
      if (!canUseChannel("invoke", channel)) return undefined;
      return ipcRenderer.invoke(channel, ...args);
    },
    send: (channel, ...args) => {
      if (!canUseChannel("send", channel)) return;
      ipcRenderer.send(channel, ...args);
    },
    on: (channel, listener) => {
      if (!canUseChannel("on", channel)) return () => {};
      const subscription = (event, ...args) => listener(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  })
);
