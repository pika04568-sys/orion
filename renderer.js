const ipcRenderer = window.electron || { invoke: async () => { }, send: () => { }, on: () => { } };
const appUtils = window.OrionAppUtils;
const localization = window.OrionLocalization;

let tabBar, newTabBtn, groupTabsBtn, groupTabsMenu, clearTabsBtn, addressBar, backBtn, forwardBtn, reloadBtn, readerBtn, aiSummaryBtn, aiSummarySidebar, closeAiSummaryBtn, aiSummaryContent, historyBtn, historySidebar, closeHistoryBtn, historyList, chromeContainer, profileBtn, profileMenu, profileListContainer, addProfileBtn, settingsBtn, settingsSidebar, closeSettingsBtn, profileColorPicker, renameModal, renameInput, renameSaveBtn, renameCancelBtn, pendingRenameProfileId = null, bookmarkBtn, bookmarksSidebar, closeBookmarksBtn, bookmarksList, downloadsBtn, downloadsSidebar, closeDownloadsBtn, downloadsList, findBar, findInput, findResults, findPrev, findNext, findClose, openExtensionsBtn, progressBarContainer, progressBar, addBookmarkBtn, bookmarksBar, bookmarkDestModal, addToBarBtn, addToNewTabBtn, addToBothBtn, cancelBookmarkBtn, checkUpdatesBtn, versionEl, updateStatusEl, startupOverlay, startupLanguagePicker, settingsLanguagePicker, readerToast, metrics = () => { }, pendingBookmark = null, activeTabId = null, activeProfile = 0, isIncognitoWindow = false, tabs = [], tabGroups = [], profiles = [];
let updaterState = { state: 'idle', message: localization.t(localization.DEFAULT_LOCALE, 'updates.ready') };
let currentLocale = localization.DEFAULT_LOCALE;
let currentPlatform = getBrowserUiPlatform();
let hasStartedRenderer = false;
let discoInterval = null;
let discoModeBtn = null;
let adblockState = null;
let adblockElements = null;
let tabStripRenderSignature = '';
let metricsFrame = null;
let lastChromeMetrics = { top: null, left: null };
let closePanels = () => {};

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

function applyStaticTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.title = t('app.name');
}

function getDisplayProfileName(profile) {
  if (!profile) return '';
  if (localization.isGeneratedProfileName(profile.name, profile.id)) {
    return localization.getProfileName(currentLocale, profile.id);
  }
  return profile.name;
}

function updateDynamicTranslationContent() {
  const colorLabel = document.getElementById('custom-color-label');
  const colorInput = document.getElementById('custom-color-input');
  const applyBtn = document.getElementById('apply-custom-color');

  if (colorLabel) colorLabel.textContent = t('settings.colorPicker');
  if (colorInput) colorInput.setAttribute('placeholder', t('settings.colorPlaceholder'));
  if (applyBtn) applyBtn.textContent = t('settings.applyColor');
  if (discoModeBtn) discoModeBtn.textContent = discoInterval ? t('settings.stopDisco') : t('settings.discoMode');
}

function formatAdblockTimestamp(value) {
  if (!value) return t('adblock.syncNever');
  try {
    return new Date(value).toLocaleString(currentLocale);
  } catch (_error) {
    return t('adblock.syncNever');
  }
}

function renderAdblockState() {
  if (!adblockElements || !adblockState) return;

  const { listStatus, customStatus, syncStatus, customRules, saveButton, refreshButton, resetButton, listToggles } = adblockElements;
  const lists = Array.isArray(adblockState.lists) ? adblockState.lists : [];
  const enabledLists = lists.filter((list) => list.enabled).length;
  const customCount = (adblockState.customRules || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('!'))
    .length;

  if (customRules && document.activeElement !== customRules && customRules.value !== (adblockState.customRules || '')) {
    customRules.value = adblockState.customRules || '';
  }

  if (listStatus) {
    listStatus.innerHTML = '';
    lists.forEach((list) => {
      const row = document.createElement('label');
      row.className = 'adblock-toggle-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!list.enabled;
      checkbox.onchange = async () => {
        const nextState = await ipcRenderer.invoke('set-adblock-list-enabled', {
          listId: list.id,
          enabled: checkbox.checked
        });
        if (nextState) {
          adblockState = nextState;
          renderAdblockState();
        }
      };
      const title = document.createElement('span');
      title.className = 'adblock-toggle-title';
      title.textContent = list.name;
      const details = document.createElement('span');
      details.className = 'adblock-toggle-meta';
      const ruleCount = Number.isFinite(list.ruleCount) ? list.ruleCount : 0;
      const updatedLabel = list.lastUpdatedAt ? formatAdblockTimestamp(list.lastUpdatedAt) : t('adblock.syncNever');
      details.textContent = `${list.enabled ? t('adblock.enabled') : t('adblock.disabled')} • ${ruleCount.toLocaleString()} ${t('adblock.rules')} • ${updatedLabel}`;
      row.appendChild(checkbox);
      row.appendChild(title);
      row.appendChild(details);
      listStatus.appendChild(row);
    });
  }

  if (customStatus) {
    customStatus.textContent = `${customCount.toLocaleString()} ${t('adblock.customRulesCount')} • ${enabledLists.toLocaleString()} ${t('adblock.listsEnabled')} • ${formatAdblockTimestamp(adblockState.syncState && adblockState.syncState.lastSyncAt)}`;
  }

  if (syncStatus) {
    const syncState = adblockState.syncState || {};
    syncStatus.textContent = `${syncState.message || t('adblock.syncIdle')}${syncState.lastError ? `\n${syncState.lastError}` : ''}`;
  }

  if (saveButton) saveButton.textContent = t('adblock.save');
  if (refreshButton) refreshButton.textContent = t('adblock.refresh');
  if (resetButton) resetButton.textContent = t('adblock.resetDefaults');
}

async function loadAdblockState() {
  const state = await ipcRenderer.invoke('get-adblock-state');
  if (!state) return;
  adblockState = state;
  const legacyRules = safeGetStorage('adblock-rules', '');
  if ((!adblockState.customRules || !adblockState.customRules.trim()) && legacyRules.trim()) {
    const migrated = await ipcRenderer.invoke('update-adblock-rules', legacyRules);
    if (migrated) adblockState = migrated;
  }
  renderAdblockState();
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
  meta.textContent = `${source} · ${t('aiSummary.localOnly')} · ${t('aiSummary.readingTime', { minutes })}`;
  card.appendChild(meta);

  const list = document.createElement('ul');
  list.className = 'ai-summary-list';
  (summary.bullets || []).forEach((point) => {
    const item = document.createElement('li');
    item.textContent = point;
    list.appendChild(item);
  });
  card.appendChild(list);
  aiSummaryContent.appendChild(card);
}

async function openAiSummaryPanel(togglePanel) {
  if (!aiSummarySidebar) return;
  togglePanel(aiSummarySidebar, true);
  renderAiSummaryLoading();
  try {
    const summary = await ipcRenderer.invoke('summarize-active-page');
    renderAiSummary(summary);
  } catch (error) {
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
  renderLanguageButtons(settingsLanguagePicker, false);
}

function applyTranslations() {
  applyStaticTranslations();
  updateDynamicTranslationContent();
  refreshLanguageButtons();
  renderUpdaterState();
  renderProfileList();
  renderBookmarks();
  renderBookmarksBar();
  renderAdblockState();
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

function ensureRendererStarted() {
  if (hasStartedRenderer) return;
  hasStartedRenderer = true;
  ipcRenderer.send('renderer-ready');
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

  try {
    const response = await ipcRenderer.invoke('set-language', nextLocale);
    setLocale(response && response.locale ? response.locale : nextLocale);
  } catch (_error) {
    setLocale(nextLocale);
  }

  try {
    safeSetStorage('orion-locale', currentLocale);
  } catch (_error) { }

  applyTranslations();

  if (options.finishOnboarding) {
    hideStartupOverlay();
    ensureRendererStarted();
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
    renderProfileList();
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
    renderTabStrip();

    const fallbackActiveId = bootstrapTabs[0].id;
    let nextActiveId = typeof snapshot.activeTabId === 'string' ? snapshot.activeTabId : fallbackActiveId;
    if (!tabs.find((tab) => tab.id === nextActiveId)) nextActiveId = fallbackActiveId;
    setActiveTab(nextActiveId);
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

function applyColor(c) {
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
  ipcRenderer.send('apply-browser-color', color);
  safeSetStorage('browser-theme-color', color);
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

function init() {
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

  const adblockBtn = document.getElementById('adblock-btn');
  const adblockSidebar = document.getElementById('adblock-sidebar');
  const closeAdblockBtn = document.getElementById('close-adblock');
  const adblockText = document.getElementById('adblock-rules');
  const saveAdblockBtn = document.getElementById('save-adblock-rules');
  const refreshAdblockBtn = document.getElementById('refresh-adblock-lists');
  const resetAdblockBtn = document.getElementById('reset-adblock-defaults');
  const adblockListStatus = document.getElementById('adblock-list-status');
  const adblockCustomStatus = document.getElementById('adblock-custom-status');
  const adblockSyncStatus = document.getElementById('adblock-sync-status');

  adblockElements = {
    listStatus: adblockListStatus,
    customStatus: adblockCustomStatus,
    syncStatus: adblockSyncStatus,
    customRules: adblockText,
    saveButton: saveAdblockBtn,
    refreshButton: refreshAdblockBtn,
    resetButton: resetAdblockBtn
  };

  void loadAdblockState();

  const sidebars = [historySidebar, settingsSidebar, bookmarksSidebar, downloadsSidebar, adblockSidebar, aiSummarySidebar].filter(Boolean);
  const toggle = (s, v) => {
    sidebars.forEach((p) => {
      if (p !== s) p.classList.remove('open');
    });
    if (s) s.classList.toggle('open', v);
    const hasOpen = sidebars.some((p) => p.classList.contains('open'));
    ipcRenderer.send('toggle-browser-view', !hasOpen);
    if (hasOpen && findBar) {
      findBar.style.display = 'none';
      ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
    }
  };
  closePanels = () => toggle(null, false);

  if (adblockBtn) adblockBtn.onclick = () => {
    adblockText.value = safeGetStorage('adblock-rules', '');
    toggle(adblockSidebar, true);
  };
  if (closeAdblockBtn) closeAdblockBtn.onclick = () => toggle(adblockSidebar, false);
  if (saveAdblockBtn) saveAdblockBtn.onclick = () => {
    safeSetStorage('adblock-rules', adblockText.value);
    ipcRenderer.invoke('update-adblock-rules', adblockText.value).then((nextState) => {
      if (nextState) {
        adblockState = nextState;
        renderAdblockState();
      }
      saveAdblockBtn.textContent = t('adblock.saved');
      setTimeout(() => {
        saveAdblockBtn.textContent = t('adblock.save');
      }, 2000);
    });
  };
  if (refreshAdblockBtn) refreshAdblockBtn.onclick = async () => {
    const nextState = await ipcRenderer.invoke('refresh-adblock-lists');
    if (nextState) {
      adblockState = nextState;
      renderAdblockState();
    }
  };
  if (resetAdblockBtn) resetAdblockBtn.onclick = async () => {
    const nextState = await ipcRenderer.invoke('reset-adblock-defaults');
    if (nextState) {
      adblockState = nextState;
      renderAdblockState();
    }
  };

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

  renderUpdaterState();

  ipcRenderer.invoke('get-updater-state').then((state) => {
    if (!state) return;
    updaterState = { ...updaterState, ...state };
    renderUpdaterState();
  });

  if (versionEl) ipcRenderer.invoke('get-app-version').then((v) => {
    versionEl.textContent = `v${v}`;
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

  const savedColor = safeGetStorage('browser-theme-color');
  if (savedColor) applyColor(savedColor);
  const storedLocale = localization.sanitizeLocale(safeGetStorage('orion-locale'));
  if (storedLocale) setLocale(storedLocale);
  renderProfileList();
  renderBookmarksBar();

  if (addressBar) {
    addressBar.onkeydown = (e) => {
      if (e.key === 'Enter') {
        let url = addressBar.value.trim();
        if (url && !url.includes('.') && !url.includes('://')) {
          url = (S_ENG[safeGetStorage('default-search-engine', 'google')] || S_ENG.google) + encodeURIComponent(url);
        }
        ipcRenderer.invoke('navigate-to', url);
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
  if (newTabBtn) newTabBtn.onclick = () => ipcRenderer.invoke('create-tab', {
    tabId: `p-${activeProfile}-t-${Date.now()}`,
    url: 'chrome://newtab',
    inc: isIncognitoWindow
  });
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
    toggle(bookmarksSidebar, show);
    if (show) renderBookmarks();
  };
  if (closeBookmarksBtn) closeBookmarksBtn.onclick = () => toggle(bookmarksSidebar, false);
  if (settingsBtn) settingsBtn.onclick = () => {
    toggle(settingsSidebar, true);
    const hero = document.getElementById('settings-hero');
    const opened = safeGetStorage('settings-opened-once', 'false') === 'true';
    if (hero) {
      hero.style.display = opened ? 'none' : '';
      if (!opened) safeSetStorage('settings-opened-once', 'true');
    }
  };
  if (closeSettingsBtn) closeSettingsBtn.onclick = () => toggle(settingsSidebar, false);
  if (openExtensionsBtn) openExtensionsBtn.onclick = () => {
    closePanels();
    ipcRenderer.invoke('navigate-to', 'chrome://extensions');
  };
  if (downloadsBtn) downloadsBtn.onclick = () => toggle(downloadsSidebar, !downloadsSidebar.classList.contains('open'));
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
  initSettings();
  applyTranslations();
}

function initSettings() {
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
  const se = document.getElementById('search-engine-select');
  const applySharedSettings = (settings = {}) => {
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
      showSeconds: safeGetStorage('show-seconds', 'false') === 'true'
    });
    void resolveShowSecondsSetting().then((enabled) => {
      applySharedSettings({ showSeconds: enabled });
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

  void ipcRenderer.invoke('get-browser-settings').then((settings) => {
    if (settings) applySharedSettings(settings);
  }).catch(() => {});

  ipcRenderer.on('browser-settings-changed', (_event, settings) => {
    if (!settings) return;
    applySharedSettings(settings);
  });

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
ipcRenderer.on('active-tab-changed', (e, id) => setActiveTab(id));
ipcRenderer.on('view-event', (e, d) => {
  if (d.type === 'did-navigate') {
    syncTabState({ id: d.tabId, url: d.url });
    if (d.tabId === activeTabId) addressBar.value = formatUrl(d.url);
  } else if (d.type === 'title') {
    syncTabState({ id: d.tabId, title: d.title });
    updateTabTitle(d.tabId, d.title);
  }
  else if (['did-start-loading', 'did-stop-loading'].includes(d.type) && d.tabId === activeTabId) progressBarContainer.classList.toggle('loading', d.type === 'did-start-loading');
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
  else if (t === 'show-adblock') {
    const btn = document.getElementById('adblock-btn');
    if (btn) btn.click();
  } else if (t === 'bookmark-page') {
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
  try {
    return JSON.parse(safeGetStorage('browser-bookmarks', '[]'));
  } catch (_error) {
    return [];
  }
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
  const img = document.createElement('img');
  img.className = 'favicon';
  img.width = size;
  img.height = size;
  const safeHost = host || 'google.com';
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(safeHost)}&sz=32`;
  img.alt = '';
  img.loading = 'lazy';
  return img;
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
  if (!bookmarksList) return;
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
  let el = document.getElementById(`dl-${i.id}`);
  if (!el) {
    el = document.createElement('div');
    el.id = `dl-${i.id}`;
    el.className = 'download-item';
    downloadsList.appendChild(el);
  }
  refreshDownloadElement(el, i);
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
    setLocale(nextLocale);
    applyTranslations();
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
  init();
  ensureRendererStarted();
  try {
    const snapshot = await ipcRenderer.invoke('get-window-bootstrap-state');
    hydrateFromBootstrapState(snapshot);
  } catch (_error) { }

  let persistedLocale = null;
  let onboardingCompleted = true;
  try {
    const response = await ipcRenderer.invoke('get-language-settings');
    persistedLocale = localization.sanitizeLocale(response && response.locale);
    onboardingCompleted = response && response.onboardingCompleted === false ? false : true;
    currentPlatform = localization.normalizeUiPlatform(response && response.platform ? response.platform : currentPlatform);
  } catch (_error) { }

  const bootstrapState = appUtils.resolveRendererBootstrapState({
    onboardingCompleted,
    persistedLocale,
    storedLocale: getStoredLocale(),
    defaultLocale: localization.DEFAULT_LOCALE,
    sanitizeLocale: localization.sanitizeLocale
  });

  setLocale(bootstrapState.locale);
  if (!bootstrapState.showOnboarding) {
    try {
      localStorage.setItem('orion-locale', bootstrapState.locale);
    } catch (_error) { }
  }
  applyTranslations();
  if (bootstrapState.showOnboarding) showStartupOverlay();
  else hideStartupOverlay();
}

bootstrap();
