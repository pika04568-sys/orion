const {
  app,
  BrowserWindow,
  nativeImage,
  net,
  protocol,
  WebContentsView,
  ipcMain,
  globalShortcut,
  session,
  dialog,
  Menu,
  MenuItem
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");
const { URL: NodeURL } = require("url");
const browserPrivacy = require("./browser-privacy");
const browserSecurity = require("./browser-security");
const appUtils = require("./app-utils");
const localization = require("./localization");
const tabState = require("./main-tab-state");
const tabGroups = require("./tab-groups");
const offlineArcade = require("./offline-arcade");
const readerSession = require("./reader-session");
const { createCoalescedAtomicWriter } = require("./async-store");
const { createProtocolAssetHandler } = require("./protocol-assets");
const { getInitialMaterializedTabId } = require("./startup-performance");
const RAM_LIMIT_MODE_OFF = "off";
const RAM_LIMIT_MODE_AUTOMATIC = "automatic";
const RAM_LIMIT_MODES = new Set([RAM_LIMIT_MODE_OFF, RAM_LIMIT_MODE_AUTOMATIC]);
const GIBIBYTE_BYTES = 1024 * 1024 * 1024;
function isValidRamLimitMode(value) {
  return typeof value === "string" && RAM_LIMIT_MODES.has(value);
}
function sanitizeRamLimitMode(value) {
  return isValidRamLimitMode(value) ? value : RAM_LIMIT_MODE_OFF;
}
function resolveRamLimitMode(value, legacyRamLimitMb = 0) {
  if (isValidRamLimitMode(value)) return value;
  return Number.isFinite(legacyRamLimitMb) && legacyRamLimitMb > 0
    ? RAM_LIMIT_MODE_AUTOMATIC
    : RAM_LIMIT_MODE_OFF;
}
function calculateAutomaticRamLimitMb(totalMemoryBytes) {
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) return 0;
  const halfMemoryGiB = Math.floor(totalMemoryBytes / (2 * GIBIBYTE_BYTES));
  return halfMemoryGiB >= 1 ? halfMemoryGiB * 1024 : 0;
}
function resolveRamLimitMb(mode, automaticRamLimitMb) {
  return sanitizeRamLimitMode(mode) === RAM_LIMIT_MODE_AUTOMATIC
    ? automaticRamLimitMb
    : 0;
}
const AUTOMATIC_RAM_LIMIT_MB = calculateAutomaticRamLimitMb(os.totalmem());
let memoryManagerModule = null;
function getMemoryManagerModule() {
  if (!memoryManagerModule) memoryManagerModule = require("./memory-manager");
  return memoryManagerModule;
}
const APP_RESOURCE_ROOT = path.join(__dirname, "public");
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const ADBLOCK_WORKER_PATH = path.join(__dirname, "adblock-worker.cjs");
const DISABLE_BACKGROUND_NETWORK = process.env.ORION_DISABLE_BACKGROUND_NETWORK === "1";
if (process.env.ORION_USER_DATA_DIR) app.setPath("userData", process.env.ORION_USER_DATA_DIR);
const earlyStartupPerformance = globalThis.__orionEarlyStartupPerformance || null;
const startupEventLoopDelay = earlyStartupPerformance && earlyStartupPerformance.eventLoopDelay
  ? earlyStartupPerformance.eventLoopDelay
  : monitorEventLoopDelay({ resolution: 10 });
const startupMilestones = {
  bootstrapStartedMs: earlyStartupPerformance && Number.isFinite(earlyStartupPerformance.bootstrapStartedMs)
    ? earlyStartupPerformance.bootstrapStartedMs
    : performance.now(),
  mainStartedMs: performance.now()
};
if (!earlyStartupPerformance) startupEventLoopDelay.enable();
delete globalThis.__orionEarlyStartupPerformance;

const INTERNAL_PAGES = new Map([
  ["chrome://newtab", "newtab.html"],
  ["chrome://extensions", "extensions.html"],
  ["chrome://offline", "offline.html"],
  ["chrome://games", "offline.html"],
  ["chrome://reader", "reader.html"]
]);
const TRUSTED_PAGE_FILES = new Set(["index.html", "newtab.html", "offline.html", "extensions.html", "reader.html"]);
const INTERNAL_PAGES_FILE_SET = new Set(["newtab.html", "offline.html", "extensions.html", "reader.html"]);
const PROTOCOL_ASSET_FILES = new Set([
  ...TRUSTED_PAGE_FILES,
  "app-utils.js",
  "extensions.js",
  "localization.js",
  "locale-de.js",
  "locale-en.js",
  "locale-fr.js",
  "locale-ja.js",
  "newtab.js",
  "offline-game-helpers.js",
  "offline.js",
  "reader.js",
  "renderer.js"
]);
const VERSIONED_STYLE_ASSET_PATTERN = /^[a-z][a-z0-9-]*\.[a-f0-9]{12}\.css$/;
const BROWSER_SETTINGS_CHANGED_CHANNEL = "browser-settings-changed";
const MEMORY_STATUS_CHANNEL = "memory-status-changed";
const LEGACY_INCOGNITO_PARTITION_MIGRATION = "legacyPersistentIncognitoPartitionsCleared";
const MIME_TYPES = Object.freeze({
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".icns": "image/icns",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
});
const PERMISSION_LABELS = Object.freeze({
  fullscreen: "full screen access",
  geolocation: "your location",
  media: "your camera and microphone",
  notifications: "notifications"
});

let windows = {};
let views = {};
let readerViews = {};
let readerSessions = {};
let readerViewTabs = {};
let states = {};
let recentlyClosedTabs = {};
let offlineRotationStates = {};
let offlineTabs = {};
let adblockManager = null;
let readerExtractionService = null;
let aiSummaryModule = null;
let incognitoSitePermissions = {};
let partitions = new Set();
let protocolSessions = new Set();
let protocolRegistered = false;
const protocolAssetResponseCache = new Map();
let pTabs = { 0: [] };
let pGroups = { 0: [] };
let pNames = { 0: localization.getProfileName(localization.DEFAULT_LOCALE, 0) };
let activeTabIds = {};
let tabActivitySequence = 0;
const tabActivitySequences = new Map();
let tabMemoryHistory = null;
const INCOGNITO_PROFILE_BASE = 10000;
let nextIncognitoProfileId = INCOGNITO_PROFILE_BASE;
let defSearch = "chrome://newtab";

const hPath = path.join(app.getPath("userData"), "browser_history.json");
const sPath = path.join(app.getPath("userData"), "browser_settings.json");
const recoveryPath = path.join(app.getPath("userData"), "browser_session_recovery.json");

let bHist = { visits: [], lastCleanup: Date.now() };
let bSett = loadInitialSettings();
let privacySettingsCache = browserPrivacy.sanitizePrivacySettings(bSett);
const REDUCED_USER_AGENT = browserPrivacy.buildReducedUserAgent({
  chromiumVersion: process.versions.chrome,
  platform: process.platform
});
let intentionalQuit = false;
let startupDataPromise = null;
let historyLoadPromise = null;
let historyLoaded = false;
let historyDirty = false;
let quitFlushComplete = false;
let quitFlushPromise = null;
let memoryController = null;
let memoryStatus = {
  supported: true,
  enabled: false,
  usedMb: 0,
  limitMb: 0,
  overLimit: false,
  unloadedTabCount: 0
};

applyStartupDnsOverHttpsSettings();

const UPDATER_STATUS_CHANNEL = "updater-status";
const GITHUB_UPDATE_FEED = {
  provider: "github",
  owner: "pika04568-sys",
  repo: "orion",
  releaseType: "release"
};
const STARTUP_DEFERRED_ADBLOCK_DELAY_MS = 2500;
const STARTUP_DEFERRED_EXTENSION_RESTORE_DELAY_MS = 1200;
const STARTUP_DEFERRED_UPDATE_CHECK_DELAY_MS = 8000;
const FINGERPRINTING_PROTECTION_SCRIPT = browserPrivacy.createFingerprintingProtectionScript({ platform: process.platform });

if (protocol && typeof protocol.registerSchemesAsPrivileged === "function") {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appUtils.ORION_SCHEME,
      privileges: {
        bypassCSP: false,
        codeCache: true,
        corsEnabled: true,
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true
      }
    }
  ]);
} else {
  console.warn("Protocol scheme registration is unavailable in this runtime.");
}

let updaterState = {
  state: "idle",
  message: "Ready to check for updates.",
  progress: null,
  version: null,
  releaseName: null,
  releaseDate: null
};
let updaterCheckPromise = null;
let updaterCheckOrigin = "startup";
let installPromptPromise = null;
let installingUpdate = false;
let autoUpdater = null;
let extensionManager = null;
let extensionRuntimePromise = null;
let adblockRuntimePromise = null;
let ElectronChromeExtensions = null;
let chromeWebStore = null;
let adblockModule = null;
let extensionManagerModule = null;
let deferredStartup = appUtils.createDeferredStartupController({
  isDeferredNavigation: (url) => isHttpUrl(url)
});
let scheduledExtensionRestoreProfiles = new Set();
let restoredExtensionProfiles = new Set();
let startupDeferredTimers = new Set();
const extensionTabRemovalNotifications = new WeakSet();
const historyWriter = createCoalescedAtomicWriter({ filePath: hPath, delayMs: 150 });
const settingsWriter = createCoalescedAtomicWriter({ filePath: sPath, delayMs: 100 });
const recoveryWriter = createCoalescedAtomicWriter({ filePath: recoveryPath, delayMs: 250 });

function getAdblockModule() {
  if (!adblockModule) adblockModule = require("./adblock");
  return adblockModule;
}

function getExtensionManagerModule() {
  if (!extensionManagerModule) extensionManagerModule = require("./extension-manager");
  return extensionManagerModule;
}

function getExtensionIntegration() {
  if (!ElectronChromeExtensions) {
    try {
      ElectronChromeExtensions = require("electron-chrome-extensions").ElectronChromeExtensions;
    } catch (error) {
      console.warn("Chrome extension support is unavailable in this runtime:", error && error.message ? error.message : error);
      ElectronChromeExtensions = null;
    }
  }
  if (!chromeWebStore) {
    try {
      chromeWebStore = require("electron-chrome-web-store");
    } catch (error) {
      console.warn("Chrome Web Store integration is unavailable in this runtime:", error && error.message ? error.message : error);
      chromeWebStore = null;
    }
  }
  return { ElectronChromeExtensions, chromeWebStore };
}

async function ensureExtensionRuntime(win = null) {
  if (!extensionRuntimePromise) {
    extensionRuntimePromise = Promise.resolve().then(() => {
      const managerModule = getExtensionManagerModule();
      const extensionIntegration = getExtensionIntegration();
      extensionManager = managerModule.createExtensionManager({
        app,
        dialog,
        ElectronChromeExtensions: extensionIntegration.ElectronChromeExtensions,
        chromeWebStore: extensionIntegration.chromeWebStore,
        createTab: createExtensionTab,
        selectTab: selectExtensionTab,
        removeTab: removeExtensionTab,
        createWindow: createExtensionWindow,
        removeWindow: removeExtensionWindow,
        assignTabDetails: assignExtensionTabDetails,
        requestPermissions: requestExtensionPermissions
      });
      return extensionManager;
    }).catch((error) => {
      extensionRuntimePromise = null;
      throw error;
    });
  }

  const manager = await extensionRuntimePromise;
  if (win && !win.isDestroyed() && !win.incognitoWindow) {
    const sess = ensureSessionSecurity(getPartitionForProfile(win.profileIndex, false), win.profileIndex, false);
    const profile = manager.ensureProfile(win.profileIndex, sess, { incognito: false });
    Object.values(views).forEach((view) => {
      if (view && view.profileIndex === win.profileIndex && view.webContents && !view.webContents.isDestroyed()) {
        manager.addTab(win.profileIndex, view.webContents, win);
      }
    });
    if (profile && profile.webStoreReady) await profile.webStoreReady;
    if (!win.isDestroyed()) win.webContents.send("extensions-ready");
  }
  return manager;
}

async function ensureAdblockRuntime(options = {}) {
  if (!adblockRuntimePromise) {
    adblockRuntimePromise = Promise.resolve().then(async () => {
      adblockManager = getAdblockModule().createAdblockManager({
        userDataDir: app.getPath("userData"),
        workerPath: ADBLOCK_WORKER_PATH
      });
      await adblockManager.initializeAsync({ lazy: true });
      return adblockManager;
    }).catch((error) => {
      adblockRuntimePromise = null;
      throw error;
    });
  }
  const manager = await adblockRuntimePromise;
  if (options.blockingReady) await manager.ensureBlockingReadyAsync();
  return manager;
}

function getAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (error) {
    console.warn("Auto-updater is unavailable in this runtime:", error && error.message ? error.message : error);
    autoUpdater = null;
  }
  return autoUpdater;
}

function scheduleDeferredStartupTask(delayMs, task) {
  if (typeof task !== "function") return null;
  const timeoutMs = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
  const timer = setTimeout(() => {
    startupDeferredTimers.delete(timer);
    try {
      const result = task();
      if (result && typeof result.then === "function") {
        void result.catch((error) => {
          console.error("Deferred startup task failed:", error && error.message ? error.message : error);
        });
      }
    } catch (error) {
      console.error("Deferred startup task failed:", error && error.message ? error.message : error);
    }
  }, timeoutMs);
  startupDeferredTimers.add(timer);
  return timer;
}

function runAfterFirstWindowReady(task, delayMs = 0) {
  return deferredStartup.scheduleAfterWindowReady(() => {
    scheduleDeferredStartupTask(delayMs, task);
  });
}

function hasForegroundLoadingTab() {
  return Object.entries(states).some(([profileId, state]) => {
    const win = windows[profileId];
    const activeView = state && state.activeView;
    if (!win || win.isDestroyed() || !win.isVisible() || !activeView || !activeView.webContents) return false;
    if (activeView.webContents.isDestroyed()) return false;
    try {
      return activeView.webContents.isLoading();
    } catch (_error) {
      return false;
    }
  });
}

function runMaintenanceAfterWindowReady(task, delayMs = 0) {
  return runAfterFirstWindowReady(() => {
    const attempt = () => {
      if (hasForegroundLoadingTab()) {
        scheduleDeferredStartupTask(250, attempt);
        return;
      }
      return task();
    };
    return attempt();
  }, delayMs);
}

function runOnFirstHttpNavigation(task) {
  return deferredStartup.scheduleOnFirstNavigation(task);
}

function markFirstWindowReady() {
  return deferredStartup.markWindowReady();
}

function noteHttpNavigation(url) {
  return deferredStartup.markNavigation(url);
}

function ensureAdblockReadyForSession() {
  void ensureAdblockRuntime({ blockingReady: true }).catch(() => {});
  return adblockManager ? adblockManager.getState() : null;
}

function hasActiveAdblockRules(state) {
  if (!state) return false;
  if (typeof state.customRules === "string" && state.customRules.trim()) return true;
  return Array.isArray(state.lists)
    && state.lists.some((list) => list && list.enabled !== false && Number(list.ruleCount) > 0);
}

function scheduleAdblockWarmup() {
  runOnFirstHttpNavigation(() => {
    ensureAdblockReadyForSession();
  });
  runMaintenanceAfterWindowReady(() => {
    void ensureAdblockRuntime().then(async (manager) => {
      const refreshPromise = DISABLE_BACKGROUND_NETWORK
        ? Promise.resolve(manager.getState())
        : manager.refreshBuiltInLists({ reason: "startup" });
      await manager.ensureBlockingReadyAsync();
      await refreshPromise;
    }).catch(() => {});
  }, STARTUP_DEFERRED_ADBLOCK_DELAY_MS);
}

function scheduleExtensionRestoreForWindow(win) {
  if (DISABLE_BACKGROUND_NETWORK) return;
  if (!win || win.isDestroyed() || win.incognitoWindow) return;
  const profileIndex = win.profileIndex;
  if (!Array.isArray(bSett.profileExtensions[profileIndex]) || !bSett.profileExtensions[profileIndex].length) return;
  if (restoredExtensionProfiles.has(profileIndex) || scheduledExtensionRestoreProfiles.has(profileIndex)) return;
  scheduledExtensionRestoreProfiles.add(profileIndex);

  runMaintenanceAfterWindowReady(() => {
    if (win.isDestroyed()) {
      scheduledExtensionRestoreProfiles.delete(profileIndex);
      return;
    }
    scheduledExtensionRestoreProfiles.delete(profileIndex);
    restoredExtensionProfiles.add(profileIndex);
    void ensureExtensionRuntime(win).then(() => {
      const partition = getPartitionForProfile(profileIndex, false);
      return restoreStoredExtensionsForProfile(profileIndex, partition, win);
    }).catch((error) => {
      console.warn("Deferred extension restore failed:", error && error.message ? error.message : error);
    });
  }, STARTUP_DEFERRED_EXTENSION_RESTORE_DELAY_MS);
}

function scheduleStartupUpdateCheck() {
  if (DISABLE_BACKGROUND_NETWORK) return;
  runMaintenanceAfterWindowReady(() => {
    void checkForUpdates("startup");
  }, STARTUP_DEFERRED_UPDATE_CHECK_DELAY_MS);
}

function getCurrentLocale() {
  return localization.sanitizeLocale(bSett && bSett.locale);
}

function getCurrentUiPlatform() {
  return localization.normalizeUiPlatform(process.platform);
}

function getOnboardingCompleted() {
  return !!(bSett && bSett.onboardingCompleted);
}

function getTrustedAppRootPath() {
  return APP_RESOURCE_ROOT;
}

function isTrustedInternalPageUrl(url, trustedFiles) {
  return appUtils.isTrustedAppPage(url, trustedFiles)
    || appUtils.isTrustedBundledFilePage(url, trustedFiles, getTrustedAppRootPath());
}

function getDefaultProfileName(index, opts = {}) {
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  if (opts.incognito) return localization.getIncognitoProfileName(locale);
  return localization.getProfileName(locale, index);
}

function getWindowsIconPath() {
  const packagedPath = path.join(process.resourcesPath, "assets", "orion.ico");
  const devPath = path.join(__dirname, "..", "assets", "orion.ico");
  const iconPath = app.isPackaged ? packagedPath : devPath;
  return fs.existsSync(iconPath) ? iconPath : null;
}

function getMacIconPath() {
  const packagedPath = path.join(process.resourcesPath, "assets", "orion-mac.png");
  const devPath = path.join(__dirname, "..", "assets", "orion-mac.png");
  const iconPath = app.isPackaged ? packagedPath : devPath;
  return fs.existsSync(iconPath) ? iconPath : null;
}

function setMacDockIcon() {
  if (process.platform !== "darwin" || !app.dock) return;
  const iconPath = getMacIconPath();
  if (!iconPath) return;
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) app.dock.setIcon(icon);
}

function getAppHtmlPath(file) {
  return path.join(APP_RESOURCE_ROOT, file);
}

function getAppPageUrl(file, searchParams = null) {
  return appUtils.getAppPageUrl(file, searchParams);
}

function getPerformanceEpochMs() {
  return performance.timeOrigin + performance.now();
}

function sanitizePerformanceIntentEpochMs(value, fallback = getPerformanceEpochMs()) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return fallback;
  if (candidate > fallback + 100 || candidate < fallback - 10000) return fallback;
  return candidate;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || "application/octet-stream";
}

function resolveProtocolAssetPath(requestUrl) {
  let file = appUtils.getCanonicalAppResourceFileName(requestUrl, PROTOCOL_ASSET_FILES);
  if (!file) {
    const candidate = appUtils.getAppPageFileName(requestUrl);
    if (candidate && VERSIONED_STYLE_ASSET_PATTERN.test(candidate)) {
      file = appUtils.getCanonicalAppResourceFileName(requestUrl, new Set([candidate]));
    }
  }
  return file ? path.join(APP_RESOURCE_ROOT, file) : null;
}

function createProtocolNotFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

function registerAppProtocolForSession(sess) {
  if (!sess || typeof sess.protocol !== "object") return;
  if (protocolSessions.has(sess)) return;
  protocolSessions.add(sess);
  
  sess.protocol.handle(appUtils.ORION_SCHEME, createProtocolAssetHandler({
    resolveAssetPath: resolveProtocolAssetPath,
    getContentType,
    responseCache: protocolAssetResponseCache
  }));
}

function registerAppProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  registerAppProtocolForSession(session.defaultSession);
}

function showHtmlLoadError(file, error) {
  const details = error && error.message ? error.message : String(error || "Unknown error");
  const message = `Orion could not load ${file}.\n\n${details}`;
  console.error(message);
  dialog.showErrorBox("Orion failed to start", message);
}

function getUpdaterState() {
  return { ...updaterState };
}

function getUpdateWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return Object.values(windows).find((win) => win && !win.isDestroyed()) || null;
}

function broadcastUpdaterState() {
  const payload = getUpdaterState();
  Object.values(windows).forEach((win) => {
    if (win && !win.isDestroyed()) win.webContents.send(UPDATER_STATUS_CHANNEL, payload);
  });
}

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch };
  broadcastUpdaterState();
  return getUpdaterState();
}

async function showUpdaterDialog(options) {
  const win = getUpdateWindow();
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

function getReleaseName(info = {}) {
  return info.releaseName || info.version || null;
}

async function promptToInstallUpdate() {
  if (installPromptPromise || updaterState.state !== "downloaded" || installingUpdate) {
    return getUpdaterState();
  }
  const updater = getAutoUpdater();
  if (!updater) {
    setUpdaterState({
      state: "unsupported",
      message: "Auto-updates are unavailable in this runtime.",
      progress: null
    });
    return getUpdaterState();
  }
  installPromptPromise = (async () => {
    const releaseName = updaterState.releaseName || updaterState.version;
    const detail = releaseName
      ? `Orion ${releaseName} has been downloaded and is ready to install.`
      : "A new Orion update has been downloaded and is ready to install.";
    const { response } = await showUpdaterDialog({
      type: "info",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: "Restart Orion to finish updating.",
      detail
    });
    if (response === 0) {
      installingUpdate = true;
      setUpdaterState({
        state: "installing",
        message: "Restarting to install update...",
        progress: 100
      });
      updater.quitAndInstall();
    }
    return getUpdaterState();
  })().finally(() => {
    installPromptPromise = null;
  });
  return installPromptPromise;
}

function configureAutoUpdater() {
  const updater = getAutoUpdater();
  if (!updater) {
    setUpdaterState({
      state: "unsupported",
      message: "Auto-updates are unavailable in this runtime.",
      progress: null
    });
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.setFeedURL(GITHUB_UPDATE_FEED);

  updater.on("checking-for-update", () => {
    setUpdaterState({
      state: "checking",
      message: "Checking for updates...",
      progress: null
    });
  });

  updater.on("update-available", async (info) => {
    const releaseName = getReleaseName(info);
    setUpdaterState({
      state: "downloading",
      message: releaseName ? `Downloading ${releaseName}...` : "Downloading update...",
      progress: 0,
      version: info.version || null,
      releaseName,
      releaseDate: info.releaseDate || null
    });
    if (updaterCheckOrigin === "manual") {
      await showUpdaterDialog({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update Found",
        message: releaseName ? `Orion ${releaseName} is available.` : "A new Orion update is available.",
        detail: "The update is downloading in the background."
      });
    }
  });

  updater.on("update-not-available", async () => {
    setUpdaterState({
      state: "update-not-available",
      message: `You're up to date on v${app.getVersion()}.`,
      progress: null,
      version: app.getVersion(),
      releaseName: null,
      releaseDate: null
    });
    if (updaterCheckOrigin === "manual") {
      await showUpdaterDialog({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "No Updates Found",
        message: "Orion is up to date.",
        detail: `You're running v${app.getVersion()}.`
      });
    }
  });

  updater.on("download-progress", (progress) => {
    const percent = Number.isFinite(progress.percent) ? Math.round(progress.percent) : null;
    setUpdaterState({
      state: "downloading",
      message: percent === null ? "Downloading update..." : `Downloading update... ${percent}%`,
      progress: percent
    });
  });

  updater.on("update-downloaded", async (info) => {
    const releaseName = getReleaseName(info) || updaterState.releaseName;
    setUpdaterState({
      state: "downloaded",
      message: releaseName ? `${releaseName} is ready to install.` : "Update ready to install.",
      progress: 100,
      version: info.version || updaterState.version,
      releaseName,
      releaseDate: info.releaseDate || updaterState.releaseDate
    });
    await promptToInstallUpdate();
  });

  updater.on("error", async (error) => {
    const message = error && error.message ? error.message : "Unable to check for updates.";
    setUpdaterState({
      state: "error",
      message,
      progress: null
    });
    if (updaterCheckOrigin === "manual") {
      await showUpdaterDialog({
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update Error",
        message: "Orion could not complete the update check.",
        detail: message
      });
    }
  });
}

async function checkForUpdates(source = "manual") {
  if (!app.isPackaged) {
    const message = "Auto-updates are only available in packaged Orion builds.";
    setUpdaterState({
      state: "unsupported",
      message,
      progress: null
    });
    if (source === "manual") {
      await showUpdaterDialog({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Updates Unavailable",
        message: "Auto-updates do not run in development builds.",
        detail: message
      });
    }
    return getUpdaterState();
  }

  if (installingUpdate) return getUpdaterState();
  if (updaterState.state === "downloaded") return promptToInstallUpdate();
  if (updaterState.state === "checking" || updaterState.state === "downloading") {
    return getUpdaterState();
  }
  if (updaterCheckPromise) return updaterCheckPromise;

  const updater = getAutoUpdater();
  if (!updater) {
    const message = "Auto-updates are unavailable in this runtime.";
    setUpdaterState({
      state: "unsupported",
      message,
      progress: null
    });
    if (source === "manual") {
      await showUpdaterDialog({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Updates Unavailable",
        message: "Auto-updates are unavailable.",
        detail: message
      });
    }
    return getUpdaterState();
  }

  updaterCheckOrigin = source;
  updaterCheckPromise = updater
    .checkForUpdates()
    .then(() => getUpdaterState())
    .catch((error) => {
      if (updaterState.state !== "error") {
        const message = error && error.message ? error.message : "Unable to check for updates.";
        setUpdaterState({
          state: "error",
          message,
          progress: null
        });
      }
      return getUpdaterState();
    })
    .finally(() => {
      updaterCheckPromise = null;
      updaterCheckOrigin = "startup";
    });

  return updaterCheckPromise;
}

function createDefaultSettings() {
  const privacyDefaults = browserPrivacy.sanitizePrivacySettings();
  return {
    themeColor: "#e9e9f0",
    profileExtensionMetadata: {},
    profileExtensions: {},
    sitePermissions: {},
    securityMigrations: {
      [LEGACY_INCOGNITO_PARTITION_MIGRATION]: false
    },
    locale: null,
    showSeconds: undefined,
    ramLimitMode: RAM_LIMIT_MODE_OFF,
    httpsOnlyMode: privacyDefaults.httpsOnlyMode,
    antiFingerprinting: privacyDefaults.antiFingerprinting,
    dnsOverHttpsEnabled: privacyDefaults.dnsOverHttpsEnabled,
    dnsOverHttpsMode: privacyDefaults.dnsOverHttpsMode,
    dnsOverHttpsTemplate: privacyDefaults.dnsOverHttpsTemplate,
    onboardingCompleted: false
  };
}

function loadS(value) {
  if (!value || typeof value !== "object") return createDefaultSettings();
  const s = value;
  const privacySettings = browserPrivacy.sanitizePrivacySettings(s);
  return {
    ...createDefaultSettings(),
    ...s,
    profileExtensions: sanitizeProfileExtensions(s.profileExtensions),
    profileExtensionMetadata: sanitizeProfileExtensionMetadata(s.profileExtensionMetadata),
    sitePermissions: browserSecurity.sanitizePermissionStore(s.sitePermissions),
    securityMigrations: {
      [LEGACY_INCOGNITO_PARTITION_MIGRATION]: !!(
        s.securityMigrations && s.securityMigrations[LEGACY_INCOGNITO_PARTITION_MIGRATION]
      )
    },
    locale: localization.sanitizeLocale(s.locale),
    showSeconds: typeof s.showSeconds === "boolean" ? s.showSeconds : undefined,
    ramLimitMode: resolveRamLimitMode(s.ramLimitMode, s.ramLimitMb),
    ramLimitMb: undefined,
    httpsOnlyMode: privacySettings.httpsOnlyMode,
    antiFingerprinting: privacySettings.antiFingerprinting,
    dnsOverHttpsEnabled: privacySettings.dnsOverHttpsEnabled,
    dnsOverHttpsMode: privacySettings.dnsOverHttpsMode,
    dnsOverHttpsTemplate: privacySettings.dnsOverHttpsTemplate,
    onboardingCompleted: typeof s.onboardingCompleted === "boolean" ? s.onboardingCompleted : true
  };
}

function loadInitialSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(sPath, "utf8"));
    return loadS(raw);
  } catch (_error) {
    return createDefaultSettings();
  }
}

function saveS() {
  settingsWriter.schedule(bSett);
}

async function runLegacyIncognitoPartitionMigration() {
  if (
    bSett.securityMigrations &&
    bSett.securityMigrations[LEGACY_INCOGNITO_PARTITION_MIGRATION]
  ) {
    return true;
  }

  const sessionDataPath = app.getPath("sessionData") || app.getPath("userData");
  const partitionsPath = path.join(sessionDataPath, "Partitions");
  let partitionEntries = [];

  try {
    partitionEntries = (await fs.promises.readdir(partitionsPath, { withFileTypes: true }))
      .filter((entry) => entry && entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      console.warn("Unable to inspect legacy incognito partitions; cleanup will retry next launch.");
      return false;
    }
  }

  const result = await browserPrivacy.clearLegacyPersistentIncognitoPartitions({
    partitionNames: partitionEntries,
    getSession: (partition) => session.fromPartition(partition)
  });
  if (!result.complete) {
    console.warn("Unable to clear every legacy incognito partition; cleanup will retry next launch.");
    return false;
  }

  if (!bSett.securityMigrations || typeof bSett.securityMigrations !== "object") {
    bSett.securityMigrations = {};
  }
  bSett.securityMigrations[LEGACY_INCOGNITO_PARTITION_MIGRATION] = true;
  saveS();
  return true;
}

async function readRecoveryState() {
  const value = await recoveryWriter.read(null);
  return value ? tabGroups.sanitizeRecoveryState(value) : null;
}

async function deleteRecoveryState() {
  await recoveryWriter.remove().catch(() => {});
}

function getProfileRecoverySnapshot(profileId) {
  const pIdx = Number(profileId);
  if (!Number.isInteger(pIdx) || pIdx >= INCOGNITO_PROFILE_BASE) return null;
  const tabs = (pTabs[pIdx] || []).filter((tab) => tab && !tab.incognito);
  if (!tabs.length) return null;
  const activeTabId = activeTabIds[pIdx] && tabs.some((tab) => tab.id === activeTabIds[pIdx])
    ? activeTabIds[pIdx]
    : tabs[0].id;
  return {
    id: pIdx,
    name: pNames[pIdx] || getDefaultProfileName(pIdx),
    tabs,
    groups: pGroups[pIdx] || [],
    activeTabId
  };
}

function buildCurrentRecoveryState() {
  const profiles = Object.keys(pTabs)
    .map((id) => getProfileRecoverySnapshot(id))
    .filter(Boolean);
  return tabGroups.buildRecoveryState(profiles);
}

function scheduleRecoverySave() {
  if (intentionalQuit) return;
  recoveryWriter.scheduleFactory(buildCurrentRecoveryState);
}

async function restoreRecoveryState() {
  const state = await readRecoveryState();
  if (!state || !state.profiles.length) return false;

  pTabs = {};
  pGroups = {};
  pNames = {};
  activeTabIds = {};

  state.profiles.forEach((profile) => {
    pTabs[profile.id] = profile.tabs;
    pGroups[profile.id] = profile.groups;
    pNames[profile.id] = profile.name || getDefaultProfileName(profile.id);
    activeTabIds[profile.id] = profile.activeTabId;
  });

  if (!pTabs[0]) {
    pTabs[0] = [];
    pGroups[0] = [];
    pNames[0] = getDefaultProfileName(0);
  }
  return true;
}

async function loadStartupData() {
  await restoreRecoveryState();
  return true;
}

function mergeHistoryVisits(persistedVisits, currentVisits) {
  const merged = [];
  const seen = new Set();
  for (const visit of [...persistedVisits, ...currentVisits]) {
    if (!visit || typeof visit.url !== "string" || !Number.isFinite(visit.timestamp)) continue;
    const key = typeof visit.id === "string" && visit.id
      ? `id:${visit.id}`
      : `visit:${visit.url}:${visit.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(visit);
  }
  return merged.sort((left, right) => left.timestamp - right.timestamp).slice(-1000);
}

function loadHistoryInBackground() {
  if (historyLoadPromise) return historyLoadPromise;
  historyLoadPromise = historyWriter.read({ visits: [], lastCleanup: Date.now() })
    .then((history) => {
      const persistedVisits = history && Array.isArray(history.visits) ? history.visits : [];
      bHist = {
        ...(history && typeof history === "object" ? history : {}),
        visits: mergeHistoryVisits(persistedVisits, bHist.visits),
        lastCleanup: Number.isFinite(history && history.lastCleanup)
          ? history.lastCleanup
          : bHist.lastCleanup
      };
      historyLoaded = true;
      if (historyDirty) saveH();
      return bHist;
    })
    .catch(() => {
      historyLoaded = true;
      if (historyDirty) saveH();
      return bHist;
    });
  return historyLoadPromise;
}

function getBrowserSettings() {
  return {
    ...browserPrivacy.buildBrowserSettingsPayload(bSett),
    themeColor: bSett.themeColor || "#e9e9f0",
    ramLimitMode: sanitizeRamLimitMode(bSett.ramLimitMode),
    automaticRamLimitMb: AUTOMATIC_RAM_LIMIT_MB,
    ramLimitMb: getEffectiveRamLimitMb()
  };
}

function getEffectiveRamLimitMb() {
  return resolveRamLimitMb(
    bSett && bSett.ramLimitMode,
    AUTOMATIC_RAM_LIMIT_MB
  );
}

function broadcastBrowserSettings() {
  const payload = getBrowserSettings();
  Object.values(windows).forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(BROWSER_SETTINGS_CHANGED_CHANNEL, payload);
    }
  });
  Object.values(views).forEach((view) => {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send(BROWSER_SETTINGS_CHANGED_CHANNEL, payload);
    }
  });
}

function updateBrowserSettings(patch = {}) {
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(patch, "showSeconds")) {
    const nextShowSeconds = !!patch.showSeconds;
    if (bSett.showSeconds !== nextShowSeconds) {
      bSett.showSeconds = nextShowSeconds;
      changed = true;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "ramLimitMode") &&
    isValidRamLimitMode(patch.ramLimitMode) &&
    bSett.ramLimitMode !== patch.ramLimitMode
  ) {
    bSett.ramLimitMode = patch.ramLimitMode;
    changed = true;
  }

  const privacyUpdate = browserPrivacy.updatePrivacySettings(bSett, patch);
  if (privacyUpdate.changed) {
    Object.assign(bSett, privacyUpdate.next);
    privacySettingsCache = privacyUpdate.next;
    changed = true;
  }

  if (changed) {
    saveS();
    applyDnsOverHttpsSettings();
    broadcastBrowserSettings();
    if (isRamLimiterEnabled()) {
      if (memoryController) memoryController.requestEvaluation();
      else runMaintenanceAfterWindowReady(initializeMemoryController);
    } else if (memoryController) {
      memoryController.stop();
      memoryController = null;
    }
  }

  return getBrowserSettings();
}

function getPrivacySettings() {
  return privacySettingsCache;
}

function applyStartupDnsOverHttpsSettings() {
  const settings = getPrivacySettings();
  if (!settings.dnsOverHttpsEnabled) {
    app.commandLine.appendSwitch("dns-over-https-mode", "off");
    return;
  }
  app.commandLine.appendSwitch("dns-over-https-mode", settings.dnsOverHttpsMode);
  app.commandLine.appendSwitch("dns-over-https-templates", settings.dnsOverHttpsTemplate);
}

function applyDnsOverHttpsSettings() {
  const settings = getPrivacySettings();
  if (typeof app.configureHostResolver !== "function") return false;

  try {
    if (!settings.dnsOverHttpsEnabled) {
      app.configureHostResolver({
        enableBuiltInResolver: true,
        secureDnsMode: "off",
        secureDnsServers: [],
        secureDnsTemplates: ""
      });
      return true;
    }

    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: settings.dnsOverHttpsMode,
      secureDnsServers: [settings.dnsOverHttpsTemplate],
      secureDnsTemplates: settings.dnsOverHttpsTemplate
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function hardenWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.setUserAgent(REDUCED_USER_AGENT);
  webContents.on("dom-ready", () => {
    const settings = getPrivacySettings();
    const currentUrl = webContents.getURL();
    if (!settings.antiFingerprinting || !isHttpUrl(currentUrl)) return;
    void webContents.executeJavaScript(FINGERPRINTING_PROTECTION_SCRIPT, true).catch(() => {});
  });
}

function normalizeNavigationTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return { url: rawUrl || "", upgraded: false };
  const settings = getPrivacySettings();
  if (!settings.httpsOnlyMode) return { url: rawUrl, upgraded: false };
  return browserPrivacy.upgradeToHttps(rawUrl);
}

function showHttpsOnlyInterstitial(view, failedUrl) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return false;
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  const pageUrl = browserPrivacy.buildHttpsOnlyErrorPage(failedUrl, {
    title: localization.t(locale, "privacy.httpsOnlyErrorTitle"),
    body: localization.t(locale, "privacy.httpsOnlyErrorBody"),
    detail: localization.t(locale, "privacy.httpsOnlyErrorDetail")
  });
  view.pendingHttpsUpgrade = null;
  view.pendingTargetUrl = failedUrl;
  view.tUrl = failedUrl;
  clearOfflineTabContext(view.tabId);
  return view.webContents.loadURL(pageUrl).catch(() => false);
}

function sanitizeProfileExtensions(rawExtensions) {
  const next = {};
  if (!rawExtensions || typeof rawExtensions !== "object") return next;

  Object.entries(rawExtensions).forEach(([profileKey, paths]) => {
    if (!Array.isArray(paths)) return;
    const safePaths = Array.from(
      new Set(
        paths.filter((entry) => typeof entry === "string" && path.isAbsolute(entry))
      )
    );
    if (safePaths.length > 0) next[String(profileKey)] = safePaths;
  });

  return next;
}

function sanitizeProfileExtensionMetadata(rawMetadata) {
  const next = {};
  if (!rawMetadata || typeof rawMetadata !== "object") return next;

  Object.entries(rawMetadata).forEach(([profileKey, profileMetadata]) => {
    if (!profileMetadata || typeof profileMetadata !== "object") return;

    const safeProfileMetadata = {};
    Object.entries(profileMetadata).forEach(([extensionPath, metadata]) => {
      if (!path.isAbsolute(extensionPath) || !metadata || typeof metadata !== "object") return;
      const safePermissions = Array.isArray(metadata.permissions)
        ? Array.from(
          new Set(metadata.permissions.filter((entry) => typeof entry === "string" && entry.trim()))
        )
        : [];

      if (typeof metadata.hash !== "string" || !metadata.hash.trim()) return;
      safeProfileMetadata[extensionPath] = {
        description: typeof metadata.description === "string" ? metadata.description : "",
        hash: metadata.hash,
        lastConfirmedAt: Number.isFinite(metadata.lastConfirmedAt) ? metadata.lastConfirmedAt : Date.now(),
        manifestVersion: Number.isInteger(metadata.manifestVersion) ? metadata.manifestVersion : null,
        name: typeof metadata.name === "string" ? metadata.name : path.basename(extensionPath),
        permissions: safePermissions,
        version: typeof metadata.version === "string" ? metadata.version : ""
      };
    });

    if (Object.keys(safeProfileMetadata).length > 0) next[String(profileKey)] = safeProfileMetadata;
  });

  return next;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function loadH() {
  return historyWriter.read({ visits: [], lastCleanup: Date.now() });
}

function saveH() {
  historyDirty = true;
  if (!historyLoaded) return;
  const limit = Date.now() - 90 * 864e5;
  historyWriter.schedule({
    ...bHist,
    visits: bHist.visits.filter((v) => v.timestamp > limit)
  });
  historyDirty = false;
}

function getPartitionForProfile(pIdx, incognito = false) {
  return appUtils.getProfilePartitionName(pIdx, incognito);
}

function getPermissionScopeKey(pIdx, incognito = false) {
  return incognito ? `incognito:${pIdx}` : `profile:${pIdx}`;
}

function getProfileExtensionStore(pIdx) {
  if (!bSett.profileExtensions[pIdx]) bSett.profileExtensions[pIdx] = [];
  return bSett.profileExtensions[pIdx];
}

function getProfileExtensionMetadataStore(pIdx) {
  if (!bSett.profileExtensionMetadata[pIdx]) bSett.profileExtensionMetadata[pIdx] = {};
  return bSett.profileExtensionMetadata[pIdx];
}

function ensureProfileExtensionSupport(pIdx, sess, incognito = false) {
  return extensionManager ? extensionManager.ensureProfile(pIdx, sess, { incognito }) : null;
}

function getBrowserWindowById(windowId) {
  return Object.values(windows).find((win) => (
    win &&
    !win.isDestroyed() &&
    typeof windowId === "number" &&
    win.id === windowId
  )) || null;
}

function getFocusedNormalWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && typeof focused.profileIndex !== "undefined" && !focused.incognitoWindow) {
    return focused;
  }
  return Object.values(windows).find((win) => win && !win.isDestroyed() && !win.incognitoWindow) || null;
}

function getWindowForExtensionDetails(details = {}) {
  const explicitWindow = getBrowserWindowById(details.windowId);
  if (explicitWindow && !explicitWindow.incognitoWindow) return explicitWindow;
  return getFocusedNormalWindow() || windows[0] || null;
}

function getPrimaryExtensionUrl(value) {
  if (Array.isArray(value)) return getPrimaryExtensionUrl(value[0]);
  return typeof value === "string" && value.trim() ? value.trim() : "chrome://newtab";
}

function findTabByWebContents(webContents) {
  if (!webContents) return null;
  for (const [tabId, view] of Object.entries(views)) {
    if (!view || view.webContents !== webContents) continue;
    const profileIndex = typeof view.profileIndex === "number"
      ? view.profileIndex
      : parseInt(String(tabId).split("-")[1], 10);
    return {
      profileIndex: Number.isFinite(profileIndex) ? profileIndex : 0,
      tabId,
      view,
      tab: (pTabs[profileIndex] || []).find((entry) => entry && entry.id === tabId) || null
    };
  }
  return null;
}

async function createExtensionTab(details = {}) {
  const win = getWindowForExtensionDetails(details);
  if (!win || win.incognitoWindow) throw new Error("Extensions cannot create tabs in incognito windows.");
  const pIdx = win.profileIndex;
  const tab = openTabInProfile(pIdx, {
    url: getPrimaryExtensionUrl(details.url),
    incognito: false
  }, {
    win,
    activate: details.active !== false
  });
  const view = tab && views[tab.id];
  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    throw new Error("Extension tab could not be created.");
  }
  return [view.webContents, win];
}

function selectExtensionTab(webContents) {
  const found = findTabByWebContents(webContents);
  if (!found) return;
  switchT(found.tabId, found.profileIndex);
}

function removeExtensionTab(webContents) {
  if (extensionTabRemovalNotifications.has(webContents)) return;
  const found = findTabByWebContents(webContents);
  if (!found) return;
  closeTab(found.profileIndex, found.tabId, windows[found.profileIndex]);
}

async function createExtensionWindow(details = {}) {
  const win = getFocusedNormalWindow() || windows[0] || createW(0) || windows[0];
  if (!win || win.isDestroyed()) throw new Error("Extension window could not be created.");
  const urls = Array.isArray(details.url) ? details.url : [details.url || "chrome://newtab"];
  urls.filter(Boolean).forEach((url, index) => {
    openTabInProfile(win.profileIndex, {
      url: getPrimaryExtensionUrl(url),
      incognito: false
    }, {
      win,
      activate: index === 0
    });
  });
  return win;
}

function removeExtensionWindow(win) {
  if (win && !win.isDestroyed()) win.close();
}

function assignExtensionTabDetails(details, webContents) {
  const found = findTabByWebContents(webContents);
  if (!found) return;
  const win = windows[found.profileIndex];
  const tabList = pTabs[found.profileIndex] || [];
  const tabIndex = tabList.findIndex((entry) => entry && entry.id === found.tabId);
  const active = activeTabIds[found.profileIndex] === found.tabId;
  details.active = active;
  details.highlighted = active;
  details.incognito = !!(found.tab && found.tab.incognito);
  details.index = tabIndex >= 0 ? tabIndex : 0;
  details.pinned = false;
  details.selected = active;
  details.title = (found.tab && found.tab.title) || webContents.getTitle();
  details.url = (found.view && found.view.tUrl) || webContents.getURL();
  if (win && !win.isDestroyed()) details.windowId = win.id;
}

async function requestExtensionPermissions(extension, permissions = {}) {
  const requested = []
    .concat(Array.isArray(permissions.permissions) ? permissions.permissions : [])
    .concat(Array.isArray(permissions.origins) ? permissions.origins.map((origin) => `host:${origin}`) : []);
  const detail = requested.length
    ? requested.map((permission) => `- ${permission}`).join("\n")
    : "This extension did not list explicit additional permissions.";
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Allow", "Block"],
    defaultId: 1,
    cancelId: 1,
    title: "Extension Permission Request",
    message: `${extension && extension.name ? extension.name : "An extension"} wants additional access.`,
    detail
  });
  return result.response === 0;
}

function removeStoredExtensionForProfile(pIdx, extensionPath) {
  if (!bSett.profileExtensions[pIdx]) return;
  bSett.profileExtensions[pIdx] = bSett.profileExtensions[pIdx].filter((entry) => entry !== extensionPath);
  if (bSett.profileExtensionMetadata[pIdx]) delete bSett.profileExtensionMetadata[pIdx][extensionPath];
}

function buildPermissionPromptOptions(origin, permission) {
  const label = PERMISSION_LABELS[permission] || permission;
  return {
    type: "question",
    buttons: ["Allow", "Block"],
    defaultId: 1,
    cancelId: 1,
    title: "Permission Request",
    message: `${origin} wants ${label}.`,
    detail: "Your choice will be remembered for this browser profile."
  };
}

function rememberPermissionDecision(pIdx, incognito, origin, permission, decision) {
  const scopeKey = getPermissionScopeKey(pIdx, incognito);
  if (incognito) {
    browserSecurity.setPermissionDecision(incognitoSitePermissions, scopeKey, origin, permission, decision);
    return;
  }

  browserSecurity.setPermissionDecision(bSett.sitePermissions, scopeKey, origin, permission, decision);
  saveS();
}

function getRememberedPermissionDecision(pIdx, incognito, origin, permission) {
  const scopeKey = getPermissionScopeKey(pIdx, incognito);
  const store = incognito ? incognitoSitePermissions : bSett.sitePermissions;
  return browserSecurity.getPermissionDecision(store, scopeKey, origin, permission);
}

async function promptForPermission(webContents, pIdx, incognito, permission, origin) {
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const result = await (ownerWindow && !ownerWindow.isDestroyed()
    ? dialog.showMessageBox(ownerWindow, buildPermissionPromptOptions(origin, permission))
    : dialog.showMessageBox(buildPermissionPromptOptions(origin, permission)));
  const decision = result.response === 0
    ? browserSecurity.PERMISSION_DECISIONS.ALLOW
    : browserSecurity.PERMISSION_DECISIONS.DENY;
  rememberPermissionDecision(pIdx, incognito, origin, permission, decision);
  return decision === browserSecurity.PERMISSION_DECISIONS.ALLOW;
}

function parseRemoteOrigin(details = {}, webContents = null) {
  return browserSecurity.normalizePermissionOrigin(
    details.requestingOrigin ||
    details.requestingUrl ||
    (webContents && typeof webContents.getURL === "function" ? webContents.getURL() : "")
  );
}

function storeExtensionMetadata(pIdx, extensionPath, extensionInfo) {
  getProfileExtensionMetadataStore(pIdx)[extensionPath] = {
    description: extensionInfo.description || "",
    hash: extensionInfo.hash,
    lastConfirmedAt: Date.now(),
    manifestVersion: extensionInfo.manifestVersion,
    name: extensionInfo.name,
    permissions: extensionInfo.permissions.slice(),
    version: extensionInfo.version || ""
  };
}

function formatExtensionPermissions(extensionInfo) {
  if (!extensionInfo.permissions.length) return "No explicit extension permissions were declared.";
  return extensionInfo.permissions.map((permission) => `- ${permission}`).join("\n");
}

async function confirmExtensionInstall(win, extensionPath, extensionInfo) {
  const dangerousPerms = browserSecurity.getDangerousPermissions(extensionInfo.permissions);
  const hasDangerous = dangerousPerms.length > 0;
  
  const permissionDetail = hasDangerous
    ? `⚠️ WARNING: This extension requests elevated permissions:\n${dangerousPerms.join(", ")}\n\nThese permissions allow access to sensitive browser data and functionality.\n\nFull declared permissions:\n${formatExtensionPermissions(extensionInfo)}`
    : `Declared permissions:\n${formatExtensionPermissions(extensionInfo)}`;
  
  const detail = [
    `Path: ${extensionPath}`,
    extensionInfo.version ? `Version: ${extensionInfo.version}` : "Version: not specified",
    extensionInfo.manifestVersion ? `Manifest: v${extensionInfo.manifestVersion}` : "Manifest: not specified",
    "",
    permissionDetail,
    "",
    hasDangerous
      ? "⚠️ SECURITY WARNING: Only install this extension if you fully trust its source."
      : "Only install unpacked extensions from sources you trust."
  ].join("\n");

  const options = {
    type: hasDangerous ? "warning" : "warning",
    buttons: ["Install Extension", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: hasDangerous ? "⚠️ High-Risk Extension" : "Review Unpacked Extension",
    message: `Install "${extensionInfo.name}"?`,
    detail
  };
  const result = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

function ensureSessionSecurity(partition, pIdx, incognito = false) {
  if (partitions.has(partition)) return session.fromPartition(partition);
  partitions.add(partition);

  const sess = session.fromPartition(partition);
  registerAppProtocolForSession(sess);
  sess.webRequest.onBeforeRequest((details, callback) => {
    if (!details.url.startsWith("http")) return callback({ cancel: false });
    if (adblockManager && adblockManager.isBlockingReady()) {
      callback({ cancel: adblockManager.shouldBlockRequest(details) });
      return;
    }
    void ensureAdblockRuntime({ blockingReady: true }).then((manager) => {
      callback({ cancel: manager.shouldBlockRequest(details) });
    }).catch((error) => {
      console.error("Adblock initialization failed; blocking request:", error && error.message ? error.message : error);
      callback({ cancel: true });
    });
  });
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const settings = getPrivacySettings();
    if (!settings.antiFingerprinting || !details.url.startsWith("http")) {
      callback({ cancel: false, requestHeaders: details.requestHeaders });
      return;
    }

    callback({
      cancel: false,
      requestHeaders: browserPrivacy.hardenRequestHeaders(details.requestHeaders || {})
    });
  });

  sess.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = browserSecurity.normalizePermissionOrigin(requestingOrigin) || parseRemoteOrigin(details, webContents);
    if (!origin) return false;

    if (browserSecurity.shouldDenyPermissionByDefault(permission)) return false;
    const decision = getRememberedPermissionDecision(pIdx, incognito, origin, permission);
    return decision === browserSecurity.PERMISSION_DECISIONS.ALLOW;
  });

  sess.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    try {
      const origin = parseRemoteOrigin(details, webContents);
      if (!origin) return callback(false);
      if (browserSecurity.shouldDenyPermissionByDefault(permission)) return callback(false);

      const remembered = getRememberedPermissionDecision(pIdx, incognito, origin, permission);
      if (remembered === browserSecurity.PERMISSION_DECISIONS.ALLOW) return callback(true);
      if (remembered === browserSecurity.PERMISSION_DECISIONS.DENY) return callback(false);
      if (!browserSecurity.isPermissionPromptable(permission)) return callback(false);

      callback(await promptForPermission(webContents, pIdx, incognito, permission, origin));
    } catch (_error) {
      callback(false);
    }
  });
  applyDnsOverHttpsSettings();

  return sess;
}

async function restoreStoredExtensionsForProfile(pIdx, partition, win) {
  const sess = ensureSessionSecurity(partition, pIdx, false);
  const storedPaths = getProfileExtensionStore(pIdx).slice();
  const metadataStore = getProfileExtensionMetadataStore(pIdx);
  let mutated = false;
  const changedExtensions = [];

  for (const extensionPath of storedPaths) {
    try {
      const inspection = browserSecurity.inspectExtensionDirectory(extensionPath);
      const previous = metadataStore[extensionPath] || null;
      if (previous && previous.hash && previous.hash !== inspection.hash) {
        changedExtensions.push(inspection.name || path.basename(extensionPath));
        removeStoredExtensionForProfile(pIdx, extensionPath);
        mutated = true;
        continue;
      }

      storeExtensionMetadata(pIdx, extensionPath, inspection);
      mutated = true;
      await extensionManager.loadUnpackedExtension(pIdx, sess, extensionPath);
    } catch (_error) {
      removeStoredExtensionForProfile(pIdx, extensionPath);
      mutated = true;
    }
  }

  if (mutated) saveS();
  if (changedExtensions.length) {
    const options = {
      type: "warning",
      buttons: ["OK"],
      defaultId: 0,
      title: "Extension Disabled",
      message: "One or more unpacked extensions changed on disk and were disabled.",
      detail: changedExtensions.join("\n")
    };
    if (win && !win.isDestroyed()) void dialog.showMessageBox(win, options);
    else void dialog.showMessageBox(options);
  }
}

function addH(url, title) {
  if (!url) return;
  if (
    url.startsWith("about:") ||
    url.startsWith("file:") ||
    url.startsWith("chrome:") ||
    url.startsWith(appUtils.ORION_PROTOCOL)
  ) {
    return;
  }
  if (url.includes("newtab")) return;
  const now = Date.now();
  const last = bHist.visits[bHist.visits.length - 1];
  if (last && now - last.timestamp < 5000) {
    try {
      if (new URL(last.url).hostname === new URL(url).hostname) {
        last.url = url;
        last.title = title || last.title;
        last.timestamp = now;
        return saveH();
      }
    } catch (e) {}
  }
  if (!bHist.visits.find((v) => v.url === url && v.timestamp > now - 18e5)) {
    bHist.visits.push({ id: genId(), url, title: title || new URL(url).hostname, timestamp: now });
    if (bHist.visits.length > 1000) bHist.visits.shift();
    saveH();
  }
}

function updateHistoryTitle(url, title) {
  if (!url || !title) return false;
  for (let index = bHist.visits.length - 1; index >= 0; index -= 1) {
    const visit = bHist.visits[index];
    if (!visit || visit.url !== url) continue;
    if (visit.title === title) return false;
    visit.title = title;
    saveH();
    return true;
  }
  return false;
}

function getH(q = "", limit = 50) {
  const nq = q && q.toLowerCase();
  return [...bHist.visits]
    .filter((v) => !nq || v.url.toLowerCase().includes(nq) || v.title.toLowerCase().includes(nq))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

function updateB(pIdx) {
  const win = windows[pIdx];
  const s = states[pIdx];
  if (!win || !s || !s.activeView || !s.visible) return;
  const [w, h] = win.getContentSize();
  const activeTabId = getActiveT(pIdx);
  const readerActive = !!(activeTabId && readerSessions[activeTabId] && readerSessions[activeTabId].active);
  const top = readerActive ? 0 : (s.metrics.top || 76);
  const nextBounds = {
    x: readerActive ? 0 : s.metrics.left,
    y: top,
    width: Math.max(0, w - (readerActive ? 0 : s.metrics.left)),
    height: Math.max(0, h - top)
  };
  const lastBounds = s.lastBounds;
  if (
    s.lastBoundsView === s.activeView &&
    lastBounds &&
    lastBounds.x === nextBounds.x &&
    lastBounds.y === nextBounds.y &&
    lastBounds.width === nextBounds.width &&
    lastBounds.height === nextBounds.height
  ) {
    return;
  }
  s.activeView.setBounds(nextBounds);
  s.lastBounds = nextBounds;
  s.lastBoundsView = s.activeView;
}

function reloadActiveView(pIdx, options = {}) {
  const s = states[pIdx];
  if (!s || !s.activeView || s.activeView.webContents.isDestroyed()) return false;
  const activeTabId = getActiveT(pIdx);
  const offlineContext = getOfflineTabContext(activeTabId);
  if (activeTabId && offlineContext && isOfflinePageUrl(s.activeView.webContents.getURL())) {
    return !!loadTabUrl(
      activeTabId,
      pIdx,
      offlineArcade.resolveOfflineReloadTarget(offlineContext),
      { source: "reload" }
    );
  }
  if (options.ignoreCache) s.activeView.webContents.reloadIgnoringCache();
  else s.activeView.webContents.reload();
  return true;
}

function collectReaderAnalysisInPage() {
  const MAX_RUNTIME_MS = 35;
  const MAX_CANDIDATES = 48;
  const MAX_SCANNED_CONTAINERS = 160;
  const MAX_ELEMENTS_PER_CANDIDATE = 480;
  const MAX_TEXT_NODES = 240;
  const MAX_PARAGRAPHS_PER_CANDIDATE = 160;
  const MAX_HEADINGS_PER_CANDIDATE = 48;
  const MAX_LINKS_PER_CANDIDATE = 256;
  const MAX_IMAGES = 24;
  const MAX_BLOCKS = 80;
  const MAX_BLOCK_NODES = 240;
  const MAX_BLOCK_SCAN_NODES = 1200;
  const MAX_BLOCK_TEXT_CHARS = 64000;
  const MAX_JSONLD_SCRIPTS = 8;
  const MAX_JSONLD_CHARS = 262144;
  const MAX_JSONLD_NODES = 64;
  const MAX_URL_CHARS = 2048;
  const SHOW_ELEMENT = 1;
  const SHOW_TEXT = 4;
  const clock = globalThis.performance && typeof globalThis.performance.now === "function"
    ? () => globalThis.performance.now()
    : () => Date.now();
  const deadline = clock() + MAX_RUNTIME_MS;
  const hasBudget = () => clock() < deadline;
  const sliceInput = (value, maxLength) => {
    const text = String(value == null ? "" : value);
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  };
  const normalizeWhitespace = (value, maxInputLength = 12000) => sliceInput(value, maxInputLength)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cleanText = (value, limit = 6000) => normalizeWhitespace(
    value,
    Math.max(512, Math.min(MAX_BLOCK_TEXT_CHARS, limit * 2))
  ).slice(0, limit);
  const boundedNodeText = (root, limit = 6000, nodeLimit = MAX_TEXT_NODES) => {
    if (!root || !hasBudget()) return "";
    if (root.nodeType === 3) return cleanText(root.nodeValue || "", limit);
    const walker = document.createTreeWalker(root, SHOW_TEXT);
    const chunks = [];
    let chars = 0;
    let scanned = 0;
    let node;
    while (scanned < nodeLimit && chars < limit * 2 && hasBudget() && (node = walker.nextNode())) {
      scanned += 1;
      const parentTag = node.parentElement && node.parentElement.tagName
        ? node.parentElement.tagName.toLowerCase()
        : "";
      if (["script", "style", "noscript", "svg", "template"].includes(parentTag)) continue;
      const chunk = sliceInput(node.nodeValue || "", Math.min(2048, limit * 2 - chars));
      if (!chunk) continue;
      chunks.push(chunk);
      chars += chunk.length + 1;
    }
    return cleanText(chunks.join(" "), limit);
  };
  const resolveUrl = (value, baseUrl) => {
    const text = cleanText(value, MAX_URL_CHARS);
    if (!text) return "";
    const lower = text.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return "";
    if (lower.startsWith("data:")) {
      return lower.startsWith("data:image/") && text.length <= MAX_URL_CHARS ? text : "";
    }
    try {
      const resolved = baseUrl ? new URL(text, baseUrl) : new URL(text);
      const href = resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.href : "";
      return href.length <= MAX_URL_CHARS ? href : "";
    } catch (_error) {
      return "";
    }
  };
  const metaValue = (...selectors) => {
    for (const selector of selectors) {
      if (!hasBudget()) break;
      const el = document.querySelector(selector);
      if (!el) continue;
      const value = cleanText(el.content || el.getAttribute("content") || el.getAttribute("href") || el.textContent || "", 320);
      if (value) return value;
    }
    return "";
  };
  const documentTitle = cleanText(
    metaValue('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
    document.title ||
    "",
    180
  );
  const siteName = cleanText(
    metaValue('meta[property="og:site_name"]', 'meta[name="application-name"]', 'meta[name="publisher"]'),
    160
  );
  const canonicalUrl = resolveUrl(
    document.querySelector('link[rel="canonical"]')?.href || "",
    document.location.href
  );
  const byline = cleanText(
    metaValue('meta[property="article:author"]', 'meta[name="author"]', 'meta[name="byl"]') ||
    document.querySelector('[rel="author"]')?.textContent ||
    document.querySelector('[itemprop="author"]')?.textContent ||
    "",
    180
  );
  const publishedDate = cleanText(
    metaValue('meta[property="article:published_time"]', 'meta[property="og:published_time"]', 'meta[name="date"]', 'time[datetime]') ||
    document.querySelector('time[datetime]')?.getAttribute("datetime") ||
    "",
    120
  );
  const modifiedDate = cleanText(
    metaValue('meta[property="article:modified_time"]', 'meta[property="og:updated_time"]') ||
    document.querySelector('time[pubdate][datetime]')?.getAttribute("datetime") ||
    "",
    120
  );
  const getJsonLdAuthor = (author) => {
    if (!author) return "";
    if (typeof author === "string") return cleanText(author, 180);
    if (Array.isArray(author)) {
      const names = [];
      for (let index = 0; index < Math.min(author.length, 8) && hasBudget(); index += 1) {
        const entry = author[index];
        const name = entry && typeof entry === "object" ? entry.name || entry["@id"] || "" : "";
        if (name) names.push(cleanText(name, 180));
      }
      return cleanText(names.join(", "), 180);
    }
    if (typeof author === "object") return cleanText(author.name || author["@id"] || "", 180);
    return "";
  };
  const getJsonLdImage = (image) => {
    const result = [];
    const stack = [image];
    let inspected = 0;
    while (stack.length && result.length < MAX_IMAGES && inspected < MAX_JSONLD_NODES && hasBudget()) {
      const current = stack.pop();
      inspected += 1;
      if (!current) continue;
      if (Array.isArray(current)) {
        for (let index = Math.min(current.length, MAX_IMAGES) - 1; index >= 0; index -= 1) {
          stack.push(current[index]);
        }
        continue;
      }
      const raw = typeof current === "string"
        ? current
        : (typeof current === "object" ? current.url || current.contentUrl || current.thumbnailUrl || "" : "");
      const resolved = resolveUrl(raw, document.location.href);
      if (resolved && !result.includes(resolved)) result.push(resolved);
    }
    return result;
  };
  const jsonLdNodes = [];
  const scripts = document.scripts || [];
  let inspectedScripts = 0;
  let parsedScripts = 0;
  for (
    let index = 0;
    index < scripts.length && inspectedScripts < 64 && parsedScripts < MAX_JSONLD_SCRIPTS && hasBudget();
    index += 1
  ) {
    const script = scripts[index];
    inspectedScripts += 1;
    if (!script || String(script.type || "").toLowerCase() !== "application/ld+json") continue;
    parsedScripts += 1;
    const raw = script.textContent || "";
    if (!raw || raw.length > MAX_JSONLD_CHARS) continue;
    try {
      const stack = [JSON.parse(raw)];
      let inspectedJsonLdNodes = 0;
      while (
        stack.length &&
        inspectedJsonLdNodes < MAX_JSONLD_NODES &&
        jsonLdNodes.length < MAX_JSONLD_NODES &&
        hasBudget()
      ) {
        const current = stack.pop();
        inspectedJsonLdNodes += 1;
        if (!current) continue;
        if (Array.isArray(current)) {
          const remaining = Math.max(0, MAX_JSONLD_NODES - inspectedJsonLdNodes - stack.length);
          for (let itemIndex = Math.min(current.length, remaining) - 1; itemIndex >= 0; itemIndex -= 1) {
            stack.push(current[itemIndex]);
          }
          continue;
        }
        if (typeof current !== "object") continue;
        jsonLdNodes.push(current);
        if (Array.isArray(current["@graph"]) && stack.length < MAX_JSONLD_NODES) stack.push(current["@graph"]);
      }
    } catch (_error) { }
  }
  let jsonLdArticle = null;
  for (const node of jsonLdNodes) {
    if (!hasBudget()) break;
    const typeValue = node && node["@type"];
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    if (types.slice(0, 8).some((type) => typeof type === "string" && /article|newsarticle|blogposting|reportagearticle|liveblogposting|analysisnewsarticle/i.test(type))) {
      jsonLdArticle = node;
      break;
    }
  }
  const jsonLdBody = cleanText(
    jsonLdArticle && (jsonLdArticle.articleBody || jsonLdArticle.description || ""),
    12000
  );
  const jsonLdTitle = cleanText(
    jsonLdArticle && (jsonLdArticle.headline || jsonLdArticle.name || ""),
    180
  );
  const jsonLdSiteName = cleanText(
    jsonLdArticle && ((jsonLdArticle.publisher && jsonLdArticle.publisher.name) || jsonLdArticle.sourceOrganization || ""),
    160
  );
  const jsonLdByline = getJsonLdAuthor(jsonLdArticle && jsonLdArticle.author);
  const jsonLdPublishedDate = cleanText(
    jsonLdArticle && (jsonLdArticle.datePublished || ""),
    120
  );
  const jsonLdModifiedDate = cleanText(
    jsonLdArticle && (jsonLdArticle.dateModified || ""),
    120
  );
  const jsonLdImages = jsonLdArticle ? getJsonLdImage(jsonLdArticle.image).slice(0, 8) : [];
  const isReadableSelector = (el) => {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return ["article", "main", "section", "div", "body"].includes(tag);
  };
  const badPattern = /nav|footer|header|menu|sidebar|comment|subscribe|promo|advert|ad-|ads|cookie|share|social|breadcrumb|related|recommend|newsletter/i;
  const goodPattern = /article|story|content|post|entry|main|body|reader|text|rich/i;
  const candidateSet = new Set();
  const candidates = [];
  const addCandidate = (el, semanticRoot = "") => {
    if (!hasBudget() || candidates.length >= MAX_CANDIDATES || !el || candidateSet.has(el) || !isReadableSelector(el)) return;
    candidateSet.add(el);
    const text = boundedNodeText(el, 12000, MAX_TEXT_NODES);
    if (text.length < 120) return;
    let paragraphCount = 0;
    let headingCount = 0;
    let linkCount = 0;
    let linkTextLength = 0;
    const images = [];
    const walker = document.createTreeWalker(el, SHOW_ELEMENT);
    let scanned = 0;
    let node;
    while (scanned < MAX_ELEMENTS_PER_CANDIDATE && hasBudget() && (node = walker.nextNode())) {
      scanned += 1;
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (tag === "p" && paragraphCount < MAX_PARAGRAPHS_PER_CANDIDATE) {
        if (boundedNodeText(node, 1200, 48).length > 40) paragraphCount += 1;
      } else if (/^h[1-3]$/.test(tag) && headingCount < MAX_HEADINGS_PER_CANDIDATE) {
        headingCount += 1;
      } else if (tag === "img" && images.length < MAX_IMAGES) {
        const src = resolveUrl(node.currentSrc || node.src || node.getAttribute("data-src") || "", document.location.href);
        if (src && !images.includes(src)) images.push(src);
      } else if (tag === "a" && linkCount < MAX_LINKS_PER_CANDIDATE) {
        linkCount += 1;
        linkTextLength += boundedNodeText(node, 260, 24).length;
      }
    }
    const linkDensity = text.length ? linkTextLength / text.length : 1;
    const className = `${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`.toLowerCase();
    let score = 0;

    if (semanticRoot === "article" || el.tagName.toLowerCase() === "article") score += 24;
    else if (semanticRoot === "main" || el.tagName.toLowerCase() === "main" || el.getAttribute("role") === "main") score += 18;
    else if (semanticRoot === "content") score += 10;

    if (goodPattern.test(className)) score += 10;
    if (badPattern.test(className)) score -= 18;

    score += Math.min(26, text.length / 140);
    score += Math.min(18, paragraphCount * 3.5);
    score += Math.min(8, headingCount * 1.5);
    score += Math.min(6, images.length * 1.2);

    if (linkDensity > 0.5) score -= 20;
    else if (linkDensity > 0.35) score -= 12;
    else if (linkDensity > 0.22) score -= 6;

    if (paragraphCount < 2) score -= 7;
    if (text.length < 420) score -= 10;

    candidates.push({
      el,
      semanticRoot,
      text,
      textLength: text.length,
      paragraphCount,
      headingCount,
      images,
      linkDensity,
      score: Math.max(0, Math.min(100, Math.round(score)))
    });
  };

  const explicitCandidates = [
    ["article", "article"],
    ["main", "main"],
    ['[role="main"]', "main"],
    ['[data-testid="card-text-container"]', "content"],
    [".lx-recipe-content", "content"],
    [".article-body", "article"],
    ['[class*="article-body"]', "article"],
    ['[class*="story-body"]', "article"]
  ];
  for (const [selector, semanticRoot] of explicitCandidates) {
    if (!hasBudget()) break;
    addCandidate(document.querySelector(selector), semanticRoot);
  }
  if (hasBudget()) addCandidate(document.body, "content");

  if (document.body && hasBudget()) {
    const containerWalker = document.createTreeWalker(document.body, SHOW_ELEMENT);
    let scannedContainers = 0;
    let node;
    while (
      scannedContainers < MAX_SCANNED_CONTAINERS &&
      candidates.length < MAX_CANDIDATES &&
      hasBudget() &&
      (node = containerWalker.nextNode())
    ) {
      scannedContainers += 1;
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (tag !== "section" && tag !== "div") continue;
      const className = `${node.id || ""} ${typeof node.className === "string" ? node.className : ""}`.toLowerCase();
      if (badPattern.test(className)) continue;
      if (tag !== "section" && !goodPattern.test(className)) continue;
      if (boundedNodeText(node, 240, 32).length >= 180) addCandidate(node, "content");
    }
  }

  if (jsonLdBody && jsonLdBody.length >= 120) {
    const jsonLdParagraphs = jsonLdBody
      .split(/\n{2,}|\n+/)
      .map((entry) => cleanText(entry, 1800))
      .filter((entry) => entry.length > 40);
    if (jsonLdParagraphs.length) {
      candidates.push({
        el: document.body,
        semanticRoot: "article",
        text: jsonLdBody,
        textLength: jsonLdBody.length,
        paragraphCount: jsonLdParagraphs.length,
        headingCount: jsonLdTitle ? 1 : 0,
        images: jsonLdImages,
        linkDensity: 0,
        score: Math.min(
          100,
          56 +
          Math.min(20, jsonLdBody.length / 180) +
          Math.min(16, jsonLdParagraphs.length * 4) +
          (jsonLdByline ? 4 : 0) +
          (jsonLdPublishedDate ? 4 : 0) +
          (canonicalUrl ? 3 : 0) +
          (jsonLdSiteName ? 2 : 0)
        ),
        jsonLd: true
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const chosen = candidates[0] || null;
  const root = chosen && !chosen.jsonLd ? chosen.el : document.body;
  const baseUrl = document.location.href;
  const blocks = [];
  const seen = new Set();
  let blockTextChars = 0;
  const pushBlock = (type, text) => {
    if (blocks.length >= MAX_BLOCKS || blockTextChars >= MAX_BLOCK_TEXT_CHARS) return;
    const cleaned = cleanText(text, Math.min(4000, MAX_BLOCK_TEXT_CHARS - blockTextChars));
    if (!cleaned || cleaned.length < 20) return;
    const key = `${type}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ type, text: cleaned });
    blockTextChars += cleaned.length;
  };

  const collectImagesFromElement = (el) => {
    if (!el || !hasBudget()) return [];
    const imgs = [];
    const addImage = (value) => {
      const src = resolveUrl(value, baseUrl);
      if (src && !imgs.includes(src) && imgs.length < MAX_IMAGES) imgs.push(src);
    };
    const walker = document.createTreeWalker(el, SHOW_ELEMENT);
    let scanned = 0;
    let node;
    while (scanned < MAX_BLOCK_NODES && imgs.length < MAX_IMAGES && hasBudget() && (node = walker.nextNode())) {
      scanned += 1;
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (tag === "img") {
        addImage(node.currentSrc || node.src || node.getAttribute("data-src") || node.getAttribute("data-lazy-src") || "");
      } else if (tag === "source") {
        const srcset = sliceInput(node.getAttribute("srcset") || "", 4096);
        addImage(srcset.split(",", 1)[0].trim().split(/\s+/, 1)[0]);
      }
      const style = sliceInput(node.getAttribute && node.getAttribute("style") || "", 1024);
      if (style.includes("background-image")) {
        const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (match && match[1]) addImage(match[1]);
      }
    }
    return imgs;
  };

  const rootImages = root ? collectImagesFromElement(root) : [];
  const allImages = rootImages.length > 0 ? rootImages : (chosen ? chosen.images : []);
  const uniqueImages = [];
  for (let index = 0; index < allImages.length && uniqueImages.length < MAX_IMAGES; index += 1) {
    const src = resolveUrl(allImages[index], baseUrl);
    if (src && !uniqueImages.includes(src)) uniqueImages.push(src);
  }

  if (chosen && chosen.jsonLd && jsonLdBody) {
    jsonLdBody
      .split(/\n{2,}|\n+/)
      .map((entry) => cleanText(entry, 6000))
      .filter((entry) => entry.length >= 20)
      .slice(0, MAX_BLOCKS)
      .forEach((entry, index) => {
        pushBlock(index === 0 && jsonLdTitle ? "heading" : "paragraph", entry);
      });
  } else if (root) {
    const walker = document.createTreeWalker(root, SHOW_ELEMENT);
    let scanned = 0;
    let matched = 0;
    let node;
    while (
      scanned < MAX_BLOCK_SCAN_NODES &&
      matched < MAX_BLOCK_NODES &&
      blocks.length < MAX_BLOCKS &&
      hasBudget() &&
      (node = walker.nextNode())
    ) {
      scanned += 1;
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (!/^(h[1-6]|p|li|blockquote)$/.test(tag)) continue;
      matched += 1;
      const text = boundedNodeText(node, 4000, 80);
      if (!text) continue;
      if (tag === "blockquote") pushBlock("quote", text);
      else if (/^h[1-6]$/.test(tag)) pushBlock("heading", text);
      else if (tag === "li") pushBlock("list", text);
      else pushBlock("paragraph", text);
    }
    if (!matched && hasBudget()) {
      boundedNodeText(root, 6000, MAX_TEXT_NODES)
        .split(/\n{2,}/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 40)
        .slice(0, MAX_BLOCKS)
        .forEach((entry) => pushBlock("paragraph", entry));
    }
  }

  const excerpt = blocks[0] ? blocks[0].text : boundedNodeText(root, 360, 40);

  return {
    sourceUrl: baseUrl,
    canonicalUrl,
    title: jsonLdTitle || documentTitle,
    siteName: jsonLdSiteName || siteName,
    byline: jsonLdByline || byline,
    publishedDate: jsonLdPublishedDate || publishedDate,
    modifiedDate: jsonLdModifiedDate || modifiedDate,
    blocks,
    images: uniqueImages.slice(0, MAX_IMAGES).map((src) => ({ src })),
    textLength: chosen ? chosen.textLength : excerpt.length,
    paragraphCount: chosen ? chosen.paragraphCount : blocks.filter((block) => block.type === "paragraph" || block.type === "quote").length,
    headingCount: chosen ? chosen.headingCount : blocks.filter((block) => block.type === "heading").length,
    linkDensity: chosen ? chosen.linkDensity : 1,
    semanticRoot: chosen ? chosen.semanticRoot : "",
    boilerplatePenalty: chosen ? Math.max(0, 100 - chosen.score) : 35,
    structureBonus: chosen ? Math.min(20, chosen.score / 5) : 0,
    excerpt,
    score: chosen ? chosen.score : 0,
    reason: chosen && chosen.score >= 58 && (chosen.textLength >= 420 || blocks.length >= 3)
      ? ""
      : "Orion could not confidently identify a readable article on this page."
  };
}

function getReaderExtractionService() {
  if (!readerExtractionService) {
    const { createReaderExtractionService } = require("./reader-extraction");
    readerExtractionService = createReaderExtractionService({
      analysisSource: collectReaderAnalysisInPage.toString()
    });
  }
  return readerExtractionService;
}

function getAiSummaryModule() {
  if (!aiSummaryModule) aiSummaryModule = require("./ai-summary");
  return aiSummaryModule;
}

function getCommittedReaderUrl(webContents) {
  if (!webContents || webContents.isDestroyed()) return "";
  try {
    const parsed = new NodeURL(webContents.getURL());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch (_error) {
    return "";
  }
}

function getReaderCacheContext(pIdx, sourceView) {
  const webContentsId = sourceView && sourceView.webContents ? sourceView.webContents.id : "missing";
  const generation = sourceView && Number.isInteger(sourceView.readerDocumentGeneration)
    ? sourceView.readerDocumentGeneration
    : 0;
  return `profile:${pIdx}:webContents:${webContentsId}:document:${generation}`;
}

async function resolveReaderSnapshot(pIdx, tabId) {
  const sourceView = getSourceViewForTab(tabId);
  if (!sourceView || !sourceView.webContents || sourceView.webContents.isDestroyed()) return null;
  const committedUrl = getCommittedReaderUrl(sourceView.webContents);
  if (!committedUrl) return null;
  const documentGeneration = Number.isInteger(sourceView.readerDocumentGeneration)
    ? sourceView.readerDocumentGeneration
    : 0;

  const session = getReaderSession(tabId);
  const sessionSnapshot = readerSession.getReaderSnapshot(session, committedUrl);
  if (sessionSnapshot) return sessionSnapshot;

  const tab = pTabs[pIdx] && pTabs[pIdx].find((entry) => entry && entry.id === tabId) || null;
  const snapshot = await getReaderExtractionService().resolve(sourceView.webContents, {
    cache: !(tab && tab.incognito),
    contextKey: getReaderCacheContext(pIdx, sourceView)
  });
  const currentDocumentGeneration = Number.isInteger(sourceView.readerDocumentGeneration)
    ? sourceView.readerDocumentGeneration
    : 0;
  if (
    !snapshot ||
    currentDocumentGeneration !== documentGeneration ||
    getCommittedReaderUrl(sourceView.webContents) !== committedUrl
  ) return null;
  return snapshot.sourceUrl === committedUrl ? snapshot : null;
}

function getReaderSession(tabId) {
  return tabId ? readerSessions[tabId] || null : null;
}

function destroyReaderView(tabId) {
  const session = getReaderSession(tabId);
  if (!session) return;
  const readerViewId = session.readerView && session.readerView.webContents ? session.readerView.webContents.id : null;
  if (session.readerView && session.readerView.webContents && !session.readerView.webContents.isDestroyed()) {
    try {
      session.readerView.webContents.destroy();
    } catch (_error) { }
  }
  if (readerViewId != null) delete readerViewTabs[readerViewId];
  delete readerViews[tabId];
  delete readerSessions[tabId];
}

function sendReaderModeState(pIdx, tabId, payload = {}) {
  const win = windows[pIdx];
  if (!win || win.isDestroyed()) return;
  win.webContents.send("reader-mode-changed", {
    tabId,
    active: !!payload.active,
    available: payload.available !== false,
    reason: payload.reason || "",
    sourceTitle: payload.sourceTitle || "",
    sourceUrl: payload.sourceUrl || ""
  });
}

function updateReaderTabRecord(pIdx, tabId, readerMode) {
  if (!tabId || !pTabs[pIdx]) return null;
  const tab = appUtils.syncTabRecord(pTabs[pIdx], tabId, { readerMode: !!readerMode });
  scheduleRecoverySave();
  return tab;
}

function getSourceViewForTab(tabId) {
  return tabId ? views[tabId] || null : null;
}

function getReaderViewForTab(tabId) {
  const session = getReaderSession(tabId);
  return session && session.readerView ? session.readerView : null;
}

function getCurrentVisibleView(tabId) {
  const session = getReaderSession(tabId);
  if (session && session.active && session.readerView) return session.readerView;
  return getSourceViewForTab(tabId);
}

function ensureReaderView(tabId, pIdx) {
  let session = getReaderSession(tabId);
  if (!session) {
    const tab = pTabs[pIdx] && pTabs[pIdx].find((entry) => entry && entry.id === tabId) || null;
    session = readerSession.createReaderSession({
      tabId,
      profileIndex: pIdx,
      incognito: !!(tab && tab.incognito),
      sourceView: views[tabId] || null,
      sourceUrl: tab && tab.url ? tab.url : "",
      sourceTitle: tab && tab.title ? tab.title : ""
    });
    readerSessions[tabId] = session;
  }

  if (!session.readerView || !session.readerView.webContents || session.readerView.webContents.isDestroyed()) {
    const win = windows[pIdx];
    const partition = getPartitionForProfile(pIdx, !!session.incognito);
    const webP = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      safeDialogs: true,
      allowRunningInsecureContent: false,
      preload: PRELOAD_PATH,
      partition
    };
    const readerView = new WebContentsView({ webPreferences: webP });
    hardenWebContents(readerView.webContents);
    readerView.webContents.on("will-navigate", (event, targetUrl) => {
      if (isHttpUrl(targetUrl)) {
        event.preventDefault();
        openL(targetUrl, pIdx);
        return;
      }
      if (isInternalUrl(targetUrl)) return;
      event.preventDefault();
    });
    readerView.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isHttpUrl(targetUrl)) openL(targetUrl, pIdx);
      return { action: "deny" };
    });
    readerViews[tabId] = readerView;
    if (readerView.webContents) {
      readerViewTabs[readerView.webContents.id] = tabId;
    }
    session.readerView = readerView;
    readerSession.attachReaderView(session, readerView);
  }

  return session;
}

function attachViewToWindow(pIdx, view) {
  const win = windows[pIdx];
  if (!win || win.isDestroyed() || !view || !view.webContents || view.webContents.isDestroyed()) return false;
  try {
    win.contentView.addChildView(view);
    return true;
  } catch (_error) {
    return false;
  }
}

function detachViewFromWindow(pIdx, view) {
  const win = windows[pIdx];
  if (!win || win.isDestroyed() || !view || !view.webContents || view.webContents.isDestroyed()) return false;
  try {
    win.contentView.removeChildView(view);
    return true;
  } catch (_error) {
    return false;
  }
}

async function enterReaderMode(pIdx, tabId) {
  const sourceView = getSourceViewForTab(tabId);
  const tab = pTabs[pIdx] && pTabs[pIdx].find((entry) => entry && entry.id === tabId) || null;

  if (!sourceView || !sourceView.webContents || sourceView.webContents.isDestroyed()) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: "Reader mode is unavailable for this tab."
    });
    return { active: false, available: false };
  }

  const currentUrl = sourceView.webContents.getURL();
  if (!isHttpUrl(currentUrl)) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: "Reader mode only works on article pages."
    });
    return { active: false, available: false };
  }

  const snapshot = await resolveReaderSnapshot(pIdx, tabId);
  if (!snapshot || !snapshot.readable) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: snapshot && snapshot.reason ? snapshot.reason : "Reader mode is unavailable for this page."
    });
    return { active: false, available: false, reason: snapshot && snapshot.reason ? snapshot.reason : "" };
  }

  if (getActiveT(pIdx) !== tabId) {
    return { active: false, available: true, reason: "Reader mode was cancelled because the active tab changed." };
  }

  const session = ensureReaderView(tabId, pIdx);
  if (!session || !session.readerView || !session.readerView.webContents || session.readerView.webContents.isDestroyed()) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: "Reader mode could not be prepared."
    });
    return { active: false, available: false };
  }

  readerSession.setReaderSnapshot(session, snapshot, snapshot.sourceUrl);
  readerSession.setSourceState(session, {
    sourceUrl: snapshot.sourceUrl,
    sourceTitle: tab && tab.title ? tab.title : sourceView.webContents.getTitle() || ""
  });
  readerSession.activateReaderSession(session);
  updateReaderTabRecord(pIdx, tabId, true);
  loadInternal(session.readerView.webContents, "chrome://reader");

  const activeView = getCurrentVisibleView(tabId);
  const s = states[pIdx];
  const win = windows[pIdx];
  if (s && win && !win.isDestroyed()) {
    if (s.activeView && s.activeView !== activeView) {
      detachViewFromWindow(pIdx, s.activeView);
    }
    s.activeView = activeView;
    s.readerMode = true;
    s.readerTabId = tabId;
    attachViewToWindow(pIdx, activeView);
    updateB(pIdx);
  }

  sendReaderModeState(pIdx, tabId, {
    active: true,
    available: true,
    sourceTitle: session.sourceTitle,
    sourceUrl: session.sourceUrl
  });
  return { active: true, available: true, snapshot };
}

function exitReaderMode(pIdx, tabId, options = {}) {
  const session = getReaderSession(tabId);
  const sourceView = getSourceViewForTab(tabId);
  const s = states[pIdx];
  const win = windows[pIdx];
  const tab = pTabs[pIdx] && pTabs[pIdx].find((entry) => entry && entry.id === tabId) || null;
  if (!session || !session.active) {
    if (!options.silent) {
      sendReaderModeState(pIdx, tabId, {
        active: false,
        available: true,
        sourceTitle: tab && tab.title ? tab.title : "",
        sourceUrl: tab && tab.url ? tab.url : ""
      });
    }
    return { active: false, available: true };
  }

  readerSession.deactivateReaderSession(session);
  updateReaderTabRecord(pIdx, tabId, false);

  if (s && win && !win.isDestroyed()) {
    const readerView = session.readerView && session.readerView.webContents ? session.readerView : null;
    const needsAttach = !!(sourceView && s.activeView !== sourceView);
    if (s.activeView && readerView && s.activeView === readerView) {
      detachViewFromWindow(pIdx, readerView);
    }
    s.activeView = sourceView;
    s.readerMode = false;
    s.readerTabId = null;
    if (needsAttach) attachViewToWindow(pIdx, sourceView);
    updateB(pIdx);
  }

  if (!options.silent) {
    const restoreState = readerSession.getRestoreState(session);
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: true,
      sourceTitle: restoreState.sourceTitle,
      sourceUrl: restoreState.sourceUrl
    });
  }

  return { active: false, available: true };
}

function getTabReaderView(tabId) {
  const session = getReaderSession(tabId);
  return session && session.readerView && session.readerView.webContents ? session.readerView : null;
}

function getProfileTabList(pIdx) {
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  return pTabs[pIdx];
}

function getProfileGroupList(pIdx) {
  if (!pGroups[pIdx]) pGroups[pIdx] = [];
  return pGroups[pIdx];
}

function getDefaultTabTitle(pIdx, opts = {}) {
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  if (opts.incognito) return localization.getIncognitoProfileName(locale);
  return localization.t(locale, "app.newTab");
}

function rememberClosedTab(pIdx, tab) {
  if (!tab || !tab.url) return;
  if (!recentlyClosedTabs[pIdx]) recentlyClosedTabs[pIdx] = [];
  recentlyClosedTabs[pIdx].unshift({
    url: appUtils.normalizeInternalUrl(tab.url, tab.url),
    title: tab.title || tab.url,
    incognito: !!tab.incognito
  });
  if (recentlyClosedTabs[pIdx].length > 20) recentlyClosedTabs[pIdx].length = 20;
}

function openTabInProfile(pIdx, tabLike = {}, options = {}) {
  const win = options.win || windows[pIdx];
  const tabList = getProfileTabList(pIdx);
  if (!win || win.isDestroyed()) return null;
  const incognito = appUtils.resolveTabIncognito(win);

  const tabId = tabLike.id || `p-${pIdx}-t-${Date.now()}`;
  const existing = tabList.find((entry) => entry && entry.id === tabId);
  if (existing) {
    switchT(tabId, pIdx);
    return existing;
  }

  const nextUrl = appUtils.normalizeInternalUrl(tabLike.url || "chrome://newtab", "chrome://newtab") || "chrome://newtab";
  const nextTab = {
    id: tabId,
    url: nextUrl,
    title: tabLike.title || getDefaultTabTitle(pIdx, { incognito }),
    incognito,
    readerMode: !!tabLike.readerMode
  };
  if (typeof tabLike.groupId === "string") nextTab.groupId = tabLike.groupId;
  const afterTabId = typeof options.afterTabId === "string" && options.afterTabId ? options.afterTabId : null;
  const shouldActivate = options.activate !== false;
  insertTabAfter(pIdx, nextTab, afterTabId);
  scheduleRecoverySave();
  if (options.notify !== false) {
    win.webContents.send("tab-created", { ...nextTab, afterTabId, active: shouldActivate });
  }
  if (shouldActivate) {
    createV(tabId, nextUrl, nextTab.incognito, pIdx, {
      restoreReaderMode: !!nextTab.readerMode,
      performanceStartEpochMs: options.performanceStartEpochMs
    });
    switchT(tabId, pIdx);
  }
  else updateB(pIdx);
  return nextTab;
}

function switchToRelativeTab(pIdx, delta) {
  const tabList = getProfileTabList(pIdx);
  if (!tabList.length) return false;
  const activeId = getActiveT(pIdx);
  const activeIndex = tabList.findIndex((tab) => tab && tab.id === activeId);
  const baseIndex = activeIndex >= 0 ? activeIndex : 0;
  const nextIndex = (baseIndex + delta + tabList.length) % tabList.length;
  const nextTab = tabList[nextIndex];
  if (!nextTab) return false;
  switchT(nextTab.id, pIdx);
  return true;
}

function switchToTabByNumber(pIdx, tabNumber) {
  const tabList = getProfileTabList(pIdx);
  if (!tabList.length) return false;
  const index = tabNumber >= 9 ? tabList.length - 1 : tabNumber - 1;
  const nextTab = tabList[index];
  if (!nextTab) return false;
  switchT(nextTab.id, pIdx);
  return true;
}

function reopenClosedTab(pIdx) {
  const closedTabs = recentlyClosedTabs[pIdx];
  const restored = closedTabs && closedTabs.shift();
  if (!restored) return false;
  const win = windows[pIdx];
  if (!win || win.isDestroyed()) return false;
  return !!openTabInProfile(pIdx, restored, {
    win,
    afterTabId: getActiveT(pIdx)
  });
}

function broadcastTabGroupsChanged(pIdx, win = null) {
  const target = win || windows[pIdx];
  if (target && !target.isDestroyed()) {
    target.webContents.send("tab-groups-changed", {
      tabs: getWindowTabSnapshot(pIdx),
      groups: getWindowGroupSnapshot(pIdx)
    });
  }
}

function dispatchBrowserShortcutAction(pIdx, action, targetWebContents = null) {
  const win = windows[pIdx];
  if (!win || win.isDestroyed()) return false;

  switch (action) {
    case "copy":
    case "cut":
    case "paste":
    case "select-all": {
      const s = states[pIdx];
      const activeTarget =
        (targetWebContents && !targetWebContents.isDestroyed())
          ? targetWebContents
          : (s && s.activeView && s.activeView.webContents && !s.activeView.webContents.isDestroyed())
            ? s.activeView.webContents
            : win.webContents;
      if (!activeTarget || activeTarget.isDestroyed()) return false;
      if (action === "copy") activeTarget.copy();
      else if (action === "cut") activeTarget.cut();
      else if (action === "paste") activeTarget.paste();
      else activeTarget.selectAll();
      return true;
    }
    case "new-tab":
      openTabInProfile(pIdx, {
        url: "chrome://newtab",
        incognito: !!win.incognitoWindow
      }, { win });
      return true;
    case "new-incognito-tab":
      openIncognitoWindow("chrome://newtab");
      return true;
    case "close-tab": {
      const activeTabId = getActiveT(pIdx);
      if (!activeTabId) return false;
      closeTab(pIdx, activeTabId, win);
      return true;
    }
    case "reopen-closed-tab":
      return reopenClosedTab(pIdx);
    case "focus-address-bar":
    case "find-in-page":
    case "show-history":
    case "show-downloads":
    case "show-bookmarks":
    case "show-settings":
    case "bookmark-page":
      win.webContents.send("keyboard-shortcut", action);
      return true;
    case "reload-page":
      return reloadActiveView(pIdx, { ignoreCache: false });
    case "hard-reload-page":
      return reloadActiveView(pIdx, { ignoreCache: true });
    case "go-back": {
      const s = states[pIdx];
      if (s && s.activeView && s.activeView.webContents.canGoBack()) {
        s.activeView.webContents.goBack();
      }
      return true;
    }
    case "go-forward": {
      const s = states[pIdx];
      if (s && s.activeView && s.activeView.webContents.canGoForward()) {
        s.activeView.webContents.goForward();
      }
      return true;
    }
    case "switch-tab-next":
      return switchToRelativeTab(pIdx, 1);
    case "switch-tab-previous":
      return switchToRelativeTab(pIdx, -1);
    default: {
      const match = typeof action === "string" ? action.match(/^switch-tab-(\d)$/) : null;
      if (!match) return false;
      return switchToTabByNumber(pIdx, Number(match[1]));
    }
  }
}

function attachBrowserShortcutHandler(webContents, getProfileIndex) {
  if (!webContents || typeof webContents.on !== "function") return;
  webContents.on("before-input-event", (event, input) => {
    const action = appUtils.resolveBrowserShortcutAction(input);
    if (!action) return;
    const pIdx = typeof getProfileIndex === "function" ? getProfileIndex() : null;
    if (pIdx === null || typeof pIdx === "undefined") return;
    event.preventDefault();
    dispatchBrowserShortcutAction(pIdx, action, webContents);
  });
}

function appendClipboardMenuItems(menu, webContents, editFlags = {}) {
  if (!menu || typeof menu.append !== "function" || !webContents || webContents.isDestroyed()) return;

  const hasClipboardActions =
    editFlags.canUndo ||
    editFlags.canRedo ||
    editFlags.canCut ||
    editFlags.canCopy ||
    editFlags.canPaste ||
    editFlags.canSelectAll;

  if (!hasClipboardActions) return;

  if (editFlags.canUndo) {
    menu.append(new MenuItem({ label: "Undo", click: () => webContents.undo() }));
  }
  if (editFlags.canRedo) {
    menu.append(new MenuItem({ label: "Redo", click: () => webContents.redo() }));
  }
  if (editFlags.canUndo || editFlags.canRedo) {
    menu.append(new MenuItem({ type: "separator" }));
  }
  if (editFlags.canCut) {
    menu.append(new MenuItem({ label: "Cut", click: () => webContents.cut() }));
  }
  if (editFlags.canCopy) {
    menu.append(new MenuItem({ label: "Copy", click: () => webContents.copy() }));
  }
  if (editFlags.canPaste) {
    menu.append(new MenuItem({ label: "Paste", click: () => webContents.paste() }));
  }
  if (editFlags.canSelectAll) {
    menu.append(new MenuItem({ label: "Select All", click: () => webContents.selectAll() }));
  }
  if (editFlags.canCut || editFlags.canCopy || editFlags.canPaste || editFlags.canSelectAll) {
    menu.append(new MenuItem({ type: "separator" }));
  }
}

function isTrustedSenderEvent(event) {
  if (!appUtils.isMainFrameIpcEvent(event)) {
    if (process.env.ORION_LOG_IPC === "1") {
      const frame = event && event.senderFrame;
      const mainFrame = event && event.sender && event.sender.mainFrame;
      console.error("Rejected Orion IPC frame", {
        frameUrl: frame && frame.url,
        mainUrl: mainFrame && mainFrame.url,
        frameProcessId: frame && frame.processId,
        mainProcessId: mainFrame && mainFrame.processId,
        frameRoutingId: frame && frame.routingId,
        mainRoutingId: mainFrame && mainFrame.routingId,
        frameParent: frame && frame.parent ? "present" : frame && frame.parent
      });
    }
    return false;
  }
  const webContents = event.sender;
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    return isTrustedInternalPageUrl(event.senderFrame.url, TRUSTED_PAGE_FILES);
  } catch (_error) {
    return false;
  }
}

function isInternalUrl(url) {
  return INTERNAL_PAGES.has(url);
}

function isInternalPageUrl(url) {
  return isTrustedInternalPageUrl(url, INTERNAL_PAGES_FILE_SET);
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (e) {
    return false;
  }
}

function isChromeExtensionUrl(url) {
  try {
    return new URL(url).protocol === "chrome-extension:";
  } catch (_error) {
    return false;
  }
}

function normalizeHttpUrl(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isHttpUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("chrome://")) return null;
  if (!trimmed.includes("://")) return `https://${trimmed}`;
  return null;
}

function loadInternal(webContents, url, searchParams = null) {
  const file = INTERNAL_PAGES.get(url);
  const targetFile = file || "newtab.html";
  const targetUrl = appUtils.getAppPageUrl(targetFile, searchParams);
  return webContents.loadURL(targetUrl).catch((error) => {
    const errorCode = error && (error.code || error.message || "");
    if (typeof errorCode === "string" && errorCode.includes("ERR_ABORTED")) {
      return;
    }
    showHtmlLoadError(targetFile, error);
    return false;
  });
}

function isOfflinePageUrl(url) {
  return appUtils.getAppPageFileName(url) === "offline.html" || url === "chrome://offline";
}

function getOfflineTabContext(tabId) {
  return tabId ? offlineTabs[tabId] || null : null;
}

function clearOfflineTabContext(tabId) {
  if (tabId) delete offlineTabs[tabId];
}

function clearOfflineTabContextsForProfile(pIdx) {
  Object.keys(offlineTabs).forEach((tabId) => {
    if (tabId.startsWith(`p-${pIdx}-t-`)) delete offlineTabs[tabId];
  });
}

function getOfflineTargetUrl(context) {
  return offlineArcade.normalizeOfflineTargetUrl(context && context.targetUrl);
}

function getDisplayUrlForTab(tabId, rawUrl, fallbackUrl = "") {
  const offlineContext = getOfflineTabContext(tabId);
  if (offlineContext && isOfflinePageUrl(rawUrl)) return getOfflineTargetUrl(offlineContext);
  return appUtils.normalizeInternalUrl(rawUrl, fallbackUrl || rawUrl || "");
}

function getDisplayTitleForTab(tabId, rawTitle) {
  const offlineContext = getOfflineTabContext(tabId);
  return offlineContext ? offlineContext.title : rawTitle;
}

function buildOfflinePageUrl(game, targetUrl, source) {
  return getAppPageUrl("offline.html", {
    game,
    source: source || "offline",
    target: offlineArcade.normalizeOfflineTargetUrl(targetUrl)
  });
}

function pickOfflineGame(pIdx) {
  const next = offlineArcade.nextOfflineGame(offlineRotationStates[pIdx]);
  offlineRotationStates[pIdx] = next.state;
  return next.game;
}

function isBrowserOnline() {
  try {
    return !!net.isOnline();
  } catch (_error) {
    return true;
  }
}

function showOfflinePage(tabId, pIdx, options = {}) {
  const view = views[tabId];
  const win = windows[pIdx];
  if (!view || !view.webContents || view.webContents.isDestroyed()) return false;

  const game = options.game || pickOfflineGame(pIdx);
  const targetUrl = offlineArcade.normalizeOfflineTargetUrl(options.targetUrl);
  const title = offlineArcade.buildOfflineTitle(game);
  const source = options.source || "offline";
  const fileUrl = buildOfflinePageUrl(game, targetUrl, source);

  offlineTabs[tabId] = { game, targetUrl, title, source };
  appUtils.syncTabRecord(pTabs[pIdx], tabId, { url: targetUrl, title });
  scheduleRecoverySave();

  view.tUrl = targetUrl;
  view.pendingHttpsUpgrade = null;
  view.lastHandledFailure = null;

  if (win && !win.isDestroyed()) {
    win.webContents.send("view-event", { tabId, type: "did-navigate", url: targetUrl });
    win.webContents.send("view-event", { tabId, type: "title", title });
  }

  return view.webContents.loadURL(fileUrl).catch(() => false);
}

function loadTabUrl(tabId, pIdx, rawUrl, options = {}) {
  const view = views[tabId];
  if (!view || !view.webContents || view.webContents.isDestroyed()) return false;
  if (view.performanceContext) {
    view.performanceContext.navigationStartedAtEpochMs = sanitizePerformanceIntentEpochMs(
      options.performanceIntentEpochMs
    );
    view.performanceContext.navigationDispatchedAtEpochMs = null;
  }

  const internalNormalizedUrl = appUtils.normalizeInternalUrl(rawUrl || "chrome://newtab", "chrome://newtab") || "chrome://newtab";
  const navigationTarget = isHttpUrl(internalNormalizedUrl)
    ? normalizeNavigationTarget(internalNormalizedUrl)
    : { url: internalNormalizedUrl, upgraded: false };
  const normalizedUrl = navigationTarget.url || "chrome://newtab";
  const source = options.source || "navigate";
  const session = getReaderSession(tabId);
  if (session && session.active) {
    exitReaderMode(pIdx, tabId);
  }

  if (normalizedUrl === "chrome://offline") {
    return showOfflinePage(tabId, pIdx, {
      targetUrl: options.targetUrl || "chrome://newtab",
      source
    });
  }

  if (normalizedUrl === "chrome://newtab" && offlineArcade.shouldRouteNewTabToOffline(isBrowserOnline())) {
    return showOfflinePage(tabId, pIdx, {
      targetUrl: "chrome://newtab",
      source: source === "reload" ? "reload" : "new-tab"
    });
  }

  clearOfflineTabContext(tabId);
  view.lastHandledFailure = null;
  view.pendingHttpsUpgrade = navigationTarget.upgraded ? normalizedUrl : null;
  view.pendingTargetUrl = normalizedUrl;
  view.tUrl = normalizedUrl;
  appUtils.syncTabRecord(pTabs[pIdx], tabId, { url: normalizedUrl });
  scheduleRecoverySave();

  if (isInternalUrl(normalizedUrl)) {
    return loadInternal(view.webContents, normalizedUrl, {
      tabId,
      startedAt: view.performanceContext && view.performanceContext.createdAtEpochMs
    });
  }
  if (isHttpUrl(normalizedUrl)) {
    noteHttpNavigation(normalizedUrl);
    ensureAdblockReadyForSession();
    const loadPromise = view.webContents.loadURL(normalizedUrl);
    if (view.performanceContext) {
      view.performanceContext.navigationDispatchedAtEpochMs = getPerformanceEpochMs();
    }
    return loadPromise.catch(() => false);
  }
  if (isChromeExtensionUrl(normalizedUrl)) {
    return view.webContents.loadURL(normalizedUrl).catch(() => false);
  }
  return loadInternal(view.webContents, "chrome://newtab", {
    tabId,
    startedAt: view.performanceContext && view.performanceContext.createdAtEpochMs
  });
}

function createW(pIdx = 0, opts = {}) {
  const isIncognito = !!opts.incognito;
  if (!isIncognito && windows[pIdx]) return windows[pIdx].focus();
  const partition = getPartitionForProfile(pIdx, isIncognito);
  ensureSessionSecurity(partition, pIdx, isIncognito);
  let win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: bSett.themeColor || "#e9e9f0",
    icon:
      process.platform === "win32"
        ? getWindowsIconPath() || undefined
        : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      safeDialogs: true,
      allowRunningInsecureContent: false,
      preload: PRELOAD_PATH,
      partition
    },
    autoHideMenuBar: true
  });
  if (!startupMilestones.windowCreatedMs) startupMilestones.windowCreatedMs = performance.now();
  win.profileIndex = pIdx;
  win.incognitoWindow = isIncognito;
  windows[pIdx] = win;
  attachBrowserShortcutHandler(win.webContents, () => win.profileIndex);
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  if (!pGroups[pIdx]) pGroups[pIdx] = [];
  pNames[pIdx] = isIncognito ? getDefaultProfileName(pIdx, { incognito: true }) : (pNames[pIdx] || getDefaultProfileName(pIdx));
  states[pIdx] = { activeView: null, metrics: { top: 76, left: 0 }, visible: true, readerMode: false, readerTabId: null };

  win.loadURL(getAppPageUrl("index.html")).catch((error) => {
    console.error(`Failed to load index.html: ${error.message}`);
    console.error(`Error code: ${error.code}`);
    showHtmlLoadError("index.html", error);
    if (!win.isDestroyed()) win.destroy();
  });
  
  // Add load failure detection
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`index.html failed to load: ${errorCode} - ${errorDescription}`);
  });
  
  win.on("resize", () => updateB(pIdx));
  win.on("closed", () => {
    Object.entries(views).forEach(([tabId, view]) => {
      if (tabMemoryHistory && view && view.profileIndex === pIdx) tabMemoryHistory.remove(tabId);
    });
    delete windows[pIdx];
    delete states[pIdx];
    delete offlineRotationStates[pIdx];
    clearOfflineTabContextsForProfile(pIdx);
    if (isIncognito) {
      delete incognitoSitePermissions[getPermissionScopeKey(pIdx, true)];
      delete pTabs[pIdx];
      delete pGroups[pIdx];
      delete pNames[pIdx];
      delete activeTabIds[pIdx];
    }
    saveH();
    scheduleRecoverySave();
  });
  broadcast();
  scheduleExtensionRestoreForWindow(win);
  return win;
}

function getProfileListSnapshot() {
  return Object.keys(pTabs)
    .filter((i) => parseInt(i, 10) < INCOGNITO_PROFILE_BASE)
    .map((i) => ({
      id: parseInt(i, 10),
      name: pNames[i] || getDefaultProfileName(parseInt(i, 10))
    }));
}

function getNextAvailableProfileIndex() {
  let n = 0;
  while (Object.prototype.hasOwnProperty.call(pTabs, n)) n++;
  return n;
}

function broadcast() {
  const p = getProfileListSnapshot();
  Object.values(windows).forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send("profile-list-updated", { profiles: p });
  });
}

function getActiveT(pIdx) {
  const s = states[pIdx];
  if (!s || !s.activeView) return activeTabIds[pIdx] || null;
  for (const [id, v] of Object.entries(views)) if (v === s.activeView) return id;
  for (const [id, session] of Object.entries(readerSessions)) {
    if (session && session.readerView === s.activeView) return id;
  }
  return null;
}

function isRamLimiterEnabled() {
  return getEffectiveRamLimitMb() > 0;
}

function getUnloadedTabCount() {
  const unmaterialized = Object.values(pTabs).reduce((count, tabs) => (
    count + (Array.isArray(tabs) ? tabs.filter((tab) => tab && !views[tab.id]).length : 0)
  ), 0);
  return unmaterialized + Object.values(views).filter((view) => (
    view && (view.memoryDiscarded || view.memoryDiscarding)
  )).length;
}

function isViewAudible(view) {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return false;
  if (typeof view.webContents.isCurrentlyAudible !== "function") return false;
  try {
    return !!view.webContents.isCurrentlyAudible();
  } catch (_error) {
    return true;
  }
}

function appendMemoryProcessOwner(processOwners, tabId, webContents) {
  if (
    !webContents ||
    (typeof webContents.isDestroyed === "function" && webContents.isDestroyed()) ||
    typeof webContents.getOSProcessId !== "function"
  ) {
    return;
  }
  try {
    const pid = webContents.getOSProcessId();
    if (Number.isInteger(pid) && pid > 0) processOwners.push({ tabId, pid });
  } catch (_error) {}
}

function getMemoryProcessOwners() {
  const processOwners = [];
  Object.entries(views).forEach(([tabId, view]) => {
    if (
      !view || !view.webContents ||
      view.memoryDiscarded || view.memoryDiscarding
    ) {
      return;
    }
    appendMemoryProcessOwner(processOwners, tabId, view.webContents);
    const readerView = readerSessions[tabId] && readerSessions[tabId].readerView;
    if (readerView && readerView.webContents) {
      appendMemoryProcessOwner(processOwners, tabId, readerView.webContents);
    }
  });
  return processOwners;
}

function observeTabMemoryMetrics(metrics) {
  if (!tabMemoryHistory) {
    tabMemoryHistory = getMemoryManagerModule().createTabMemoryHistory();
  }
  return tabMemoryHistory.observe(metrics, getMemoryProcessOwners());
}

function getMemoryUnloadCandidates() {
  return Object.entries(views).map(([id, view]) => {
    const pIdx = view && view.profileIndex;
    return {
      id,
      profileIndex: pIdx,
      active: Number.isInteger(pIdx) && (getActiveT(pIdx) === id || activeTabIds[pIdx] === id),
      audible: isViewAudible(view),
      unloaded: !view || !view.webContents || view.webContents.isDestroyed() || !!(
        view.memoryDiscarded || view.memoryDiscarding
      ),
      peakWorkingSetKb: tabMemoryHistory ? tabMemoryHistory.getPeakWorkingSetKb(id) : 0,
      lastActiveSequence: tabActivitySequences.get(id) || 0
    };
  });
}

function broadcastMemoryStatus(status = memoryStatus) {
  Object.values(windows).forEach((win) => {
    if (win && !win.isDestroyed()) win.webContents.send(MEMORY_STATUS_CHANNEL, status);
  });
}

async function unloadTabForMemory(candidate) {
  const id = candidate && candidate.id;
  const view = id ? views[id] : null;
  const pIdx = view && view.profileIndex;
  const win = Number.isInteger(pIdx) ? windows[pIdx] : null;
  const tab = Number.isInteger(pIdx) && pTabs[pIdx]
    ? pTabs[pIdx].find((entry) => entry && entry.id === id) || null
    : null;
  if (
    !id || !view || !tab || !win || win.isDestroyed() ||
    !view.webContents || view.webContents.isDestroyed() ||
    view.memoryDiscarded || view.memoryDiscarding ||
    getActiveT(pIdx) === id || activeTabIds[pIdx] === id ||
    isViewAudible(view)
  ) {
    return false;
  }

  const webContents = view.webContents;
  const currentUrl = view.tUrl || getDisplayUrlForTab(id, webContents.getURL(), tab.url) || tab.url || "chrome://newtab";
  const currentTitle = webContents.getTitle() || tab.title || currentUrl;
  const readerMode = !!(tab.readerMode || (readerSessions[id] && readerSessions[id].active));
  return getMemoryManagerModule().unloadTabPage({
    view,
    tab,
    savedUrl: currentUrl,
    savedTitle: currentTitle,
    readerMode,
    syncTabRecord: (patch) => appUtils.syncTabRecord(pTabs[pIdx], id, patch),
    destroyReaderView: readerSessions[id] ? () => destroyReaderView(id) : null,
    onDiscarded: scheduleRecoverySave
  });
}

function finishPendingReaderRestore(pIdx, id, view) {
  if (
    !view || !view.pendingReaderRestore ||
    !view.webContents || view.webContents.isDestroyed() ||
    view.webContents.isLoading() || activeTabIds[pIdx] !== id
  ) {
    return false;
  }

  view.pendingReaderRestore = false;
  void enterReaderMode(pIdx, id).then((result) => {
    if (!result || result.active !== true) updateReaderTabRecord(pIdx, id, false);
  }).catch(() => {
    updateReaderTabRecord(pIdx, id, false);
  });
  return true;
}

function restoreMemoryDiscardedTab(id, pIdx) {
  const view = views[id];
  const tab = pTabs[pIdx] && pTabs[pIdx].find((entry) => entry && entry.id === id) || null;
  if (!view || (!view.memoryDiscarded && !view.memoryDiscarding)) return false;
  return getMemoryManagerModule().restoreUnloadedTabPage({
    view,
    tab,
    loadUrl: (targetUrl) => loadTabUrl(id, pIdx, targetUrl, { source: "memory-restore" })
  });
}

function initializeMemoryController() {
  if (!isRamLimiterEnabled()) return null;
  if (memoryController) memoryController.stop();
  const memoryManager = getMemoryManagerModule();
  if (!tabMemoryHistory) tabMemoryHistory = memoryManager.createTabMemoryHistory();
  memoryController = memoryManager.createMemoryController({
    getMetrics: () => app.getAppMetrics(),
    getLimitMb: getEffectiveRamLimitMb,
    getCandidates: getMemoryUnloadCandidates,
    unloadTab: unloadTabForMemory,
    getUnloadedTabCount,
    observeMetrics: observeTabMemoryMetrics,
    onStatus: (status) => {
      memoryStatus = { ...status };
      broadcastMemoryStatus(memoryStatus);
    }
  });
  memoryController.start();
  return memoryController;
}

function insertTabAfter(pIdx, tab, afterTabId) {
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  const list = pTabs[pIdx];
  if (!afterTabId) {
    list.push(tab);
    return;
  }
  const idx = list.findIndex((t) => t.id === afterTabId);
  if (idx === -1) list.push(tab);
  else list.splice(idx + 1, 0, tab);
}

function createT(pIdx, win, options = {}) {
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  if (!pGroups[pIdx]) pGroups[pIdx] = [];
  const id = `p-${pIdx}-t-1`;
  const home = "chrome://newtab";
  const isIncognito = !!(win && win.incognitoWindow);
  const pendingUrl = win && win.pendingIncognitoUrl;
  const initialUrl = pendingUrl || home;
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  if (!pTabs[pIdx].length) {
    pTabs[pIdx].push({
      id,
      url: initialUrl,
      title: isIncognito ? localization.getIncognitoProfileName(locale) : localization.t(locale, "app.newTab"),
      incognito: isIncognito,
      readerMode: false
    });
    if (pendingUrl) delete win.pendingIncognitoUrl;
  }

  const nextActive = getInitialMaterializedTabId(pTabs[pIdx], activeTabIds[pIdx]);
  pTabs[pIdx].forEach((tab) => {
    if (tab) tab.incognito = isIncognito;
  });
  const activeTab = pTabs[pIdx].find((tab) => tab && tab.id === nextActive);
  if (activeTab && !views[nextActive]) {
    createV(nextActive, activeTab.url || home, isIncognito, pIdx, {
      restoreReaderMode: !!activeTab.readerMode
    });
  }
  if (!options.quiet) {
    win.webContents.send("profile-changed", {
      profileIndex: pIdx,
      tabs: pTabs[pIdx],
      groups: pGroups[pIdx],
      incognitoWindow: isIncognito
    });
  }
  switchT(nextActive, pIdx, { quiet: !!options.quiet });
  if (!options.quiet) broadcast();
  scheduleRecoverySave();
}

function getWindowTabSnapshot(pIdx) {
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  return getProfileTabList(pIdx).map((tab, index) => {
    const fallbackTitle = tab && tab.incognito
      ? localization.getIncognitoProfileName(locale)
      : localization.t(locale, "app.newTab");
    return {
      id: tab.id || `p-${pIdx}-t-${index + 1}`,
      url: appUtils.normalizeInternalUrl(tab.url || "chrome://newtab", "chrome://newtab") || "chrome://newtab",
      title: tab.title || fallbackTitle,
      incognito: !!tab.incognito,
      readerMode: !!tab.readerMode,
      groupId: typeof tab.groupId === "string" ? tab.groupId : undefined
    };
  });
}

function getWindowGroupSnapshot(pIdx) {
  return tabGroups.sanitizeGroups(getProfileGroupList(pIdx));
}

function getTabWebPreferences(pIdx, inc) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    safeDialogs: true,
    allowRunningInsecureContent: false,
    preload: PRELOAD_PATH,
    partition: getPartitionForProfile(pIdx, inc)
  };
}

async function ensureWindowBootstrapState(win) {
  if (!win || win.isDestroyed()) return null;
  if (startupDataPromise) await startupDataPromise;
  const pIdx = win.profileIndex;
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  if (!states[pIdx]) {
    states[pIdx] = { activeView: null, metrics: { top: 76, left: 0 }, visible: true, readerMode: false, readerTabId: null };
  }

  if (!pTabs[pIdx].length) createT(pIdx, win, { quiet: true });
  const tabList = getProfileTabList(pIdx);
  if (tabList.length) {
    const requestedActiveId = getActiveT(pIdx) || tabList[0].id;
    if (!views[requestedActiveId]) switchT(requestedActiveId, pIdx, { quiet: true });
  }

  const snapshot = {
    profileIndex: pIdx,
    incognitoWindow: !!win.incognitoWindow,
    profiles: getProfileListSnapshot(),
    tabs: getWindowTabSnapshot(pIdx),
    groups: getWindowGroupSnapshot(pIdx),
    activeTabId: getActiveT(pIdx) || (tabList[0] && tabList[0].id) || null,
    locale: getCurrentLocale(),
    onboardingCompleted: getOnboardingCompleted(),
    platform: getCurrentUiPlatform(),
    browserSettings: getBrowserSettings(),
    memoryStatus: { ...memoryStatus },
    updaterState: getUpdaterState(),
    version: app.getVersion(),
    startupPerformance: {
      ...startupMilestones,
      mainTimeOriginMs: performance.timeOrigin,
      bootstrapReadyMs: performance.now(),
      maxMainEventLoopDelayMs: startupEventLoopDelay.max / 1e6
    }
  };
  startupEventLoopDelay.disable();
  markFirstWindowReady();
  return snapshot;
}

function createV(id, url, inc, pIdx, options = {}) {
  if (views[id] && views[id].webContents && !views[id].webContents.isDestroyed()) return views[id];
  const win = windows[pIdx];
  const s = states[pIdx];
  const partition = getPartitionForProfile(pIdx, inc);
  ensureSessionSecurity(partition, pIdx, inc);
  const v = new WebContentsView({ webPreferences: getTabWebPreferences(pIdx, inc) });
  attachBrowserShortcutHandler(v.webContents, () => pIdx);
  v.tabId = id;
  v.profileIndex = pIdx;
  v.performanceContext = {
    tabId: id,
    createdAtEpochMs: Number.isFinite(options.performanceStartEpochMs)
      ? options.performanceStartEpochMs
      : getPerformanceEpochMs(),
    navigationStartedAtEpochMs: null,
    navigationDispatchedAtEpochMs: null
  };
  v.webContents.__orionTabId = id;
  v.webContents.__orionPerformance = v.performanceContext;
  v.tUrl = url || "chrome://newtab";
  v.memoryHistoryPageUrl = v.tUrl;
  v.memoryDiscarding = false;
  v.memoryDiscarded = !!options.startDiscarded;
  v.memoryRestoring = false;
  v.pendingReaderRestore = !!options.restoreReaderMode;
  v.readerDocumentGeneration = 0;
  if (!v.__orionHardened) {
    hardenWebContents(v.webContents);
    v.__orionHardened = true;
  }
  views[id] = v;
  if (extensionManager && appUtils.shouldPersistTabActivity({ incognito: inc })) {
    extensionManager.addTab(pIdx, v.webContents, win);
  }
  updateB(pIdx);

  v.webContents.on("will-navigate", (event, targetUrl) => {
    if (isInternalUrl(targetUrl)) {
      if (isInternalPageUrl(v.webContents.getURL())) {
        event.preventDefault();
        loadTabUrl(id, pIdx, targetUrl, {
          source: targetUrl === "chrome://newtab" ? "new-tab" : "internal"
        });
      } else {
        event.preventDefault();
      }
      return;
    }
    if (isHttpUrl(targetUrl)) {
      const target = normalizeNavigationTarget(targetUrl);
      if (target.upgraded) {
        event.preventDefault();
        loadTabUrl(id, pIdx, target.url, { source: "navigate" });
      }
      return;
    }
    if (isChromeExtensionUrl(targetUrl)) return;
    event.preventDefault();
  });

  v.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame === false) return;
    if (readerExtractionService) {
      readerExtractionService.clearContext(getReaderCacheContext(pIdx, v));
    }
    v.readerDocumentGeneration += 1;
    const session = getReaderSession(id);
    if (session) readerSession.setReaderSnapshot(session, null);
    if (win && !win.isDestroyed()) {
      win.webContents.send("view-event", { tabId: id, type: "did-start-navigation" });
    }
  });

  v.webContents.on("did-navigate-in-page", (_event, u, isMainFrame) => {
    if (isMainFrame === false || !isHttpUrl(u)) return;
    const displayUrl = getDisplayUrlForTab(id, u, v.tUrl || u);
    v.tUrl = displayUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnNavigate(pTabs[pIdx], id, displayUrl);
    scheduleRecoverySave();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("view-event", { tabId: id, type: "did-navigate", url: displayUrl });
    const tab = pTabs[pIdx].find((entry) => entry && entry.id === id);
    if (appUtils.shouldPersistTabActivity(tab)) {
      addH(displayUrl, (updatedTab && updatedTab.title) || v.webContents.getTitle() || displayUrl);
    }
  });

  v.webContents.on("did-navigate", (_e, u) => {
    if ((v.memoryDiscarding || v.memoryDiscarded || v.memoryRestoring) && u === "about:blank") return;
    if (v.memoryRestoring) v.memoryRestoring = false;
    const previousMemoryHistoryPageUrl = v.memoryHistoryPageUrl || "";
    const offlinePage = isOfflinePageUrl(u);
    const httpsOnlyInterstitial = typeof u === "string" && u.startsWith("data:text/html");
    if (!offlinePage) clearOfflineTabContext(id);
    if (!offlinePage && !httpsOnlyInterstitial) v.pendingHttpsUpgrade = null;
    const navigationUrl = httpsOnlyInterstitial ? (v.pendingTargetUrl || v.tUrl || u) : u;
    const displayUrl = getDisplayUrlForTab(id, navigationUrl, v.tUrl || navigationUrl);
    if (
      previousMemoryHistoryPageUrl && displayUrl &&
      previousMemoryHistoryPageUrl !== displayUrl
    ) {
      if (tabMemoryHistory) tabMemoryHistory.reset(id);
    }
    v.memoryHistoryPageUrl = displayUrl || previousMemoryHistoryPageUrl;
    v.tUrl = displayUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnNavigate(pTabs[pIdx], id, displayUrl);
    scheduleRecoverySave();
    if (win) {
      win.webContents.send("view-event", { tabId: id, type: "did-navigate", url: displayUrl });
      const tab = pTabs[pIdx].find((t) => t.id === id);
      if (!offlinePage && !httpsOnlyInterstitial && appUtils.shouldPersistTabActivity(tab)) {
        try {
          const host = new URL(displayUrl).hostname;
          addH(displayUrl, (updatedTab && updatedTab.title) || host);
        } catch (e) {
          addH(displayUrl, displayUrl);
        }
      }
    }
  });
  v.webContents.on("did-start-loading", () => {
    if (v.memoryDiscarding || v.memoryDiscarded) return;
    v.lastHandledFailure = null;
    if (win) win.webContents.send("view-event", { tabId: id, type: "did-start-loading" });
  });
  v.webContents.on("did-stop-loading", () => {
    if (v.memoryDiscarding || v.memoryDiscarded) return;
    if (v.memoryRestoring && v.webContents.getURL() === "about:blank") return;
    if (win) win.webContents.send("view-event", { tabId: id, type: "did-stop-loading" });
    finishPendingReaderRestore(pIdx, id, v);
  });
  v.webContents.on("page-title-updated", (_e, t) => {
    if (v.memoryDiscarding || v.memoryDiscarded) return;
    const rawCurrentUrl = v.webContents.getURL();
    const httpsOnlyInterstitial = typeof rawCurrentUrl === "string" && rawCurrentUrl.startsWith("data:text/html");
    const currentUrl = getDisplayUrlForTab(
      id,
      httpsOnlyInterstitial ? (v.pendingTargetUrl || v.tUrl || rawCurrentUrl) : rawCurrentUrl,
      v.tUrl || ""
    );
    const title = getDisplayTitleForTab(id, t);
    v.tUrl = currentUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnTitle(pTabs[pIdx], id, title, currentUrl);
    scheduleRecoverySave();
    if (win) {
      win.webContents.send("view-event", {
        tabId: id,
        type: "title",
        title: (updatedTab && updatedTab.title) || title
      });
      const tab = pTabs[pIdx].find((tabEntry) => tabEntry.id === id);
      if (appUtils.shouldPersistTabActivity(tab) && currentUrl && !isOfflinePageUrl(rawCurrentUrl) && !httpsOnlyInterstitial) {
        updateHistoryTitle(currentUrl, title);
      }
    }
  });
  const handleLoadFailure = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (v.memoryDiscarding || v.memoryDiscarded) return;
    const failureKey = `${errorCode}:${validatedURL}:${isMainFrame}`;
    if (v.lastHandledFailure === failureKey) return;
    v.lastHandledFailure = failureKey;

    if (offlineArcade.shouldIgnoreLoadFailure({ errorCode, errorDescription, isMainFrame })) return;

    const failedUrl = appUtils.normalizeInternalUrl(
      validatedURL || v.pendingTargetUrl || v.tUrl || v.webContents.getURL() || "",
      v.pendingTargetUrl || v.tUrl || "chrome://newtab"
    ) || "chrome://newtab";

    if (offlineArcade.shouldTriggerOfflinePage({ errorCode, errorDescription, isMainFrame })) {
      showOfflinePage(id, pIdx, {
        targetUrl: failedUrl,
        source: "navigation-failure"
      });
      return;
    }

    clearOfflineTabContext(id);
    if (v.pendingHttpsUpgrade && validatedURL === v.pendingHttpsUpgrade) {
      showHttpsOnlyInterstitial(v, validatedURL);
      return;
    }

    loadInternal(v.webContents, "chrome://newtab");
  };
  v.webContents.on("did-fail-load", handleLoadFailure);
  v.webContents.on("did-fail-provisional-load", handleLoadFailure);
  v.webContents.on("found-in-page", (_e, r) => {
    if (win) win.webContents.send("find-result", r);
  });
  v.webContents.on("context-menu", (_e, p) => {
    const m = new Menu();
    appendClipboardMenuItems(m, v.webContents, p.editFlags || {});
    const extensionMenuItems = extensionManager
      ? extensionManager.getContextMenuItems(v.webContents, p)
      : [];
    if (extensionMenuItems.length) {
      if (m.items.length) m.append(new MenuItem({ type: "separator" }));
      extensionMenuItems.forEach((item) => m.append(item));
      m.append(new MenuItem({ type: "separator" }));
    }
    // Validate URL to prevent javascript: and data: URL attacks
    const isValidUrl = (url) => {
      if (!url || typeof url !== "string") return false;
      try {
        const parsed = new NodeURL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch (_error) {
        return false;
      }
    };
    if (p.linkURL && isValidUrl(p.linkURL)) {
      m.append(
        new MenuItem({
          label: "Open in new tab",
          click: () => openL(p.linkURL, pIdx)
        })
      );
      m.append(
        new MenuItem({
          label: "Open in incognito window",
          click: () => openIncognitoWindow(p.linkURL)
        })
      );
    }
    m.append(
      new MenuItem({
        label: "Back",
        enabled: v.webContents.canGoBack(),
        click: () => v.webContents.goBack()
      })
    );
    m.append(
      new MenuItem({
        label: "Forward",
        enabled: v.webContents.canGoForward(),
        click: () => v.webContents.goForward()
      })
    );
    m.append(
      new MenuItem({
        label: "Reload",
        click: () => reloadActiveView(pIdx)
      })
    );
    m.append(new MenuItem({ type: "separator" }));
    m.append(
      new MenuItem({
        label: "Inspect",
        click: () => v.webContents.inspectElement(p.x, p.y)
      })
    );
    m.popup(BrowserWindow.fromWebContents(v.webContents));
  });
  v.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isHttpUrl(targetUrl)) openL(targetUrl, pIdx);
    else if (isChromeExtensionUrl(targetUrl)) {
      openTabInProfile(pIdx, { url: targetUrl, incognito: inc }, { win: windows[pIdx] });
    }
    return { action: "deny" };
  });

  if (v.memoryDiscarded) {
    if (memoryController) memoryController.requestEvaluation();
    return v;
  }

  loadTabUrl(id, pIdx, url, {
    source: url === "chrome://newtab" ? "new-tab" : "startup"
  });
  return v;
}

function switchT(id, pIdx, options = {}) {
  const win = windows[pIdx];
  const s = states[pIdx];
  if (!win || !s) return;

  const tabRecord = pTabs[pIdx] && pTabs[pIdx].find((tab) => tab && tab.id === id);
  if (!views[id] && tabRecord) {
    createV(id, tabRecord.url || "chrome://newtab", !!tabRecord.incognito, pIdx, {
      restoreReaderMode: !!tabRecord.readerMode
    });
  }
  const wasMemoryRestored = restoreMemoryDiscardedTab(id, pIdx);
  const session = getReaderSession(id);
  const nextView = session && session.active && session.readerView ? session.readerView : views[id];
  if (!nextView) return;
  
  if (s.activeView && s.activeView !== nextView && s.visible) {
    try {
      win.contentView.removeChildView(s.activeView);
    } catch (e) { }
  }
  s.activeView = nextView;
  if (s.visible && s.activeView && !s.activeView.webContents.isDestroyed()) {
    try {
      win.contentView.addChildView(s.activeView);
      updateB(pIdx);
    } catch (e) { }
  }
  if (win && !win.isDestroyed() && s.activeView && !s.activeView.webContents.isDestroyed()) {
    activeTabIds[pIdx] = id;
    tabActivitySequence += 1;
    tabActivitySequences.set(id, tabActivitySequence);
    if (views[id] && views[id].webContents && !views[id].webContents.isDestroyed()) {
      if (extensionManager) extensionManager.selectTab(pIdx, views[id].webContents);
    }
    const currentRawUrl = wasMemoryRestored
      ? ((tabRecord && tabRecord.url) || (views[id] && views[id].tUrl) || "")
      : session && session.active
      ? (session.sourceUrl || (tabRecord && tabRecord.url) || "")
      : (s.activeView.webContents.getURL() || (views[id] && views[id].tUrl) || "");
    const currentTitle = wasMemoryRestored
      ? ((tabRecord && tabRecord.title) || currentRawUrl)
      : session && session.active
      ? (session.sourceTitle || (tabRecord && tabRecord.title) || "")
      : s.activeView.webContents.getTitle();
    const payload = tabState.buildTabSwitchPayload(
      pTabs[pIdx],
      id,
      getDisplayUrlForTab(id, currentRawUrl, (views[id] && views[id].tUrl) || currentRawUrl),
      getDisplayTitleForTab(id, currentTitle)
    );
    if (payload.url && views[id]) views[id].tUrl = payload.url;
    if (!options.quiet) win.webContents.send("tab-switched", payload);
    finishPendingReaderRestore(pIdx, id, views[id]);
    if (memoryController) memoryController.requestEvaluation();
  }
  scheduleRecoverySave();
  if (!options.quiet) setTimeout(() => updateB(pIdx), 100);
}

function openL(u, pIdx) {
  const url = normalizeHttpUrl(u);
  if (!url) return;
  openTabInProfile(pIdx, { url }, { win: windows[pIdx] });
}

function closeTab(pIdx, id, win) {
  const w = win || windows[pIdx];
  const s = states[pIdx];
  const view = views[id] || null;
  if (!w) return;
  
  const session = getReaderSession(id);
  const profileTabs = pTabs[pIdx] || [];
  const closingTab = profileTabs.find((t) => t && t.id === id);
  const closingIncognito = !!(closingTab ? closingTab.incognito : w.incognitoWindow);
  
  rememberClosedTab(pIdx, {
    url: (view && view.tUrl) || (closingTab && closingTab.url) || "",
    title: view && view.memoryDiscarded
      ? (closingTab && closingTab.title) || ""
      : (view && view.webContents && !view.webContents.isDestroyed())
        ? view.webContents.getTitle()
        : (closingTab && closingTab.title) || "",
    incognito: closingIncognito
  });
  
  const wasA = activeTabIds[pIdx] === id
    || (view && s && s.activeView === view)
    || (session && session.readerView && s && s.activeView === session.readerView);
  if (wasA) {
    try {
      if (s && s.activeView) w.contentView.removeChildView(s.activeView);
    } catch (e) { }
  }
  
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    try {
      extensionTabRemovalNotifications.add(view.webContents);
      if (extensionManager) extensionManager.removeTrackedTab(view.webContents);
    } catch (_error) {
    } finally {
      extensionTabRemovalNotifications.delete(view.webContents);
    }
    try {
      view.webContents.destroy();
    } catch (_error) { }
  }
  if (view) delete views[id];
  tabActivitySequences.delete(id);
  if (tabMemoryHistory) tabMemoryHistory.remove(id);
  
  if (session && session.readerView && session.readerView.webContents && !session.readerView.webContents.isDestroyed()) {
    try {
      session.readerView.webContents.destroy();
    } catch (_error) { }
  }
  if (session && session.readerView && session.readerView.webContents && readerViewTabs[session.readerView.webContents.id]) {
    delete readerViewTabs[session.readerView.webContents.id];
  }
  delete readerViews[id];
  delete readerSessions[id];
  clearOfflineTabContext(id);
  pTabs[pIdx] = profileTabs.filter((t) => t && t.id !== id);
  if (activeTabIds[pIdx] === id) delete activeTabIds[pIdx];
  
  if (wasA && s) {
    s.activeView = null;
    if (pTabs[pIdx].length) switchT(pTabs[pIdx][0].id, pIdx);
    else {
      const nid = `p-${pIdx}-t-${Date.now()}`;
      const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
      const replacementIncognito = appUtils.resolveTabIncognito(w);
      pTabs[pIdx].push({
        id: nid,
        url: "chrome://newtab",
        title: replacementIncognito
          ? localization.getIncognitoProfileName(locale)
          : localization.t(locale, "app.newTab"),
        incognito: replacementIncognito,
        readerMode: false
      });
      createV(nid, "chrome://newtab", replacementIncognito, pIdx);
      switchT(nid, pIdx);
    }
  }
  w.webContents.send("tab-closed", id);
  scheduleRecoverySave();
  updateB(pIdx);
  if (memoryController) memoryController.requestEvaluation();
}

function clearOtherTabs(pIdx, keepId, win) {
  const ids = pTabs[pIdx].map((t) => t.id).filter((id) => id !== keepId);
  ids.forEach((id) => closeTab(pIdx, id, win));
}

function clearHistoryRange(range) {
  const now = new Date();
  if (range === "all") {
    bHist.visits = [];
    saveH();
    return;
  }
  let cutoff = 0;
  if (range === "hour") cutoff = Date.now() - 3600e3;
  else if (range === "week") cutoff = Date.now() - 7 * 864e5;
  else if (range === "today") {
    cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  } else return;
  bHist.visits = bHist.visits.filter((v) => v.timestamp < cutoff);
  saveH();
}

function deleteHistoryItem(idOrMatch) {
  if (typeof idOrMatch === "string") {
    bHist.visits = bHist.visits.filter((v) => v.id !== idOrMatch);
  } else if (idOrMatch && idOrMatch.url != null && idOrMatch.timestamp != null) {
    bHist.visits = bHist.visits.filter(
      (v) => !(String(v.url) === String(idOrMatch.url) && Number(v.timestamp) === Number(idOrMatch.timestamp))
    );
  }
  saveH();
}

function getSenderWindow(sender) {
  if (!sender) return null;
  if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) return null;
  return BrowserWindow.fromWebContents(sender) || sender.getOwnerBrowserWindow() || null;
}

function getSessionForWindow(win) {
  const profileIndex = win ? win.profileIndex : 0;
  const incognito = !!(win && win.incognitoWindow);
  const partition = getPartitionForProfile(profileIndex, incognito);
  return ensureSessionSecurity(partition, profileIndex, incognito);
}

function withTrustedSender(handler, fallback) {
  return (e, ...args) => {
    if (!isTrustedSenderEvent(e)) {
      return typeof fallback === "function" ? fallback(e, ...args) : fallback;
    }
    return handler(e, ...args);
  };
}

ipcMain.on("set-chrome-metrics", withTrustedSender((e, m) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (m && s) {
    if (m.top !== undefined) s.metrics.top = m.top;
    if (m.left !== undefined) s.metrics.left = m.left;
    updateB(w.profileIndex);
  }
}));
ipcMain.handle("bootstrap-window", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  return ensureWindowBootstrapState(w);
}, null));
ipcMain.handle("get-browser-settings", withTrustedSender(() => {
  return getBrowserSettings();
}, null));
ipcMain.handle("get-memory-status", withTrustedSender(() => {
  return { ...memoryStatus };
}, null));
ipcMain.handle("get-reader-content", withTrustedSender((e) => {
  const session = readerViewTabs[e.sender.id] ? readerSessions[readerViewTabs[e.sender.id]] : null;
  return readerSession.getReaderSnapshot(session, session && session.sourceUrl ? session.sourceUrl : "");
}, null));
ipcMain.handle("summarize-active-page", withTrustedSender(async (e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return { ok: false, reason: "No active browser window is available." };
  const profileIndex = w.profileIndex;
  const tabId = getActiveT(profileIndex);
  if (!tabId) return { ok: false, reason: "No active tab is available." };

  const sourceView = getSourceViewForTab(tabId);
  if (!sourceView || !sourceView.webContents || sourceView.webContents.isDestroyed()) {
    return { ok: false, reason: "This tab is not ready to summarize." };
  }
  const committedUrl = getCommittedReaderUrl(sourceView.webContents);
  if (!committedUrl) {
    return { ok: false, reason: "On-device summaries work on readable web pages." };
  }
  const snapshot = await resolveReaderSnapshot(profileIndex, tabId);

  const currentWindow = getSenderWindow(e.sender);
  if (
    currentWindow !== w ||
    currentWindow.profileIndex !== profileIndex ||
    getActiveT(profileIndex) !== tabId ||
    getSourceViewForTab(tabId) !== sourceView ||
    getCommittedReaderUrl(sourceView.webContents) !== committedUrl ||
    !snapshot || snapshot.sourceUrl !== committedUrl
  ) {
    return { ok: false, reason: "The summary was cancelled because the active page changed." };
  }

  if (!snapshot.readable) {
    return {
      ok: false,
      reason: snapshot && snapshot.reason ? snapshot.reason : "Orion could not extract readable page text to summarize."
    };
  }

  return getAiSummaryModule().summarizeSnapshot(snapshot);
}, { ok: false, reason: "Summary is unavailable." }));
ipcMain.handle("close-reader", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return { active: false, available: true };
  const tabId = readerViewTabs[e.sender.id] || getActiveT(w.profileIndex);
  if (!tabId) return { active: false, available: true };
  return exitReaderMode(w.profileIndex, tabId);
}, { active: false, available: true }));
ipcMain.handle("toggle-reader-mode", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return { active: false, available: false };
  const tabId = getActiveT(w.profileIndex);
  if (!tabId) return { active: false, available: false };
  const session = getReaderSession(tabId);
  if (session && session.active) return exitReaderMode(w.profileIndex, tabId);
  return enterReaderMode(w.profileIndex, tabId);
}, { active: false, available: false }));
ipcMain.handle("set-browser-settings", withTrustedSender((e, patch) => {
  return updateBrowserSettings(patch || {});
}, null));
ipcMain.on("fetch-and-show-history", withTrustedSender((e, q) => {
  void loadHistoryInBackground().then(() => {
    if (!e.sender || e.sender.isDestroyed()) return;
    e.reply("history-data-received", getH(q));
  });
}));
ipcMain.on("apply-browser-color", withTrustedSender((e, c) => {
  const w = getSenderWindow(e.sender);
  if (w) {
    w.setBackgroundColor(c);
    bSett.themeColor = c;
    saveS();
  }
}));
ipcMain.on("update-default-search-engine", withTrustedSender((e, u) => {
  defSearch = u;
}));
ipcMain.on("toggle-browser-view", withTrustedSender((e, v) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (!s) return;
  s.visible = !!v;
  if (s.visible) {
    if (s.activeView) {
      try {
        w.contentView.addChildView(s.activeView);
      } catch (e) { }
      updateB(w.profileIndex);
    }
  } else if (s.activeView) {
    try {
      w.contentView.removeChildView(s.activeView);
    } catch (e) { }
  }
}));
ipcMain.handle("add-new-profile", withTrustedSender((e) => {
  const n = getNextAvailableProfileIndex();
  pTabs[n] = [];
  pGroups[n] = [];
  pNames[n] = getDefaultProfileName(n);
  scheduleRecoverySave();
  const win = createW(n);
  if (win && !win.isDestroyed()) {
    try {
      win.show();
      win.focus();
    } catch (_error) { }
  }
  return n;
}, null));
function openIncognitoWindow(url) {
  const pIdx = nextIncognitoProfileId++;
  pTabs[pIdx] = [];
  pGroups[pIdx] = [];
  pNames[pIdx] = getDefaultProfileName(pIdx, { incognito: true });
  const win = createW(pIdx, { incognito: true });
  if (url && url !== "chrome://newtab") {
    const target = normalizeHttpUrl(url) || (url.startsWith("http") ? url : `https://${url}`);
    if (target && win && !win.isDestroyed()) win.pendingIncognitoUrl = target;
  }
}

ipcMain.handle("open-incognito-window", withTrustedSender((e, url) => {
  openIncognitoWindow(url);
}, null));
ipcMain.on("rename-profile", withTrustedSender((e, { profileIndex, newName }) => {
  if (pNames[profileIndex]) {
    pNames[profileIndex] = newName;
    broadcast();
    scheduleRecoverySave();
  }
}, null));
ipcMain.handle("create-tab", withTrustedSender((e, { tabId, url, afterTabId, performanceIntentEpochMs } = {}) => {
  const performanceStartEpochMs = sanitizePerformanceIntentEpochMs(performanceIntentEpochMs);
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  const pIdx = w.profileIndex;
  const u = url || "https://www.google.com/";
  const createdTab = openTabInProfile(pIdx, {
    id: tabId,
    url: u
  }, {
    win: w,
    afterTabId: typeof afterTabId === "string" && afterTabId.length ? afterTabId : null,
    performanceStartEpochMs
  });
  return createdTab ? { tabId: createdTab.id, requestedAtEpochMs: performanceStartEpochMs } : null;
}, null));
ipcMain.handle("switch-tab", withTrustedSender((e, id) => {
  const w = getSenderWindow(e.sender);
  if (w) switchT(id, w.profileIndex);
}, null));
ipcMain.handle("close-tab", withTrustedSender((e, id) => {
  const w = getSenderWindow(e.sender);
  if (w) closeTab(w.profileIndex, id, w);
}, null));
ipcMain.handle("reopen-closed-tab", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return false;
  return reopenClosedTab(w.profileIndex);
}, false));
ipcMain.handle("clear-other-tabs", withTrustedSender((e, keepId) => {
  const w = getSenderWindow(e.sender);
  if (w) clearOtherTabs(w.profileIndex, keepId, w);
}, null));
ipcMain.handle("create-tab-group", withTrustedSender((e, options = {}) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  const pIdx = w.profileIndex;
  const groups = getProfileGroupList(pIdx);
  const tabs = getProfileTabList(pIdx);
  const group = tabGroups.createGroup(groups, options);
  groups.push(group);
  const tabId = typeof options.tabId === "string" ? options.tabId : getActiveT(pIdx);
  if (tabId) tabGroups.assignTabToGroup(tabs, groups, tabId, group.id);
  scheduleRecoverySave();
  broadcastTabGroupsChanged(pIdx, w);
  return { group, tabs: getWindowTabSnapshot(pIdx), groups: getWindowGroupSnapshot(pIdx) };
}, null));
ipcMain.handle("create-ai-tab-groups", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w || w.incognitoWindow) return null;
  const pIdx = w.profileIndex;
  const result = tabGroups.createOnDeviceTabGroups(getProfileTabList(pIdx), getProfileGroupList(pIdx));
  if (!result.grouped) return null;
  scheduleRecoverySave();
  broadcastTabGroupsChanged(pIdx, w);
  return {
    ...result,
    tabs: getWindowTabSnapshot(pIdx),
    groups: getWindowGroupSnapshot(pIdx)
  };
}, null));
ipcMain.handle("rename-tab-group", withTrustedSender((e, { groupId, name } = {}) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  const pIdx = w.profileIndex;
  if (!tabGroups.renameGroup(getProfileGroupList(pIdx), groupId, name)) return null;
  scheduleRecoverySave();
  broadcastTabGroupsChanged(pIdx, w);
  return { tabs: getWindowTabSnapshot(pIdx), groups: getWindowGroupSnapshot(pIdx) };
}, null));
ipcMain.handle("delete-tab-group", withTrustedSender((e, groupId) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  const pIdx = w.profileIndex;
  if (!tabGroups.deleteGroup(getProfileGroupList(pIdx), getProfileTabList(pIdx), groupId)) return null;
  scheduleRecoverySave();
  broadcastTabGroupsChanged(pIdx, w);
  return { tabs: getWindowTabSnapshot(pIdx), groups: getWindowGroupSnapshot(pIdx) };
}, null));
ipcMain.handle("assign-tab-to-group", withTrustedSender((e, { tabId, groupId } = {}) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  const pIdx = w.profileIndex;
  if (!tabGroups.assignTabToGroup(getProfileTabList(pIdx), getProfileGroupList(pIdx), tabId || getActiveT(pIdx), groupId || null)) return null;
  scheduleRecoverySave();
  broadcastTabGroupsChanged(pIdx, w);
  return { tabs: getWindowTabSnapshot(pIdx), groups: getWindowGroupSnapshot(pIdx) };
}, null));
ipcMain.handle("toggle-tab-group-collapsed", withTrustedSender((e, { groupId, collapsed } = {}) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  const pIdx = w.profileIndex;
  if (!tabGroups.toggleGroupCollapsed(getProfileGroupList(pIdx), groupId, collapsed)) return null;
  scheduleRecoverySave();
  broadcastTabGroupsChanged(pIdx, w);
  return { tabs: getWindowTabSnapshot(pIdx), groups: getWindowGroupSnapshot(pIdx) };
}, null));
ipcMain.handle("navigate-to", withTrustedSender((e, navigationRequest) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (!s || !s.activeView) return;
  const activeTabId = getActiveT(w.profileIndex);
  if (!activeTabId) return;
  const request = navigationRequest && typeof navigationRequest === "object"
    ? navigationRequest
    : { url: navigationRequest };
  const performanceIntentEpochMs = sanitizePerformanceIntentEpochMs(request.performanceIntentEpochMs);
  const tu = typeof request.url === "string" ? request.url.trim() : "";
  
  // Security: Block dangerous URL schemes
  const lowerUrl = tu.toLowerCase();
  const dangerousSchemes = ["javascript:", "data:", "vbscript:", "file:"];
  for (const scheme of dangerousSchemes) {
    if (lowerUrl.startsWith(scheme) || lowerUrl.trim().startsWith(scheme)) {
      console.warn(`Blocked navigation to dangerous URL scheme: ${scheme}`);
      return;
    }
  }
  
  if (tu === "chrome://extensions" || tu === "chrome://newtab" || tu === "chrome://offline") {
    loadTabUrl(activeTabId, w.profileIndex, tu, {
      source: tu === "chrome://newtab" ? "new-tab" : "internal",
      performanceIntentEpochMs
    });
    return true;
  }
  if (tu.startsWith("chrome://") && INTERNAL_PAGES.has(tu)) {
    loadTabUrl(activeTabId, w.profileIndex, tu, { source: "internal", performanceIntentEpochMs });
    return true;
  }
  if (appUtils.isTrustedAppPage(tu, TRUSTED_PAGE_FILES)) {
    loadTabUrl(activeTabId, w.profileIndex, tu, { source: "internal", performanceIntentEpochMs });
    return true;
  }
  const templates = {
    google: "https://www.google.com/search?q=",
    bing: "https://www.bing.com/search?q=",
    duckduckgo: "https://www.duckduckgo.com/?q=",
    yahoo: "https://search.yahoo.com/search?p=",
    yandex: "https://yandex.com/search/?text=",
    brave: "https://search.brave.com/search?q=",
    naver: "https://search.naver.com/search.naver?query=",
    startpage: "https://startpage.com/do/search?q=",
    baidu: "https://www.baidu.com/s?wd=",
    ecosia: "https://www.ecosia.org/search?q=",
    "yahoo japan": "https://search.yahoo.co.jp/search?p=",
    "yandex japan": "https://yandex.co.jp/search/?text="
  };
  let final = tu;
  if (!tu.includes("://")) {
    if (tu.includes(".") && !tu.includes(" ")) final = `https://${tu}`;
    else {
      let t = templates.google;
      for (const [k, v] of Object.entries(templates)) {
        if (defSearch.includes(k)) {
          t = v;
          break;
        }
      }
      final = t + encodeURIComponent(tu);
    }
  }
  if (isHttpUrl(final)) {
    loadTabUrl(activeTabId, w.profileIndex, final, { source: "navigate", performanceIntentEpochMs });
    return true;
  }
  loadTabUrl(activeTabId, w.profileIndex, "chrome://newtab", { source: "new-tab", performanceIntentEpochMs });
  return true;
}, null));
ipcMain.handle("go-back", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView && s.activeView.webContents.canGoBack()) s.activeView.webContents.goBack();
}, null));
ipcMain.handle("go-forward", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView && s.activeView.webContents.canGoForward())
    s.activeView.webContents.goForward();
}, null));
ipcMain.handle("reload-page", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  reloadActiveView(w.profileIndex);
}, null));
ipcMain.handle("switch-profile", withTrustedSender((e, pIdx) => {
  if (windows[pIdx]) windows[pIdx].focus();
  else createW(pIdx);
}, null));
ipcMain.handle("clear-history-range", withTrustedSender(async (e, range) => {
  await loadHistoryInBackground();
  clearHistoryRange(range);
}, null));
ipcMain.handle("delete-history-item", withTrustedSender(async (e, id) => {
  await loadHistoryInBackground();
  deleteHistoryItem(id);
}, null));
ipcMain.handle("find-in-page", withTrustedSender((e, t, o = {}) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView && t) s.activeView.webContents.findInPage(t, o);
}, null));
ipcMain.handle("stop-find-in-page", withTrustedSender((e, a) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView) s.activeView.webContents.stopFindInPage(a || "clearSelection");
}, null));
ipcMain.handle("select-extension-folder", withTrustedSender(async (e) => {
  try {
    const result = await dialog.showOpenDialog(getSenderWindow(e.sender), { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  } catch (_error) {
    return null;
  }
}, null));
ipcMain.handle("load-extension", withTrustedSender(async (e, p) => {
  const w = getSenderWindow(e.sender);
  if (!w) return { success: false, error: "No window." };
  if (w.incognitoWindow) return { success: false, error: "Extensions cannot be installed from incognito windows." };
  const pIdx = w.profileIndex;
  try {
    const manager = await ensureExtensionRuntime(w);
    const inspection = browserSecurity.inspectExtensionDirectory(p);
    const approved = await confirmExtensionInstall(w, p, inspection);
    if (!approved) return { success: false, error: "Installation cancelled." };

    const sess = getSessionForWindow(w);
    const ext = await manager.loadUnpackedExtension(pIdx, sess, p);
    const extensionStore = getProfileExtensionStore(pIdx);
    if (!extensionStore.includes(p)) extensionStore.push(p);
    storeExtensionMetadata(pIdx, p, inspection);
    saveS();
    return { success: true, name: ext && ext.name ? ext.name : "Extension", source: getExtensionManagerModule().UNPACKED_SOURCE };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : "Unknown error" };
  }
}, { success: false, error: "Untrusted sender." }));
ipcMain.handle("get-extensions", withTrustedSender(async (e) => {
  const w = getSenderWindow(e.sender);
  if (w && w.incognitoWindow) return [];
  const manager = await ensureExtensionRuntime(w);
  const sess = getSessionForWindow(w);
  const pIdx = w ? w.profileIndex : 0;
  return manager.getExtensions(pIdx, sess);
}, []));
ipcMain.handle("remove-extension", withTrustedSender(async (e, id) => {
  const w = getSenderWindow(e.sender);
  if (w && w.incognitoWindow) return { success: false, error: "Extensions cannot be managed from incognito windows." };
  const manager = await ensureExtensionRuntime(w);
  const pIdx = w ? w.profileIndex : 0;
  const sess = getSessionForWindow(w);
  const result = await manager.removeExtension(pIdx, sess, id);
  if (result.success && result.source === getExtensionManagerModule().UNPACKED_SOURCE && result.path) {
    removeStoredExtensionForProfile(pIdx, result.path);
    saveS();
  }
  return result;
}, { success: false, error: "Untrusted sender." }));
ipcMain.handle("open-chrome-web-store", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return { success: false, error: "No window." };
  if (w.incognitoWindow) return { success: false, error: "Chrome Web Store is unavailable in incognito windows." };
  openTabInProfile(w.profileIndex, {
    url: getExtensionManagerModule().CHROME_WEB_STORE_URL,
    incognito: false
  }, { win: w });
  return { success: true };
}, { success: false, error: "Untrusted sender." }));
ipcMain.handle("update-extensions", withTrustedSender(async (e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return { success: false, error: "No window." };
  if (w.incognitoWindow) return { success: false, error: "Extensions cannot be updated from incognito windows." };
  const manager = await ensureExtensionRuntime(w);
  const sess = getSessionForWindow(w);
  return manager.updateExtensions(w.profileIndex, sess);
}, { success: false, error: "Untrusted sender." }));
ipcMain.handle("get-app-version", withTrustedSender(() => {
  return app.getVersion();
}, null));
ipcMain.handle("get-updater-state", withTrustedSender(() => {
  return getUpdaterState();
}, null));
ipcMain.handle("get-language-settings", withTrustedSender(() => {
  return {
    locale: getCurrentLocale(),
    onboardingCompleted: getOnboardingCompleted(),
    platform: getCurrentUiPlatform()
  };
}, null));
ipcMain.handle("bootstrap-newtab", (e) => {
  if (!isTrustedSenderEvent(e) || appUtils.getAppPageFileName(e.senderFrame.url) !== "newtab.html") {
    return null;
  }
  return {
    locale: getCurrentLocale(),
    onboardingCompleted: getOnboardingCompleted(),
    platform: getCurrentUiPlatform(),
    browserSettings: getBrowserSettings()
  };
});
ipcMain.handle("set-language", withTrustedSender((e, locale) => {
  const nextState = appUtils.resolveLanguageSettingsState({
    currentLocale: getCurrentLocale(),
    nextLocale: locale,
    currentOnboardingCompleted: getOnboardingCompleted(),
    sanitizeLocale: localization.sanitizeLocale
  });
  bSett.locale = nextState.locale;
  bSett.onboardingCompleted = nextState.onboardingCompleted;
  saveS();
  return nextState;
}, null));
ipcMain.handle("check-for-updates", withTrustedSender((e) => {
  return checkForUpdates("manual");
}, null));
ipcMain.handle("get-adblock-state", withTrustedSender(async () => {
  try {
    const manager = await ensureAdblockRuntime({ blockingReady: true });
    return manager.getState();
  } catch (_error) {
    return {
    customRules: "",
    hasCustomRules: false,
    lists: [],
    syncState: {
      status: "idle",
      message: "Adblock is initializing.",
      lastSyncAt: null,
      lastError: null
    },
    defaults: {
      refreshIntervalMs: null,
      builtInListCount: 0
    }
    };
  }
}, null));
ipcMain.handle("update-adblock-rules", withTrustedSender(async (e, r) => {
  const manager = await ensureAdblockRuntime({ blockingReady: true });
  return manager.updateCustomRulesAsync(r || "");
}, null));
ipcMain.handle("set-adblock-list-enabled", withTrustedSender(async (e, { listId, enabled }) => {
  const manager = await ensureAdblockRuntime({ blockingReady: true });
  return manager.setListEnabledAsync(listId, enabled);
}, null));
ipcMain.handle("refresh-adblock-lists", withTrustedSender(async () => {
  const manager = await ensureAdblockRuntime({ blockingReady: true });
  return manager.refreshBuiltInLists({ force: true });
}, null));
ipcMain.handle("reset-adblock-defaults", withTrustedSender(async () => {
  const manager = await ensureAdblockRuntime({ blockingReady: true });
  return manager.resetToDefaultsAsync();
}, null));

app.on("window-all-closed", () => {
  intentionalQuit = true;
  void deleteRecoveryState();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitFlushComplete) return;
  event.preventDefault();
  intentionalQuit = true;
  if (memoryController) memoryController.stop();
  if (quitFlushPromise) return;
  quitFlushPromise = Promise.all([
    historyWriter.flush(),
    settingsWriter.flush(),
    adblockManager && typeof adblockManager.flushPersistence === "function"
      ? adblockManager.flushPersistence()
      : Promise.resolve()
  ]).then(() => deleteRecoveryState()).catch(() => {}).finally(() => {
    quitFlushComplete = true;
    app.quit();
  });
});

app.whenReady().then(() => {
  startupMilestones.appReadyMs = performance.now();
  registerAppProtocol();
  applyDnsOverHttpsSettings();
  startupDataPromise = loadStartupData().catch((error) => {
    console.warn("Unable to restore startup data:", error && error.message ? error.message : error);
    return false;
  });
  createW(0);
  runAfterFirstWindowReady(() => void loadHistoryInBackground());
  runAfterFirstWindowReady(() => void runLegacyIncognitoPartitionMigration(), 3000);
  runAfterFirstWindowReady(setMacDockIcon, 300);
  if (isRamLimiterEnabled()) runMaintenanceAfterWindowReady(initializeMemoryController, 1200);
  if (!DISABLE_BACKGROUND_NETWORK) runMaintenanceAfterWindowReady(configureAutoUpdater, 3000);
  scheduleAdblockWarmup();
  scheduleStartupUpdateCheck();
});
