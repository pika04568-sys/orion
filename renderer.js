const ipcRenderer = window.electron || { invoke: async () => { }, send: () => { }, on: () => { } };
const appUtils = window.OrionAppUtils;
const localization = window.OrionLocalization;

let tabBar, newTabBtn, groupTabsBtn, groupTabsMenu, clearTabsBtn, addressBar, backBtn, forwardBtn, reloadBtn, readerBtn, aiSummaryBtn, aiSummarySidebar, closeAiSummaryBtn, aiSummaryContent, historyBtn, historySidebar, closeHistoryBtn, historyList, chromeContainer, profileBtn, profileMenu, profileListContainer, addProfileBtn, settingsBtn, settingsSidebar, closeSettingsBtn, profileColorPicker, renameModal, renameInput, renameSaveBtn, renameCancelBtn, pendingRenameProfileId = null, bookmarkBtn, bookmarksSidebar, closeBookmarksBtn, bookmarksList, downloadsBtn, downloadsSidebar, closeDownloadsBtn, downloadsList, findBar, findInput, findResults, findPrev, findNext, findClose, openExtensionsBtn, progressBarContainer, progressBar, addBookmarkBtn, bookmarksBar, bookmarkDestModal, addToBarBtn, addToNewTabBtn, addToBothBtn, cancelBookmarkBtn, checkUpdatesBtn, versionEl, updateStatusEl, startupOverlay, startupLanguagePicker, settingsLanguagePicker, readerToast, extensionActionList, extensionActionsMenuBtn, extensionActionsMenu, extensionActionsMenuList, extensionActionState = null, metrics = () => { }, pendingBookmark = null, activeTabId = null, activeProfile = 0, isIncognitoWindow = false, tabs = [], tabGroups = [], profiles = [];
let updaterState = { state: 'idle', message: localization.t(localization.DEFAULT_LOCALE, 'updates.ready') };
let memoryStatus = { supported: true, enabled: false, usedMb: 0, limitMb: 0, overLimit: false, unloadedTabCount: 0 };
let ramLimitSettings = { mode: 'off', automaticLimitMb: 0 };
let cachedBrowserSettings = {};
let applyMountedBrowserSettings = null;
let settingsStateListenersInitialized = false;
let currentLocale = localization.DEFAULT_LOCALE;
let currentPlatform = getBrowserUiPlatform();
let bootstrapSnapshot = null;
let extensionToolbarInitialized = false;
let discoInterval = null;
let discoModeBtn = null;
let managedExtensionStatus = null;
let managedExtensionOverlay = null;
let managedExtensionTitle = null;
let managedExtensionBody = null;
let managedExtensionError = null;
let managedExtensionRetry = null;
let aiModelStatusEl = null;
let aiModelProgressContainer = null;
let aiModelProgressBar = null;
let aiModelProgressText = null;
let removeAiModelBtn = null;
let redownloadAiModelBtn = null;
let aiModelStatus = { state: 'missing', modelId: '', progress: 0, loadedBytes: 0, totalBytes: 0, error: null };
let tabStripRenderSignature = '';
let metricsFrame = null;
let lastChromeMetrics = { top: null, left: null };
let closePanels = () => {};
let closeExtensionActionsMenu = () => {};
const initializedPanels = new WeakSet();
const panelPaintTokens = new WeakMap();
const downloadItems = new Map();
let bookmarksStorageSnapshot = null;
let parsedBookmarks = [];
let aiSummaryRequestGeneration = 0;

const SEARCH_ENGINES = [
  { id: 'google', label: 'Google', searchUrl: 'https://www.google.com/search?q=', homeUrl: 'https://www.google.com/' },
  { id: 'bing', label: 'Bing', searchUrl: 'https://www.bing.com/search?q=', homeUrl: 'https://www.bing.com/' },
  { id: 'yahoo', label: 'Yahoo', searchUrl: 'https://search.yahoo.com/search?p=', homeUrl: 'https://www.yahoo.com/' },
  { id: 'duckduckgo', label: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=', homeUrl: 'https://duckduckgo.com/' },
  { id: 'brave', label: 'Brave', searchUrl: 'https://search.brave.com/search?q=', homeUrl: 'https://search.brave.com/' },
  { id: 'yandex', label: 'Yandex', searchUrl: 'https://yandex.com/search/?text=', homeUrl: 'https://yandex.com/' },
  { id: 'baidu', label: 'Baidu', searchUrl: 'https://www.baidu.com/s?wd=', homeUrl: 'https://www.baidu.com/' },
  { id: 'startpage', label: 'StartPage', searchUrl: 'https://www.startpage.com/do/search?q=', homeUrl: 'https://www.startpage.com/' },
  { id: 'naver', label: 'Naver', searchUrl: 'https://search.naver.com/search.naver?query=', homeUrl: 'https://www.naver.com/' }
];

const S_ENG = Object.fromEntries(SEARCH_ENGINES.map(({ id, searchUrl }) => [id, searchUrl]));
const S_HOME = Object.fromEntries(SEARCH_ENGINES.map(({ id, homeUrl }) => [id, homeUrl]));
const GROUP_COLORS = ['#0f6bff', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c'];

// Safe localStorage helpers to handle disabled/quota exceeded scenarios
function safeGetStorage(key, defaultValue = null) {
  try {
    return localStorage.getItem(key) || defaultValue;
  } catch (_error) {
    return defaultValue;
  }
}

function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_error) {
    return false;
  }
}

function safeRemoveStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch (_error) { }
}

const EXTENSION_PIN_STORAGE_KEY = 'browser-pinned-extensions';
const EXTENSION_ACTION_PARTITION = '_self';

function getBrowserActionBridge() {
  if (typeof window === 'undefined') return null;
  const bridge = window.browserAction;
  if (!bridge || typeof bridge.getState !== 'function' || typeof bridge.activate !== 'function') {
    return null;
  }
  return bridge;
}

function readPinnedExtensionIds() {
  try {
    const raw = safeGetStorage(EXTENSION_PIN_STORAGE_KEY, '[]');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value) => typeof value === 'string' && value.trim()));
  } catch (_error) {
    return new Set();
  }
}

function persistPinnedExtensionIds(ids) {
  return safeSetStorage(EXTENSION_PIN_STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

function getExtensionActionInfo(action, activeTabId) {
  const tabInfo = action && action.tabs && activeTabId != null
    ? action.tabs[String(activeTabId)] || action.tabs[activeTabId]
    : null;
  return {
    ...action,
    ...(tabInfo || {})
  };
}

function getExtensionActionIconUrl(action, activeTabId) {
  const info = getExtensionActionInfo(action, activeTabId);
  const searchParams = new URLSearchParams({
    tabId: `${activeTabId != null ? activeTabId : -1}`,
    partition: EXTENSION_ACTION_PARTITION
  });
  if (info && info.iconModified) {
    searchParams.append('t', info.iconModified);
  }
  return `crx://extension-icon/${action.id}/32/2?${searchParams.toString()}`;
}

function getExtensionActionLabel(action) {
  return action && typeof action.title === 'string' && action.title.trim()
    ? action.title.trim()
    : (action && action.id) || 'Extension';
}

function getExtensionActionLetter(action) {
  return getExtensionActionLabel(action).charAt(0).toUpperCase() || 'E';
}

function getExtensionActionAnchorRect(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function activateExtensionAction(action, eventType, anchorElement) {
  const bridge = getBrowserActionBridge();
  if (!bridge || !action || !action.id) return;
  const activeTabId = extensionActionState && typeof extensionActionState.activeTabId === 'number'
    ? extensionActionState.activeTabId
    : -1;
  const anchorRect = anchorElement ? getExtensionActionAnchorRect(anchorElement) : {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  };
  bridge.activate(EXTENSION_ACTION_PARTITION, {
    eventType,
    extensionId: action.id,
    tabId: activeTabId,
    alignment: 'bottom right',
    anchorRect
  });
}

function setExtensionActionsMenuOpen(open) {
  if (!extensionActionsMenu || !extensionActionsMenuBtn) return;
  extensionActionsMenu.hidden = !open;
  extensionActionsMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    ipcRenderer.send('toggle-browser-view', false);
  } else {
    ipcRenderer.send('toggle-browser-view', true);
  }
}

function closeExtensionActions() {
  setExtensionActionsMenuOpen(false);
}

function renderExtensionActionsMenu(actions, pinnedIds) {
  if (!extensionActionsMenuList) return;
  const fragment = document.createDocumentFragment();
  const activeTabId = extensionActionState && typeof extensionActionState.activeTabId === 'number'
    ? extensionActionState.activeTabId
    : -1;

  actions.forEach((action) => {
    const row = document.createElement('div');
    row.className = 'extension-action-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', getExtensionActionLabel(action));

    const icon = document.createElement('div');
    icon.className = 'extension-action-row-icon';
    icon.style.backgroundImage = `url("${getExtensionActionIconUrl(action, activeTabId)}")`;
    const iconImage = new Image();
    iconImage.onerror = () => {
      icon.classList.add('no-icon');
      icon.dataset.letter = getExtensionActionLetter(action);
    };
    iconImage.src = getExtensionActionIconUrl(action, activeTabId);

    const body = document.createElement('div');
    body.className = 'extension-action-row-body';
    const title = document.createElement('div');
    title.className = 'extension-action-row-title';
    title.textContent = getExtensionActionLabel(action);
    const subtitle = document.createElement('div');
    subtitle.className = 'extension-action-row-subtitle';
    subtitle.textContent = pinnedIds.has(action.id) ? t('toolbar.extensionsPinned') : t('toolbar.extensionsHidden');
    body.appendChild(title);
    body.appendChild(subtitle);

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'extension-action-pin-btn';
    pinBtn.textContent = pinnedIds.has(action.id) ? t('toolbar.unpinExtension') : t('toolbar.pinExtension');
    pinBtn.onclick = (event) => {
      event.stopPropagation();
      toggleExtensionPinned(action.id);
    };

    row.onclick = () => {
      activateExtensionAction(action, 'click', row);
      setExtensionActionsMenuOpen(false);
    };
    row.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        row.click();
      } else if (event.key === 'Escape') {
        setExtensionActionsMenuOpen(false);
      }
    };
    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(pinBtn);
    fragment.appendChild(row);
  });

  if (!actions.length) {
    const empty = document.createElement('div');
    empty.className = 'extension-actions-menu-note';
    empty.textContent = t('extension.empty');
    fragment.appendChild(empty);
  }

  extensionActionsMenuList.replaceChildren(fragment);
}

function renderExtensionActionToolbar() {
  if (!extensionActionList || !extensionActionsMenuList) return;
  const state = extensionActionState || { actions: [], activeTabId: -1 };
  const actions = Array.isArray(state.actions) ? state.actions : [];
  const pinnedIds = readPinnedExtensionIds();
  const pinnedActions = actions.filter((action) => pinnedIds.has(action.id));
  const pinnedFragment = document.createDocumentFragment();
  const activeTabId = typeof state.activeTabId === 'number' ? state.activeTabId : -1;

  pinnedActions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'extension-action-button';
    button.title = getExtensionActionLabel(action);
    button.setAttribute('aria-label', getExtensionActionLabel(action));
    button.style.backgroundImage = `url("${getExtensionActionIconUrl(action, activeTabId)}")`;
    const info = getExtensionActionInfo(action, activeTabId);
    if (info && info.text) {
      const badge = document.createElement('span');
      badge.className = 'extension-action-badge';
      badge.textContent = info.text;
      button.appendChild(badge);
    }
    const loadIconFallback = () => {
      button.classList.add('no-icon');
      button.dataset.letter = getExtensionActionLetter(action);
    };
    const probe = new Image();
    probe.onerror = loadIconFallback;
    probe.src = getExtensionActionIconUrl(action, activeTabId);
    button.onclick = () => activateExtensionAction(action, 'click', button);
    button.oncontextmenu = (event) => {
      event.preventDefault();
      activateExtensionAction(action, 'contextmenu', button);
    };
    pinnedFragment.appendChild(button);
  });

  extensionActionList.replaceChildren(pinnedFragment);
  extensionActionList.hidden = pinnedActions.length === 0;
  renderExtensionActionsMenu(actions, pinnedIds);
}

function toggleExtensionPinned(extensionId) {
  if (!extensionId) return;
  const pinnedIds = readPinnedExtensionIds();
  if (pinnedIds.has(extensionId)) {
    pinnedIds.delete(extensionId);
  } else {
    pinnedIds.add(extensionId);
  }
  persistPinnedExtensionIds(pinnedIds);
  renderExtensionActionToolbar();
}

async function refreshExtensionActionState() {
  const bridge = getBrowserActionBridge();
  if (!bridge) return;
  try {
    const state = await bridge.getState(EXTENSION_ACTION_PARTITION);
    extensionActionState = state || { actions: [], activeTabId: -1 };
    renderExtensionActionToolbar();
  } catch (error) {
    console.error('Failed to refresh extension actions:', error);
  }
}

function initExtensionActionToolbar() {
  extensionActionsMenuBtn = document.getElementById('extension-actions-menu-btn');
  extensionActionList = document.getElementById('extension-action-list');
  extensionActionsMenu = document.getElementById('extension-actions-menu');
  extensionActionsMenuList = document.getElementById('extension-actions-menu-list');
  const bridge = getBrowserActionBridge();

  if (!bridge || !extensionActionList || !extensionActionsMenuBtn || !extensionActionsMenu || !extensionActionsMenuList) {
    if (extensionActionList) extensionActionList.hidden = true;
    if (extensionActionsMenuBtn) extensionActionsMenuBtn.style.display = 'none';
    if (extensionActionsMenu) extensionActionsMenu.hidden = true;
    return;
  }

  extensionActionsMenuBtn.title = t('toolbar.extensionsMenuButton');
  extensionActionsMenuBtn.setAttribute('aria-label', t('toolbar.extensionsMenuButton'));
  extensionActionsMenuBtn.setAttribute('aria-expanded', 'false');
  extensionActionsMenuBtn.onclick = (event) => {
    event.stopPropagation();
    const nextOpen = extensionActionsMenu.hidden;
    setExtensionActionsMenuOpen(nextOpen);
    if (nextOpen) {
      void refreshExtensionActionState();
    }
  };

  document.addEventListener('click', (event) => {
    if (extensionActionsMenu.hidden) return;
    if (event.target && typeof event.target.closest === 'function' && event.target.closest('#extension-action-shell')) return;
    setExtensionActionsMenuOpen(false);
  });

  bridge.addEventListener('update', refreshExtensionActionState);
  bridge.addObserver(EXTENSION_ACTION_PARTITION);

  closeExtensionActionsMenu = closeExtensionActions;
  void refreshExtensionActionState();
}

async function resolveShowSecondsSetting() {
  const storedValue = safeGetStorage('show-seconds', null);
  const storedBool = storedValue === 'true';

  try {
    const settings = await ipcRenderer.invoke('get-browser-settings');
    if (settings && typeof settings.showSeconds === 'boolean') {
      return settings.showSeconds;
    }

    if (storedValue != null) {
      await ipcRenderer.invoke('set-browser-settings', { showSeconds: storedBool });
    }
  } catch (_error) {
    // Fall back to the local setting when the shared browser setting store is unavailable.
  }

  return storedBool;
}

function t(key, vars = {}) {
  return localization.t(currentLocale, key, getUiTextVars(vars));
}

function getBrowserUiPlatform() {
  if (typeof navigator === 'undefined') return localization.normalizeUiPlatform('');

  const candidates = [];
  try {
    if (navigator.userAgentData && typeof navigator.userAgentData.platform === 'string') {
      candidates.push(navigator.userAgentData.platform);
    }
  } catch (_error) {}
  if (typeof navigator.platform === 'string') candidates.push(navigator.platform);
  if (typeof navigator.userAgent === 'string') candidates.push(navigator.userAgent);

  const platformCandidate = candidates.find((value) => typeof value === 'string' && value.trim());
  return localization.normalizeUiPlatform(platformCandidate || '');
}

function getUiTextVars(vars = {}) {
  return {
    ...localization.getUiPlatformText(currentLocale, currentPlatform),
    ...vars
  };
}

function setLocale(locale) {
  currentLocale = localization.resolveLocale(locale);
  document.documentElement.lang = currentLocale;
}

async function ensureLocaleLoaded(locale) {
  if (!localization || typeof localization.loadLocale !== 'function') return;
  try {
    await localization.loadLocale(locale);
  } catch (_error) { }
}

function applyStaticTranslations(root = document) {
  const translatedElements = (selector) => Array.from(root.querySelectorAll(selector));
  translatedElements('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  translatedElements('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  translatedElements('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });
  translatedElements('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  if (root === document) document.title = t('app.name');
  if (extensionActionsMenuBtn) {
    const label = t('toolbar.extensionsMenuButton');
    extensionActionsMenuBtn.title = label;
    extensionActionsMenuBtn.setAttribute('aria-label', label);
  }
}

function isPanelInitialized(panel) {
  return !!panel && initializedPanels.has(panel);
}

function refreshDeferredPanelReferences(panel) {
  if (!panel) return;
  switch (panel.id) {
    case 'history-sidebar':
      historyList = panel.querySelector('#history-list');
      break;
    case 'bookmarks-sidebar':
      bookmarksList = panel.querySelector('#bookmarks-list');
      break;
    case 'downloads-sidebar':
      downloadsList = panel.querySelector('#downloads-list');
      break;
    case 'ai-summary-sidebar':
      aiSummaryContent = panel.querySelector('#ai-summary-content');
      break;
    case 'settings-sidebar':
      profileColorPicker = panel.querySelector('#profile-color-picker');
      settingsLanguagePicker = panel.querySelector('#settings-language-picker');
      checkUpdatesBtn = panel.querySelector('#check-updates-btn');
      versionEl = panel.querySelector('#app-version');
      updateStatusEl = panel.querySelector('#update-status');
      openExtensionsBtn = panel.querySelector('#open-extensions-btn');
      break;
    default:
      break;
  }
}

function mountDeferredPanel(panel) {
  if (!panel || panel.dataset.mounted === 'true') return false;
  const template = Array.from(panel.children).find((child) => (
    child.tagName === 'TEMPLATE' && child.hasAttribute('data-panel-template')
  ));
  if (template) {
    panel.appendChild(template.content.cloneNode(true));
    template.remove();
  }
  refreshDeferredPanelReferences(panel);
  panel.dataset.mounted = 'true';
  return true;
}

function ensurePanelInitialized(panel, initializer) {
  if (!panel || initializedPanels.has(panel)) return false;
  mountDeferredPanel(panel);
  if (typeof initializer === 'function') initializer();
  applyStaticTranslations(panel);
  initializedPanels.add(panel);
  panel.dataset.initialized = 'true';
  return true;
}

function cancelPanelPaintSignal(panel) {
  if (!panel) return;
  panelPaintTokens.set(panel, (panelPaintTokens.get(panel) || 0) + 1);
  delete panel.dataset.orionPanelReady;
  if (document.documentElement.dataset.orionPanelReady === panel.id) {
    delete document.documentElement.dataset.orionPanelReady;
  }
}

function signalPanelPaintReady(panel) {
  if (!panel || !isPanelInitialized(panel)) return;
  const token = (panelPaintTokens.get(panel) || 0) + 1;
  panelPaintTokens.set(panel, token);
  panel.dataset.orionPanelReady = 'pending';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (panelPaintTokens.get(panel) !== token || !panel.classList.contains('open')) return;
      panel.dataset.orionPanelReady = 'true';
      document.documentElement.dataset.orionPanelReady = panel.id;
      if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(`orion-panel-ready:${panel.id}`);
      }
    });
  });
}

function getDisplayProfileName(profile) {
  if (!profile) return '';
  if (localization.isGeneratedProfileName(profile.name, profile.id)) {
    return localization.getProfileName(currentLocale, profile.id);
  }
  return profile.name;
}

function updateDynamicTranslationContent() {
  if (settingsSidebar && !isPanelInitialized(settingsSidebar)) return;
  const colorLabel = document.getElementById('custom-color-label');
  const colorInput = document.getElementById('custom-color-input');
  const applyBtn = document.getElementById('apply-custom-color');

  if (colorLabel) colorLabel.textContent = t('settings.colorPicker');
  if (colorInput) colorInput.setAttribute('placeholder', t('settings.colorPlaceholder'));
  if (applyBtn) applyBtn.textContent = t('settings.applyColor');
  if (discoModeBtn) discoModeBtn.textContent = discoInterval ? t('settings.stopDisco') : t('settings.discoMode');
  renderRamLimitControl();
  renderMemoryStatus();
}

function formatMemoryNumber(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return numeric.toLocaleString(localization.getIntlLocale(currentLocale), {
    maximumFractionDigits: 1
  });
}

function renderRamLimitControl() {
  const select = document.getElementById('ram-limit-select');
  const automaticOption = document.getElementById('ram-limit-automatic-option');
  if (!select || !automaticOption) return;

  const automaticLimitMb = Number.isInteger(ramLimitSettings.automaticLimitMb)
    ? ramLimitSettings.automaticLimitMb
    : 0;
  automaticOption.textContent = automaticLimitMb > 0
    ? t('settings.ramAutomatic', { limit: formatMemoryNumber(automaticLimitMb / 1024) })
    : t('settings.ramAutomaticUnavailable');
  automaticOption.disabled = automaticLimitMb <= 0 && ramLimitSettings.mode !== 'automatic';
  select.value = ramLimitSettings.mode;
}

function renderMemoryStatus() {
  if (settingsSidebar && !isPanelInitialized(settingsSidebar)) return;
  const usageEl = document.getElementById('memory-usage-status');
  const unloadedEl = document.getElementById('memory-unloaded-status');
  if (!usageEl || !unloadedEl) return;

  if (!memoryStatus || memoryStatus.supported === false || !Number.isFinite(memoryStatus.usedMb)) {
    usageEl.textContent = t('settings.ramUnavailable');
  } else if (memoryStatus.enabled && memoryStatus.limitMb > 0) {
    usageEl.textContent = t('settings.ramUsageWithLimit', {
      used: formatMemoryNumber(memoryStatus.usedMb),
      limit: formatMemoryNumber(memoryStatus.limitMb / 1024)
    });
  } else {
    usageEl.textContent = t('settings.ramUsageNoLimit', {
      used: formatMemoryNumber(memoryStatus.usedMb)
    });
  }

  const count = Number.isFinite(memoryStatus && memoryStatus.unloadedTabCount)
    ? Math.max(0, Math.floor(memoryStatus.unloadedTabCount))
    : 0;
  unloadedEl.textContent = t(count === 1 ? 'settings.ramUnloadedTab' : 'settings.ramUnloadedTabs', { count });
  const card = usageEl.closest('.memory-status-card');
  if (card) card.classList.toggle('over-limit', !!(memoryStatus && memoryStatus.overLimit));
}

function applyMemoryStatus(status) {
  if (!status || typeof status !== 'object') return;
  memoryStatus = { ...memoryStatus, ...status };
  renderMemoryStatus();
}

function initializeSettingsStateListeners() {
  if (settingsStateListenersInitialized) return;
  settingsStateListenersInitialized = true;
  ipcRenderer.on('browser-settings-changed', (_event, settings) => {
    if (!settings || typeof settings !== 'object') return;
    cachedBrowserSettings = { ...cachedBrowserSettings, ...settings };
    if (typeof applyMountedBrowserSettings === 'function') {
      applyMountedBrowserSettings(cachedBrowserSettings);
    }
  });
  ipcRenderer.on('memory-status-changed', (_event, status) => {
    applyMemoryStatus(status);
  });
  ipcRenderer.on('ai-model-status-changed', (_event, status) => {
    applyAiModelStatus(status);
  });
}

function initializeExtensionToolbarOnce() {
  if (extensionToolbarInitialized) return;
  extensionToolbarInitialized = true;
  document.documentElement.dataset.extensionsReady = 'true';
  initExtensionActionToolbar();
}

function renderAiModelStatus() {
  if (!aiModelStatusEl) return;
  const state = aiModelStatus && aiModelStatus.state ? aiModelStatus.state : 'missing';
  const statusText = state === 'ready'
    ? t('settings.aiReady')
    : state === 'downloading'
      ? t('aiSummary.downloading')
      : state === 'error'
        ? (aiModelStatus.error || t('settings.aiError'))
        : t('settings.aiMissing');
  aiModelStatusEl.textContent = statusText;

  if (aiModelProgressContainer) {
    const showProgress = state === 'downloading' && Number.isFinite(aiModelStatus.progress);
    aiModelProgressContainer.style.display = showProgress ? 'block' : 'none';
  }
  if (aiModelProgressBar) {
    const progressValue = Math.max(0, Math.min(100, Number(aiModelStatus.progress) || 0));
    aiModelProgressBar.style.width = `${progressValue}%`;
  }
  if (aiModelProgressText) {
    const progressValue = Math.max(0, Math.min(100, Number(aiModelStatus.progress) || 0));
    aiModelProgressText.textContent = `${Math.round(progressValue)}%`;
  }
  if (removeAiModelBtn) {
    removeAiModelBtn.style.display = state === 'ready' || state === 'error' ? 'inline-flex' : 'none';
  }
  if (redownloadAiModelBtn) {
    redownloadAiModelBtn.style.display = state === 'error' || state === 'missing' ? 'inline-flex' : 'none';
  }
}

function applyAiModelStatus(status) {
  if (!status || typeof status !== 'object') return;
  aiModelStatus = { ...aiModelStatus, ...status };
  renderAiModelStatus();
}

function renderManagedExtensionStatus() {
  if (!managedExtensionOverlay || isIncognitoWindow) {
    if (managedExtensionOverlay) managedExtensionOverlay.classList.remove('show');
    return;
  }
  const status = managedExtensionStatus || { state: 'installing', error: '' };
  const ready = status.state === 'ready';
  const failed = status.state === 'error';
  managedExtensionOverlay.classList.toggle('show', !ready);
  managedExtensionOverlay.dataset.state = failed ? 'error' : 'installing';
  document.body.classList.toggle('managed-extension-blocked', !ready);
  if (managedExtensionTitle) {
    managedExtensionTitle.textContent = t(failed ? 'managedExtension.errorTitle' : 'managedExtension.installingTitle');
  }
  if (managedExtensionBody) {
    managedExtensionBody.textContent = t(failed ? 'managedExtension.errorBody' : 'managedExtension.installingBody');
  }
  if (managedExtensionError) {
    managedExtensionError.hidden = !failed || !status.error;
    managedExtensionError.textContent = failed ? (status.error || '') : '';
  }
  if (managedExtensionRetry) {
    managedExtensionRetry.hidden = !failed;
    managedExtensionRetry.disabled = false;
    managedExtensionRetry.textContent = t('managedExtension.retry');
  }
  if (ready) initializeExtensionToolbarOnce();
}

function isReaderActiveTab() {
  const tab = tabs.find((entry) => entry && entry.id === activeTabId);
  return !!(tab && tab.readerMode);
}

function updateReaderButtonState() {
  if (!readerBtn) return;
  const active = isReaderActiveTab();
  const state = appUtils.getReaderButtonState(active, (key) => t(key));
  readerBtn.classList.toggle('reader-active', active);
  readerBtn.setAttribute('aria-pressed', state.ariaPressed);
  readerBtn.setAttribute('aria-label', state.ariaLabel);
  readerBtn.title = state.title;
}

function updateReaderShellState() {
  document.body.classList.toggle('reader-mode', isReaderActiveTab());
  updateReaderButtonState();
}

let readerToastTimer = null;
function showReaderToast(message) {
  if (!readerToast) return;
  readerToast.textContent = message;
  readerToast.hidden = false;
  readerToast.classList.add('show');
  if (readerToastTimer) clearTimeout(readerToastTimer);
  readerToastTimer = window.setTimeout(() => {
    readerToast.classList.remove('show');
    readerToast.hidden = true;
  }, 2600);
}

function renderAiSummaryLoading() {
  if (!aiSummaryContent) return;
  aiSummaryContent.innerHTML = `<div class="ai-summary-card ai-summary-muted">${t('aiSummary.loading')}</div>`;
}

function renderAiSummary(summary) {
  if (!aiSummaryContent) return;
  aiSummaryContent.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'ai-summary-card';
  if (!summary || !summary.ok) {
    card.classList.add('ai-summary-muted');
    card.textContent = summary && summary.reason ? summary.reason : t('aiSummary.unavailable');
    aiSummaryContent.appendChild(card);
    return;
  }

  const title = document.createElement('h3');
  title.textContent = summary.title || t('aiSummary.untitled');
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'ai-summary-meta';
  const source = summary.siteName || summary.sourceUrl || t('aiSummary.localOnly');
  const minutes = summary.readingTimeMinutes || 1;
  const modeLabel = summary.mode === 'fallback' ? t('aiSummary.fallback') : t('aiSummary.localOnly');
  meta.textContent = `${source} · ${modeLabel} · ${t('aiSummary.readingTime', { minutes })}`;
  card.appendChild(meta);

  const paragraph = document.createElement('p');
  paragraph.className = 'ai-summary-paragraph';
  paragraph.textContent = summary.summary || '';
  card.appendChild(paragraph);
  aiSummaryContent.appendChild(card);
}

function invalidateAiSummaryRequest(options = {}) {
  aiSummaryRequestGeneration += 1;
  if (options.closePanel && aiSummarySidebar && aiSummarySidebar.classList.contains('open')) {
    closePanels();
  }
}

async function openAiSummaryPanel(togglePanel) {
  if (!aiSummarySidebar) return;
  const requestGeneration = ++aiSummaryRequestGeneration;
  const requestedTabId = activeTabId;
  const requestedProfile = activeProfile;
  ensurePanelInitialized(aiSummarySidebar);
  togglePanel(aiSummarySidebar, true);
  renderAiSummaryLoading();
  try {
    const summary = await ipcRenderer.invoke('summarize-active-page');
    if (
      requestGeneration !== aiSummaryRequestGeneration ||
      requestedTabId !== activeTabId ||
      requestedProfile !== activeProfile ||
      !aiSummarySidebar.classList.contains('open')
    ) return;
    renderAiSummary(summary);
  } catch (error) {
    if (
      requestGeneration !== aiSummaryRequestGeneration ||
      requestedTabId !== activeTabId ||
      requestedProfile !== activeProfile ||
      !aiSummarySidebar.classList.contains('open')
    ) return;
    renderAiSummary({
      ok: false,
      reason: error && error.message ? error.message : t('aiSummary.unavailable')
    });
  }
}

function renderLanguageButtons(container, finishOnboarding) {
  if (!container) return;
  container.innerHTML = '';
  localization.getLanguageOptions().forEach(({ locale, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `language-choice-btn ${locale === currentLocale ? 'active' : ''}`;
    button.textContent = label;
    button.onclick = () => changeLanguage(locale, { finishOnboarding });
    container.appendChild(button);
  });
}

function refreshLanguageButtons() {
  renderLanguageButtons(startupLanguagePicker, true);
  if (isPanelInitialized(settingsSidebar)) renderLanguageButtons(settingsLanguagePicker, false);
}

function applyTranslations() {
  applyStaticTranslations();
  updateDynamicTranslationContent();
  refreshLanguageButtons();
  if (isPanelInitialized(settingsSidebar)) renderUpdaterState();
  renderProfileList();
  if (isPanelInitialized(bookmarksSidebar)) renderBookmarks();
  renderBookmarksBar();
  renderManagedExtensionStatus();
  updateReaderButtonState();
  if (findResults && findResults.textContent === '0/0') findResults.textContent = t('find.empty');
}

function showStartupOverlay() {
  if (!startupOverlay) return;
  startupOverlay.classList.add('show');
  document.body.classList.add('onboarding-active');
}

function hideStartupOverlay() {
  if (!startupOverlay) return;
  startupOverlay.classList.remove('show');
  document.body.classList.remove('onboarding-active');
}

function getStoredLocale() {
  try {
    return localization.sanitizeLocale(safeGetStorage('orion-locale'));
  } catch (_error) {
    return null;
  }
}

async function changeLanguage(locale, options = {}) {
  const nextLocale = localization.sanitizeLocale(locale);
  if (!nextLocale) return;

  let appliedLocale = nextLocale;
  try {
    const response = await ipcRenderer.invoke('set-language', nextLocale);
    appliedLocale = response && response.locale ? response.locale : nextLocale;
  } catch (_error) { }
  await ensureLocaleLoaded(appliedLocale);
  setLocale(appliedLocale);

  try {
    safeSetStorage('orion-locale', currentLocale);
  } catch (_error) { }

  applyTranslations();

  if (options.finishOnboarding) {
    hideStartupOverlay();
  }
}

function normalizeTabUrl(url) {
  return appUtils.normalizeInternalUrl(url, url || "");
}

function syncTabState(tabLike = {}) {
  if (!tabLike.id) return null;

  const nextTab = { id: tabLike.id };
  if (Object.prototype.hasOwnProperty.call(tabLike, 'url')) nextTab.url = normalizeTabUrl(tabLike.url);
  if (Object.prototype.hasOwnProperty.call(tabLike, 'title')) nextTab.title = tabLike.title;
  if (Object.prototype.hasOwnProperty.call(tabLike, 'incognito')) nextTab.incognito = tabLike.incognito;
  if (Object.prototype.hasOwnProperty.call(tabLike, 'readerMode')) nextTab.readerMode = tabLike.readerMode;
  if (Object.prototype.hasOwnProperty.call(tabLike, 'groupId')) nextTab.groupId = tabLike.groupId;

  return appUtils.upsertTabRecord(tabs, nextTab);
}

function normalizeBootstrapTab(tabLike = {}) {
  if (!tabLike || !tabLike.id) return null;
  return {
    id: tabLike.id,
    url: normalizeTabUrl(tabLike.url || 'chrome://newtab') || 'chrome://newtab',
    title: tabLike.title || t('app.newTab'),
    incognito: !!tabLike.incognito,
    readerMode: !!tabLike.readerMode,
    groupId: typeof tabLike.groupId === 'string' ? tabLike.groupId : undefined
  };
}

function normalizeTabGroup(groupLike = {}, index = 0) {
  if (!groupLike || !groupLike.id) return null;
  return {
    id: groupLike.id,
    name: groupLike.name || `Group ${index + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(groupLike.color || '') ? groupLike.color : GROUP_COLORS[index % GROUP_COLORS.length],
    collapsed: !!groupLike.collapsed,
    createdAt: Number.isFinite(groupLike.createdAt) ? groupLike.createdAt : Date.now()
  };
}

function setTabGroups(nextGroups) {
  tabGroups = Array.isArray(nextGroups)
    ? nextGroups.map(normalizeTabGroup).filter(Boolean)
    : [];
}

function hydrateFromBootstrapState(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;

  if (typeof snapshot.profileIndex === 'number') activeProfile = snapshot.profileIndex;
  isIncognitoWindow = !!snapshot.incognitoWindow;
  document.body.classList.toggle('incognito-window', isIncognitoWindow);

  if (Array.isArray(snapshot.profiles)) {
    profiles = snapshot.profiles
      .map((profile) => ({
        id: Number(profile.id),
        name: profile && profile.name ? profile.name : ''
      }))
      .filter((profile) => Number.isFinite(profile.id));
  }

  const bootstrapTabs = Array.isArray(snapshot.tabs)
    ? snapshot.tabs.map(normalizeBootstrapTab).filter(Boolean)
    : [];
  setTabGroups(snapshot.groups);
  if (bootstrapTabs.length) {
    tabs = [];
    bootstrapTabs.forEach((tabLike) => {
      tabs.push({
        id: tabLike.id,
        url: normalizeTabUrl(tabLike.url || 'chrome://newtab') || 'chrome://newtab',
        title: tabLike.title || localization.t(currentLocale, 'app.loading'),
        incognito: !!tabLike.incognito,
        readerMode: !!tabLike.readerMode,
        groupId: tabLike.groupId
      });
    });
    const fallbackActiveId = bootstrapTabs[0].id;
    let nextActiveId = typeof snapshot.activeTabId === 'string' ? snapshot.activeTabId : fallbackActiveId;
    if (!tabs.find((tab) => tab.id === nextActiveId)) nextActiveId = fallbackActiveId;
    activeTabId = nextActiveId;
  } else if (addressBar) {
    addressBar.value = '';
  }
}

function getUpdateButtonText(state) {
  switch (state) {
    case 'checking':
      return t('updates.checking');
    case 'available':
    case 'downloading':
      return t('updates.downloading');
    case 'downloaded':
      return t('updates.restart');
    case 'update-not-available':
      return t('updates.uptodate');
    case 'installing':
      return t('updates.restarting');
    default:
      return t('settings.checkUpdates');
  }
}

function getUpdateStatusText(status) {
  const state = status && status.state ? status.state : 'idle';
  switch (state) {
    case 'checking':
      return t('updates.checking');
    case 'available':
    case 'downloading':
      return t('updates.downloading');
    case 'downloaded':
      return t('updates.restart');
    case 'update-not-available':
      return t('updates.uptodate');
    case 'installing':
      return t('updates.restarting');
    case 'error':
    case 'unsupported':
      return status && status.message ? status.message : t('updates.ready');
    default:
      return t('updates.ready');
  }
}

function renderUpdaterState() {
  const state = updaterState && updaterState.state ? updaterState.state : 'idle';
  if (checkUpdatesBtn) {
    checkUpdatesBtn.textContent = getUpdateButtonText(state);
    checkUpdatesBtn.disabled = ['checking', 'available', 'downloading', 'installing'].includes(state);
  }
  if (updateStatusEl) updateStatusEl.textContent = getUpdateStatusText(updaterState);
}

function initializeSettingsPanelActions() {
  if (versionEl && bootstrapSnapshot.version) versionEl.textContent = `v${bootstrapSnapshot.version}`;
  if (removeAiModelBtn) {
    removeAiModelBtn.onclick = async () => {
      try {
        await ipcRenderer.invoke('remove-ai-model');
      } catch (error) {
        console.error(error);
      }
    };
  }
  if (redownloadAiModelBtn) {
    redownloadAiModelBtn.onclick = async () => {
      try {
        await ipcRenderer.invoke('cancel-ai-model-download');
        await ipcRenderer.invoke('get-ai-model-status');
      } catch (error) {
        console.error(error);
      }
    };
  }
  if (checkUpdatesBtn) {
    checkUpdatesBtn.onclick = async () => {
      try {
        const nextState = await ipcRenderer.invoke('check-for-updates');
        if (nextState) updaterState = { ...updaterState, ...nextState };
      } catch (error) {
        updaterState = {
          state: 'error',
          message: error && error.message ? error.message : 'Unable to check for updates.'
        };
      }
      renderUpdaterState();
    };
  }
  if (openExtensionsBtn) {
    openExtensionsBtn.onclick = () => {
      closePanels();
      ipcRenderer.invoke('navigate-to', 'chrome://extensions');
    };
  }
}

function applyColor(c, options = {}) {
  const custom = { 'emerald green': '#50c878', 'emerald': '#50c878', 'turquoise': '#40E0D0' };
  const color = custom[c.toLowerCase()] || c;
  const temp = document.createElement('div');
  temp.style.color = color;
  document.body.appendChild(temp);
  const rgb = getComputedStyle(temp).color;
  document.body.removeChild(temp);
  const match = rgb.match(/\d+/g);
  if (!match) return;
  const [r, g, b] = match;
  if (options.notifyMain !== false) ipcRenderer.send('apply-browser-color', color);
  if (options.persistLocal !== false) safeSetStorage('browser-theme-color', color);
  const bright = (r * 299 + g * 587 + b * 114) / 1000;
  const dark = bright < 128;
  const primary = dark ? '#f4f8ff' : '#10213a';
  const secondary = dark ? '#9bb3d1' : '#5f728c';
  document.body.style.setProperty('--bg-color', color);
  document.body.style.setProperty('--glass-bg', `rgba(${r},${g},${b},0.9)`);
  document.body.style.setProperty('--text-primary', primary);
  document.body.style.setProperty('--text-secondary', secondary);
  document.body.style.setProperty('--text-color', primary);
  document.body.style.setProperty('--tab-inactive-bg', dark ? color : `rgba(${r},${g},${b},0.8)`);
  document.body.style.setProperty('--sidebar-bg', `rgba(${r},${g},${b},0.9)`);
}

function init(snapshot = {}) {
  bootstrapSnapshot = snapshot || {};
  cachedBrowserSettings = { ...(bootstrapSnapshot.browserSettings || {}) };
  initializeSettingsStateListeners();
  window.__orionBootstrapSnapshot = bootstrapSnapshot;
  window.__orionStartupPerformance = bootstrapSnapshot.startupPerformance || null;
  tabBar = document.getElementById('tab-bar');
  newTabBtn = document.getElementById('new-tab-btn');
  groupTabsBtn = document.getElementById('group-tabs-btn');
  groupTabsMenu = document.getElementById('group-tabs-menu');
  addressBar = document.getElementById('address-bar');
  backBtn = document.getElementById('back-btn');
  forwardBtn = document.getElementById('forward-btn');
  reloadBtn = document.getElementById('reload-btn');
  readerBtn = document.getElementById('reader-btn');
  aiSummaryBtn = document.getElementById('ai-summary-btn');
  aiSummarySidebar = document.getElementById('ai-summary-sidebar');
  closeAiSummaryBtn = document.getElementById('close-ai-summary');
  aiSummaryContent = document.getElementById('ai-summary-content');
  historyBtn = document.getElementById('history-btn');
  historySidebar = document.getElementById('history-sidebar');
  closeHistoryBtn = document.getElementById('close-history');
  historyList = document.getElementById('history-list');
  chromeContainer = document.getElementById('chrome-container');
  profileBtn = document.getElementById('profile-btn');
  profileMenu = document.getElementById('profile-menu');
  profileListContainer = document.getElementById('profile-list-container');
  addProfileBtn = document.getElementById('add-profile-btn');
  settingsBtn = document.getElementById('settings-btn');
  settingsSidebar = document.getElementById('settings-sidebar');
  closeSettingsBtn = document.getElementById('close-settings');
  profileColorPicker = document.getElementById('profile-color-picker');
  bookmarkBtn = document.getElementById('bookmark-btn');
  bookmarksSidebar = document.getElementById('bookmarks-sidebar');
  closeBookmarksBtn = document.getElementById('close-bookmarks');
  bookmarksList = document.getElementById('bookmarks-list');
  addBookmarkBtn = document.getElementById('add-bookmark-btn');
  progressBarContainer = document.getElementById('progress-bar-container');
  progressBar = document.getElementById('progress-bar');
  clearTabsBtn = document.getElementById('clear-tabs-btn');
  openExtensionsBtn = document.getElementById('open-extensions-btn');
  downloadsBtn = document.getElementById('downloads-btn');
  downloadsSidebar = document.getElementById('downloads-sidebar');
  closeDownloadsBtn = document.getElementById('close-downloads');
  downloadsList = document.getElementById('downloads-list');
  findBar = document.getElementById('find-bar');
  findInput = document.getElementById('find-input');
  findResults = document.getElementById('find-results');
  findPrev = document.getElementById('find-prev');
  findNext = document.getElementById('find-next');
  findClose = document.getElementById('find-close');
  bookmarksBar = document.getElementById('bookmarks-bar');
  bookmarkDestModal = document.getElementById('bookmark-dest-modal');
  addToBarBtn = document.getElementById('add-to-bar-btn');
  addToNewTabBtn = document.getElementById('add-to-newtab-btn');
  addToBothBtn = document.getElementById('add-to-both-btn');
  cancelBookmarkBtn = document.getElementById('cancel-bookmark-btn');
  renameModal = document.getElementById('rename-modal');
  renameInput = document.getElementById('rename-input');
  renameSaveBtn = document.getElementById('rename-save-btn');
  renameCancelBtn = document.getElementById('rename-cancel-btn');
  checkUpdatesBtn = document.getElementById('check-updates-btn');
  versionEl = document.getElementById('app-version');
  updateStatusEl = document.getElementById('update-status');
  startupOverlay = document.getElementById('startup-overlay');
  startupLanguagePicker = document.getElementById('startup-language-picker');
  settingsLanguagePicker = document.getElementById('settings-language-picker');
  readerToast = document.getElementById('reader-toast');
  managedExtensionOverlay = document.getElementById('managed-extension-overlay');
  managedExtensionTitle = document.getElementById('managed-extension-title');
  managedExtensionBody = document.getElementById('managed-extension-body');
  managedExtensionError = document.getElementById('managed-extension-error');
  managedExtensionRetry = document.getElementById('managed-extension-retry');
  aiModelStatusEl = document.getElementById('ai-model-status');
  aiModelProgressContainer = document.getElementById('ai-model-progress-container');
  aiModelProgressBar = document.getElementById('ai-model-progress-bar');
  aiModelProgressText = document.getElementById('ai-model-progress-text');
  removeAiModelBtn = document.getElementById('remove-ai-model-btn');
  redownloadAiModelBtn = document.getElementById('redownload-ai-model-btn');
  managedExtensionStatus = bootstrapSnapshot.managedExtensionStatus || null;

  if (bootstrapSnapshot.updaterState) {
    updaterState = { ...updaterState, ...bootstrapSnapshot.updaterState };
  }
  if (bootstrapSnapshot.memoryStatus) applyMemoryStatus(bootstrapSnapshot.memoryStatus);
  if (bootstrapSnapshot.aiModelStatus) applyAiModelStatus(bootstrapSnapshot.aiModelStatus);

  const sidebars = [historySidebar, settingsSidebar, bookmarksSidebar, downloadsSidebar, aiSummarySidebar].filter(Boolean);
  const toggle = (s, v) => {
    if (
      aiSummarySidebar &&
      aiSummarySidebar.classList.contains('open') &&
      (s !== aiSummarySidebar || v === false)
    ) invalidateAiSummaryRequest();
    sidebars.forEach((p) => {
      if (p !== s) {
        p.classList.remove('open');
        cancelPanelPaintSignal(p);
      }
    });
    if (s) {
      s.classList.toggle('open', v);
      if (s.classList.contains('open')) signalPanelPaintReady(s);
      else cancelPanelPaintSignal(s);
    }
    const hasOpen = sidebars.some((p) => p.classList.contains('open'));
    closeExtensionActionsMenu();
    ipcRenderer.send('toggle-browser-view', !hasOpen);
    if (hasOpen && findBar) {
      findBar.style.display = 'none';
      ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
    }
  };
  closePanels = () => toggle(null, false);
  if (managedExtensionRetry) {
    managedExtensionRetry.onclick = async () => {
      managedExtensionRetry.disabled = true;
      managedExtensionStatus = { ...(managedExtensionStatus || {}), state: 'installing', error: '' };
      renderManagedExtensionStatus();
      try {
        managedExtensionStatus = await ipcRenderer.invoke('retry-managed-extension-install');
      } catch (error) {
        managedExtensionStatus = {
          ...(managedExtensionStatus || {}),
          state: 'error',
          error: error && error.message ? error.message : String(error)
        };
      }
      renderManagedExtensionStatus();
    };
  }
  ipcRenderer.on('managed-extension-status-changed', (_event, status) => {
    if (!status || status.profileId !== activeProfile) return;
    managedExtensionStatus = status;
    renderManagedExtensionStatus();
  });

  const updateChromeMetrics = () => {
    metricsFrame = null;
    const chromeHeight = Math.ceil(chromeContainer.getBoundingClientRect().height);
    const barHeight = bookmarksBar && window.getComputedStyle(bookmarksBar).display !== 'none' ? Math.ceil(bookmarksBar.getBoundingClientRect().height) : 0;
    const top = chromeHeight + barHeight;
    const left = document.body.classList.contains('vertical-tabs') ? 240 : 0;
    if (lastChromeMetrics.top === top && lastChromeMetrics.left === left) return;
    lastChromeMetrics = { top, left };
    document.documentElement.style.setProperty('--chrome-top', `${top}px`);
    ipcRenderer.send('set-chrome-metrics', { top, left });
  };

  metrics = () => {
    if (metricsFrame) return;
    metricsFrame = window.requestAnimationFrame(updateChromeMetrics);
  };

  window.addEventListener('resize', metrics);
  if (typeof ResizeObserver === 'function') {
    const chromeMetricsObserver = new ResizeObserver(metrics);
    chromeMetricsObserver.observe(chromeContainer);
    if (bookmarksBar) chromeMetricsObserver.observe(bookmarksBar);
  }
  metrics();

  const bootstrapColor = bootstrapSnapshot.browserSettings && bootstrapSnapshot.browserSettings.themeColor;
  const savedColor = safeGetStorage('browser-theme-color');
  const initialColor = savedColor || bootstrapColor;
  if (initialColor) {
    applyColor(initialColor, {
      notifyMain: !!savedColor && savedColor !== bootstrapColor,
      persistLocal: false
    });
  }

  if (addressBar) {
    addressBar.onkeydown = (e) => {
      if (e.key === 'Enter') {
        let url = addressBar.value.trim();
        if (url && !url.includes('.') && !url.includes('://')) {
          url = (S_ENG[safeGetStorage('default-search-engine', 'google')] || S_ENG.google) + encodeURIComponent(url);
        }
        const navigationIntentAt = performance.now();
        window.__orionLastNavigationDispatchPromise = ipcRenderer.invoke('navigate-to', {
          url,
          performanceIntentEpochMs: performance.timeOrigin + navigationIntentAt
        }).then(() => {
          const dispatchMs = performance.now() - navigationIntentAt;
          window.__orionLastNavigationDispatchMs = dispatchMs;
          return dispatchMs;
        });
        addressBar.blur();
      }
    };
  }
  if (clearTabsBtn) clearTabsBtn.onclick = () => {
    if (activeTabId) ipcRenderer.invoke('clear-other-tabs', activeTabId);
  };
  if (groupTabsBtn && groupTabsMenu) {
    groupTabsBtn.onclick = (event) => {
      event.stopPropagation();
      renderGroupTabsMenu();
      groupTabsMenu.classList.toggle('show');
    };
    groupTabsMenu.onclick = (event) => event.stopPropagation();
    document.addEventListener('click', () => {
      groupTabsMenu.classList.remove('show');
    });
  }
  if (backBtn) backBtn.onclick = () => ipcRenderer.invoke('go-back');
  if (forwardBtn) forwardBtn.onclick = () => ipcRenderer.invoke('go-forward');
  if (reloadBtn) reloadBtn.onclick = () => ipcRenderer.invoke('reload-page');
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) homeBtn.onclick = () => ipcRenderer.invoke('navigate-to', 'chrome://newtab');
  if (readerBtn) {
    readerBtn.onclick = () => ipcRenderer.invoke('toggle-reader-mode');
  }
  if (aiSummaryBtn) aiSummaryBtn.onclick = () => openAiSummaryPanel(toggle);
  if (closeAiSummaryBtn) closeAiSummaryBtn.onclick = () => toggle(aiSummarySidebar, false);
  if (newTabBtn) newTabBtn.onclick = () => {
    const performanceIntentEpochMs = performance.timeOrigin + performance.now();
    ipcRenderer.invoke('create-tab', {
      tabId: `p-${activeProfile}-t-${Date.now()}`,
      url: 'chrome://newtab',
      inc: isIncognitoWindow,
      performanceIntentEpochMs
    });
  };
  const incognitoTabBtn = document.getElementById('incognito-tab-btn');
  if (incognitoTabBtn) incognitoTabBtn.onclick = () => ipcRenderer.invoke('open-incognito-window', 'chrome://newtab');
  if (addBookmarkBtn) addBookmarkBtn.onclick = () => openBookmarkModal();

  const saveBm = (target) => {
    if (pendingBookmark) {
      saveBookmark(pendingBookmark.url, pendingBookmark.title, target);
      bookmarkDestModal.classList.remove('show');
      pendingBookmark = null;
    }
  };

  if (addToBarBtn) addToBarBtn.onclick = () => saveBm('bar');
  if (addToNewTabBtn) addToNewTabBtn.onclick = () => saveBm('newtab');
  if (addToBothBtn) addToBothBtn.onclick = () => saveBm('both');
  if (cancelBookmarkBtn) cancelBookmarkBtn.onclick = () => bookmarkDestModal.classList.remove('show');
  if (historyBtn) historyBtn.onclick = () => {
    ensurePanelInitialized(historySidebar);
    toggle(historySidebar, true);
    ipcRenderer.send('fetch-and-show-history');
  };
  if (closeHistoryBtn) closeHistoryBtn.onclick = () => toggle(historySidebar, false);
  ['all', 'hour', 'today', 'week'].forEach((r) => {
    const b = document.getElementById(`clear-history-${r}`);
    if (b) b.onclick = async () => {
      if (confirm(t(`history.confirm.${r}`))) {
        await ipcRenderer.invoke('clear-history-range', r);
        ipcRenderer.send('fetch-and-show-history');
      }
    };
  });
  if (profileBtn && profileMenu) profileBtn.onclick = (e) => {
    e.stopPropagation();
    const show = !profileMenu.classList.contains('show');
    profileMenu.classList.toggle('show', show);
    ipcRenderer.send('toggle-browser-view', !show);
  };
  if (profileMenu) {
    document.addEventListener('click', (event) => {
      if (profileMenu.classList.contains('show') && !event.target.closest('.profile-menu-wrap')) {
        profileMenu.classList.remove('show');
        ipcRenderer.send('toggle-browser-view', true);
      }
    });
  }
  if (addProfileBtn) addProfileBtn.onclick = async (e) => {
    e.stopPropagation();
    try {
      const profileIndex = await ipcRenderer.invoke('add-new-profile');
      if (typeof profileIndex === 'number') {
        await ipcRenderer.invoke('switch-profile', profileIndex);
      }
    } finally {
      profileMenu.classList.remove('show');
      ipcRenderer.send('toggle-browser-view', true);
    }
  };
  if (renameSaveBtn) renameSaveBtn.onclick = () => {
    const n = renameInput.value.trim();
    if (n && pendingRenameProfileId !== null) {
      ipcRenderer.send('rename-profile', { profileIndex: pendingRenameProfileId, newName: n });
      renameModal.classList.remove('show');
    }
  };
  if (renameCancelBtn) renameCancelBtn.onclick = () => renameModal.classList.remove('show');
  if (bookmarkBtn) bookmarkBtn.onclick = () => {
    const show = !bookmarksSidebar.classList.contains('open');
    if (show && ensurePanelInitialized(bookmarksSidebar)) renderBookmarks();
    toggle(bookmarksSidebar, show);
  };
  if (closeBookmarksBtn) closeBookmarksBtn.onclick = () => toggle(bookmarksSidebar, false);
  if (settingsBtn) settingsBtn.onclick = () => {
    const firstOpen = ensurePanelInitialized(settingsSidebar, () => {
      initSettings(cachedBrowserSettings, memoryStatus);
      initializeSettingsPanelActions();
    });
    if (firstOpen) {
      renderLanguageButtons(settingsLanguagePicker, false);
      renderUpdaterState();
      updateDynamicTranslationContent();
    }
    toggle(settingsSidebar, true);
    const hero = document.getElementById('settings-hero');
    const opened = safeGetStorage('settings-opened-once', 'false') === 'true';
    if (hero) {
      hero.style.display = opened ? 'none' : '';
      if (!opened) safeSetStorage('settings-opened-once', 'true');
    }
  };
  if (closeSettingsBtn) closeSettingsBtn.onclick = () => toggle(settingsSidebar, false);
  if (downloadsBtn) downloadsBtn.onclick = () => {
    const show = !downloadsSidebar.classList.contains('open');
    if (show && ensurePanelInitialized(downloadsSidebar)) renderDownloads();
    toggle(downloadsSidebar, show);
  };
  if (closeDownloadsBtn) closeDownloadsBtn.onclick = () => toggle(downloadsSidebar, false);
  if (findInput) {
    findInput.oninput = () => {
      const v = findInput.value.trim();
      if (v) ipcRenderer.invoke('find-in-page', v);
      else {
        ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
        if (findResults) findResults.textContent = t('find.empty');
      }
    };
    findInput.onkeydown = (e) => {
      if (e.key === 'Enter') ipcRenderer.invoke('find-in-page', findInput.value.trim(), { forward: !e.shiftKey, findNext: true });
      else if (e.key === 'Escape') {
        if (findBar) findBar.style.display = 'none';
        ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
      }
    };
  }
  if (findNext) findNext.onclick = () => ipcRenderer.invoke('find-in-page', findInput.value.trim(), { forward: true, findNext: true });
  if (findPrev) findPrev.onclick = () => ipcRenderer.invoke('find-in-page', findInput.value.trim(), { forward: false, findNext: true });
  if (findClose) findClose.onclick = () => {
    if (findBar) findBar.style.display = 'none';
    ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
  };
  ipcRenderer.on('extensions-ready', initializeExtensionToolbarOnce);
}

function initSettings(initialSettings = {}, initialMemoryStatus = null) {
  const colors = ['#e9e9f0', '#ffffff', '#f0f4f8', '#e3f2fd', '#e8f5e9', '#fff3e0', '#fce4ec', '#f3e5f5', '#202124', '#3c4043', '#E0115F'];
  if (!profileColorPicker) return;
  
  profileColorPicker.innerHTML = '';
  const pCon = document.createElement('div');
  pCon.className = 'color-picker';
  colors.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'color-option';
    d.style.backgroundColor = c;
    d.title = c;
    d.onclick = () => applyColor(c);
    pCon.appendChild(d);
  });
  profileColorPicker.appendChild(pCon);

  const sCon = document.createElement('div');
  sCon.className = 'settings-color-controls';
  sCon.innerHTML = `<div class="settings-color-row"><span class="settings-label" id="custom-color-label"></span><input type="color" id="custom-color-wheel" class="settings-color-wheel" value="#ffffff"></div><div class="settings-color-row"><input type="text" id="custom-color-input" class="settings-input"><button id="apply-custom-color" class="settings-btn settings-btn-secondary"></button></div>`;
  profileColorPicker.appendChild(sCon);

  const wheel = sCon.querySelector('#custom-color-wheel');
  const text = sCon.querySelector('#custom-color-input');
  const btn = sCon.querySelector('#apply-custom-color');
  wheel.oninput = (e) => {
    applyColor(e.target.value);
    text.value = e.target.value;
  };
  btn.onclick = () => text.value && applyColor(text.value);

  const disco = document.createElement('button');
  disco.className = 'settings-btn settings-btn-secondary';
  discoModeBtn = disco;
  disco.onclick = () => {
    if (discoInterval) {
      clearInterval(discoInterval);
      discoInterval = null;
      applyColor('#ffffff');
    } else {
      discoInterval = setInterval(() => applyColor('#' + Math.floor(Math.random() * 16777215).toString(16)), 1000);
    }
    updateDynamicTranslationContent();
  };
  profileColorPicker.appendChild(disco);

  const vt = document.getElementById('vertical-tabs-toggle');
  const ss = document.getElementById('show-seconds-toggle');
  const httpsOnlyToggle = document.getElementById('https-only-toggle');
  const antiFingerprintingToggle = document.getElementById('anti-fingerprinting-toggle');
  const dnsOverHttpsToggle = document.getElementById('dns-over-https-toggle');
  const ramLimitSelect = document.getElementById('ram-limit-select');
  const se = document.getElementById('search-engine-select');
  const applySharedSettings = (settings = {}) => {
    cachedBrowserSettings = { ...cachedBrowserSettings, ...settings };
    if (ss && typeof settings.showSeconds === 'boolean') {
      ss.checked = settings.showSeconds;
      safeSetStorage('show-seconds', settings.showSeconds ? 'true' : 'false');
    }
    if (httpsOnlyToggle && typeof settings.httpsOnlyMode === 'boolean') {
      httpsOnlyToggle.checked = settings.httpsOnlyMode;
    }
    if (antiFingerprintingToggle && typeof settings.antiFingerprinting === 'boolean') {
      antiFingerprintingToggle.checked = settings.antiFingerprinting;
    }
    if (dnsOverHttpsToggle && typeof settings.dnsOverHttpsEnabled === 'boolean') {
      dnsOverHttpsToggle.checked = settings.dnsOverHttpsEnabled;
    }
    if (settings.ramLimitMode === 'off' || settings.ramLimitMode === 'automatic') {
      ramLimitSettings.mode = settings.ramLimitMode;
    }
    if (Number.isInteger(settings.automaticRamLimitMb)) {
      ramLimitSettings.automaticLimitMb = settings.automaticRamLimitMb;
    }
    renderRamLimitControl();
  };
  if (vt) {
    vt.checked = localStorage.getItem('vertical-tabs') === 'true';
    if (vt.checked) document.body.classList.add('vertical-tabs');
    vt.onchange = (e) => {
      const en = e.target.checked;
      localStorage.setItem('vertical-tabs', en);
      document.body.classList.toggle('vertical-tabs', en);
      lastChromeMetrics = { top: null, left: null };
      metrics();
    };
  }
  if (ss) {
    applySharedSettings({
      showSeconds: typeof initialSettings.showSeconds === 'boolean'
        ? initialSettings.showSeconds
        : safeGetStorage('show-seconds', 'false') === 'true'
    });

    ss.onchange = async (e) => {
      const enabled = e.target.checked;
      applySharedSettings({ showSeconds: enabled });
      try {
        await ipcRenderer.invoke('set-browser-settings', { showSeconds: enabled });
      } catch (_error) {
        // Keep the local toggle state even if the shared settings store is unavailable.
      }
    };
  }
  if (httpsOnlyToggle) {
    httpsOnlyToggle.onchange = async (e) => {
      const enabled = e.target.checked;
      applySharedSettings({ httpsOnlyMode: enabled });
      try {
        await ipcRenderer.invoke('set-browser-settings', { httpsOnlyMode: enabled });
      } catch (_error) {}
    };
  }
  if (antiFingerprintingToggle) {
    antiFingerprintingToggle.onchange = async (e) => {
      const enabled = e.target.checked;
      applySharedSettings({ antiFingerprinting: enabled });
      try {
        await ipcRenderer.invoke('set-browser-settings', { antiFingerprinting: enabled });
      } catch (_error) {}
    };
  }
  if (dnsOverHttpsToggle) {
    dnsOverHttpsToggle.onchange = async (e) => {
      const enabled = e.target.checked;
      applySharedSettings({ dnsOverHttpsEnabled: enabled });
      try {
        await ipcRenderer.invoke('set-browser-settings', { dnsOverHttpsEnabled: enabled });
      } catch (_error) {}
    };
  }
  if (ramLimitSelect) {
    ramLimitSelect.onchange = async (event) => {
      const previousMode = ramLimitSettings.mode;
      const ramLimitMode = event.target.value;
      try {
        const settings = await ipcRenderer.invoke('set-browser-settings', { ramLimitMode });
        if (settings) applySharedSettings(settings);
      } catch (_error) {
        ramLimitSettings.mode = previousMode;
        renderRamLimitControl();
      }
    };
  }
  if (se) {
    se.innerHTML = SEARCH_ENGINES.map((engine) => `<option value="${engine.id}">${engine.label}</option>`).join('');
    se.value = localStorage.getItem('default-search-engine') || 'google';
    se.onchange = (e) => {
      const eng = e.target.value;
      localStorage.setItem('default-search-engine', eng);
      const url = S_HOME[eng] || S_HOME.google;
      ipcRenderer.send('update-default-search-engine', url);
    };
  }

  applySharedSettings(initialSettings);
  applyMountedBrowserSettings = applySharedSettings;
  if (initialMemoryStatus) applyMemoryStatus(initialMemoryStatus);

  updateDynamicTranslationContent();
}

const formatUrl = (url) => {
  const normalized = normalizeTabUrl(url);
  return !normalized || normalized === 'chrome://newtab' ? '' : normalized;
};

ipcRenderer.on('tab-created', (e, t) => {
  const anchorTabId = t.afterTabId || null;
  addTabToUI(t, anchorTabId);
  syncTabState(t);
  if (t.active !== false) setActiveTab(t.id);
});
ipcRenderer.on('tab-switched', (e, { tabId, url, title, incognito, readerMode }) => {
  invalidateAiSummaryRequest({ closePanel: true });
  if (!tabs.find((t) => t.id === tabId)) {
    addTabToUI({
      id: tabId,
      url: url || 'chrome://newtab',
      title: title || t('app.newTab'),
      incognito: !!incognito
    });
  }
  syncTabState({ id: tabId, url, title, incognito, readerMode: !!readerMode });
  activeTabId = tabId;
  renderTabStrip();
  setActiveTab(tabId);
  updateTabTitle(tabId, title);
});
ipcRenderer.on('tab-groups-changed', (e, payload) => {
  if (!payload) return;
  if (Array.isArray(payload.tabs)) {
    tabs = payload.tabs.map(normalizeBootstrapTab).filter(Boolean);
  }
  setTabGroups(payload.groups);
  renderTabStrip();
  if (activeTabId) setActiveTab(activeTabId);
  renderGroupTabsMenu();
});
ipcRenderer.on('active-tab-changed', (e, id) => {
  invalidateAiSummaryRequest({ closePanel: true });
  setActiveTab(id);
});
ipcRenderer.on('view-event', (e, d) => {
  if (d.type === 'did-start-navigation' && d.tabId === activeTabId) {
    invalidateAiSummaryRequest({ closePanel: true });
  } else if (d.type === 'did-navigate') {
    syncTabState({ id: d.tabId, url: d.url });
    if (d.tabId === activeTabId) addressBar.value = formatUrl(d.url);
  } else if (d.type === 'title') {
    syncTabState({ id: d.tabId, title: d.title });
    updateTabTitle(d.tabId, d.title);
  }
  else if (['did-start-loading', 'did-stop-loading'].includes(d.type) && d.tabId === activeTabId) {
    if (d.type === 'did-start-loading') invalidateAiSummaryRequest({ closePanel: true });
    if (progressBarContainer) {
      progressBarContainer.classList.toggle('loading', d.type === 'did-start-loading');
    }
  }
});
ipcRenderer.on('history-data-received', (e, h) => renderHistory(h));
ipcRenderer.on('keyboard-shortcut', (e, t) => {
  if (t === 'new-tab') newTabBtn.click();
  else if (t === 'new-incognito-tab') {
    const btn = document.getElementById('incognito-tab-btn');
    if (btn) btn.click();
  } else if (t === 'close-tab' && activeTabId) ipcRenderer.invoke('close-tab', activeTabId);
  else if (t === 'reopen-closed-tab') ipcRenderer.invoke('reopen-closed-tab');
  else if (t === 'focus-address-bar') {
    addressBar.focus();
    addressBar.select();
  } else if (t === 'show-history') historyBtn.click();
  else if (t === 'show-downloads') downloadsBtn.click();
  else if (t === 'show-bookmarks') bookmarkBtn.click();
  else if (t === 'show-settings') settingsBtn.click();
  else if (t === 'bookmark-page') {
    openBookmarkModal();
  }
  else if (t === 'find-in-page') {
    findBar.style.display = findBar.style.display === 'none' ? 'flex' : 'none';
    if (findBar.style.display === 'flex') {
      findInput.focus();
      findInput.select();
    } else ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
  }
});
ipcRenderer.on('tab-closed', (e, id) => {
  tabs = tabs.filter((t) => t.id !== id);
  renderTabStrip();
  if (activeTabId) setActiveTab(activeTabId);
  renderGroupTabsMenu();
});
ipcRenderer.on('profile-changed', (e, { profileIndex, tabs: pTabs, groups: pGroups, incognitoWindow }) => {
  invalidateAiSummaryRequest({ closePanel: true });
  activeProfile = profileIndex;
  isIncognitoWindow = !!incognitoWindow;
  document.body.classList.toggle('incognito-window', isIncognitoWindow);
  tabs = Array.isArray(pTabs) ? pTabs.map(normalizeBootstrapTab).filter(Boolean) : [];
  setTabGroups(pGroups);
  renderTabStrip();
  renderProfileList();
  renderGroupTabsMenu();
  updateReaderShellState();
});
ipcRenderer.on('profile-list-updated', (e, d) => {
  profiles = d.profiles;
  renderProfileList();
});
ipcRenderer.on('reader-mode-changed', (e, d) => {
  if (d && d.tabId) {
    syncTabState({ id: d.tabId, readerMode: !!d.active });
    if (d.active) {
      const tab = tabs.find((entry) => entry.id === d.tabId);
      if (tab && d.sourceUrl) tab.url = d.sourceUrl;
      if (tab && d.sourceTitle) tab.title = d.sourceTitle;
    }
  }
  updateReaderShellState();
  if (d && d.available === false && d.reason) {
    showReaderToast(d.reason);
  }
});
ipcRenderer.on('updater-status', (e, status) => {
  updaterState = { ...updaterState, ...status };
  renderUpdaterState();
});

function renderProfileList() {
  if (!profileListContainer) return;
  const fragment = document.createDocumentFragment();
  profiles.forEach((p) => {
    const item = document.createElement('div');
    item.className = `dropdown-item ${p.id === activeProfile ? 'active' : ''}`;
    const n = document.createElement('span');
    n.textContent = getDisplayProfileName(p);
    n.style.flex = '1';
    const r = document.createElement('button');
    r.textContent = '✎';
    r.className = 'profile-rename-btn';
    if (p.id === activeProfile) {
      const d = document.createElement('div');
      d.className = 'status-dot';
      item.appendChild(d);
    }
    item.appendChild(n);
    item.appendChild(r);
    item.onclick = (e) => {
      if (e.target === r) return;
      ipcRenderer.invoke('switch-profile', p.id);
      profileMenu.classList.remove('show');
      ipcRenderer.send('toggle-browser-view', true);
    };
    r.onclick = (e) => {
      e.stopPropagation();
      pendingRenameProfileId = p.id;
      renameInput.value = p.name;
      renameModal.classList.add('show');
      renameInput.focus();
    };
    fragment.appendChild(item);
  });
  profileListContainer.replaceChildren(fragment);
}

function getGroupById(groupId) {
  return tabGroups.find((group) => group.id === groupId) || null;
}

function getActiveTab() {
  return tabs.find((entry) => entry && entry.id === activeTabId) || null;
}

function createGroupHeader(group) {
  const count = tabs.filter((tab) => tab && tab.groupId === group.id).length;
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'tab-group-header';
  header.dataset.groupId = group.id;
  header.style.setProperty('--group-color', group.color);
  header.title = group.collapsed ? 'Expand group' : 'Collapse group';
  header.innerHTML = `<span class="tab-group-chevron">${group.collapsed ? '>' : 'v'}</span><span class="tab-group-name"></span><span class="tab-group-count">${count}</span>`;
  header.querySelector('.tab-group-name').textContent = group.name;
  header.onclick = () => ipcRenderer.invoke('toggle-tab-group-collapsed', {
    groupId: group.id,
    collapsed: !group.collapsed
  });
  header.ondblclick = (event) => {
    event.stopPropagation();
    const nextName = prompt('Rename tab group', group.name);
    if (nextName && nextName.trim()) {
      ipcRenderer.invoke('rename-tab-group', { groupId: group.id, name: nextName.trim() });
    }
  };
  return header;
}

function renderTabStrip() {
  if (!tabBar) return;
  const signature = JSON.stringify({
    activeTabId,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      incognito: !!tab.incognito,
      readerMode: !!tab.readerMode,
      groupId: tab.groupId || ''
    })),
    groups: tabGroups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      collapsed: !!group.collapsed
    }))
  });
  if (signature === tabStripRenderSignature && tabBar.childElementCount) return;
  tabStripRenderSignature = signature;

  const fragment = document.createDocumentFragment();
  const renderedGroups = new Set();
  const collapsedGroups = new Set(tabGroups.filter((group) => group.collapsed).map((group) => group.id));

  tabs.forEach((tab) => {
    const group = tab.groupId ? getGroupById(tab.groupId) : null;
    if (group && !renderedGroups.has(group.id)) {
      fragment.appendChild(createGroupHeader(group));
      renderedGroups.add(group.id);
    }
    if (group && collapsedGroups.has(group.id) && tab.id !== activeTabId) return;

    const { element: el } = appUtils.createTabElement(document, tab);
    if (group) {
      el.dataset.groupId = group.id;
      el.style.setProperty('--group-color', group.color);
    }
    el.onclick = (event) => {
      if (event.target.classList.contains('tab-close')) ipcRenderer.invoke('close-tab', tab.id);
      else ipcRenderer.invoke('switch-tab', tab.id);
    };
    fragment.appendChild(el);
  });

  tabGroups.forEach((group) => {
    if (!renderedGroups.has(group.id)) fragment.appendChild(createGroupHeader(group));
  });

  tabBar.replaceChildren(fragment);
}

function applyGroupPayload(payload) {
  if (!payload) return;
  if (Array.isArray(payload.tabs)) tabs = payload.tabs.map(normalizeBootstrapTab).filter(Boolean);
  setTabGroups(payload.groups);
  renderTabStrip();
  if (activeTabId) setActiveTab(activeTabId);
  renderGroupTabsMenu();
}

function renderGroupTabsMenu() {
  if (!groupTabsMenu) return;
  groupTabsMenu.innerHTML = '';
  const activeTab = getActiveTab();

  const addItem = (label, handler, options = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.className || 'tab-group-menu-item';
    button.disabled = !!options.disabled;
    button.textContent = label;
    button.onclick = async (event) => {
      event.stopPropagation();
      if (button.disabled) return;
      await handler();
      groupTabsMenu.classList.remove('show');
    };
    groupTabsMenu.appendChild(button);
    return button;
  };

  addItem('New group with active tab', async () => {
    const name = prompt('Group name', `Group ${tabGroups.length + 1}`);
    const payload = await ipcRenderer.invoke('create-tab-group', {
      tabId: activeTabId,
      name: name && name.trim() ? name.trim() : `Group ${tabGroups.length + 1}`
    });
    applyGroupPayload(payload);
  }, { disabled: !activeTab });

  addItem('AI organize tabs on device', async () => {
    const payload = await ipcRenderer.invoke('create-ai-tab-groups');
    applyGroupPayload(payload);
  }, { disabled: tabs.filter((tab) => tab && !tab.incognito).length < 2 });

  if (activeTab && activeTab.groupId) {
    addItem('Remove active tab from group', async () => {
      const payload = await ipcRenderer.invoke('assign-tab-to-group', { tabId: activeTabId, groupId: null });
      applyGroupPayload(payload);
    });
  }

  const divider = document.createElement('div');
  divider.className = 'tab-group-menu-divider';
  groupTabsMenu.appendChild(divider);

  if (!tabGroups.length) {
    const empty = document.createElement('div');
    empty.className = 'tab-group-menu-empty';
    empty.textContent = 'No tab groups yet.';
    groupTabsMenu.appendChild(empty);
    return;
  }

  tabGroups.forEach((group) => {
    const row = document.createElement('div');
    row.className = 'tab-group-menu-row';
    row.style.setProperty('--group-color', group.color);

    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'tab-group-menu-main';
    move.disabled = !activeTab || activeTab.groupId === group.id;
    move.textContent = `Move active tab to ${group.name}`;
    move.onclick = async (event) => {
      event.stopPropagation();
      const payload = await ipcRenderer.invoke('assign-tab-to-group', { tabId: activeTabId, groupId: group.id });
      applyGroupPayload(payload);
      groupTabsMenu.classList.remove('show');
    };

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tab-group-menu-icon';
    toggle.textContent = group.collapsed ? 'Expand' : 'Collapse';
    toggle.onclick = async (event) => {
      event.stopPropagation();
      const payload = await ipcRenderer.invoke('toggle-tab-group-collapsed', {
        groupId: group.id,
        collapsed: !group.collapsed
      });
      applyGroupPayload(payload);
      groupTabsMenu.classList.remove('show');
    };

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'tab-group-menu-icon';
    rename.textContent = 'Rename';
    rename.onclick = async (event) => {
      event.stopPropagation();
      const nextName = prompt('Rename tab group', group.name);
      if (nextName && nextName.trim()) {
        const payload = await ipcRenderer.invoke('rename-tab-group', { groupId: group.id, name: nextName.trim() });
        applyGroupPayload(payload);
      }
      groupTabsMenu.classList.remove('show');
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tab-group-menu-icon danger';
    remove.textContent = 'Delete';
    remove.onclick = async (event) => {
      event.stopPropagation();
      if (confirm(`Delete "${group.name}"? Tabs will stay open.`)) {
        const payload = await ipcRenderer.invoke('delete-tab-group', group.id);
        applyGroupPayload(payload);
      }
      groupTabsMenu.classList.remove('show');
    };

    row.appendChild(move);
    row.appendChild(toggle);
    row.appendChild(rename);
    row.appendChild(remove);
    groupTabsMenu.appendChild(row);
  });
}

function addTabToUI(t, anchorTabId = null) {
  if (tabs.find((x) => x.id === t.id)) {
    syncTabState(t);
    renderTabStrip();
    updateTabTitle(t.id, t.title);
    return;
  }
  const anchorIdx = anchorTabId ? tabs.findIndex((x) => x.id === anchorTabId) : -1;
  const nextTab = {
    id: t.id,
    url: normalizeTabUrl(t.url || 'chrome://newtab') || 'chrome://newtab',
    title: t.title || localization.t(currentLocale, 'app.loading'),
    incognito: !!t.incognito,
    readerMode: !!t.readerMode,
    groupId: typeof t.groupId === 'string' ? t.groupId : undefined
  };
  if (anchorIdx >= 0) tabs.splice(anchorIdx + 1, 0, nextTab);
  else tabs.push(nextTab);
  renderTabStrip();
}

function ensureTabsVisible(ids) {
  if (!tabBar || !ids.length) return;
  const els = ids
    .map((id) => document.querySelector(`.tab[data-id="${id}"]`))
    .filter(Boolean);
  if (!els.length) return;
  let minLeft = Infinity;
  let maxRight = -Infinity;
  els.forEach((el) => {
    const left = el.offsetLeft;
    minLeft = Math.min(minLeft, left);
    maxRight = Math.max(maxRight, left + el.offsetWidth);
  });
  const viewWidth = Math.max(tabBar.clientWidth, 0);
  const scrollLeft = Math.max(tabBar.scrollLeft, 0);
  const padding = 16;
  if (minLeft < scrollLeft) {
    tabBar.scrollTo({ left: Math.max(0, minLeft - padding), behavior: 'smooth' });
  } else if (maxRight > scrollLeft + viewWidth) {
    const maxScroll = Math.max(0, tabBar.scrollWidth - viewWidth);
    const target = Math.min(maxScroll, maxRight - viewWidth + padding);
    tabBar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }
}

function setActiveTab(id, opts = {}) {
  activeTabId = id;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
  const t = tabs.find((x) => x.id === id);
  document.querySelectorAll('.tab-group-header').forEach((header) => {
    header.classList.toggle('active', !!(t && t.groupId && header.dataset.groupId === t.groupId));
  });
  if (t && addressBar) addressBar.value = formatUrl(t.url);
  updateReaderShellState();
  const extras = Array.isArray(opts.alsoReveal) ? opts.alsoReveal : [];
  const revealIds = Array.from(new Set([id, ...extras].filter(Boolean)));
  ensureTabsVisible(revealIds);
}

function updateTabTitle(id, title) {
  const el = document.querySelector(`.tab[data-id="${id}"] .tab-title`);
  const nextTitle = title || t('app.loading');
  if (el && el.textContent !== nextTitle) el.textContent = nextTitle;
  appUtils.syncTabRecord(tabs, id, { title: nextTitle });
}

function getBms() {
  const raw = safeGetStorage('browser-bookmarks', '[]');
  if (raw === bookmarksStorageSnapshot) return parsedBookmarks;
  bookmarksStorageSnapshot = raw;
  try {
    const parsed = JSON.parse(raw);
    parsedBookmarks = Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    parsedBookmarks = [];
  }
  return parsedBookmarks;
}

function saveBookmark(u, t, target = 'both') {
  try {
    const bms = getBms();
    const idx = bms.findIndex((b) => b.url === u);
    if (idx !== -1) {
      bms[idx].target = target;
      bms[idx].title = t || bms[idx].title;
    } else {
      bms.push({ url: u, title: t || u, id: Date.now(), target });
    }
    safeSetStorage('browser-bookmarks', JSON.stringify(bms));
    renderBookmarks();
    renderBookmarksBar();
  } catch (_error) {
    // Silently fail if localStorage is unavailable
  }
}
function getFaviconHost(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}
function buildFavicon(host, size = 20) {
  const icon = document.createElement('span');
  const safeHost = typeof host === 'string' && host.trim() ? host.trim() : '?';
  icon.className = 'favicon favicon-fallback';
  icon.style.width = `${size}px`;
  icon.style.height = `${size}px`;
  icon.textContent = safeHost.charAt(0).toUpperCase();
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
function buildHistoryEntry(entry) {
  const host = getFaviconHost(entry.url);
  const el = document.createElement('div');
  el.className = 'history-item';
  const icon = buildFavicon(host);
  const info = document.createElement('div');
  info.style.flex = '1';
  info.style.minWidth = '0';
  const title = document.createElement('div');
  title.textContent = entry.title || entry.url;
  const urlEl = document.createElement('div');
  urlEl.className = 'url';
  urlEl.textContent = entry.url;
  info.appendChild(title);
  info.appendChild(urlEl);
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-history-btn';
  removeBtn.textContent = '×';
  removeBtn.setAttribute('aria-label', t('history.remove'));
  el.append(icon, info, removeBtn);
  return el;
}
function renderHistory(h) {
  if (!historyList) return;
  const fragment = document.createDocumentFragment();
  h.forEach((i) => {
    const el = buildHistoryEntry(i);
    const removeBtn = el.querySelector('.remove-history-btn');
    removeBtn.onclick = async (e) => {
      e.stopPropagation();
      await ipcRenderer.invoke('delete-history-item', i.id || { url: i.url, timestamp: i.timestamp });
      ipcRenderer.send('fetch-and-show-history');
    };
    el.onclick = (e) => {
      if (e.target.closest('.remove-history-btn')) return;
      ipcRenderer.invoke('navigate-to', i.url);
      closePanels();
    };
    fragment.appendChild(el);
  });
  historyList.replaceChildren(fragment);
}
function buildBookmarkBarItem(bookmark) {
  const host = getFaviconHost(bookmark.url);
  const el = document.createElement('div');
  el.className = 'bookmarks-bar-item';
  const icon = buildFavicon(host, 16);
  const label = document.createElement('span');
  label.textContent = bookmark.title || bookmark.url;
  el.append(icon, label);
  return el;
}
function buildBookmarkItem(bookmark) {
  const host = getFaviconHost(bookmark.url);
  const el = document.createElement('div');
  el.className = 'bookmark-item';
  const icon = buildFavicon(host);
  const info = document.createElement('div');
  const title = document.createElement('div');
  title.textContent = bookmark.title || bookmark.url;
  const urlEl = document.createElement('div');
  urlEl.className = 'url';
  urlEl.textContent = bookmark.url;
  info.append(title, urlEl);
  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-bm';
  removeBtn.style.marginLeft = 'auto';
  removeBtn.textContent = '×';
  el.append(icon, info, removeBtn);
  return el;
}
function renderBookmarksBar() {
  if (!bookmarksBar) return;
  const bms = getBms().filter((b) => b.target === 'bar' || b.target === 'both');
  bookmarksBar.style.display = bms.length ? 'flex' : 'none';
  const fragment = document.createDocumentFragment();
  bms.forEach((b) => {
    const el = buildBookmarkBarItem(b);
    el.onclick = () => ipcRenderer.invoke('navigate-to', b.url);
    fragment.appendChild(el);
  });
  bookmarksBar.replaceChildren(fragment);
  if (typeof metrics === 'function') metrics();
}
function renderBookmarks() {
  if (!bookmarksList || !isPanelInitialized(bookmarksSidebar)) return;
  const bms = getBms();
  if (!bms.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = t('bookmarks.empty');
    bookmarksList.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  bms.forEach((b) => {
    const el = buildBookmarkItem(b);
    const removeBtn = el.querySelector('.remove-bm');
    el.onclick = (e) => {
      if (e.target === removeBtn) return;
      ipcRenderer.invoke('navigate-to', b.url);
      closePanels();
    };
    if (removeBtn) {
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        localStorage.setItem(
          'browser-bookmarks',
          JSON.stringify(appUtils.removeBookmarkById(getBms(), b.id))
        );
        renderBookmarks();
        renderBookmarksBar();
      };
    }
    fragment.appendChild(el);
  });
  bookmarksList.replaceChildren(fragment);
}
function refreshDownloadElement(el, info) {
  while (el.firstChild) el.removeChild(el.firstChild);
  const name = document.createElement('div');
  name.textContent = info.filename || '';
  const status = document.createElement('div');
  const received = info.receivedBytes || 0;
  const total = info.totalBytes || 0;
  const ratio = total > 0 ? received / total : 0;
  const percent = Math.floor(ratio * 100) || 0;
  status.textContent = info.state === 'completed' ? t('downloads.done') : `${percent}%`;
  el.appendChild(name);
  el.appendChild(status);
  if (info.state === 'completed') el.style.borderColor = 'green';
  else el.style.removeProperty('border-color');
}
function updateDlUI(i) {
  if (!i || i.id == null) return;
  downloadItems.set(i.id, i);
  if (!isPanelInitialized(downloadsSidebar) || !downloadsList) return;
  let el = document.getElementById(`dl-${i.id}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `dl-${i.id}`;
    el.className = 'download-item';
    downloadsList.appendChild(el);
  }
  refreshDownloadElement(el, i);
}
function renderDownloads() {
  if (!downloadsList || !isPanelInitialized(downloadsSidebar)) return;
  downloadsList.replaceChildren();
  downloadItems.forEach((info) => updateDlUI(info));
}
ipcRenderer.on('find-result', (e, r) => findResults.textContent = r ? `${r.activeMatchOrdinal}/${r.matches}` : t('find.empty'));
ipcRenderer.on('download-started', (e, i) => updateDlUI(i));
ipcRenderer.on('download-updated', (e, i) => updateDlUI(i));

function openBookmarkModal() {
  const bookmark = appUtils.getActiveTabBookmark(tabs, activeTabId);
  if (!bookmark) return;
  pendingBookmark = bookmark;
  if (bookmarkDestModal) bookmarkDestModal.classList.add('show');
}

window.addEventListener('storage', (event) => {
  if (!event.key || event.key === 'browser-bookmarks') {
    renderBookmarks();
    renderBookmarksBar();
  }
  if (event.key === 'orion-locale') {
    const nextLocale = localization.sanitizeLocale(event.newValue);
    if (!nextLocale) return;
    void ensureLocaleLoaded(nextLocale).then(() => {
      setLocale(nextLocale);
      applyTranslations();
    });
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
  if (tagName === 'input' || tagName === 'textarea' || (target && target.isContentEditable)) return;
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    openBookmarkModal();
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    ipcRenderer.invoke('open-incognito-window', 'chrome://newtab');
  }
});

async function bootstrap() {
  let snapshot = null;
  try {
    snapshot = await ipcRenderer.invoke('bootstrap-window');
  } catch (error) {
    window.__orionBootstrapError = error && error.message ? error.message : String(error);
    console.error('Orion bootstrap failed:', error);
  }

  const persistedLocale = localization.sanitizeLocale(snapshot && snapshot.locale);
  const onboardingCompleted = snapshot && snapshot.onboardingCompleted === false ? false : true;
  currentPlatform = localization.normalizeUiPlatform(snapshot && snapshot.platform ? snapshot.platform : currentPlatform);

  const bootstrapState = appUtils.resolveRendererBootstrapState({
    onboardingCompleted,
    persistedLocale,
    storedLocale: getStoredLocale(),
    defaultLocale: localization.DEFAULT_LOCALE,
    sanitizeLocale: localization.sanitizeLocale
  });

  await ensureLocaleLoaded(bootstrapState.locale);
  setLocale(bootstrapState.locale);
  safeRemoveStorage('adblock-rules');
  init(snapshot || {});
  hydrateFromBootstrapState(snapshot);
  if (!bootstrapState.showOnboarding) {
    try {
      localStorage.setItem('orion-locale', bootstrapState.locale);
    } catch (_error) { }
  }
  renderTabStrip();
  if (activeTabId) setActiveTab(activeTabId);
  applyTranslations();
  if (bootstrapState.showOnboarding) showStartupOverlay();
  else hideStartupOverlay();
  document.documentElement.dataset.orionReady = 'true';
  if (window.__orionStartupPerformance) {
    const mainTimeOriginMs = Number(window.__orionStartupPerformance.mainTimeOriginMs);
    const mainStartedMs = Number(window.__orionStartupPerformance.mainStartedMs);
    if (Number.isFinite(mainTimeOriginMs) && Number.isFinite(mainStartedMs)) {
      window.__orionStartupPerformance.shellInteractiveMs = Math.max(
        0,
        performance.timeOrigin + performance.now() - mainTimeOriginMs - mainStartedMs
      );
    }
  }
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark('orion-shell-interactive');
  }
  requestAnimationFrame(() => {
    document.documentElement.dataset.orionFirstPaint = 'true';
  });
}

bootstrap();
