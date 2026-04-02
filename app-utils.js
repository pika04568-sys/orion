(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OrionAppUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const ORION_SCHEME = "orion";
  const ORION_PROTOCOL = `${ORION_SCHEME}:`;
  const ORION_HOST = "app";
  const INTERNAL_PAGE_ALIASES = Object.freeze({
    "newtab.html": "chrome://newtab",
    "extensions.html": "chrome://extensions",
    "offline.html": "chrome://offline",
    "reader.html": "chrome://reader"
  });
  const APP_INVOKE_CHANNELS = Object.freeze([
    "add-new-profile",
    "check-for-updates",
    "clear-history-range",
    "delete-history-item",
    "clear-other-tabs",
    "close-tab",
    "close-reader",
    "create-tab",
    "get-language-settings",
    "get-reader-content",
    "get-window-bootstrap-state",
    "open-incognito-window",
    "find-in-page",
    "get-app-version",
    "get-browser-settings",
    "get-updater-state",
    "go-back",
    "go-forward",
    "load-extension",
    "navigate-to",
    "reload-page",
    "reopen-closed-tab",
    "set-language",
    "get-adblock-state",
    "refresh-adblock-lists",
    "reset-adblock-defaults",
    "set-adblock-list-enabled",
    "set-browser-settings",
    "select-extension-folder",
    "stop-find-in-page",
    "switch-profile",
    "switch-tab",
    "toggle-reader-mode",
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
    "browser-settings-changed",
    "profile-changed",
    "profile-list-updated",
    "reader-mode-changed",
    "tab-closed",
    "tab-created",
    "tab-switched",
    "updater-status",
    "view-event"
  ]);
  const NEWTAB_INVOKE_CHANNELS = Object.freeze([
    "get-language-settings",
    "get-browser-settings",
    "navigate-to"
  ]);
  const OFFLINE_INVOKE_CHANNELS = Object.freeze([
    "navigate-to"
  ]);
  const EXTENSIONS_INVOKE_CHANNELS = Object.freeze([
    "get-extensions",
    "get-language-settings",
    "load-extension",
    "remove-extension",
    "select-extension-folder"
  ]);
  const EMPTY_CHANNELS = Object.freeze({
    invoke: Object.freeze([]),
    send: Object.freeze([]),
    on: Object.freeze([])
  });
  const NEWTAB_ON_CHANNELS = Object.freeze([
    "browser-settings-changed"
  ]);
  const ELECTRON_PAGE_CHANNELS = Object.freeze({
    "index.html": Object.freeze({
      invoke: APP_INVOKE_CHANNELS,
      send: APP_SEND_CHANNELS,
      on: APP_ON_CHANNELS
    }),
    "newtab.html": Object.freeze({
      invoke: NEWTAB_INVOKE_CHANNELS,
      send: EMPTY_CHANNELS.send,
      on: NEWTAB_ON_CHANNELS
    }),
    "offline.html": Object.freeze({
      invoke: OFFLINE_INVOKE_CHANNELS,
      send: EMPTY_CHANNELS.send,
      on: EMPTY_CHANNELS.on
    }),
    "reader.html": Object.freeze({
      invoke: Object.freeze([
        "close-reader",
        "get-reader-content"
      ]),
      send: EMPTY_CHANNELS.send,
      on: EMPTY_CHANNELS.on
    }),
    "extensions.html": Object.freeze({
      invoke: EXTENSIONS_INVOKE_CHANNELS,
      send: EMPTY_CHANNELS.send,
      on: EMPTY_CHANNELS.on
    })
  });

  function getAppPageFileName(url) {
    if (!url || typeof url !== "string") return null;

    try {
      const parsed = new URL(url);
      let file = null;
      if (parsed.protocol === ORION_PROTOCOL && parsed.hostname === ORION_HOST) {
        file = (parsed.pathname || "")
          .split("/")
          .filter(Boolean)
          .pop();
      } else if (parsed.protocol === "file:") {
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
      } else {
        return null;
      }
      return file ? file.toLowerCase() : null;
    } catch (_error) {
      return null;
    }
  }

  function normalizeFilePathCandidates(value) {
    if (!value || typeof value !== "string") return [];

    let normalized = value
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");
    
    // Handle Windows file URL paths that start with /C:/
    if (/^\/[A-Za-z]:/.test(normalized)) {
      normalized = normalized.slice(1);
    }
    
    // Create variants: normalized, lowercase, and drive-letter normalized
    const variants = [normalized];
    const lower = normalized.toLowerCase();
    if (lower !== normalized) variants.push(lower);
    
    // Add variant with leading slash for comparison
    if (!normalized.startsWith("/")) {
      variants.push("/" + normalized);
      if (!lower.startsWith("/")) variants.push("/" + lower);
    }
    
    return Array.from(new Set(variants.filter(Boolean)));
  }

  function isTrustedBundledFilePage(url, trustedFiles, rootPath) {
    if (!trustedFiles || typeof trustedFiles.has !== "function") return false;
    if (!rootPath || typeof rootPath !== "string") return false;
    if (!url || typeof url !== "string") return false;

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "file:") return false;

      const file = getAppPageFileName(url);
      if (!file || !trustedFiles.has(file)) return false;

      const rootCandidates = normalizeFilePathCandidates(rootPath);
      // Get the full pathname from URL, handling Windows format
      let urlPathname = decodeURIComponent(parsed.pathname || "");
      // Handle Windows file URL format /C:/path
      if (/^\/[A-Za-z]:/.test(urlPathname)) {
        urlPathname = urlPathname.slice(1);
      }
      const fileCandidates = normalizeFilePathCandidates(urlPathname);

      return fileCandidates.some((filePath) => {
        const lowerFilePath = filePath.toLowerCase();
        return rootCandidates.some((rootCandidate) => {
          const lowerRoot = rootCandidate.toLowerCase();
          // Check if file path matches root or is inside root
          return lowerFilePath === lowerRoot || 
                 lowerFilePath.startsWith(lowerRoot + "/") ||
                 lowerFilePath.startsWith(lowerRoot + "\\");
        });
      });
    } catch (_error) {
      return false;
    }
  }

  function getAppPageUrl(fileName, searchParams = null) {
    if (!fileName || typeof fileName !== "string") return "";
    const url = new URL(`${ORION_PROTOCOL}//${ORION_HOST}/${fileName.replace(/^\/+/, "")}`);
    if (searchParams && typeof searchParams === "object") {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value == null) return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  function isTrustedAppPage(url, trustedFiles) {
    if (!trustedFiles || typeof trustedFiles.has !== "function") return false;
    if (!url || typeof url !== "string") return false;

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== ORION_PROTOCOL || parsed.hostname !== ORION_HOST) return false;
      const file = getAppPageFileName(url);
      return !!file && trustedFiles.has(file);
    } catch (_error) {
      return false;
    }
  }

  function getInternalAlias(url) {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("chrome://")) return url;

    const file = getAppPageFileName(url);
    return file ? INTERNAL_PAGE_ALIASES[file] || null : null;
  }

  function normalizeInternalUrl(url, fallbackUrl = "") {
    if (!url || typeof url !== "string") return fallbackUrl || "";
    return getInternalAlias(url) || url;
  }

  function resolveBrowserShortcutAction(input = {}) {
    if (!input || input.type !== "keyDown") return null;

    const key = typeof input.key === "string" ? input.key.toLowerCase() : "";
    const code = typeof input.code === "string" ? input.code.toLowerCase() : "";
    const primary = !!(input.control || input.meta);
    const shift = !!input.shift;
    const alt = !!input.alt;

    const getDigit = () => {
      if (/^[1-9]$/.test(key)) return key;
      const digitMatch = code.match(/^(digit|numpad)([1-9])$/);
      return digitMatch ? digitMatch[2] : null;
    };

    if (!primary && alt && (key === "arrowleft" || code === "arrowleft")) return "go-back";
    if (!primary && alt && (key === "arrowright" || code === "arrowright")) return "go-forward";

    if (primary && !alt && !shift && (key === "l" || key === "k")) return "focus-address-bar";
    if (primary && !alt && !shift && key === "c") return "copy";
    if (primary && !alt && !shift && key === "x") return "cut";
    if (primary && !alt && !shift && key === "v") return "paste";
    if (primary && !alt && !shift && key === "a") return "select-all";
    if (primary && !alt && !shift && key === "t") return "new-tab";
    if (primary && shift && key === "n") return "new-incognito-tab";
    if (primary && !alt && !shift && key === "w") return "close-tab";
    if (primary && shift && key === "t") return "reopen-closed-tab";
    if (primary && !alt && !shift && key === "d") return "bookmark-page";
    if (primary && !alt && !shift && key === "f") return "find-in-page";
    if (primary && !alt && !shift && key === "h") return "show-history";
    if (primary && !alt && !shift && key === "j") return "show-downloads";
    if (primary && !alt && key === "b") return "show-bookmarks";
    if (primary && !alt && !shift && (key === "," || code === "comma")) return "show-settings";
    if (primary && !alt && shift && (key === "r" || code === "f5")) return "hard-reload-page";
    if (primary && !alt && (key === "r" || code === "f5")) return "reload-page";

    if (primary && !alt && (key === "tab" || code === "tab" || key === "pagedown" || code === "pagedown")) {
      return shift ? "switch-tab-previous" : "switch-tab-next";
    }
    if (primary && !alt && (key === "pageup" || code === "pageup")) return "switch-tab-previous";
    if (primary && !alt && (key === "[" || code === "bracketleft")) return "switch-tab-previous";
    if (primary && !alt && (key === "]" || code === "bracketright")) return "switch-tab-next";

    const digit = getDigit();
    if (primary && !alt && digit) return `switch-tab-${digit}`;

    return null;
  }

  function getElectronPageChannels(fileName) {
    if (!fileName || typeof fileName !== "string") return EMPTY_CHANNELS;
    return ELECTRON_PAGE_CHANNELS[fileName.toLowerCase()] || EMPTY_CHANNELS;
  }

  function canUseElectronChannel(fileName, method, channel) {
    if (!channel || typeof channel !== "string") return false;
    const channels = getElectronPageChannels(fileName);
    const allowed = channels && channels[method];
    return Array.isArray(allowed) ? allowed.includes(channel) : false;
  }

  function resolveRendererBootstrapState(options = {}) {
    const sanitizeLocale =
      typeof options.sanitizeLocale === "function" ? options.sanitizeLocale : (value) => value || null;
    const persistedLocale = sanitizeLocale(options.persistedLocale);
    const storedLocale = sanitizeLocale(options.storedLocale);
    const onboardingCompleted = options.onboardingCompleted !== false;

    let locale = options.defaultLocale || "en";
    let source = "default";

    if (persistedLocale) {
      locale = persistedLocale;
      source = "settings";
    } else if (storedLocale) {
      locale = storedLocale;
      source = "local-storage";
    }

    return {
      locale,
      showOnboarding: !onboardingCompleted,
      source
    };
  }

  function resolveLanguageSettingsState(options = {}) {
    const sanitizeLocale =
      typeof options.sanitizeLocale === "function" ? options.sanitizeLocale : (value) => value || null;
    const currentLocale = sanitizeLocale(options.currentLocale);
    const nextLocale = sanitizeLocale(options.nextLocale);

    if (!nextLocale) {
      return {
        locale: currentLocale,
        onboardingCompleted: !!options.currentOnboardingCompleted
      };
    }

    return {
      locale: nextLocale,
      onboardingCompleted: true
    };
  }

  function syncTabRecord(tabList, tabId, patch = {}) {
    if (!Array.isArray(tabList) || !tabId) return null;
    const tab = tabList.find((entry) => entry && entry.id === tabId);
    if (!tab) return null;

    if (Object.prototype.hasOwnProperty.call(patch, "url")) {
      const nextUrl = normalizeInternalUrl(patch.url, tab.url || "");
      if (nextUrl) tab.url = nextUrl;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "title")) {
      tab.title = patch.title || tab.title || "Loading...";
    }

    if (Object.prototype.hasOwnProperty.call(patch, "incognito")) {
      tab.incognito = !!patch.incognito;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "readerMode")) {
      tab.readerMode = !!patch.readerMode;
    }

    return tab;
  }

  function upsertTabRecord(tabList, tabLike = {}) {
    if (!Array.isArray(tabList) || !tabLike.id) return null;

    let tab = tabList.find((entry) => entry && entry.id === tabLike.id);
    if (!tab) {
      tab = {
        id: tabLike.id,
        url: normalizeInternalUrl(tabLike.url, "chrome://newtab") || "chrome://newtab",
        title: tabLike.title || "Loading...",
        incognito: !!tabLike.incognito,
        readerMode: !!tabLike.readerMode
      };
      tabList.push(tab);
      return tab;
    }

    return syncTabRecord(tabList, tabLike.id, tabLike);
  }

  function getActiveTabBookmark(tabList, activeTabId) {
    if (!Array.isArray(tabList) || !activeTabId) return null;
    const tab = tabList.find((entry) => entry && entry.id === activeTabId);
    if (!tab) return null;

    return {
      url: normalizeInternalUrl(tab.url, tab.url || ""),
      title: tab.title || tab.url || ""
    };
  }

  function removeBookmarkById(bookmarks, bookmarkId) {
    if (!Array.isArray(bookmarks)) return [];
    const bookmarkIdValue = String(bookmarkId);
    return bookmarks.filter((bookmark) => String(bookmark.id) !== bookmarkIdValue);
  }

  function createTabElement(doc, tab = {}) {
    const element = doc.createElement("div");
    element.className = "tab";
    element.dataset.id = tab.id || "";
    if (tab.incognito) element.dataset.incognito = "true";
    if (tab.readerMode) element.dataset.readerMode = "true";

    const titleWrap = doc.createElement("span");
    titleWrap.className = "tab-title-wrap";
    if (tab.incognito) {
      const icon = doc.createElement("span");
      icon.className = "tab-incognito-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0-6 6v1H4v2h2v8h12v-8h2v-2h-2V9a6 6 0 0 0-6-6z"/></svg>';
      titleWrap.appendChild(icon);
    }
    const titleEl = doc.createElement("span");
    titleEl.className = "tab-title";
    titleEl.textContent = tab.title || "Loading...";
    titleWrap.appendChild(titleEl);

    const closeEl = doc.createElement("span");
    closeEl.className = "tab-close";
    closeEl.textContent = "\u00d7";

    element.appendChild(titleWrap);
    element.appendChild(closeEl);

    return { element, titleEl, closeEl };
  }

  function createExtensionCard(doc, extension = {}, labels = {}) {
    const card = doc.createElement("div");
    card.className = "extension-card";

    const header = doc.createElement("div");
    header.className = "extension-header";

    const nameEl = doc.createElement("span");
    nameEl.className = "extension-name";
    nameEl.textContent = extension.name || labels.unknown || "Unknown extension";

    const versionEl = doc.createElement("span");
    versionEl.className = "extension-version";
    versionEl.textContent = extension.version ? `v${extension.version}` : "";

    header.appendChild(nameEl);
    header.appendChild(versionEl);

    const descriptionEl = doc.createElement("div");
    descriptionEl.className = "extension-desc";
    descriptionEl.textContent = extension.description || labels.noDescription || "No description provided.";

    const actions = doc.createElement("div");
    actions.className = "extension-actions";

    const removeBtn = doc.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-btn";
    removeBtn.textContent = labels.remove || "Remove";

    actions.appendChild(removeBtn);
    card.appendChild(header);
    card.appendChild(descriptionEl);
    card.appendChild(actions);

    return { card, nameEl, versionEl, descriptionEl, removeBtn };
  }

  return {
    APP_INVOKE_CHANNELS,
    APP_ON_CHANNELS,
    APP_SEND_CHANNELS,
    EXTENSIONS_INVOKE_CHANNELS,
    INTERNAL_INVOKE_CHANNELS: NEWTAB_INVOKE_CHANNELS,
    NEWTAB_INVOKE_CHANNELS,
    OFFLINE_INVOKE_CHANNELS,
    ORION_HOST,
    ORION_PROTOCOL,
    ORION_SCHEME,
    ELECTRON_PAGE_CHANNELS,
    canUseElectronChannel,
    INTERNAL_PAGE_ALIASES,
    createExtensionCard,
    createTabElement,
    getAppPageFileName,
    getAppPageUrl,
    getElectronPageChannels,
    getActiveTabBookmark,
    getLocalPageFileName: getAppPageFileName,
    resolveRendererBootstrapState,
    resolveLanguageSettingsState,
    resolveBrowserShortcutAction,
    normalizeInternalUrl,
    isTrustedAppPage,
    isTrustedBundledFilePage,
    isTrustedLocalPage: isTrustedAppPage,
    removeBookmarkById,
    syncTabRecord,
    upsertTabRecord
  };
});
