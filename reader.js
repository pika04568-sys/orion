(() => {
  const bridge = window.orionPage || {};
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
  const fontSmaller = document.getElementById("font-smaller");
  const fontReset = document.getElementById("font-reset");
  const fontLarger = document.getElementById("font-larger");

  const THEME_KEY = "reader-theme";
  const FONT_SIZE_KEY = "reader-font-size";
  const DEFAULT_FONT_SIZE = 20;
  const MIN_FONT_SIZE = 17;
  const MAX_FONT_SIZE = 28;

  let currentFontSize = Number.parseInt(localStorage.getItem(FONT_SIZE_KEY) || String(DEFAULT_FONT_SIZE), 10);
  if (!Number.isFinite(currentFontSize)) currentFontSize = DEFAULT_FONT_SIZE;

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
    if (snapshot.publishedDate) {
      const parsed = new Date(snapshot.publishedDate);
      metaItems.push(Number.isNaN(parsed.getTime()) ? snapshot.publishedDate : parsed.toLocaleString());
    }
    if (snapshot.modifiedDate && snapshot.modifiedDate !== snapshot.publishedDate) {
      const parsed = new Date(snapshot.modifiedDate);
      metaItems.push(`Updated ${Number.isNaN(parsed.getTime()) ? snapshot.modifiedDate : parsed.toLocaleString()}`);
    }

    if (snapshot.canonicalUrl && snapshot.canonicalUrl !== snapshot.sourceUrl) {
      const sourceLink = document.createElement("a");
      sourceLink.className = "source-link";
      sourceLink.href = snapshot.canonicalUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noreferrer noopener";
      sourceLink.textContent = "Open canonical source";
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
    snapshot.images.forEach((image) => {
      const figure = document.createElement("figure");
      const img = document.createElement("img");
      img.src = image.src;
      img.alt = image.alt || snapshot.title || "Article image";
      img.loading = "lazy";
      figure.appendChild(img);
      if (image.alt) {
        const caption = document.createElement("figcaption");
        caption.textContent = image.alt;
        figure.appendChild(caption);
      }
      readerContentEl.appendChild(figure);
    });
  }

  function renderUnavailable(snapshot) {
    readerCardEl.classList.add("unavailable");
    readerStateEl.textContent = snapshot && snapshot.reason ? snapshot.reason : "Reader mode is unavailable for this page.";
    readerStateEl.classList.remove("hidden");
    document.title = "Reader unavailable";
    pageLabel.textContent = "Reader unavailable";
    siteNameEl.textContent = snapshot && snapshot.siteName ? snapshot.siteName : "";
    readerTitleEl.textContent = snapshot && snapshot.title ? snapshot.title : "This page could not be converted";
    readerSubtitleEl.textContent = "Orion could not confidently extract a readable article from this page.";
    readerMetaEl.innerHTML = "";
    readerContentEl.innerHTML = "";
    readerCardEl.classList.add("unavailable");
  }

  function renderSnapshot(snapshot) {
    if (!snapshot || !snapshot.readable) {
      renderUnavailable(snapshot || {});
      return;
    }

    readerCardEl.classList.remove("unavailable");
    readerStateEl.classList.add("hidden");
    document.title = snapshot.title ? `${snapshot.title} • Reader` : "Reader";
    pageLabel.textContent = snapshot.siteName || "Reader mode";
    siteNameEl.textContent = snapshot.siteName || "Reader mode";
    readerTitleEl.textContent = snapshot.title || "Untitled article";
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
    setTheme(localStorage.getItem(THEME_KEY) || "sepia");
    setFontSize(Number.parseInt(localStorage.getItem(FONT_SIZE_KEY) || String(DEFAULT_FONT_SIZE), 10));
  }

  async function loadSnapshot() {
    try {
      const snapshot = await bridge.getReaderContent();
      if (!snapshot) {
        renderUnavailable({
          reason: "Reader data is not ready yet."
        });
        return;
      }
      renderSnapshot(snapshot);
    } catch (_error) {
      renderUnavailable({
        reason: "Orion could not load reader mode for this page."
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

  applySavedPreferences();
  void loadSnapshot();
})();
