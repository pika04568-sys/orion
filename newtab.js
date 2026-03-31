(() => {
  const localization = window.OrionLocalization;
  const pageBridge = window.orionPage || null;
  const clock = document.getElementById('c');
  const dateE = document.getElementById('d');
  const search = document.getElementById('i');
  const grid = document.getElementById('g');

  const LOCALE_KEY = 'orion-locale';
  const SHOW_SECONDS_KEY = 'show-seconds';
  const BOOKMARKS_KEY = 'browser-bookmarks';
  const HIDDEN_DEFAULT_SHORTCUTS_KEY = 'hidden-default-newtab-shortcuts';

  const MAX_STORAGE_LENGTH = 100000;
  const MAX_BOOKMARKS = 200;
  const MAX_HIDDEN_DEFAULT_SHORTCUTS = 32;
  const MAX_TITLE_LENGTH = 120;
  const MAX_URL_LENGTH = 2048;
  const MAX_ID_LENGTH = 64;
  const SEARCH_URL = 'https://www.google.com/search';

  const defaultShortcuts = Object.freeze([
    { name: 'Google', url: 'https://google.com', icon: 'G' },
    { name: 'YouTube', url: 'https://youtube.com', icon: 'Y' },
    { name: 'GitHub', url: 'https://github.com', icon: 'H' },
    { name: 'Wikipedia', url: 'https://wikipedia.org', icon: 'W' }
  ].map((entry) => ({
    ...entry,
    url: normalizeNavigableUrl(entry.url)
  })).filter((entry) => !!entry.url));

  const defaultShortcutUrlSet = new Set(defaultShortcuts.map((entry) => entry.url));

  let currentLocale = localization.resolveLocale(safeLocalStorageGet(LOCALE_KEY));
  let currentPlatform = getBrowserUiPlatform();
  let clockTimer = null;
  let showSecondsEnabled = null;

  function safeLocalStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clampText(value, maxLength) {
    if (value == null) return '';
    const text = String(value).trim();
    if (!text) return '';
    return text.slice(0, maxLength);
  }

  function normalizeNavigableUrl(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href.length <= MAX_URL_LENGTH ? parsed.href : null;
    } catch (_error) {
      return null;
    }
  }

  function readJsonArray(key, mapper, maxItems, maxLength) {
    const raw = safeLocalStorageGet(key);
    if (!raw || raw.length > maxLength) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const result = [];
    for (const item of parsed) {
      if (result.length >= maxItems) break;
      const mapped = mapper(item);
      if (mapped != null) result.push(mapped);
    }
    return result;
  }

  function sanitizeBookmarkRecord(entry) {
    if (!entry || typeof entry !== 'object') return null;

    const url = normalizeNavigableUrl(entry.url);
    if (!url) return null;

    const title = clampText(entry.title || entry.name || url, MAX_TITLE_LENGTH) || url;
    const id = entry.id == null ? '' : clampText(entry.id, MAX_ID_LENGTH);
    const target = entry.target === 'bar' || entry.target === 'newtab' || entry.target === 'both'
      ? entry.target
      : 'both';

    return { url, title, id, target };
  }

  function readBookmarks() {
    return readJsonArray(BOOKMARKS_KEY, sanitizeBookmarkRecord, MAX_BOOKMARKS, MAX_STORAGE_LENGTH);
  }

  function persistBookmarks(bookmarks) {
    const normalized = bookmarks
      .map(sanitizeBookmarkRecord)
      .filter(Boolean)
      .slice(0, MAX_BOOKMARKS);
    safeLocalStorageSet(BOOKMARKS_KEY, JSON.stringify(normalized));
  }

  function sanitizeHiddenDefaultShortcut(entry) {
    const url = normalizeNavigableUrl(entry);
    return url && defaultShortcutUrlSet.has(url) ? url : null;
  }

  function readHiddenDefaultShortcuts() {
    const hidden = readJsonArray(
      HIDDEN_DEFAULT_SHORTCUTS_KEY,
      sanitizeHiddenDefaultShortcut,
      MAX_HIDDEN_DEFAULT_SHORTCUTS,
      MAX_STORAGE_LENGTH
    );
    return Array.from(new Set(hidden));
  }

  function persistHiddenDefaultShortcuts(shortcuts) {
    const normalized = Array.from(new Set(shortcuts))
      .map(sanitizeHiddenDefaultShortcut)
      .filter(Boolean)
      .slice(0, MAX_HIDDEN_DEFAULT_SHORTCUTS);
    safeLocalStorageSet(HIDDEN_DEFAULT_SHORTCUTS_KEY, JSON.stringify(normalized));
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

  function applyTranslations() {
    document.documentElement.lang = currentLocale;
    document.title = t('newtab.pageTitle');
    if (search) search.setAttribute('placeholder', t('newtab.searchPlaceholder'));
  }

  function shouldShowSeconds() {
    if (typeof showSecondsEnabled === 'boolean') return showSecondsEnabled;
    return safeLocalStorageGet(SHOW_SECONDS_KEY) === 'true';
  }

  function applyShowSecondsSetting(enabled) {
    showSecondsEnabled = !!enabled;
    safeLocalStorageSet(SHOW_SECONDS_KEY, showSecondsEnabled ? 'true' : 'false');
  }

  function updateTime() {
    if (!clock || !dateE) return;

    const now = new Date();
    const showSeconds = shouldShowSeconds();
    const timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false };
    if (showSeconds) timeOpts.second = '2-digit';

    const intlLocale = localization.getIntlLocale(currentLocale);
    clock.textContent = now.toLocaleTimeString(intlLocale, timeOpts);
    dateE.textContent = now.toLocaleDateString(intlLocale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }

  function tickClock() {
    updateTime();
    scheduleClockTick();
  }

  function scheduleClockTick() {
    if (clockTimer) {
      clearTimeout(clockTimer);
      clockTimer = null;
    }

    const now = new Date();
    const delay = shouldShowSeconds()
      ? Math.max(250, 1000 - now.getMilliseconds())
      : Math.max(250, ((60 - now.getSeconds()) * 1000) - now.getMilliseconds());

    clockTimer = window.setTimeout(tickClock, delay);
  }

  function getStoredShortcuts() {
    return readBookmarks().filter((bookmark) => bookmark.target === 'newtab' || bookmark.target === 'both');
  }

  function getDefaultShortcuts() {
    const hidden = new Set(readHiddenDefaultShortcuts());
    return defaultShortcuts
      .filter((entry) => !hidden.has(entry.url))
      .map((entry) => ({
        url: entry.url,
        title: entry.name,
        id: '',
        isDefaultShortcut: true,
        icon: entry.icon
      }));
  }

  function getVisibleShortcuts() {
    const stored = getStoredShortcuts();
    return stored.length > 0
      ? stored.map((entry) => ({
        ...entry,
        isDefaultShortcut: false
      }))
      : getDefaultShortcuts();
  }

  function hideShortcutRemoveButtons() {
    if (!grid) return;
    grid.querySelectorAll('.shortcut.show-remove').forEach((el) => el.classList.remove('show-remove'));
  }

  function hideDefaultShortcut(url) {
    const safeUrl = normalizeNavigableUrl(url);
    if (!safeUrl || !defaultShortcutUrlSet.has(safeUrl)) return;

    const hidden = readHiddenDefaultShortcuts();
    if (!hidden.includes(safeUrl)) {
      hidden.push(safeUrl);
      persistHiddenDefaultShortcuts(hidden);
    }
  }

  function removeStoredShortcut(url, id) {
    const safeUrl = normalizeNavigableUrl(url);
    const bookmarks = readBookmarks();
    const filtered = bookmarks.filter((bookmark) => {
      if (id) return String(bookmark.id) !== String(id);
      return safeUrl ? bookmark.url !== safeUrl : true;
    });
    persistBookmarks(filtered);
  }

  function navigateShortcut(url) {
    const safeUrl = normalizeNavigableUrl(url);
    if (!safeUrl) return;

    if (pageBridge && typeof pageBridge.navigateTo === 'function') {
      const pending = pageBridge.navigateTo(safeUrl);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      return;
    }

    window.location.assign(safeUrl);
  }

  function navigateSearch(query) {
    const safeQuery = clampText(query, MAX_TITLE_LENGTH * 16);
    if (!safeQuery) return;

    if (pageBridge && typeof pageBridge.navigateTo === 'function') {
      const pending = pageBridge.navigateTo(safeQuery);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      return;
    }

    const searchUrl = new URL(SEARCH_URL);
    searchUrl.searchParams.set('q', safeQuery);
    window.location.assign(searchUrl.href);
  }

  function createShortcutCard(shortcut, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'shortcut';
    wrapper.style.setProperty('--i', String(index + 1));
    wrapper.dataset.url = shortcut.url;

    if (shortcut.id) wrapper.dataset.id = String(shortcut.id);
    if (shortcut.isDefaultShortcut) wrapper.dataset.default = 'true';

    const link = document.createElement('a');
    link.href = shortcut.url;
    link.rel = 'noreferrer noopener';

    const displayTitle = clampText(shortcut.title || shortcut.name || shortcut.url || '?', MAX_TITLE_LENGTH) || shortcut.url || '?';
    const label = document.createElement('b');
    label.textContent = (shortcut.icon || displayTitle[0] || '?').toUpperCase();

    const title = document.createElement('small');
    title.textContent = displayTitle;

    link.append(label, title);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigateShortcut(shortcut.url);
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-shortcut';
    removeButton.setAttribute('aria-label', t('newtab.removeShortcut', { name: displayTitle }));
    removeButton.textContent = '×';
    removeButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (shortcut.isDefaultShortcut) {
        hideDefaultShortcut(shortcut.url);
      } else {
        removeStoredShortcut(shortcut.url, shortcut.id);
      }
      renderShortcuts();
    });

    wrapper.append(link, removeButton);
    return wrapper;
  }

  function renderShortcuts() {
    if (!grid) return;

    const shortcuts = getVisibleShortcuts();
    const fragment = document.createDocumentFragment();

    shortcuts.forEach((shortcut, index) => {
      const card = createShortcutCard(shortcut, index);
      fragment.appendChild(card);
    });

    grid.replaceChildren(fragment);
  }

  async function syncLocale() {
    try {
      if (pageBridge && typeof pageBridge.getLanguageSettings === 'function') {
        const response = await pageBridge.getLanguageSettings();
        const locale = localization.sanitizeLocale(response && response.locale);
        currentPlatform = localization.normalizeUiPlatform(response && response.platform ? response.platform : currentPlatform);
        if (locale) {
          currentLocale = locale;
          safeLocalStorageSet(LOCALE_KEY, locale);
        }
      }
    } catch (_error) {
      // Ignore and keep the locally resolved locale.
    }

    applyTranslations();
    updateTime();
    renderShortcuts();
    scheduleClockTick();
  }

  function handleStorageEvent(event) {
    if (!event) return;

    if (event.key === SHOW_SECONDS_KEY) {
      applyShowSecondsSetting(event.newValue === 'true');
      updateTime();
      scheduleClockTick();
      return;
    }

    if (event.key === LOCALE_KEY) {
      const nextLocale = localization.sanitizeLocale(event.newValue);
      if (!nextLocale) return;
      currentLocale = nextLocale;
      applyTranslations();
      updateTime();
      renderShortcuts();
      return;
    }

    if (event.key === BOOKMARKS_KEY || event.key === HIDDEN_DEFAULT_SHORTCUTS_KEY) {
      renderShortcuts();
    }
  }

  async function syncShowSecondsSetting() {
    try {
      if (pageBridge && typeof pageBridge.getBrowserSettings === 'function') {
        const response = await pageBridge.getBrowserSettings();
        if (response && typeof response.showSeconds === 'boolean') {
          applyShowSecondsSetting(response.showSeconds);
          updateTime();
          scheduleClockTick();
          return;
        }
      }
    } catch (_error) {
      // Keep the locally resolved value when the shared settings store is unavailable.
    }

    applyShowSecondsSetting(safeLocalStorageGet(SHOW_SECONDS_KEY) === 'true');
    updateTime();
    scheduleClockTick();
  }

  function handleGridContextMenu(event) {
    if (!grid || !(event.target instanceof Node)) return;
    const shortcutEl = event.target.closest('.shortcut');
    if (!shortcutEl || !grid.contains(shortcutEl)) return;

    event.preventDefault();
    hideShortcutRemoveButtons();
    shortcutEl.classList.add('show-remove');
  }

  function handleDocumentClick(event) {
    if (!grid || !(event.target instanceof Node)) return;
    if (!grid.contains(event.target)) hideShortcutRemoveButtons();
  }

  function handleSearchKeydown(event) {
    if (event.key !== 'Enter') return;

    const query = search ? search.value.trim() : '';
    if (!query) return;

    event.preventDefault();
    navigateSearch(query);
  }

  function startReducedMotionParallax() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const orbLayer = document.querySelector('.orbs');
    const cardOrbLayer = document.querySelector('.card-orbs');

    if (prefersReducedMotion || !orbLayer || !cardOrbLayer) return;

    let frame = null;
    let px = 0;
    let py = 0;

    const paintParallax = () => {
      orbLayer.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      cardOrbLayer.style.transform = `translate3d(${px * 0.55}px, ${py * 0.55}px, 0)`;
      frame = null;
    };

    document.addEventListener('mousemove', (event) => {
      px = (event.clientX / window.innerWidth - 0.5) * 20;
      py = (event.clientY / window.innerHeight - 0.5) * 20;
      if (!frame) frame = requestAnimationFrame(paintParallax);
    });

    document.addEventListener('mouseleave', () => {
      px = 0;
      py = 0;
      if (!frame) frame = requestAnimationFrame(paintParallax);
    });
  }

  applyTranslations();
  updateTime();
  scheduleClockTick();
  renderShortcuts();
  void syncLocale();
  void syncShowSecondsSetting();

  document.addEventListener('click', handleDocumentClick);
  if (grid) {
    grid.addEventListener('contextmenu', handleGridContextMenu);
  }
  if (search) {
    search.addEventListener('keydown', handleSearchKeydown);
  }
  if (pageBridge && typeof pageBridge.on === 'function') {
    pageBridge.on('browser-settings-changed', (_event, settings) => {
      if (!settings || typeof settings.showSeconds !== 'boolean') return;
      applyShowSecondsSetting(settings.showSeconds);
      updateTime();
      scheduleClockTick();
    });
  }
  window.addEventListener('storage', handleStorageEvent);
  startReducedMotionParallax();
})();
