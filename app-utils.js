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
  const ORION_HOST_ALIASES = Object.freeze({
    games: "offline.html"
  });
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
    "create-ai-tab-groups",
    "create-tab-group",
    "create-tab",
    "delete-tab-group",
    "get-reader-content",
    "bootstrap-window",
    "open-incognito-window",
    "find-in-page",
    "get-browser-settings",
    "get-memory-status",
    "go-back",
    "go-forward",
    "navigate-to",
    "reload-page",
    "reopen-closed-tab",
    "assign-tab-to-group",
    "retry-managed-extension-install",
    "set-language",
    "set-browser-settings",
    "stop-find-in-page",
    "summarize-active-page",
    "chat-with-active-page",
    "cancel-page-summary",
    "cancel-page-chat",
    "get-ai-model-status",
    "cancel-ai-model-download",
    "remove-ai-model",
    "switch-profile",
    "switch-tab",
    "toggle-tab-group-collapsed",
    "toggle-reader-mode",
    "rename-tab-group"
  ]);
  const APP_SEND_CHANNELS = Object.freeze([
    "apply-browser-color",
    "fetch-and-show-history",
    "set-chrome-metrics",
    "toggle-browser-view",
    "update-default-search-engine",
    "rename-profile"
  ]);
  const APP_ON_CHANNELS = Object.freeze([
    "active-tab-changed",
    "download-started",
    "download-updated",
    "extensions-ready",
    "find-result",
    "history-data-received",
    "keyboard-shortcut",
    "browser-settings-changed",
    "memory-status-changed",
    "managed-extension-status-changed",
    "open-ai-summary",
    "profile-changed",
    "profile-list-updated",
    "reader-mode-changed",
    "tab-closed",
    "tab-created",
    "tab-groups-changed",
    "tab-switched",
    "updater-status",
    "view-event",
    "ai-model-status-changed"
  ]);
  const NEWTAB_INVOKE_CHANNELS = Object.freeze([
    "bootstrap-newtab",
    "navigate-to"
  ]);
  const OFFLINE_INVOKE_CHANNELS = Object.freeze([
    "navigate-to"
  ]);
  const EXTENSIONS_INVOKE_CHANNELS = Object.freeze([
    "get-extensions",
    "get-language-settings",
    "load-extension",
    "open-chrome-web-store",
    "remove-extension",
    "select-extension-folder",
    "update-extensions"
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
      if (parsed.protocol === ORION_PROTOCOL) {
        if (parsed.hostname === ORION_HOST) {
          file = (parsed.pathname || "")
            .split("/")
            .filter(Boolean)
            .pop();
        } else if (parsed.hostname && ORION_HOST_ALIASES[parsed.hostname]) {
          const pathname = (parsed.pathname || "").trim();
          if (!pathname || pathname === "/") {
            file = ORION_HOST_ALIASES[parsed.hostname];
          }
        }
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

  function getCanonicalAppResourceFileName(url, allowedFiles) {
    if (!allowedFiles || typeof allowedFiles.has !== "function") return null;
    if (!url || typeof url !== "string" || url.trim() !== url) return null;

    const resourcePrefix = `${ORION_PROTOCOL}//${ORION_HOST}/`;
    if (url.startsWith(resourcePrefix)) {
      const resourceWithSuffix = url.slice(resourcePrefix.length);
      const suffixIndex = resourceWithSuffix.search(/[?#]/);
      const resource = suffixIndex === -1
        ? resourceWithSuffix
        : resourceWithSuffix.slice(0, suffixIndex);

      if (!resource || resource.includes("/") || resource.includes("\\") || /%[0-9a-f]{2}/i.test(resource)) {
        return null;
      }

      try {
        const parsed = new URL(url);
        if (
          parsed.protocol !== ORION_PROTOCOL ||
          parsed.hostname !== ORION_HOST ||
          parsed.pathname !== `/${resource}`
        ) {
          return null;
        }
      } catch (_error) {
        return null;
      }

      return allowedFiles.has(resource) ? resource : null;
    }

    try {
      const parsed = new URL(url);
      const alias = ORION_HOST_ALIASES[parsed.hostname];
      if (
        parsed.protocol !== ORION_PROTOCOL ||
        !alias ||
        (parsed.pathname !== "" && parsed.pathname !== "/")
      ) {
        return null;
      }

      const withoutSuffix = url.split(/[?#]/, 1)[0];
      const canonicalAliasUrls = new Set([
        `${ORION_PROTOCOL}//${parsed.hostname}`,
        `${ORION_PROTOCOL}//${parsed.hostname}/`
      ]);
      return canonicalAliasUrls.has(withoutSuffix) && allowedFiles.has(alias) ? alias : null;
    } catch (_error) {
      return null;
    }
  }

  function normalizeFilePath(value) {
    if (!value || typeof value !== "string") return "";

    let normalized = value
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");

    // Handle Windows file URL paths that start with /C:/
    if (/^\/[A-Za-z]:/.test(normalized)) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }

  function isTrustedBundledFilePage(url, trustedFiles, rootPath) {
    if (!trustedFiles || typeof trustedFiles.has !== "function") return false;
    if (!rootPath || typeof rootPath !== "string") return false;
    if (!url || typeof url !== "string") return false;

    try {
      const rawPath = url.split(/[?#]/, 1)[0];
      if (/%(?:2f|5c)/i.test(rawPath) || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(rawPath)) {
        return false;
      }

      const parsed = new URL(url);
      if (parsed.protocol !== "file:") return false;

      const file = getAppPageFileName(url);
      if (!file || !trustedFiles.has(file)) return false;

      const normalizedRoot = normalizeFilePath(rootPath);
      const normalizedFile = normalizeFilePath(decodeURIComponent(parsed.pathname || ""));
      const expectedFile = `${normalizedRoot}/${file}`;
      const windowsPath = /^[A-Za-z]:\//.test(normalizedRoot);

      return windowsPath
        ? normalizedFile.toLowerCase() === expectedFile.toLowerCase()
        : normalizedFile === expectedFile;
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
    return !!getCanonicalAppResourceFileName(url, trustedFiles);
  }

  function isMainFrameIpcEvent(event) {
    if (!event || !event.sender || !event.senderFrame || !event.sender.mainFrame) return false;
    if (event.senderFrame === event.sender.mainFrame) return true;
    const senderFrame = event.senderFrame;
    const mainFrame = event.sender.mainFrame;
    return senderFrame.parent === null
      && Number.isInteger(senderFrame.processId)
      && Number.isInteger(senderFrame.routingId)
      && senderFrame.processId === mainFrame.processId
      && senderFrame.routingId === mainFrame.routingId;
  }

  function resolveTabIncognito(ownerWindow) {
    return !!(ownerWindow && ownerWindow.incognitoWindow);
  }

  function getProfilePartitionName(profileIndex, incognito = false) {
    return incognito
      ? `orion-incognito-profile-${profileIndex}`
      : `persist:profile-${profileIndex}`;
  }

  function shouldPersistTabActivity(tab) {
    return !(tab && tab.incognito);
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

  function createDeferredStartupController(options = {}) {
    const isDeferredNavigation =
      typeof options.isDeferredNavigation === "function"
        ? options.isDeferredNavigation
        : (url) => typeof url === "string" && /^https?:/i.test(url);

    let windowReady = false;
    let firstNavigationHandled = false;
    const windowReadyTasks = [];
    const firstNavigationTasks = [];

    const runQueuedTasks = (queue, value) => {
      while (queue.length) {
        const task = queue.shift();
        try {
          task(value);
        } catch (_error) {}
      }
    };

    return {
      markWindowReady() {
        if (windowReady) return false;
        windowReady = true;
        runQueuedTasks(windowReadyTasks);
        return true;
      },
      markNavigation(url) {
        if (firstNavigationHandled || !isDeferredNavigation(url)) return false;
        firstNavigationHandled = true;
        runQueuedTasks(firstNavigationTasks, url);
        return true;
      },
      scheduleAfterWindowReady(task) {
        if (typeof task !== "function") return false;
        if (windowReady) {
          task();
          return true;
        }
        windowReadyTasks.push(task);
        return false;
      },
      scheduleOnFirstNavigation(task) {
        if (typeof task !== "function") return false;
        if (firstNavigationHandled) return true;
        firstNavigationTasks.push(task);
        return false;
      }
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

    if (Object.prototype.hasOwnProperty.call(patch, "groupId")) {
      if (typeof patch.groupId === "string" && patch.groupId) tab.groupId = patch.groupId;
      else delete tab.groupId;
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
      if (typeof tabLike.groupId === "string" && tabLike.groupId) tab.groupId = tabLike.groupId;
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

    const metaEl = doc.createElement("div");
    metaEl.className = "extension-meta";
    const sourceLabel = extension.source === "chrome-web-store"
      ? (labels.webStore || "Chrome Web Store")
      : (labels.unpacked || "Unpacked");
    const manifestLabel = extension.manifestVersion ? `Manifest v${extension.manifestVersion}` : labels.unknownManifest || "Manifest unknown";
    const managedLabel = extension.managed ? ` - ${labels.managed || "Managed by Orion"}` : "";
    metaEl.textContent = `${sourceLabel} - ${manifestLabel}${managedLabel}`;

    const actions = doc.createElement("div");
    actions.className = "extension-actions";

    let removeBtn = null;
    if (extension.removable !== false) {
      removeBtn = doc.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = labels.remove || "Remove";
      actions.appendChild(removeBtn);
    } else {
      const managedBadge = doc.createElement("span");
      managedBadge.className = "managed-extension-badge";
      managedBadge.textContent = labels.managed || "Managed by Orion";
      actions.appendChild(managedBadge);
    }
    card.appendChild(header);
    card.appendChild(descriptionEl);
    card.appendChild(metaEl);
    card.appendChild(actions);

    return { card, nameEl, versionEl, descriptionEl, removeBtn };
  }

  function getReaderButtonState(active, translate = (key) => key) {
    const label = translate(active ? "reader.exitMode" : "reader.enterMode");
    return {
      title: label,
      ariaLabel: label,
      ariaPressed: active ? "true" : "false"
    };
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
    createDeferredStartupController,
    INTERNAL_PAGE_ALIASES,
    createExtensionCard,
    createTabElement,
    getAppPageFileName,
    getCanonicalAppResourceFileName,
    getAppPageUrl,
    getProfilePartitionName,
    getElectronPageChannels,
    getActiveTabBookmark,
    getReaderButtonState,
    getLocalPageFileName: getAppPageFileName,
    resolveRendererBootstrapState,
    resolveLanguageSettingsState,
    resolveBrowserShortcutAction,
    resolveTabIncognito,
    shouldPersistTabActivity,
    normalizeInternalUrl,
    isMainFrameIpcEvent,
    isTrustedAppPage,
    isTrustedBundledFilePage,
    isTrustedLocalPage: isTrustedAppPage,
    removeBookmarkById,
    syncTabRecord,
    upsertTabRecord
  };
});
