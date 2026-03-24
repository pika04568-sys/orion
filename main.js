const {
  app,
  BrowserWindow,
  nativeImage,
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
const appUtils = require("./app-utils");
const localization = require("./localization");
const tabState = require("./main-tab-state");

const INTERNAL_PAGES = new Map([
  ["chrome://newtab", "newtab.html"],
  ["chrome://extensions", "extensions.html"]
]);

let windows = {};
let views = {};
let states = {};
let adRules = [];
let partitions = new Set();
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
      if (!s.profileExtensions) s.profileExtensions = {};
      s.locale = localization.sanitizeLocale(s.locale);
      return s;
    }
  } catch (e) { }
  return { themeColor: "#e9e9f0", profileExtensions: {}, locale: null };
}

function saveS() {
  try {
    fs.writeFileSync(sPath, JSON.stringify(bSett));
  } catch (e) { }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadH() {
  try {
    if (fs.existsSync(hPath)) return JSON.parse(fs.readFileSync(hPath, "utf8"));
  } catch (e) { }
  return { visits: [], lastCleanup: Date.now() };
}

function saveH() {
  try {
    const limit = Date.now() - 90 * 864e5;
    bHist.visits = bHist.visits.filter((v) => v.timestamp > limit);
    fs.writeFileSync(hPath, JSON.stringify(bHist));
  } catch (e) { }
}

function addH(url, title) {
  if (!url) return;
  if (url.startsWith("about:") || url.startsWith("file:") || url.startsWith("chrome:")) return;
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
    } catch (e) { }
  }
  if (!bHist.visits.find((v) => v.url === url && v.timestamp > now - 18e5)) {
    bHist.visits.push({
      id: genId(),
      url,
      title: title || new URL(url).hostname,
      timestamp: now
    });
    if (bHist.visits.length > 1000) bHist.visits.shift();
    saveH();
  }
}

function getH(q = "", limit = 50) {
  let r = [...bHist.visits];
  if (q) {
    const nq = q.toLowerCase();
    r = r.filter(
      (v) => v.url.toLowerCase().includes(nq) || v.title.toLowerCase().includes(nq)
    );
  }
  return r.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

function updateB(pIdx) {
  const win = windows[pIdx];
  const s = states[pIdx];
  if (!win || !s || !s.activeView || !s.visible) return;
  const [w, h] = win.getContentSize();
  const top = s.metrics.top || 76;
  s.activeView.setBounds({
    x: s.metrics.left,
    y: top,
    width: Math.max(0, w - s.metrics.left),
    height: Math.max(0, h - top)
  });
}

const TRUSTED_PAGE_FILES = new Set(["index.html", "newtab.html", "extensions.html"]);

function isTrustedSender(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  return appUtils.isTrustedLocalPage(webContents.getURL(), TRUSTED_PAGE_FILES);
}

function isInternalUrl(url) {
  return INTERNAL_PAGES.has(url);
}

function isInternalPageUrl(url) {
  return appUtils.isTrustedLocalPage(url, INTERNAL_PAGES_FILE_SET);
}

const INTERNAL_PAGES_FILE_SET = new Set(["newtab.html", "extensions.html"]);

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
    showHtmlLoadError(targetFile, error);
  });
}

function createW(pIdx = 0, opts = {}) {
  const isIncognito = !!opts.incognito;
  if (!isIncognito && windows[pIdx]) return windows[pIdx].focus();
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
      partition: `persist:profile-${pIdx}`
    },
    autoHideMenuBar: true
  });
  win.profileIndex = pIdx;
  win.incognitoWindow = isIncognito;
  windows[pIdx] = win;
  if (!pTabs[pIdx]) pTabs[pIdx] = [];
  pNames[pIdx] = isIncognito ? getDefaultProfileName(pIdx, { incognito: true }) : (pNames[pIdx] || getDefaultProfileName(pIdx));
  states[pIdx] = { activeView: null, metrics: { top: 76, left: 0 }, visible: true };
  win.loadFile(getAppHtmlPath("index.html")).catch((error) => {
    showHtmlLoadError("index.html", error);
    if (!win.isDestroyed()) win.destroy();
  });
  win.on("resize", () => updateB(pIdx));
  win.on("closed", () => {
    delete windows[pIdx];
    delete states[pIdx];
    if (isIncognito) {
      delete pTabs[pIdx];
      delete pNames[pIdx];
    }
    saveH();
  });
  broadcast();
  const sess = session.fromPartition(`persist:profile-${pIdx}`);
  (bSett.profileExtensions[pIdx] || []).forEach(async (p) => {
    try {
      await sess.loadExtension(p);
    } catch (e) { }
  });
  return win;
}

function broadcast() {
  const p = Object.keys(pTabs)
    .filter((i) => parseInt(i, 10) < INCOGNITO_PROFILE_BASE)
    .map((i) => ({
      id: parseInt(i, 10),
      name: pNames[i] || getDefaultProfileName(parseInt(i, 10))
    }));
  Object.values(windows).forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send("profile-list-updated", { profiles: p });
  });
}

function getActiveT(pIdx) {
  const s = states[pIdx];
  if (!s || !s.activeView) return null;
  for (const [id, v] of Object.entries(views)) if (v === s.activeView) return id;
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
      incognito: isIncognito
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

function createV(id, url, inc, pIdx) {
  const win = windows[pIdx];
  const s = states[pIdx];
  const webP = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    safeDialogs: true,
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, "preload.js"),
    partition: inc ? `incognito-${Date.now()}` : `persist:profile-${pIdx}`
  };
  ad(webP.partition);
  const v = new WebContentsView({ webPreferences: webP });
  v.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );
  views[id] = v;
  updateB(pIdx);

  v.webContents.on("will-navigate", (event, targetUrl) => {
    if (isInternalUrl(targetUrl)) {
      if (isInternalPageUrl(v.webContents.getURL())) {
        event.preventDefault();
        loadInternal(v.webContents, targetUrl);
      } else {
        event.preventDefault();
      }
      return;
    }
    if (!isHttpUrl(targetUrl)) event.preventDefault();
  });

  v.webContents.on("did-navigate", (_e, u) => {
    const normalizedUrl = appUtils.normalizeInternalUrl(u, v.tUrl || u);
    v.tUrl = normalizedUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnNavigate(pTabs[pIdx], id, normalizedUrl);
    if (win) {
      win.webContents.send("view-event", { tabId: id, type: "did-navigate", url: normalizedUrl });
      const tab = pTabs[pIdx].find((t) => t.id === id);
      if (!tab || !tab.incognito) {
        try {
          const host = new URL(normalizedUrl).hostname;
          addH(normalizedUrl, (updatedTab && updatedTab.title) || host);
          win.webContents.send("history-updated", getH());
        } catch (e) {
          addH(normalizedUrl, normalizedUrl);
        }
      }
    }
  });
  v.webContents.on("did-start-loading", () => {
    if (win) win.webContents.send("view-event", { tabId: id, type: "did-start-loading" });
  });
  v.webContents.on("did-stop-loading", () => {
    if (win) win.webContents.send("view-event", { tabId: id, type: "did-stop-loading" });
  });
  v.webContents.on("page-title-updated", (_e, t) => {
    const currentUrl = appUtils.normalizeInternalUrl(v.webContents.getURL(), v.tUrl || "");
    v.tUrl = currentUrl || v.tUrl;
    const updatedTab = tabState.updateTabOnTitle(pTabs[pIdx], id, t, currentUrl);
    if (win) {
      win.webContents.send("view-event", {
        tabId: id,
        type: "title",
        title: (updatedTab && updatedTab.title) || t
      });
      const tab = pTabs[pIdx].find((tabEntry) => tabEntry.id === id);
      if ((!tab || !tab.incognito) && currentUrl) {
        addH(currentUrl, t);
        win.webContents.send("history-updated", getH());
      }
    }
  });
  v.webContents.on("found-in-page", (_e, r) => {
    if (win) win.webContents.send("find-result", r);
  });
  v.webContents.on("context-menu", (_e, p) => {
    const m = new Menu();
    if (p.linkURL) {
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
    m.append(new MenuItem({ label: "Reload", click: () => v.webContents.reload() }));
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

  v.tUrl = appUtils.normalizeInternalUrl(url, url);
  if (isInternalUrl(url)) loadInternal(v.webContents, url);
  else if (isHttpUrl(url)) {
    v.webContents.loadURL(url).catch(() => loadInternal(v.webContents, "chrome://newtab"));
  } else loadInternal(v.webContents, "chrome://newtab");
}

function switchT(id, pIdx) {
  const win = windows[pIdx];
  const s = states[pIdx];
  if (!win || !views[id]) return;
  if (s.activeView && s.activeView !== views[id] && s.visible) {
    try {
      win.contentView.removeChildView(s.activeView);
    } catch (e) { }
  }
  s.activeView = views[id];
  if (s.visible && s.activeView && !s.activeView.webContents.isDestroyed()) {
    try {
      win.contentView.addChildView(s.activeView);
      updateB(pIdx);
    } catch (e) { }
  }
  if (win && !win.isDestroyed() && s.activeView && !s.activeView.webContents.isDestroyed()) {
    const payload = tabState.buildTabSwitchPayload(
      pTabs[pIdx],
      id,
      s.activeView.webContents.getURL() || views[id].tUrl || "",
      s.activeView.webContents.getTitle()
    );
    if (payload.url) views[id].tUrl = payload.url;
    win.webContents.send("tab-switched", payload);
  }
  setTimeout(() => updateB(pIdx), 100);
}

function openL(u, pIdx, inc = false) {
  const url = normalizeHttpUrl(u);
  if (!url) return;
  const id = `p-${pIdx}-t-${Date.now()}`;
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  pTabs[pIdx].push({
    id,
    url,
    title: inc ? localization.getIncognitoProfileName(locale) : localization.t(locale, "app.newTab"),
    incognito: inc
  });
  createV(id, url, inc, pIdx);
  switchT(id, pIdx);
}

function closeTab(pIdx, id, win) {
  const w = win || windows[pIdx];
  const s = states[pIdx];
  if (!views[id] || !w) return;
  const wasA = s.activeView === views[id];
  try {
    w.contentView.removeChildView(views[id]);
  } catch (e) { }
  views[id].webContents.destroy();
  delete views[id];
  pTabs[pIdx] = pTabs[pIdx].filter((t) => t.id !== id);
  if (wasA) {
    s.activeView = null;
    if (pTabs[pIdx].length) switchT(pTabs[pIdx][0].id, pIdx);
    else {
      const nid = `p-${pIdx}-t-${Date.now()}`;
      pTabs[pIdx].push({
        id: nid,
        url: "chrome://newtab",
        title: localization.t(getCurrentLocale() || localization.DEFAULT_LOCALE, "app.newTab")
      });
      createV(nid, "chrome://newtab", false, pIdx);
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

ipcMain.on("set-chrome-metrics", (e, m) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (m && s) {
    if (m.top !== undefined) s.metrics.top = m.top;
    if (m.left !== undefined) s.metrics.left = m.left;
    updateB(w.profileIndex);
  }
});
ipcMain.on("renderer-ready", (e) => {
  if (!isTrustedSender(e.sender)) return;
  const w = e.sender.getOwnerBrowserWindow();
  if (w) {
    createT(w.profileIndex, w);
    broadcast();
  }
});
ipcMain.on("fetch-and-show-history", (e, q) => {
  if (!isTrustedSender(e.sender)) return;
  e.reply("history-data-received", getH(q));
});
ipcMain.on("apply-browser-color", (e, c) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (w) {
    w.setBackgroundColor(c);
    bSett.themeColor = c;
    saveS();
  }
});
ipcMain.on("update-default-search-engine", (e, u) => {
  if (!isTrustedSender(e.sender)) return;
  defSearch = u;
});
ipcMain.on("toggle-browser-view", (e, v) => {
  if (!isTrustedSender(e.sender)) return;
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
});
ipcMain.handle("add-new-profile", (e) => {
  if (!isTrustedSender(e.sender)) return null;
  let n = 0;
  while (pTabs[n]) n++;
  pTabs[n] = [];
  pNames[n] = getDefaultProfileName(n);
  createW(n);
  return n;
});
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

ipcMain.handle("open-incognito-window", (e, url) => {
  if (!isTrustedSender(e.sender)) return;
  openIncognitoWindow(url);
});
ipcMain.on("rename-profile", (e, { profileIndex, newName }) => {
  if (!isTrustedSender(e.sender)) return;
  if (pNames[profileIndex]) {
    pNames[profileIndex] = newName;
    broadcast();
  }
});
ipcMain.handle("create-tab", (e, { tabId, url, inc, afterTabId }) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const pIdx = w.profileIndex;
  const u = url || "https://www.google.com/";
  const isIncognito = !!inc;
  const locale = getCurrentLocale() || localization.DEFAULT_LOCALE;
  if (!pTabs[pIdx].find((t) => t.id === tabId)) {
    const nt = {
      id: tabId,
      url: u,
      title: isIncognito ? localization.getIncognitoProfileName(locale) : localization.t(locale, "app.newTab"),
      incognito: isIncognito
    };
    const insertAfter = typeof afterTabId === "string" && afterTabId.length ? afterTabId : null;
    insertTabAfter(pIdx, nt, insertAfter);
    w.webContents.send("tab-created", { ...nt, afterTabId: insertAfter });
  }
  createV(tabId, u, isIncognito, pIdx);
  switchT(tabId, pIdx);
});
ipcMain.handle("switch-tab", (e, id) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (w) switchT(id, w.profileIndex);
});
ipcMain.handle("close-tab", (e, id) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (w) closeTab(w.profileIndex, id, w);
});
ipcMain.handle("clear-other-tabs", (e, keepId) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (w) clearOtherTabs(w.profileIndex, keepId, w);
});
ipcMain.handle("navigate-to", (e, u) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (!s || !s.activeView) return;
  const tu = (u || "").trim();
  if (tu === "chrome://extensions" || tu === "chrome://newtab") {
    return loadInternal(s.activeView.webContents, tu);
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
  if (isHttpUrl(final)) return s.activeView.webContents.loadURL(final);
  return loadInternal(s.activeView.webContents, "chrome://newtab");
});
ipcMain.handle("go-back", (e) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView && s.activeView.webContents.canGoBack()) s.activeView.webContents.goBack();
});
ipcMain.handle("go-forward", (e) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView && s.activeView.webContents.canGoForward())
    s.activeView.webContents.goForward();
});
ipcMain.handle("reload-page", (e) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView) s.activeView.webContents.reload();
});
ipcMain.handle("switch-profile", (e, pIdx) => {
  if (!isTrustedSender(e.sender)) return;
  if (windows[pIdx]) windows[pIdx].focus();
  else createW(pIdx);
});
ipcMain.handle("clear-history-range", (e, range) => {
  if (!isTrustedSender(e.sender)) return;
  clearHistoryRange(range);
});
ipcMain.handle("delete-history-item", (e, id) => {
  if (!isTrustedSender(e.sender)) return;
  deleteHistoryItem(id);
});
ipcMain.handle("find-in-page", (e, t, o = {}) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView && t) s.activeView.webContents.findInPage(t, o);
});
ipcMain.handle("stop-find-in-page", (e, a) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  if (!w) return;
  const s = states[w.profileIndex];
  if (s && s.activeView) s.activeView.webContents.stopFindInPage(a || "clearSelection");
});
ipcMain.handle("select-extension-folder", async (e) => {
  if (!isTrustedSender(e.sender)) return null;
  return dialog
    .showOpenDialog(getSenderWindow(e.sender), { properties: ["openDirectory"] })
    .then((r) => (r.canceled ? null : r.filePaths[0]));
});
ipcMain.handle("load-extension", async (e, p) => {
  if (!isTrustedSender(e.sender)) return { success: false, error: "Untrusted sender." };
  const w = getSenderWindow(e.sender);
  if (!w) return { success: false, error: "No window." };
  const pIdx = w.profileIndex;
  if (!p || !path.isAbsolute(p) || !fs.existsSync(p))
    return { success: false, error: "Invalid extension path." };
  const sess = session.fromPartition(`persist:profile-${pIdx}`);
  try {
    const ext = await sess.loadExtension(p);
    if (!bSett.profileExtensions[pIdx]) bSett.profileExtensions[pIdx] = [];
    if (!bSett.profileExtensions[pIdx].includes(p)) {
      bSett.profileExtensions[pIdx].push(p);
      saveS();
    }
    return { success: true, name: ext.name };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle("get-extensions", (e) => {
  if (!isTrustedSender(e.sender)) return [];
  const w = getSenderWindow(e.sender);
  const pIdx = w ? w.profileIndex : 0;
  const sess = session.fromPartition(`persist:profile-${pIdx}`);
  return sess.getAllExtensions().map((ext) => ({
    id: ext.id,
    name: ext.name,
    version: ext.version,
    description: ext.description
  }));
});
ipcMain.handle("remove-extension", (e, id) => {
  if (!isTrustedSender(e.sender)) return;
  const w = getSenderWindow(e.sender);
  const pIdx = w ? w.profileIndex : 0;
  const sess = session.fromPartition(`persist:profile-${pIdx}`);
  const ext = sess.getExtension(id);
  if (ext && bSett.profileExtensions[pIdx]) {
    bSett.profileExtensions[pIdx] = bSett.profileExtensions[pIdx].filter((p) => p !== ext.path);
    saveS();
  }
  sess.removeExtension(id);
});
ipcMain.handle("get-app-version", (e) => {
  if (!isTrustedSender(e.sender)) return null;
  return app.getVersion();
});
ipcMain.handle("get-updater-state", (e) => {
  if (!isTrustedSender(e.sender)) return null;
  return getUpdaterState();
});
ipcMain.handle("get-language-settings", (e) => {
  if (!isTrustedSender(e.sender)) return { locale: null };
  return { locale: getCurrentLocale() };
});
ipcMain.handle("set-language", (e, locale) => {
  if (!isTrustedSender(e.sender)) return { locale: getCurrentLocale() };
  const nextLocale = localization.sanitizeLocale(locale);
  if (!nextLocale) return { locale: getCurrentLocale() };
  bSett.locale = nextLocale;
  saveS();
  return { locale: nextLocale };
});
ipcMain.handle("check-for-updates", (e) => {
  if (!isTrustedSender(e.sender)) return null;
  return checkForUpdates("manual");
});
ipcMain.handle("update-adblock-rules", (e, r) => {
  if (!isTrustedSender(e.sender)) return;
  adRules = (r || "")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      if (!line || line.startsWith("!")) return "";
      return line.replace(/\s*!.*$/, "").trim();
    })
    .filter((x) => x);
});

function ad(p) {
  if (partitions.has(p)) return;
  partitions.add(p);
  const sess = session.fromPartition(p);
  sess.webRequest.onBeforeRequest((d, cb) => {
    if (!d.url.startsWith("http") || !adRules.length) return cb({ cancel: false });
    const url = d.url.toLowerCase();
    cb({ cancel: adRules.some((r) => url.includes(r.toLowerCase())) });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(() => {
  setMacDockIcon();
  createW(0);
  configureAutoUpdater();
  setTimeout(() => {
    void checkForUpdates("startup");
  }, 5000);
});
