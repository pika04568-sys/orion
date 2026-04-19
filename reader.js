(() => {
  const bridge = window.orionPage || {};
  const localization = window.OrionLocalization;
  const readerKicker = document.getElementById("reader-kicker");
  const pageLabel = document.getElementById("page-label");
  const siteNameEl = document.getElementById("site-name");
  const readerTitleEl = document.getElementById("reader-title");
  const readerSubtitleEl = document.getElementById("reader-subtitle");
  const readerMetaEl = document.getElementById("reader-meta");
  const readerContentEl = document.getElementById("reader-content");
  const readerStateEl = document.getElementById("reader-state");
  const readerCardEl = document.getElementById("reader-card");
  const exitBtn = document.getElementById("exit-reader");
  const themeButtons = Array.from(document.querySelectorAll(".chip[data-theme]"));
  const themeControls = document.getElementById("reader-theme-controls");
  const fontControls = document.getElementById("reader-font-controls");
  const fontSmaller = document.getElementById("font-smaller");
  const fontReset = document.getElementById("font-reset");
  const fontLarger = document.getElementById("font-larger");

  const THEME_KEY = "reader-theme";
  const FONT_SIZE_KEY = "reader-font-size";
  const DEFAULT_FONT_SIZE = 20;
  const MIN_FONT_SIZE = 17;
  const MAX_FONT_SIZE = 28;

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  let currentFontSize = Number.parseInt(safeGet(FONT_SIZE_KEY) || String(DEFAULT_FONT_SIZE), 10);
  if (!Number.isFinite(currentFontSize)) currentFontSize = DEFAULT_FONT_SIZE;
  const currentLocale = localization && typeof localization.sanitizeLocale === "function"
    ? (localization.sanitizeLocale(safeGet("orion-locale")) || localization.DEFAULT_LOCALE || "en")
    : "en";

  function t(key, vars = {}) {
    if (!localization || typeof localization.t !== "function") return key;
    return localization.t(currentLocale, key, vars);
  }

  function formatDateTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    try {
      return parsed.toLocaleString(localization.getIntlLocale(currentLocale));
    } catch (_error) {
      return parsed.toLocaleString();
    }
  }

  function clearRenderedImages() {
    document.querySelectorAll(".reader-image").forEach((element) => element.remove());
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_error) { }
  }

  function setTheme(theme) {
    const nextTheme = theme || "sepia";
    document.body.dataset.theme = nextTheme;
    themeButtons.forEach((button) => button.classList.toggle("active", button.dataset.theme === nextTheme));
    safeSet(THEME_KEY, nextTheme);
  }

  function setFontSize(value) {
    currentFontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
    document.documentElement.style.setProperty("--page-font-size", `${currentFontSize}px`);
    safeSet(FONT_SIZE_KEY, String(currentFontSize));
  }

  function renderMeta(snapshot) {
    readerMetaEl.innerHTML = "";
    const metaItems = [];

    if (snapshot.byline) metaItems.push(snapshot.byline);
    if (snapshot.publishedDate) metaItems.push(formatDateTime(snapshot.publishedDate));
    if (snapshot.modifiedDate && snapshot.modifiedDate !== snapshot.publishedDate) {
      metaItems.push(t("reader.updated", { value: formatDateTime(snapshot.modifiedDate) }));
    }

    if (snapshot.canonicalUrl && snapshot.canonicalUrl !== snapshot.sourceUrl) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "source-link";
      sourceLink.href = snapshot.canonicalUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noreferrer noopener";
      sourceLink.textContent = t("reader.openCanonicalSource");
      readerMetaEl.appendChild(sourceLink);
    }

    metaItems.forEach((item) => {
      const span = document.createElement("span");
      span.textContent = item;
      readerMetaEl.appendChild(span);
    });
  }

  function renderBlocks(snapshot) {
    readerContentEl.innerHTML = "";
    snapshot.blocks.forEach((block) => {
      if (block.type === "heading") {
        const heading = document.createElement("h2");
        heading.textContent = block.text;
        readerContentEl.appendChild(heading);
        return;
      }

      if (block.type === "quote") {
        const quote = document.createElement("blockquote");
        quote.textContent = block.text;
        readerContentEl.appendChild(quote);
        return;
      }

      if (block.type === "list") {
        const list = document.createElement("ul");
        block.text
          .split(/\s*(?:\u2022|•|\u2013|\-)\s+/)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .forEach((entry) => {
            const item = document.createElement("li");
            item.textContent = entry;
            list.appendChild(item);
          });
        if (!list.childElementCount) {
          const fallback = document.createElement("li");
          fallback.textContent = block.text;
          list.appendChild(fallback);
        }
        readerContentEl.appendChild(list);
        return;
      }

      const paragraph = document.createElement("p");
      paragraph.textContent = block.text;
      readerContentEl.appendChild(paragraph);
    });
  }

  function renderImages(snapshot) {
    clearRenderedImages();
    if (!snapshot.images || snapshot.images.length === 0) return;

    snapshot.images.forEach((image, index) => {
      const figure = document.createElement("figure");
      figure.className = "reader-image";

      const img = document.createElement("img");
      img.src = image.src;
      img.alt = image.alt || snapshot.title || t("reader.untitledArticle");
      img.loading = index === 0 ? "eager" : "lazy";
      img.decoding = "async";

      img.onerror = () => {
        figure.remove();
      };

      figure.appendChild(img);

      if (image.alt) {
        const caption = document.createElement("figcaption");
        caption.textContent = image.alt;
        figure.appendChild(caption);
      }

      if (index === 0 && readerSubtitleEl) {
        readerSubtitleEl.parentNode.insertBefore(figure, readerSubtitleEl.nextSibling);
      } else {
        readerContentEl.appendChild(figure);
      }
    });
  }

  function renderUnavailable(snapshot) {
    readerCardEl.classList.add("unavailable");
    clearRenderedImages();
    readerStateEl.textContent = snapshot && snapshot.reason ? snapshot.reason : t("reader.unavailableState");
    readerStateEl.classList.remove("hidden");
    document.title = t("reader.unavailable");
    pageLabel.textContent = t("reader.unavailable");
    siteNameEl.textContent = snapshot && snapshot.siteName ? snapshot.siteName : "";
    readerTitleEl.textContent = snapshot && snapshot.title ? snapshot.title : t("reader.unavailableTitle");
    readerSubtitleEl.textContent = t("reader.unavailableSubtitle");
    readerMetaEl.innerHTML = "";
    readerContentEl.innerHTML = "";
  }

  function renderSnapshot(snapshot) {
    if (!snapshot || !snapshot.readable) {
      renderUnavailable(snapshot || {});
      return;
    }

    readerCardEl.classList.remove("unavailable");
    readerStateEl.classList.add("hidden");
    document.title = snapshot.title ? `${snapshot.title} • ${t("reader.title")}` : t("reader.title");
    pageLabel.textContent = snapshot.siteName || t("reader.modeLabel");
    siteNameEl.textContent = snapshot.siteName || t("reader.modeLabel");
    readerTitleEl.textContent = snapshot.title || t("reader.untitledArticle");
    readerSubtitleEl.textContent = snapshot.excerpt || "";
    renderMeta(snapshot);
    renderImages(snapshot);
    renderBlocks(snapshot);
    if (!readerContentEl.childElementCount && snapshot.excerpt) {
      const fallback = document.createElement("p");
      fallback.textContent = snapshot.excerpt;
      readerContentEl.appendChild(fallback);
    }
  }

  function applySavedPreferences() {
    setTheme(safeGet(THEME_KEY) || "sepia");
    setFontSize(Number.parseInt(safeGet(FONT_SIZE_KEY) || String(DEFAULT_FONT_SIZE), 10));
  }

  function applyStaticTranslations() {
    document.documentElement.lang = currentLocale;
    if (readerKicker) readerKicker.textContent = t("reader.modeLabel");
    if (pageLabel) pageLabel.textContent = t("reader.loadingArticle");
    if (themeControls) themeControls.setAttribute("aria-label", t("reader.theme"));
    if (fontControls) fontControls.setAttribute("aria-label", t("reader.fontSize"));
    document.title = t("reader.title");

    themeButtons.forEach((button) => {
      button.textContent = t(`reader.theme${button.dataset.theme.charAt(0).toUpperCase()}${button.dataset.theme.slice(1)}`);
    });
    if (exitBtn) exitBtn.textContent = t("reader.backToPage");
  }

  async function loadSnapshot() {
    try {
      const snapshot = await bridge.getReaderContent();
      if (!snapshot) {
        renderUnavailable({
          reason: t("reader.dataNotReady")
        });
        return;
      }
      renderSnapshot(snapshot);
    } catch (_error) {
      renderUnavailable({
        reason: t("reader.loadFailed")
      });
    }
  }

  themeButtons.forEach((button) => {
    button.addEventListener("click", () => setTheme(button.dataset.theme));
  });

  fontSmaller.addEventListener("click", () => setFontSize(currentFontSize - 1));
  fontReset.addEventListener("click", () => setFontSize(DEFAULT_FONT_SIZE));
  fontLarger.addEventListener("click", () => setFontSize(currentFontSize + 1));

  exitBtn.addEventListener("click", () => {
    if (typeof bridge.closeReader === "function") bridge.closeReader();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && typeof bridge.closeReader === "function") {
      event.preventDefault();
      bridge.closeReader();
    }
  });

  applyStaticTranslations();
  applySavedPreferences();
  void loadSnapshot();
})();
