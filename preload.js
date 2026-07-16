const { contextBridge, ipcRenderer } = require("electron");

const ORION_PROTOCOL = "orion:";
const ORION_HOST = "app";

function normalizeFilePath(value) {
  if (!value || typeof value !== "string") return "";
  let normalized = value
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  if (/^\/[A-Za-z]:/.test(normalized)) normalized = normalized.slice(1);
  return normalized;
}

function getTrustedPreloadRoot() {
  if (typeof __dirname === "string" && __dirname) return __dirname;
  if (typeof process !== "object" || !Array.isArray(process.argv)) return "";
  const appPathArgument = process.argv.find((argument) => (
    typeof argument === "string" && argument.startsWith("--app-path=")
  ));
  return appPathArgument ? appPathArgument.slice("--app-path=".length) : "";
}

const APP_INVOKE_CHANNELS = Object.freeze([
  "add-new-profile",
  "check-for-updates",
  "clear-history-range",
  "clear-other-tabs",
  "close-tab",
  "close-reader",
  "create-tab-group",
  "create-ai-tab-groups",
  "create-tab",
  "delete-tab-group",
  "delete-history-item",
  "assign-tab-to-group",
  "find-in-page",
  "get-language-settings",
  "get-reader-content",
  "summarize-active-page",
  "bootstrap-window",
  "go-back",
  "go-forward",
  "navigate-to",
  "open-incognito-window",
  "preconnect-origin",
  "reload-page",
  "reopen-closed-tab",
  "set-language",
  "get-adblock-state",
  "get-browser-settings",
  "get-memory-status",
  "refresh-adblock-lists",
  "reset-adblock-defaults",
  "set-adblock-list-enabled",
  "set-browser-settings",
  "stop-find-in-page",
  "switch-profile",
  "switch-tab",
  "toggle-tab-group-collapsed",
  "toggle-reader-mode",
  "rename-tab-group",
  "update-adblock-rules"
]);

const APP_SEND_CHANNELS = Object.freeze([
  "apply-browser-color",
  "fetch-and-show-history",
  "rename-profile",
  "set-chrome-metrics",
  "toggle-browser-view",
  "update-default-search-engine"
]);

const APP_ON_CHANNELS = Object.freeze([
  "active-tab-changed",
  "download-started",
  "download-updated",
  "extensions-ready",
  "find-result",
  "history-data-received",
  "history-loaded",
  "history-updated",
  "keyboard-shortcut",
  "browser-settings-changed",
  "memory-status-changed",
  "profile-changed",
  "profile-list-updated",
  "reader-mode-changed",
  "tab-closed",
  "tab-created",
  "tab-groups-changed",
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
      const resourcePrefix = `${ORION_PROTOCOL}//${ORION_HOST}/`;
      if (!url.startsWith(resourcePrefix)) return null;
      const resourceWithSuffix = url.slice(resourcePrefix.length);
      const suffixIndex = resourceWithSuffix.search(/[?#]/);
      const resource = suffixIndex === -1
        ? resourceWithSuffix
        : resourceWithSuffix.slice(0, suffixIndex);
      if (
        !resource ||
        resource.includes("/") ||
        resource.includes("\\") ||
        /%[0-9a-f]{2}/i.test(resource) ||
        parsed.pathname !== `/${resource}`
      ) {
        return null;
      }
      file = resource;
    } else if (parsed.protocol === "file:") {
      const rawPath = url.split(/[?#]/, 1)[0];
      if (/%(?:2f|5c)/i.test(rawPath) || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(rawPath)) {
        return null;
      }
      // Handle Windows file URLs which may have format like /C:/path/to/file.html
      let pathname = parsed.pathname || "";
      // Decode URI component first
      pathname = decodeURIComponent(pathname);
      // On Windows, pathname may start with / followed by drive letter, e.g., /C:/path
      // Remove leading slash for Windows paths
      if (/^\/[A-Za-z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      // Normalize backslashes to forward slashes
      pathname = pathname.replace(/\\/g, "/");
      file = pathname.split("/").filter(Boolean).pop();
      const preloadRoot = normalizeFilePath(getTrustedPreloadRoot());
      const normalizedFilePath = normalizeFilePath(pathname);
      const expectedFilePath = preloadRoot && file ? `${preloadRoot}/${file}` : "";
      const windowsPath = /^[A-Za-z]:\//.test(preloadRoot);
      const trustedFilePath = windowsPath
        ? normalizedFilePath.toLowerCase() === expectedFilePath.toLowerCase()
        : normalizedFilePath === expectedFilePath;
      if (!trustedFilePath) return null;
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
    getBrowserSettings: () => ipcRenderer.invoke("get-browser-settings"),
    preconnectOrigin: (value) => ipcRenderer.invoke("preconnect-origin", value),
    navigateTo: (value) => {
      // Validate URL to prevent javascript: URLs
      if (typeof value === "string" && value.toLowerCase().trim().startsWith("javascript:")) {
        return Promise.reject(new Error("Invalid URL"));
      }
      return ipcRenderer.invoke("navigate-to", value);
    },
    on: (channel, listener) => {
      if (channel !== "browser-settings-changed" || typeof listener !== "function") return () => {};
      const subscription = (event, ...args) => listener(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  };

  if (page === "extensions.html") {
    return Object.freeze({
      getExtensions: () => ipcRenderer.invoke("get-extensions"),
      getLanguageSettings: () => ipcRenderer.invoke("get-language-settings"),
      loadExtension: (extensionPath) => ipcRenderer.invoke("load-extension", extensionPath),
      openChromeWebStore: () => ipcRenderer.invoke("open-chrome-web-store"),
      removeExtension: (id) => ipcRenderer.invoke("remove-extension", id),
      selectExtensionFolder: () => ipcRenderer.invoke("select-extension-folder"),
      updateExtensions: () => ipcRenderer.invoke("update-extensions")
    });
  }

  if (page === "reader.html") {
    return Object.freeze({
      closeReader: () => ipcRenderer.invoke("close-reader"),
      getReaderContent: () => ipcRenderer.invoke("get-reader-content")
    });
  }

  if (page === "offline.html") {
    return Object.freeze({
      navigateTo: (value) => {
        // Validate URL to prevent javascript: URLs
        if (typeof value === "string" && value.toLowerCase().trim().startsWith("javascript:")) {
          return Promise.reject(new Error("Invalid URL"));
        }
        return ipcRenderer.invoke("navigate-to", value);
      }
    });
  }

  return Object.freeze(newtabBridge);
}

function injectBrowserActionControls() {
  try {
    const { injectBrowserAction } = require("electron-chrome-extensions/browser-action");
    if (typeof injectBrowserAction === "function") injectBrowserAction();
  } catch (error) {
    console.error("Unable to initialize extension action controls:", error);
  }
}

const currentPage = getAppPageFileName(window.location.href);

if (currentPage === "index.html") {
  contextBridge.exposeInMainWorld("electron", createIndexBridge());
  ipcRenderer.once("extensions-ready", injectBrowserActionControls);
} else if (currentPage === "newtab.html" || currentPage === "offline.html" || currentPage === "extensions.html" || currentPage === "reader.html") {
  contextBridge.exposeInMainWorld("orionPage", createInternalBridge(currentPage));
}
