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
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { URL: NodeURL } = require("url");
const browserSecurity = require("./browser-security");
const appUtils = require("./app-utils");
const adblock = require("./adblock");
const localization = require("./localization");
const tabState = require("./main-tab-state");
const offlineArcade = require("./offline-arcade");
const readerUtils = require("./reader-utils");
const readerSession = require("./reader-session");

protocol.registerSchemesAsPrivileged([
  {
    scheme: appUtils.ORION_SCHEME,
    privileges: {
      bypassCSP: false,
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

const INTERNAL_PAGES = new Map([
  ["chrome://newtab", "newtab.html"],
  ["chrome://extensions", "extensions.html"],
  ["chrome://offline", "offline.html"],
  ["chrome://reader", "reader.html"]
]);
const TRUSTED_PAGE_FILES = new Set(["index.html", "newtab.html", "offline.html", "extensions.html", "reader.html"]);
const INTERNAL_PAGES_FILE_SET = new Set(["newtab.html", "offline.html", "extensions.html", "reader.html"]);
const MIME_TYPES = Object.freeze({
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
let incognitoSitePermissions = {};
let partitions = new Set();
let protocolSessions = new Set();
let protocolRegistered = false;
let pTabs = { 0: [] };
let pNames = { 0: localization.getProfileName(localization.DEFAULT_LOCALE, 0) };
const INCOGNITO_PROFILE_BASE = 10000;
let nextIncognitoProfileId = INCOGNITO_PROFILE_BASE;
let defSearch = "chrome://newtab";

const hPath = path.join(app.getPath("userData"), "browser_history.json");
const sPath = path.join(app.getPath("userData"), "browser_settings.json");

let bHist = loadH();
let bSett = loadS();

const UPDATER_STATUS_CHANNEL = "updater-status";
const GITHUB_UPDATE_FEED = {
  provider: "github",
  owner: "pika04568-sys",
  repo: "orion",
  releaseType: "release"
};

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
  try {
    return app.getAppPath();
  } catch (_error) {
    return __dirname;
  }
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
  const devPath = path.join(__dirname, "assets", "orion.ico");
  const iconPath = app.isPackaged ? packagedPath : devPath;
  return fs.existsSync(iconPath) ? iconPath : null;
}

function getMacIconPath() {
  const packagedPath = path.join(process.resourcesPath, "assets", "orion-mac.png");
  const devPath = path.join(__dirname, "assets", "orion-mac.png");
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
  return path.join(__dirname, file);
}

function getAppPageUrl(file, searchParams = null) {
  return appUtils.getAppPageUrl(file, searchParams);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || "application/octet-stream";
}

function resolveProtocolAssetPath(requestUrl) {
  try {
    const parsed = new NodeURL(requestUrl);
    if (parsed.protocol !== appUtils.ORION_PROTOCOL || parsed.hostname !== appUtils.ORION_HOST) return null;
    const requestedPath = decodeURIComponent(parsed.pathname || "/").replace(/^\/+/, "").replace(/\\/g, "/");
    if (!requestedPath) return null;
    
    // Prevent path traversal attacks
    if (requestedPath.includes("..")) return null;
    
    let basePath = __dirname;
    if (basePath.endsWith(".asar") || basePath.endsWith(".asar" + path.sep)) {
      if (process.resourcesPath) {
        basePath = path.join(process.resourcesPath, "app.asar");
      }
    }
    
    const rootPath = path.resolve(basePath);
    const resolved = path.normalize(path.join(rootPath, requestedPath));
    const normalizedRoot = path.normalize(rootPath);
    
    // Use path.relative for secure path validation
    const relativePath = path.relative(normalizedRoot, resolved);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return null;
    }
    
    return resolved;
  } catch (_error) {
    return null;
  }
}

function registerAppProtocolForSession(sess) {
  if (!sess || typeof sess.protocol !== "object") return;
  if (protocolSessions.has(sess)) return;
  protocolSessions.add(sess);
  
  sess.protocol.handle(appUtils.ORION_SCHEME, (request) => {
    const filePath = resolveProtocolAssetPath(request.url);
    const contentType = getContentType(filePath || "");
    if (!filePath) {
      return net.fetch("data:text/plain,Not%20found");
    }

    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return net.fetch("data:text/plain,Not%20found");
      }
      
      const fileContent = fs.readFileSync(filePath);
      const response = new Response(fileContent, {
        status: 200,
        headers: {
          "content-type": /^(text\/|application\/(javascript|json))/.test(contentType)
            ? `${contentType}; charset=utf-8`
            : contentType
        }
      });
      return response;
    } catch (_error) {
      return net.fetch("data:text/plain,Not%20found");
    }
  });
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
      autoUpdater.quitAndInstall();
    }
    return getUpdaterState();
  })().finally(() => {
    installPromptPromise = null;
  });
  return installPromptPromise;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL(GITHUB_UPDATE_FEED);

  autoUpdater.on("checking-for-update", () => {
    setUpdaterState({
      state: "checking",
      message: "Checking for updates...",
      progress: null
    });
  });

  autoUpdater.on("update-available", async (info) => {
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

  autoUpdater.on("update-not-available", async () => {
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

  autoUpdater.on("download-progress", (progress) => {
    const percent = Number.isFinite(progress.percent) ? Math.round(progress.percent) : null;
    setUpdaterState({
      state: "downloading",
      message: percent === null ? "Downloading update..." : `Downloading update... ${percent}%`,
      progress: percent
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
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

  autoUpdater.on("error", async (error) => {
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

  updaterCheckOrigin = source;
  updaterCheckPromise = autoUpdater
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

function loadS() {
  try {
    if (fs.existsSync(sPath)) {
      const s = JSON.parse(fs.readFileSync(sPath, "utf8"));
      return {
        themeColor: "#e9e9f0",
        profileExtensions: {},
        profileExtensionMetadata: {},
        sitePermissions: {},
        ...s,
        profileExtensions: sanitizeProfileExtensions(s.profileExtensions),
        profileExtensionMetadata: sanitizeProfileExtensionMetadata(s.profileExtensionMetadata),
        sitePermissions: browserSecurity.sanitizePermissionStore(s.sitePermissions),
        locale: localization.sanitizeLocale(s.locale),
        onboardingCompleted: typeof s.onboardingCompleted === "boolean" ? s.onboardingCompleted : true
      };
    }
  } catch (e) {}
  return {
    themeColor: "#e9e9f0",
    profileExtensionMetadata: {},
    profileExtensions: {},
    sitePermissions: {},
    locale: null,
    onboardingCompleted: false
  };
}

function saveS() {
  try { fs.writeFileSync(sPath, JSON.stringify(bSett)); } catch (e) {}
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

function loadH() {
  try {
    if (fs.existsSync(hPath)) return JSON.parse(fs.readFileSync(hPath, "utf8"));
  } catch (e) {}
  return { visits: [], lastCleanup: Date.now() };
}

function saveH() {
  try {
    const limit = Date.now() - 90 * 864e5;
    fs.writeFileSync(hPath, JSON.stringify({
      ...bHist,
      visits: bHist.visits.filter((v) => v.timestamp > limit)
    }));
  } catch (e) {}
}

function getPartitionForProfile(pIdx, incognito = false) {
  return incognito ? `orion-incognito-profile-${pIdx}` : `persist:profile-${pIdx}`;
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
  const detail = [
    `Path: ${extensionPath}`,
    extensionInfo.version ? `Version: ${extensionInfo.version}` : "Version: not specified",
    extensionInfo.manifestVersion ? `Manifest: v${extensionInfo.manifestVersion}` : "Manifest: not specified",
    "",
    "Declared permissions:",
    formatExtensionPermissions(extensionInfo),
    "",
    "Only install unpacked extensions from sources you trust."
  ].join("\n");

  const options = {
    type: "warning",
    buttons: ["Install Extension", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Review Unpacked Extension",
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
    if (!details.url.startsWith("http") || !adblockManager) return callback({ cancel: false });
    callback({ cancel: adblockManager.shouldBlockRequest(details) });
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
      await sess.loadExtension(extensionPath);
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
  s.activeView.setBounds({
    x: readerActive ? 0 : s.metrics.left,
    y: top,
    width: Math.max(0, w - (readerActive ? 0 : s.metrics.left)),
    height: Math.max(0, h - top)
  });
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
  const normalizeWhitespace = (value) => String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const resolveUrl = (value, baseUrl) => {
    const text = normalizeWhitespace(value);
    if (!text) return "";
    const lower = text.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return "";
    if (lower.startsWith("data:")) return lower.startsWith("data:image/") ? text : "";
    try {
      const resolved = baseUrl ? new URL(text, baseUrl) : new URL(text);
      return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.href : "";
    } catch (_error) {
      return "";
    }
  };
  const cleanText = (value, limit = 6000) => normalizeWhitespace(value).slice(0, limit);
  const metaValue = (...selectors) => {
    for (const selector of selectors) {
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
    if (!el || candidateSet.has(el) || !isReadableSelector(el)) return;
    candidateSet.add(el);
    const text = cleanText(el.innerText || el.textContent || "");
    if (text.length < 120) return;
    const paragraphs = Array.from(el.querySelectorAll("p")).map((node) => cleanText(node.textContent || "", 1200)).filter((value) => value.length > 40);
    const headings = Array.from(el.querySelectorAll("h1,h2,h3")).map((node) => cleanText(node.textContent || "", 240)).filter(Boolean);
    const images = Array.from(el.querySelectorAll("img"))
      .map((img) => resolveUrl(img.currentSrc || img.src || img.getAttribute("data-src") || "", document.location.href))
      .filter(Boolean);
    const links = Array.from(el.querySelectorAll("a")).reduce((total, link) => total + cleanText(link.textContent || "", 260).length, 0);
    const linkDensity = text.length ? links / text.length : 1;
    const className = `${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`.toLowerCase();
    let score = 0;

    if (semanticRoot === "article" || el.tagName.toLowerCase() === "article") score += 24;
    else if (semanticRoot === "main" || el.tagName.toLowerCase() === "main" || el.getAttribute("role") === "main") score += 18;
    else if (semanticRoot === "content") score += 10;

    if (goodPattern.test(className)) score += 10;
    if (badPattern.test(className)) score -= 18;

    score += Math.min(26, text.length / 140);
    score += Math.min(18, paragraphs.length * 3.5);
    score += Math.min(8, headings.length * 1.5);
    score += Math.min(6, images.length * 1.2);

    if (linkDensity > 0.5) score -= 20;
    else if (linkDensity > 0.35) score -= 12;
    else if (linkDensity > 0.22) score -= 6;

    if (paragraphs.length < 2) score -= 7;
    if (text.length < 420) score -= 10;

    candidates.push({
      el,
      semanticRoot,
      text,
      textLength: text.length,
      paragraphCount: paragraphs.length,
      headingCount: headings.length,
      images,
      linkDensity,
      score: Math.max(0, Math.min(100, Math.round(score)))
    });
  };

  addCandidate(document.querySelector("article"), "article");
  addCandidate(document.querySelector("main"), "main");
  addCandidate(document.querySelector('[role="main"]'), "main");
  addCandidate(document.querySelector("body"), "content");

  Array.from(document.querySelectorAll("section,div")).slice(0, 40).forEach((el) => {
    const text = cleanText(el.innerText || el.textContent || "");
    if (text.length < 180) return;
    const className = `${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`.toLowerCase();
    if (badPattern.test(className)) return;
    if (goodPattern.test(className) || /article|content|story|post|entry/i.test(className) || el.querySelector("p")) addCandidate(el, "content");
  });

  candidates.sort((left, right) => right.score - left.score);
  const chosen = candidates[0] || null;
  const root = chosen ? chosen.el : document.body;
  const baseUrl = document.location.href;
  const blocks = [];
  const seen = new Set();
  const pushBlock = (type, text) => {
    const cleaned = cleanText(text, 6000);
    if (!cleaned || cleaned.length < 20) return;
    const key = `${type}:${cleaned.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ type, text: cleaned });
  };

  if (root) {
    const blockNodes = root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote");
    if (blockNodes.length) {
      blockNodes.forEach((node) => {
        const text = cleanText(node.textContent || "", 6000);
        if (!text) return;
        const tag = node.tagName.toLowerCase();
        if (tag === "blockquote") pushBlock("quote", text);
        else if (/^h[1-6]$/.test(tag)) pushBlock("heading", text);
        else if (tag === "li") pushBlock("list", text);
        else pushBlock("paragraph", text);
      });
    } else {
      cleanText(root.innerText || root.textContent || "", 6000)
        .split(/\n{2,}/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 40)
        .forEach((entry) => pushBlock("paragraph", entry));
    }
  }

  const imageUrls = chosen ? chosen.images.slice(0, 8) : [];
  const excerpt = blocks[0] ? blocks[0].text : cleanText(root && (root.innerText || root.textContent) || "", 360);

  return {
    sourceUrl: baseUrl,
    canonicalUrl,
    title: documentTitle,
    siteName,
    byline,
    publishedDate,
    modifiedDate,
    blocks,
    images: imageUrls.map((src) => ({ src })),
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

async function extractReaderSnapshot(webContents) {
  if (!webContents || webContents.isDestroyed()) return null;
  try {
    const analysis = await webContents.executeJavaScript(`(${collectReaderAnalysisInPage.toString()})()`, true);
    return readerUtils.buildReaderSnapshot(analysis || {});
  } catch (_error) {
    return null;
  }
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
  return appUtils.syncTabRecord(pTabs[pIdx], tabId, { readerMode: !!readerMode });
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

  if (!session.readerView || session.readerView.webContents.isDestroyed()) {
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
      preload: path.join(__dirname, "preload.js"),
      partition
    };
    const readerView = new WebContentsView({ webPreferences: webP });
    readerView.webContents.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
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
    readerViewTabs[readerView.webContents.id] = tabId;
    session.readerView = readerView;
    if (win && !win.isDestroyed()) {
      // The reader surface is shown through the window content view, just like a tab view.
    }
  }

  return session.readerView;
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

  if (!isHttpUrl(sourceView.webContents.getURL())) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: "Reader mode only works on article pages."
    });
    return { active: false, available: false };
  }

  const snapshot = await extractReaderSnapshot(sourceView.webContents);
  if (!snapshot || !snapshot.readable) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: snapshot && snapshot.reason ? snapshot.reason : "Reader mode is unavailable for this page."
    });
    return { active: false, available: false, reason: snapshot && snapshot.reason ? snapshot.reason : "" };
  }

  const session = ensureReaderView(tabId, pIdx);
  if (!session) {
    sendReaderModeState(pIdx, tabId, {
      active: false,
      available: false,
      reason: "Reader mode could not be prepared."
    });
    return { active: false, available: false };
  }

  readerSession.setReaderSnapshot(session, snapshot);
  readerSession.setSourceState(session, {
    sourceUrl: tab && tab.url ? tab.url : sourceView.webContents.getURL(),
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
    const needsAttach = !!(sourceView && s.activeView !== sourceView);
    if (s.activeView && session.readerView && s.activeView === session.readerView) {
      detachViewFromWindow(pIdx, session.readerView);
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
  return session ? session.readerView : null;
}

function getProfileTabList(pIdx) {
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  return pTabs[pIdx];
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
    title: tabLike.title || getDefaultTabTitle(pIdx, { incognito: !!tabLike.incognito }),
    incognito: !!tabLike.incognito,
    readerMode: !!tabLike.readerMode
  };
  const afterTabId = typeof options.afterTabId === "string" && options.afterTabId ? options.afterTabId : null;
  insertTabAfter(pIdx, nextTab, afterTabId);
  if (options.notify !== false) {
    win.webContents.send("tab-created", { ...nextTab, afterTabId });
  }
  createV(tabId, nextUrl, nextTab.incognito, pIdx);
  switchT(tabId, pIdx);
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

function dispatchBrowserShortcutAction(pIdx, action) {
  const win = windows[pIdx];
  if (!win || win.isDestroyed()) return false;

  switch (action) {
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
    dispatchBrowserShortcutAction(pIdx, action);
  });
}

function isTrustedSender(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    return isTrustedInternalPageUrl(webContents.getURL(), TRUSTED_PAGE_FILES);
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

function normalizeHttpUrl(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isHttpUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("chrome://")) return null;
  if (!trimmed.includes("://")) return `https://${trimmed}`;
  return null;
}

function loadInternal(webContents, url) {
  const file = INTERNAL_PAGES.get(url);
  const targetFile = file || "newtab.html";
  return webContents.loadFile(getAppHtmlPath(targetFile)).catch((error) => {
    const errorCode = error && (error.code || error.message || "");
    if (typeof errorCode === "string" && errorCode.includes("ERR_ABORTED")) {
      return;
    }
    showHtmlLoadError(targetFile, error);
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

  view.tUrl = targetUrl;
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

  const normalizedUrl = appUtils.normalizeInternalUrl(rawUrl || "chrome://newtab", "chrome://newtab") || "chrome://newtab";
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
  view.pendingTargetUrl = normalizedUrl;
  view.tUrl = normalizedUrl;
  appUtils.syncTabRecord(pTabs[pIdx], tabId, { url: normalizedUrl });

  if (isInternalUrl(normalizedUrl)) return loadInternal(view.webContents, normalizedUrl);
  if (isHttpUrl(normalizedUrl)) {
    return view.webContents.loadURL(normalizedUrl).catch(() => false);
  }
  return loadInternal(view.webContents, "chrome://newtab");
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
        : process.platform === "darwin"
          ? getMacIconPath() || undefined
          : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      safeDialogs: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, "preload.js"),
      partition
    },
    autoHideMenuBar: true
  });
  win.profileIndex = pIdx;
  win.incognitoWindow = isIncognito;
  windows[pIdx] = win;
  attachBrowserShortcutHandler(win.webContents, () => win.profileIndex);
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  pNames[pIdx] = isIncognito ? getDefaultProfileName(pIdx, { incognito: true }) : (pNames[pIdx] || getDefaultProfileName(pIdx));
  states[pIdx] = { activeView: null, metrics: { top: 76, left: 0 }, visible: true, readerMode: false, readerTabId: null };
  
  // Use file:// protocol for main window for better Windows compatibility
  const indexPath = path.join(__dirname, "index.html");
  const fileUrl = `file://${indexPath.replace(/\\/g, "/")}`;
  win.loadURL(fileUrl).catch((error) => {
    showHtmlLoadError("index.html", error);
    if (!win.isDestroyed()) win.destroy();
  });
  win.on("resize", () => updateB(pIdx));
  win.on("closed", () => {
    delete windows[pIdx];
    delete states[pIdx];
    delete offlineRotationStates[pIdx];
    clearOfflineTabContextsForProfile(pIdx);
    if (isIncognito) {
      delete incognitoSitePermissions[getPermissionScopeKey(pIdx, true)];
      delete pTabs[pIdx];
      delete pNames[pIdx];
    }
    saveH();
  });
  broadcast();
  if (!isIncognito) void restoreStoredExtensionsForProfile(pIdx, partition, win);
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

function broadcast() {
  const p = getProfileListSnapshot();
  Object.values(windows).forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send("profile-list-updated", { profiles: p });
  });
}

function getActiveT(pIdx) {
  const s = states[pIdx];
  if (!s || !s.activeView) return null;
  for (const [id, v] of Object.entries(views)) if (v === s.activeView) return id;
  for (const [id, session] of Object.entries(readerSessions)) {
    if (session && session.readerView === s.activeView) return id;
  }
  return null;
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

function createT(pIdx, win) {
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
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
    createV(id, initialUrl, isIncognito, pIdx);
    if (pendingUrl) delete win.pendingIncognitoUrl;
  }
  win.webContents.send("profile-changed", {
    profileIndex: pIdx,
    tabs: pTabs[pIdx],
    incognitoWindow: isIncognito
  });
  switchT(pTabs[pIdx][0].id, pIdx);
  broadcast();
  if (!isIncognito) win.webContents.send("history-loaded", getH());
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
      readerMode: !!tab.readerMode
    };
  });
}

function ensureWindowBootstrapState(win) {
  if (!win || win.isDestroyed()) return null;
  const pIdx = win.profileIndex;
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  if (!states[pIdx]) {
    states[pIdx] = { activeView: null, metrics: { top: 76, left: 0 }, visible: true, readerMode: false, readerTabId: null };
  }

  if (!pTabs[pIdx].length) createT(pIdx, win);
  const tabList = getProfileTabList(pIdx);
  if (tabList.length && !getActiveT(pIdx)) switchT(tabList[0].id, pIdx);

  return {
    profileIndex: pIdx,
    incognitoWindow: !!win.incognitoWindow,
    profiles: getProfileListSnapshot(),
    tabs: getWindowTabSnapshot(pIdx),
    activeTabId: getActiveT(pIdx) || (tabList[0] && tabList[0].id) || null
  };
}

function createV(id, url, inc, pIdx) {
  const win = windows[pIdx];
  const s = states[pIdx];
  const partition = getPartitionForProfile(pIdx, inc);
  const webP = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    safeDialogs: true,
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, "preload.js"),
    partition
  };
  ensureSessionSecurity(partition, pIdx, inc);
  const v = new WebContentsView({ webPreferences: webP });
  attachBrowserShortcutHandler(v.webContents, () => pIdx);
  v.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );
  views[id] = v;
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
    if (!isHttpUrl(targetUrl)) event.preventDefault();
  });

  v.webContents.on("did-navigate", (_e, u) => {
    const offlinePage = isOfflinePageUrl(u);
    if (!offlinePage) clearOfflineTabContext(id);
    const displayUrl = getDisplayUrlForTab(id, u, v.tUrl || u);
    v.tUrl = displayUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnNavigate(pTabs[pIdx], id, displayUrl);
    if (win) {
      win.webContents.send("view-event", { tabId: id, type: "did-navigate", url: displayUrl });
      const tab = pTabs[pIdx].find((t) => t.id === id);
      if (!offlinePage && (!tab || !tab.incognito)) {
        try {
          const host = new URL(displayUrl).hostname;
          addH(displayUrl, (updatedTab && updatedTab.title) || host);
          win.webContents.send("history-updated", getH());
        } catch (e) {
          addH(displayUrl, displayUrl);
        }
      }
    }
  });
  v.webContents.on("did-start-loading", () => {
    v.lastHandledFailure = null;
    if (win) win.webContents.send("view-event", { tabId: id, type: "did-start-loading" });
  });
  v.webContents.on("did-stop-loading", () => {
    if (win) win.webContents.send("view-event", { tabId: id, type: "did-stop-loading" });
  });
  v.webContents.on("page-title-updated", (_e, t) => {
    const currentUrl = getDisplayUrlForTab(id, v.webContents.getURL(), v.tUrl || "");
    const title = getDisplayTitleForTab(id, t);
    v.tUrl = currentUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnTitle(pTabs[pIdx], id, title, currentUrl);
    if (win) {
      win.webContents.send("view-event", {
        tabId: id,
        type: "title",
        title: (updatedTab && updatedTab.title) || title
      });
      const tab = pTabs[pIdx].find((tabEntry) => tabEntry.id === id);
      if ((!tab || !tab.incognito) && currentUrl && !isOfflinePageUrl(v.webContents.getURL())) {
        addH(currentUrl, title);
        win.webContents.send("history-updated", getH());
      }
    }
  });
  const handleLoadFailure = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
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
    loadInternal(v.webContents, "chrome://newtab");
  };
  v.webContents.on("did-fail-load", handleLoadFailure);
  v.webContents.on("did-fail-provisional-load", handleLoadFailure);
  v.webContents.on("found-in-page", (_e, r) => {
    if (win) win.webContents.send("find-result", r);
  });
  v.webContents.on("context-menu", (_e, p) => {
    const m = new Menu();
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
    return { action: "deny" };
  });

  loadTabUrl(id, pIdx, url, {
    source: url === "chrome://newtab" ? "new-tab" : "startup"
  });
}

function switchT(id, pIdx) {
  const win = windows[pIdx];
  const s = states[pIdx];
  if (!win || !s) return;
  
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
    const tabRecord = pTabs[pIdx] && pTabs[pIdx].find((tab) => tab.id === id);
    const currentRawUrl = session && session.active
      ? (session.sourceUrl || (tabRecord && tabRecord.url) || "")
      : (s.activeView.webContents.getURL() || (views[id] && views[id].tUrl) || "");
    const currentTitle = session && session.active
      ? (session.sourceTitle || (tabRecord && tabRecord.title) || "")
      : s.activeView.webContents.getTitle();
    const payload = tabState.buildTabSwitchPayload(
      pTabs[pIdx],
      id,
      getDisplayUrlForTab(id, currentRawUrl, (views[id] && views[id].tUrl) || currentRawUrl),
      getDisplayTitleForTab(id, currentTitle)
    );
    if (payload.url && views[id]) views[id].tUrl = payload.url;
    win.webContents.send("tab-switched", payload);
  }
  setTimeout(() => updateB(pIdx), 100);
}

function openL(u, pIdx, inc = false) {
  const url = normalizeHttpUrl(u);
  if (!url) return;
  openTabInProfile(pIdx, { url, incognito: inc }, { win: windows[pIdx] });
}

function closeTab(pIdx, id, win) {
  const w = win || windows[pIdx];
  const s = states[pIdx];
  const view = views[id] || null;
  if (!view || !w) return;
  
  const session = getReaderSession(id);
  const profileTabs = pTabs[pIdx] || [];
  const closingTab = profileTabs.find((t) => t && t.id === id);
  const closingIncognito = !!(closingTab ? closingTab.incognito : w.incognitoWindow);
  
  rememberClosedTab(pIdx, {
    url: view.tUrl || (closingTab && closingTab.url) || "",
    title: (view.webContents && !view.webContents.isDestroyed()) ? view.webContents.getTitle() : (closingTab && closingTab.title) || "",
    incognito: closingIncognito
  });
  
  const wasA = (s && s.activeView === view) || (session && session.readerView && s && s.activeView === session.readerView);
  try {
    if (s && s.activeView) w.contentView.removeChildView(s.activeView);
  } catch (e) { }
  
  if (view.webContents && !view.webContents.isDestroyed()) {
    try {
      view.webContents.destroy();
    } catch (_error) { }
  }
  delete views[id];
  
  if (session && session.readerView && !session.readerView.webContents.isDestroyed()) {
    try {
      session.readerView.webContents.destroy();
    } catch (_error) { }
  }
  if (session && session.readerView && readerViewTabs[session.readerView.webContents.id]) {
    delete readerViewTabs[session.readerView.webContents.id];
  }
  delete readerViews[id];
  delete readerSessions[id];
  clearOfflineTabContext(id);
  pTabs[pIdx] = profileTabs.filter((t) => t && t.id !== id);
  
  if (wasA && s) {
    s.activeView = null;
    if (pTabs[pIdx].length) switchT(pTabs[pIdx][0].id, pIdx);
    else {
      const nid = `p-${pIdx}-t-${Date.now()}`;
      const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
      pTabs[pIdx].push({
        id: nid,
        url: "chrome://newtab",
        title: localization.t(locale, "app.newTab"),
        incognito: closingIncognito
      });
      createV(nid, "chrome://newtab", closingIncognito, pIdx);
      switchT(nid, pIdx);
    }
  }
  w.webContents.send("tab-closed", id);
  updateB(pIdx);
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
    if (!e || !isTrustedSender(e.sender)) {
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
ipcMain.on("renderer-ready", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (w) {
    createT(w.profileIndex, w);
    broadcast();
  }
}, null));
ipcMain.handle("get-window-bootstrap-state", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  if (!w) return null;
  return ensureWindowBootstrapState(w);
}, null));
ipcMain.handle("get-reader-content", withTrustedSender((e) => {
  const session = readerViewTabs[e.sender.id] ? readerSessions[readerViewTabs[e.sender.id]] : null;
  return session && session.snapshot ? session.snapshot : null;
}, null));
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
ipcMain.on("fetch-and-show-history", withTrustedSender((e, q) => {
  e.reply("history-data-received", getH(q));
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
  let n = 0;
  while (pTabs[n]) n++;
  pTabs[n] = [];
  pNames[n] = getDefaultProfileName(n);
  createW(n);
  return n;
}, null));
function openIncognitoWindow(url) {
  const pIdx = nextIncognitoProfileId++;
  pTabs[pIdx] = [];
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
  }
}, null));
ipcMain.handle("create-tab", withTrustedSender((e, { tabId, url, inc, afterTabId }) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const pIdx = w.profileIndex;
  const u = url || "https://www.google.com/";
  const isIncognito = !!inc;
  openTabInProfile(pIdx, {
    id: tabId,
    url: u,
    incognito: isIncognito
  }, {
    win: w,
    afterTabId: typeof afterTabId === "string" && afterTabId.length ? afterTabId : null
  });
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
ipcMain.handle("navigate-to", withTrustedSender((e, u) => {
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (!s || !s.activeView) return;
  const activeTabId = getActiveT(w.profileIndex);
  if (!activeTabId) return;
  const tu = (u || "").trim();
  if (tu === "chrome://extensions" || tu === "chrome://newtab" || tu === "chrome://offline") {
    return loadTabUrl(activeTabId, w.profileIndex, tu, {
      source: tu === "chrome://newtab" ? "new-tab" : "internal"
    });
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
  if (isHttpUrl(final)) return loadTabUrl(activeTabId, w.profileIndex, final, { source: "navigate" });
  return loadTabUrl(activeTabId, w.profileIndex, "chrome://newtab", { source: "new-tab" });
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
ipcMain.handle("clear-history-range", withTrustedSender((e, range) => {
  clearHistoryRange(range);
}, null));
ipcMain.handle("delete-history-item", withTrustedSender((e, id) => {
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
    const inspection = browserSecurity.inspectExtensionDirectory(p);
    const approved = await confirmExtensionInstall(w, p, inspection);
    if (!approved) return { success: false, error: "Installation cancelled." };

    const sess = getSessionForWindow(w);
    const ext = await sess.loadExtension(p);
    const extensionStore = getProfileExtensionStore(pIdx);
    if (!extensionStore.includes(p)) extensionStore.push(p);
    storeExtensionMetadata(pIdx, p, inspection);
    saveS();
    return { success: true, name: ext && ext.name ? ext.name : "Extension" };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : "Unknown error" };
  }
}, { success: false, error: "Untrusted sender." }));
ipcMain.handle("get-extensions", withTrustedSender((e) => {
  const w = getSenderWindow(e.sender);
  const sess = getSessionForWindow(w);
  return sess.getAllExtensions().map((ext) => ({
    id: ext.id,
    name: ext.name,
    version: ext.version,
    description: ext.description
  }));
}, []));
ipcMain.handle("remove-extension", withTrustedSender((e, id) => {
  const w = getSenderWindow(e.sender);
  const pIdx = w ? w.profileIndex : 0;
  const sess = getSessionForWindow(w);
  const ext = sess.getExtension(id);
  if (ext) {
    removeStoredExtensionForProfile(pIdx, ext.path);
    saveS();
  }
  sess.removeExtension(id);
}, null));
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
}, () => ({ locale: null, onboardingCompleted: true, platform: getCurrentUiPlatform() })));
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
}, () => ({
  locale: getCurrentLocale(),
  onboardingCompleted: getOnboardingCompleted()
})));
ipcMain.handle("check-for-updates", withTrustedSender((e) => {
  return checkForUpdates("manual");
}, null));
ipcMain.handle("get-adblock-state", withTrustedSender(() => {
  return adblockManager ? adblockManager.getState() : {
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
}, null));
ipcMain.handle("update-adblock-rules", withTrustedSender((e, r) => {
  return adblockManager ? adblockManager.updateCustomRules(r || "") : null;
}, null));
ipcMain.handle("set-adblock-list-enabled", withTrustedSender((e, { listId, enabled }) => {
  return adblockManager ? adblockManager.setListEnabled(listId, enabled) : null;
}, null));
ipcMain.handle("refresh-adblock-lists", withTrustedSender(async () => {
  return adblockManager ? adblockManager.refreshBuiltInLists({ force: true }) : null;
}, null));
ipcMain.handle("reset-adblock-defaults", withTrustedSender(() => {
  return adblockManager ? adblockManager.resetToDefaults() : null;
}, null));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(() => {
  registerAppProtocol();
  setMacDockIcon();
  adblockManager = adblock.createAdblockManager({
    userDataDir: app.getPath("userData")
  });
  adblockManager.initialize();
  void adblockManager.refreshBuiltInLists({ reason: "startup" });
  createW(0);
  configureAutoUpdater();
  setTimeout(() => {
    void checkForUpdates("startup");
  }, 5000);
});
