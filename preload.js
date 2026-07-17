const ORION_PROTOCOL = "orion:";
const TRUSTED_PAGE_FILES = new Set([
  "index.html",
  "newtab.html",
  "offline.html",
  "extensions.html",
  "reader.html"
]);

function getTrustedPreloadRoot() {
  if (typeof __dirname === "string" && __dirname) return __dirname;
  if (typeof process !== "object" || !Array.isArray(process.argv)) return "";
  const appPathArgument = process.argv.find((argument) => (
    typeof argument === "string" && argument.startsWith("--app-path=")
  ));
  return appPathArgument ? appPathArgument.slice("--app-path=".length) : "";
}

let preloadProtocol = "";
try {
  preloadProtocol = new URL(window.location.href).protocol;
} catch (_error) {
  // Invalid and non-app URLs do not receive a privileged bridge.
}

// Ordinary web pages take the fast path without loading any privileged module.
if (preloadProtocol === ORION_PROTOCOL || preloadProtocol === "file:") {
  const appUtils = require("./app-utils");
  const currentPage = preloadProtocol === ORION_PROTOCOL
    ? appUtils.getCanonicalAppResourceFileName(window.location.href, TRUSTED_PAGE_FILES)
    : appUtils.isTrustedBundledFilePage(
      window.location.href,
      TRUSTED_PAGE_FILES,
      getTrustedPreloadRoot()
    )
      ? appUtils.getAppPageFileName(window.location.href)
      : null;

  if (currentPage) {
    const { contextBridge, ipcRenderer } = require("electron");

    const invoke = (page, channel, ...args) => {
      if (!appUtils.canUseElectronChannel(page, "invoke", channel)) return undefined;
      return ipcRenderer.invoke(channel, ...args);
    };

    const send = (page, channel, ...args) => {
      if (!appUtils.canUseElectronChannel(page, "send", channel)) return;
      ipcRenderer.send(channel, ...args);
    };

    const on = (page, channel, listener) => {
      if (!appUtils.canUseElectronChannel(page, "on", channel) || typeof listener !== "function") {
        return () => {};
      }
      const subscription = (event, ...args) => listener(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    };

    function createIndexBridge() {
      return Object.freeze({
        invoke: (channel, ...args) => invoke(currentPage, channel, ...args),
        send: (channel, ...args) => send(currentPage, channel, ...args),
        on: (channel, listener) => on(currentPage, channel, listener)
      });
    }

    function rejectUnsafeNavigation(value) {
      return typeof value === "string" && value.toLowerCase().trim().startsWith("javascript:");
    }

    function navigateFromInternalPage(page, value) {
      if (rejectUnsafeNavigation(value)) return Promise.reject(new Error("Invalid URL"));
      return invoke(page, "navigate-to", value);
    }

    function createInternalBridge(page) {
      if (page === "extensions.html") {
        return Object.freeze({
          getExtensions: () => invoke(page, "get-extensions"),
          getLanguageSettings: () => invoke(page, "get-language-settings"),
          loadExtension: (extensionPath) => invoke(page, "load-extension", extensionPath),
          openChromeWebStore: () => invoke(page, "open-chrome-web-store"),
          removeExtension: (id) => invoke(page, "remove-extension", id),
          selectExtensionFolder: () => invoke(page, "select-extension-folder"),
          updateExtensions: () => invoke(page, "update-extensions")
        });
      }

      if (page === "reader.html") {
        return Object.freeze({
          closeReader: () => invoke(page, "close-reader"),
          getReaderContent: () => invoke(page, "get-reader-content")
        });
      }

      if (page === "offline.html") {
        return Object.freeze({
          navigateTo: (value) => navigateFromInternalPage(page, value)
        });
      }

      return Object.freeze({
        getBootstrapState: () => invoke(page, "bootstrap-newtab"),
        navigateTo: (value) => navigateFromInternalPage(page, value),
        on: (channel, listener) => on(page, channel, listener)
      });
    }

    function injectBrowserActionControls() {
      try {
        const { injectBrowserAction } = require("electron-chrome-extensions/browser-action");
        if (typeof injectBrowserAction === "function") injectBrowserAction();
      } catch (error) {
        console.error("Unable to initialize extension action controls:", error);
      }
    }

    if (currentPage === "index.html") {
      contextBridge.exposeInMainWorld("electron", createIndexBridge());
      ipcRenderer.once("extensions-ready", injectBrowserActionControls);
    } else {
      contextBridge.exposeInMainWorld("orionPage", createInternalBridge(currentPage));
    }
  }
}
