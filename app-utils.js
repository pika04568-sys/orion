(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OrionAppUtils = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const INTERNAL_PAGE_ALIASES = Object.freeze({
    "newtab.html": "chrome://newtab",
    "extensions.html": "chrome://extensions"
  });

  function getInternalAlias(url) {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("chrome://")) return url;

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "file:") return null;
      const file = parsed.pathname.split("/").pop().toLowerCase();
      return INTERNAL_PAGE_ALIASES[file] || null;
    } catch (error) {
      return null;
    }
  }

  function normalizeInternalUrl(url, fallbackUrl = "") {
    if (!url || typeof url !== "string") return fallbackUrl || "";
    return getInternalAlias(url) || url;
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
        incognito: !!tabLike.incognito
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
    INTERNAL_PAGE_ALIASES,
    createExtensionCard,
    createTabElement,
    getActiveTabBookmark,
    normalizeInternalUrl,
    removeBookmarkById,
    syncTabRecord,
    upsertTabRecord
  };
});
