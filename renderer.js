const ipcRenderer = window.electron || { invoke: async () => { }, send: () => { }, on: () => { } };
const appUtils = window.OrionAppUtils;
const localization = window.OrionLocalization;

let tabBar, newTabBtn, clearTabsBtn, addressBar, backBtn, forwardBtn, reloadBtn, historyBtn, historySidebar, closeHistoryBtn, historyList, chromeContainer, profileBtn, profileMenu, profileListContainer, addProfileBtn, settingsBtn, settingsSidebar, closeSettingsBtn, profileColorPicker, renameModal, renameInput, renameSaveBtn, renameCancelBtn, pendingRenameProfileId = null, bookmarkBtn, bookmarksSidebar, closeBookmarksBtn, bookmarksList, downloadsBtn, downloadsSidebar, closeDownloadsBtn, downloadsList, findBar, findInput, findResults, findPrev, findNext, findClose, openExtensionsBtn, progressBarContainer, progressBar, addBookmarkBtn, bookmarksBar, bookmarkDestModal, addToBarBtn, addToNewTabBtn, addToBothBtn, cancelBookmarkBtn, checkUpdatesBtn, versionEl, updateStatusEl, startupOverlay, startupLanguagePicker, settingsLanguagePicker, metrics = () => { }, pendingBookmark = null, activeTabId = null, activeProfile = 0, isIncognitoWindow = false, tabs = [], profiles = [];
let updaterState = { state: 'idle', message: localization.t(localization.DEFAULT_LOCALE, 'updates.ready') };
let currentLocale = localization.DEFAULT_LOCALE;
let hasStartedRenderer = false;
let discoInterval = null;
let discoModeBtn = null;

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

function t(key, vars = {}) {
  return localization.t(currentLocale, key, vars);
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
    localStorage.setItem('orion-locale', currentLocale);
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

  return appUtils.upsertTabRecord(tabs, nextTab);
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
  localStorage.setItem('browser-theme-color', color);
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
  addressBar = document.getElementById('address-bar');
  backBtn = document.getElementById('back-btn');
  forwardBtn = document.getElementById('forward-btn');
  reloadBtn = document.getElementById('reload-btn');
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

  const adblockBtn = document.getElementById('adblock-btn');
  const adblockSidebar = document.getElementById('adblock-sidebar');
  const closeAdblockBtn = document.getElementById('close-adblock');
  const adblockText = document.getElementById('adblock-rules');
  const saveAdblockBtn = document.getElementById('save-adblock-rules');

  ipcRenderer.invoke('update-adblock-rules', localStorage.getItem('adblock-rules') || '');

  const sidebars = [historySidebar, settingsSidebar, bookmarksSidebar, downloadsSidebar, adblockSidebar].filter(Boolean);
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

  if (adblockBtn) adblockBtn.onclick = () => {
    adblockText.value = localStorage.getItem('adblock-rules') || '';
    toggle(adblockSidebar, true);
  };
  if (closeAdblockBtn) closeAdblockBtn.onclick = () => toggle(adblockSidebar, false);
  if (saveAdblockBtn) saveAdblockBtn.onclick = () => {
    localStorage.setItem('adblock-rules', adblockText.value);
    ipcRenderer.invoke('update-adblock-rules', adblockText.value);
    saveAdblockBtn.textContent = t('adblock.saved');
    setTimeout(() => {
      saveAdblockBtn.textContent = t('adblock.save');
    }, 2000);
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

  metrics = () => {
    const chromeHeight = Math.ceil(chromeContainer.getBoundingClientRect().height);
    const barHeight = bookmarksBar && window.getComputedStyle(bookmarksBar).display !== 'none' ? Math.ceil(bookmarksBar.getBoundingClientRect().height) : 0;
    const top = chromeHeight + barHeight;
    const left = document.body.classList.contains('vertical-tabs') ? 240 : 0;
    document.documentElement.style.setProperty('--chrome-top', `${top}px`);
    ipcRenderer.send('set-chrome-metrics', { top, left });
  };

  window.onresize = metrics;
  setInterval(metrics, 1000);
  metrics();

  const savedColor = localStorage.getItem('browser-theme-color');
  if (savedColor) applyColor(savedColor);
  const storedLocale = localization.sanitizeLocale(localStorage.getItem('orion-locale'));
  if (storedLocale) setLocale(storedLocale);
  renderProfileList();
  renderBookmarksBar();

  addressBar.onkeydown = (e) => {
    if (e.key === 'Enter') {
      let url = addressBar.value.trim();
      if (url && !url.includes('.') && !url.includes('://')) {
        url = (S_ENG[localStorage.getItem('default-search-engine') || 'google'] || S_ENG.google) + encodeURIComponent(url);
      }
      ipcRenderer.invoke('navigate-to', url);
      addressBar.blur();
    }
  };
  clearTabsBtn.onclick = () => {
    if (activeTabId) ipcRenderer.invoke('clear-other-tabs', activeTabId);
  };
  backBtn.onclick = () => ipcRenderer.invoke('go-back');
  forwardBtn.onclick = () => ipcRenderer.invoke('go-forward');
  reloadBtn.onclick = () => ipcRenderer.invoke('reload-page');
  document.getElementById('home-btn').onclick = () => ipcRenderer.invoke('navigate-to', 'chrome://newtab');
  newTabBtn.onclick = () => ipcRenderer.invoke('create-tab', {
    tabId: `p-${activeProfile}-t-${Date.now()}`,
    url: 'chrome://newtab',
    inc: isIncognitoWindow
  });
  const incognitoTabBtn = document.getElementById('incognito-tab-btn');
  if (incognitoTabBtn) incognitoTabBtn.onclick = () => ipcRenderer.invoke('open-incognito-window', 'chrome://newtab');
  addBookmarkBtn.onclick = () => openBookmarkModal();

  const saveBm = (target) => {
    if (pendingBookmark) {
      saveBookmark(pendingBookmark.url, pendingBookmark.title, target);
      bookmarkDestModal.classList.remove('show');
      pendingBookmark = null;
    }
  };

  addToBarBtn.onclick = () => saveBm('bar');
  addToNewTabBtn.onclick = () => saveBm('newtab');
  addToBothBtn.onclick = () => saveBm('both');
  cancelBookmarkBtn.onclick = () => bookmarkDestModal.classList.remove('show');
  historyBtn.onclick = () => {
    toggle(historySidebar, true);
    ipcRenderer.send('fetch-and-show-history');
  };
  closeHistoryBtn.onclick = () => toggle(historySidebar, false);
  ['all', 'hour', 'today', 'week'].forEach((r) => {
    const b = document.getElementById(`clear-history-${r}`);
    if (b) b.onclick = async () => {
      if (confirm(t(`history.confirm.${r}`))) {
        await ipcRenderer.invoke('clear-history-range', r);
        ipcRenderer.send('fetch-and-show-history');
      }
    };
  });
  profileBtn.onclick = (e) => {
    e.stopPropagation();
    const show = !profileMenu.classList.contains('show');
    profileMenu.classList.toggle('show', show);
    if (!show) ipcRenderer.send('toggle-browser-view', true);
  };
  document.onclick = () => {
    if (profileMenu.classList.contains('show')) {
      profileMenu.classList.remove('show');
      ipcRenderer.send('toggle-browser-view', true);
    }
  };
  addProfileBtn.onclick = async (e) => {
    e.stopPropagation();
    await ipcRenderer.invoke('add-new-profile');
    profileMenu.classList.remove('show');
    ipcRenderer.send('toggle-browser-view', true);
  };
  renameSaveBtn.onclick = () => {
    const n = renameInput.value.trim();
    if (n && pendingRenameProfileId !== null) {
      ipcRenderer.send('rename-profile', { profileIndex: pendingRenameProfileId, newName: n });
      renameModal.classList.remove('show');
    }
  };
  renameCancelBtn.onclick = () => renameModal.classList.remove('show');
  bookmarkBtn.onclick = () => {
    const show = !bookmarksSidebar.classList.contains('open');
    toggle(bookmarksSidebar, show);
    if (show) renderBookmarks();
  };
  closeBookmarksBtn.onclick = () => toggle(bookmarksSidebar, false);
  settingsBtn.onclick = () => {
    toggle(settingsSidebar, true);
    const hero = document.getElementById('settings-hero');
    const opened = localStorage.getItem('settings-opened-once') === 'true';
    if (hero) {
      hero.style.display = opened ? 'none' : '';
      if (!opened) localStorage.setItem('settings-opened-once', 'true');
    }
  };
  closeSettingsBtn.onclick = () => toggle(settingsSidebar, false);
  openExtensionsBtn.onclick = () => {
    settingsSidebar.classList.remove('open');
    ipcRenderer.invoke('navigate-to', 'chrome://extensions');
    ipcRenderer.send('toggle-browser-view', true);
  };
  downloadsBtn.onclick = () => toggle(downloadsSidebar, !downloadsSidebar.classList.contains('open'));
  closeDownloadsBtn.onclick = () => toggle(downloadsSidebar, false);
  findInput.oninput = () => {
    const v = findInput.value.trim();
    if (v) ipcRenderer.invoke('find-in-page', v);
    else {
      ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
      findResults.textContent = t('find.empty');
    }
  };
  findInput.onkeydown = (e) => {
    if (e.key === 'Enter') ipcRenderer.invoke('find-in-page', findInput.value.trim(), { forward: !e.shiftKey, findNext: true });
    else if (e.key === 'Escape') {
      findBar.style.display = 'none';
      ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
    }
  };
  findNext.onclick = () => ipcRenderer.invoke('find-in-page', findInput.value.trim(), { forward: true, findNext: true });
  findPrev.onclick = () => ipcRenderer.invoke('find-in-page', findInput.value.trim(), { forward: false, findNext: true });
  findClose.onclick = () => {
    findBar.style.display = 'none';
    ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
  };
  initSettings();
  applyTranslations();
}

function initSettings() {
  const colors = ['#e9e9f0', '#ffffff', '#f0f4f8', '#e3f2fd', '#e8f5e9', '#fff3e0', '#fce4ec', '#f3e5f5', '#202124', '#3c4043', '#E0115F'];
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
  const se = document.getElementById('search-engine-select');
  if (vt) {
    vt.checked = localStorage.getItem('vertical-tabs') === 'true';
    if (vt.checked) document.body.classList.add('vertical-tabs');
    vt.onchange = (e) => {
      const en = e.target.checked;
      localStorage.setItem('vertical-tabs', en);
      document.body.classList.toggle('vertical-tabs', en);
      metrics();
    };
  }
  if (ss) {
    ss.checked = localStorage.getItem('show-seconds') === 'true';
    ss.onchange = (e) => localStorage.setItem('show-seconds', e.target.checked);
  }
  if (se) {
    se.innerHTML = SEARCH_ENGINES.map((engine) => `<option value="${engine.id}">${engine.label}</option>`).join('');
    se.value = localStorage.getItem('default-search-engine') || 'google';
    se.onchange = (e) => {
      const eng = e.target.value;
      localStorage.setItem('default-search-engine', eng);
      const url = S_HOME[eng] || S_HOME.google;
      ipcRenderer.send('update-default-search-engine', url);
      if (activeTabId) ipcRenderer.invoke('navigate-to', url);
    };
  }

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
  setActiveTab(t.id);
});
ipcRenderer.on('tab-switched', (e, { tabId, url, title, incognito }) => {
  if (!tabs.find((t) => t.id === tabId)) {
    addTabToUI({
      id: tabId,
      url: url || 'chrome://newtab',
      title: title || t('app.newTab'),
      incognito: !!incognito
    });
  }
  syncTabState({ id: tabId, url, title, incognito });
  setActiveTab(tabId);
  updateTabTitle(tabId, title);
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
  else if (t === 'focus-address-bar') {
    addressBar.focus();
    addressBar.select();
  } else if (t === 'show-history') historyBtn.click();
  else if (t === 'find-in-page') {
    findBar.style.display = findBar.style.display === 'none' ? 'flex' : 'none';
    if (findBar.style.display === 'flex') {
      findInput.focus();
      findInput.select();
    } else ipcRenderer.invoke('stop-find-in-page', 'clearSelection');
  }
});
ipcRenderer.on('tab-closed', (e, id) => {
  const el = document.querySelector(`.tab[data-id="${id}"]`);
  if (el) el.remove();
  tabs = tabs.filter((t) => t.id !== id);
});
ipcRenderer.on('profile-changed', (e, { profileIndex, tabs: pTabs, incognitoWindow }) => {
  activeProfile = profileIndex;
  isIncognitoWindow = !!incognitoWindow;
  document.body.classList.toggle('incognito-window', isIncognitoWindow);
  document.querySelectorAll('.tab').forEach((t) => t.remove());
  tabs = [];
  pTabs.forEach((t) => addTabToUI(t));
  renderProfileList();
});
ipcRenderer.on('profile-list-updated', (e, d) => {
  profiles = d.profiles;
  renderProfileList();
});
ipcRenderer.on('updater-status', (e, status) => {
  updaterState = { ...updaterState, ...status };
  renderUpdaterState();
});

function renderProfileList() {
  profileListContainer.innerHTML = '';
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
    profileListContainer.appendChild(item);
  });
}

function addTabToUI(t, anchorTabId = null) {
  if (tabs.find((x) => x.id === t.id)) {
    syncTabState(t);
    updateTabTitle(t.id, t.title);
    return;
  }

  const { element: el } = appUtils.createTabElement(document, t);
  el.onclick = (e) => {
    if (e.target.classList.contains('tab-close')) ipcRenderer.invoke('close-tab', t.id);
    else ipcRenderer.invoke('switch-tab', t.id);
  };
  const anchorEl = anchorTabId ? document.querySelector(`.tab[data-id="${anchorTabId}"]`) : null;
  if (anchorEl && anchorEl.parentElement === tabBar) tabBar.insertBefore(el, anchorEl.nextSibling);
  else tabBar.appendChild(el);
  const anchorIdx = anchorTabId ? tabs.findIndex((x) => x.id === anchorTabId) : -1;
  const nextTab = {
    id: t.id,
    url: normalizeTabUrl(t.url || 'chrome://newtab') || 'chrome://newtab',
    title: t.title || localization.t(currentLocale, 'app.loading'),
    incognito: !!t.incognito
  };
  if (anchorIdx >= 0) tabs.splice(anchorIdx + 1, 0, nextTab);
  else tabs.push(nextTab);
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
  if (t && addressBar) addressBar.value = formatUrl(t.url);
  const extras = Array.isArray(opts.alsoReveal) ? opts.alsoReveal : [];
  const revealIds = Array.from(new Set([id, ...extras].filter(Boolean)));
  ensureTabsVisible(revealIds);
}

function updateTabTitle(id, title) {
  const el = document.querySelector(`.tab[data-id="${id}"] .tab-title`);
  const nextTitle = title || t('app.loading');
  if (el) el.textContent = nextTitle;
  appUtils.syncTabRecord(tabs, id, { title: nextTitle });
}
const getBms = () => JSON.parse(localStorage.getItem('browser-bookmarks') || '[]');
function saveBookmark(u, t, target = 'both') {
  const bms = getBms();
  const idx = bms.findIndex((b) => b.url === u);
  if (idx !== -1) {
    bms[idx].target = target;
    bms[idx].title = t || bms[idx].title;
  } else {
    bms.push({ url: u, title: t || u, id: Date.now(), target });
  }
  localStorage.setItem('browser-bookmarks', JSON.stringify(bms));
  renderBookmarks();
  renderBookmarksBar();
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
  historyList.innerHTML = '';
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
      historySidebar.classList.remove('open');
      ipcRenderer.send('toggle-browser-view', true);
    };
    historyList.appendChild(el);
  });
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
  bookmarksBar.innerHTML = '';
  bms.forEach((b) => {
    const el = buildBookmarkBarItem(b);
    el.onclick = () => ipcRenderer.invoke('navigate-to', b.url);
    bookmarksBar.appendChild(el);
  });
  if (typeof window.onresize === 'function') window.onresize();
}
function renderBookmarks() {
  if (!bookmarksList) return;
  const bms = getBms();
  bookmarksList.innerHTML = bms.length ? '' : `<div style="text-align:center;padding:40px">${t('bookmarks.empty')}</div>`;
  bms.forEach((b) => {
    const el = buildBookmarkItem(b);
    const removeBtn = el.querySelector('.remove-bm');
    el.onclick = (e) => {
      if (e.target === removeBtn) return;
      ipcRenderer.invoke('navigate-to', b.url);
      bookmarksSidebar.classList.remove('open');
      ipcRenderer.send('toggle-browser-view', true);
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
    bookmarksList.appendChild(el);
  });
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
    const response = await ipcRenderer.invoke('get-language-settings');
    const locale = localization.sanitizeLocale(response && response.locale);
    if (locale) {
      setLocale(locale);
      try {
        localStorage.setItem('orion-locale', locale);
      } catch (_error) { }
      applyTranslations();
      hideStartupOverlay();
      return;
    }
  } catch (_error) { }

  setLocale(localization.DEFAULT_LOCALE);
  applyTranslations();
  showStartupOverlay();
}

bootstrap();
