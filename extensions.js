(() => {
  const pageBridge = window.orionPage || {
    getExtensions: async () => [],
    getLanguageSettings: async () => ({ locale: null, platform: null }),
    loadExtension: async () => ({ success: false, error: "Not running in Orion." }),
    removeExtension: async () => {},
    selectExtensionFolder: async () => null,
    setLanguage: async () => ({ locale: null })
  };
  const appUtils = window.OrionAppUtils;
  const localization = window.OrionLocalization;

  const loadBtn = document.getElementById("load-btn");
  const pathInput = document.getElementById("ext-path");
  const list = document.getElementById("ext-list");
  let currentLocale = localization.resolveLocale(localStorage.getItem("orion-locale"));
  let currentPlatform = getBrowserUiPlatform();

  const t = (key, vars = {}) => localization.t(currentLocale, key, getUiTextVars(vars));

  function getBrowserUiPlatform() {
    if (typeof navigator === "undefined") return localization.normalizeUiPlatform("");

    const candidates = [];
    try {
      if (navigator.userAgentData && typeof navigator.userAgentData.platform === "string") {
        candidates.push(navigator.userAgentData.platform);
      }
    } catch (_error) {}
    if (typeof navigator.platform === "string") candidates.push(navigator.platform);
    if (typeof navigator.userAgent === "string") candidates.push(navigator.userAgent);

    const platformCandidate = candidates.find((value) => typeof value === "string" && value.trim());
    return localization.normalizeUiPlatform(platformCandidate || "");
  }

  function getUiTextVars(vars = {}) {
    return {
      ...localization.getUiPlatformText(currentLocale, currentPlatform),
      ...vars
    };
  }

  function renderEmptyState(message) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    list.replaceChildren(empty);
  }

  function applyTranslations() {
    document.documentElement.lang = currentLocale;
    document.title = t("extension.pageTitle");
    document.getElementById("ext-eyebrow").textContent = t("extension.eyebrow");
    document.getElementById("ext-header").textContent = t("extension.header");
    document.getElementById("ext-badge").textContent = t("extension.badge");
    document.getElementById("ext-load-title").textContent = t("extension.loadTitle");
    document.getElementById("ext-load-body").textContent = t("extension.loadBody");
    document.getElementById("ext-load-example").textContent = t("extension.loadExample");
    document.getElementById("ext-installed-title").textContent = t("extension.installedTitle");
    document.getElementById("ext-installed-note").textContent = t("extension.installedNote");
    pathInput.setAttribute("placeholder", t("extension.pathPlaceholder"));
    loadBtn.textContent = loadBtn.disabled ? t("download.loading") : t("extension.loadButton");
  }

  async function syncLocale() {
    try {
      const response = await pageBridge.getLanguageSettings();
      const locale = localization.sanitizeLocale(response && response.locale);
      currentPlatform = localization.normalizeUiPlatform(response && response.platform ? response.platform : currentPlatform);
      if (locale) {
        currentLocale = locale;
        try {
          localStorage.setItem("orion-locale", locale);
        } catch (_error) {}
      }
    } catch (_error) {}
    applyTranslations();
    void refreshList();
  }

  async function removeExtension(id) {
    if (confirm(t("extension.removeConfirm"))) {
      try {
        const result = await pageBridge.removeExtension(id);
        if (result && result.error) {
          alert(t("extension.removeFailure", { error: result.error }));
        }
        void refreshList();
      } catch (error) {
        alert(t("extension.removeFailure", { error: error && error.message ? error.message : "Unknown error" }));
      }
    }
  }

  async function refreshList() {
    try {
      const extensions = await pageBridge.getExtensions();
      list.replaceChildren();

      if (!extensions || extensions.length === 0) {
        renderEmptyState(t("extension.empty"));
        return;
      }

      extensions.forEach((extensionInfo) => {
        const { card, removeBtn } = appUtils.createExtensionCard(document, extensionInfo, {
          noDescription: t("extension.noDescription"),
          remove: t("extension.remove"),
          unknown: t("extension.unknown")
        });
        removeBtn.addEventListener("click", () => {
          void removeExtension(extensionInfo.id);
        });
        list.appendChild(card);
      });
    } catch (error) {
      console.error("Failed to refresh extension list:", error);
      renderEmptyState(t("extension.error"));
    }
  }

  loadBtn.addEventListener("click", async () => {
    const selectedPath = await pageBridge.selectExtensionFolder();
    if (!selectedPath) return;

    pathInput.value = selectedPath;
    loadBtn.disabled = true;
    loadBtn.textContent = t("download.loading");

    try {
      const result = await pageBridge.loadExtension(selectedPath);
      if (result && result.success) {
        alert(t("extension.success"));
        pathInput.value = "";
        void refreshList();
      } else {
        alert(t("extension.loadFailure", { error: result && result.error ? result.error : "Unknown error" }));
      }
    } catch (error) {
      alert(t("extension.invokeFailure", { error: error && error.message ? error.message : "Unknown error" }));
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = t("extension.loadButton");
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "orion-locale" && localization.sanitizeLocale(event.newValue)) {
      currentLocale = localization.resolveLocale(event.newValue);
      applyTranslations();
      void refreshList();
    }
  });

  applyTranslations();
  void refreshList();
  void syncLocale();
})();
