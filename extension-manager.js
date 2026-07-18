const path = require("path");

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";
const EXTENSION_LICENSE = "GPL-3.0";
const UBLOCK_ORIGIN_LITE_ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";
const WEB_STORE_SOURCE = "chrome-web-store";
const UNPACKED_SOURCE = "unpacked";
const MANAGED_EXTENSION_ERROR = "uBlock Origin Lite is managed by Orion and cannot be removed.";
const MANAGED_RECONCILE_DELAY_MS = 500;

function getSessionExtensionApi(sess) {
  if (!sess) return null;
  return sess.extensions || sess;
}

function isPersistentSession(sess) {
  if (!sess) return false;
  return typeof sess.isPersistent !== "function" ? true : sess.isPersistent();
}

function normalizePathForCompare(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isPathInside(childPath, parentPath) {
  const child = normalizePathForCompare(childPath);
  const parent = normalizePathForCompare(parentPath);
  return !!child && !!parent && (child === parent || child.startsWith(`${parent}/`));
}

function collectManifestPermissions(manifest = {}) {
  const values = [];
  const pushString = (value, prefix = "") => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed) values.push(prefix ? `${prefix}${trimmed}` : trimmed);
  };

  ["permissions", "optional_permissions"].forEach((key) => {
    if (Array.isArray(manifest[key])) manifest[key].forEach((value) => pushString(value));
  });
  ["host_permissions", "optional_host_permissions"].forEach((key) => {
    if (Array.isArray(manifest[key])) manifest[key].forEach((value) => pushString(value, "host:"));
  });
  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((entry) => {
      if (!entry || !Array.isArray(entry.matches)) return;
      entry.matches.forEach((value) => pushString(value, "content-script:"));
    });
  }

  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function formatPermissionList(manifest = {}) {
  const permissions = collectManifestPermissions(manifest);
  if (!permissions.length) return "No explicit extension permissions were declared.";
  return permissions.map((permission) => `- ${permission}`).join("\n");
}

function getExtensionSource(extensionPath, extensionsPath) {
  return isPathInside(extensionPath, extensionsPath) ? WEB_STORE_SOURCE : UNPACKED_SOURCE;
}

function createExtensionSummary(ext, extensionsPath, managedExtensionId = UBLOCK_ORIGIN_LITE_ID) {
  const manifest = ext && ext.manifest && typeof ext.manifest === "object" ? ext.manifest : {};
  const source = getExtensionSource(ext && ext.path, extensionsPath);
  const managed = !!(ext && ext.id === managedExtensionId);
  return {
    id: ext && ext.id,
    name: (ext && ext.name) || manifest.name || "Extension",
    version: (ext && ext.version) || manifest.version || "",
    description: (ext && ext.description) || manifest.description || "",
    source,
    manifestVersion: Number.isInteger(manifest.manifest_version) ? manifest.manifest_version : null,
    canUpdate: source === WEB_STORE_SOURCE,
    managed,
    removable: !managed
  };
}

function createExtensionManager({
  app,
  dialog,
  ElectronChromeExtensions,
  chromeWebStore,
  createTab,
  selectTab,
  removeTab,
  createWindow,
  removeWindow,
  assignTabDetails,
  requestPermissions,
  managedExtensionId = UBLOCK_ORIGIN_LITE_ID,
  managedReconcileDelayMs = MANAGED_RECONCILE_DELAY_MS,
  onManagedExtensionStatusChanged = () => {}
} = {}) {
  const profiles = new Map();

  function createManagedStatus(profileIndex, patch = {}) {
    return {
      profileIndex,
      extensionId: managedExtensionId,
      state: "idle",
      version: null,
      error: null,
      ...patch
    };
  }

  function setManagedStatus(profile, patch) {
    profile.managedStatus = Object.freeze({
      ...profile.managedStatus,
      ...patch,
      profileIndex: profile.profileIndex,
      extensionId: managedExtensionId
    });
    try {
      onManagedExtensionStatusChanged(profile.profileIndex, profile.managedStatus);
    } catch (_error) {}
    return profile.managedStatus;
  }

  function scheduleManagedReconciliation(profile) {
    if (!profile || profile.managedReconcileTimer) return;
    setManagedStatus(profile, {
      state: "installing",
      version: null,
      error: null
    });
    profile.managedReconcileTimer = setTimeout(() => {
      profile.managedReconcileTimer = null;
      void ensureManagedExtension(profile.profileIndex, profile.session, { force: true }).catch(() => {});
    }, managedReconcileDelayMs);
    if (typeof profile.managedReconcileTimer.unref === "function") {
      profile.managedReconcileTimer.unref();
    }
  }

  function getProfileExtensionsPath(profileIndex) {
    return path.join(app.getPath("userData"), "Extensions", `profile-${profileIndex}`);
  }

  async function confirmWebStoreInstall(details = {}) {
    const manifest = details.manifest || {};
    const ownerWindow = details.browserWindow;
    const title = details.localizedName || manifest.name || details.id || "Extension";
    const detail = [
      `ID: ${details.id || "unknown"}`,
      manifest.version ? `Version: ${manifest.version}` : "Version: not specified",
      Number.isInteger(manifest.manifest_version) ? `Manifest: v${manifest.manifest_version}` : "Manifest: not specified",
      "",
      "Declared permissions:",
      formatPermissionList(manifest),
      "",
      "Only install Chrome Web Store extensions from publishers you trust."
    ].join("\n");
    const options = {
      type: "warning",
      buttons: ["Install Extension", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Review Chrome Web Store Extension",
      message: `Install "${title}"?`,
      detail
    };
    const result = ownerWindow && typeof ownerWindow.isDestroyed === "function" && !ownerWindow.isDestroyed()
      ? await dialog.showMessageBox(ownerWindow, options)
      : await dialog.showMessageBox(options);
    return { action: result.response === 0 ? "allow" : "deny" };
  }

  function ensureProfile(profileIndex, sess, options = {}) {
    if (options.incognito || !isPersistentSession(sess)) return null;
    if (profiles.has(profileIndex)) return profiles.get(profileIndex);

    const extensionsPath = getProfileExtensionsPath(profileIndex);
    const extensions = new ElectronChromeExtensions({
      license: EXTENSION_LICENSE,
      session: sess,
      createTab,
      selectTab,
      removeTab,
      createWindow,
      removeWindow,
      assignTabDetails,
      requestPermissions
    });
    ElectronChromeExtensions.handleCRXProtocol(sess);

    const profile = {
      profileIndex,
      session: sess,
      extensions,
      extensionsPath,
      managedInstallPromise: null,
      managedReconcileTimer: null,
      managedStatus: createManagedStatus(profileIndex),
      webStoreReady: chromeWebStore.installChromeWebStore({
        session: sess,
        extensionsPath,
        beforeInstall: confirmWebStoreInstall,
        autoUpdate: true,
        loadExtensions: true,
        allowUnpackedExtensions: false,
        denylist: [managedExtensionId]
      }).catch((error) => {
        console.error("Failed to initialize Chrome Web Store support:", error);
        throw error;
      })
    };
    profiles.set(profileIndex, profile);

    const extensionApi = getSessionExtensionApi(sess);
    const extensionEvents = sess && typeof sess.on === "function" ? sess : extensionApi;
    if (extensionEvents && typeof extensionEvents.on === "function") {
      extensionEvents.on("extension-loaded", (_event, ext) => {
        if (!ext || ext.id !== managedExtensionId) return;
        if (profile.managedReconcileTimer) {
          clearTimeout(profile.managedReconcileTimer);
          profile.managedReconcileTimer = null;
        }
        setManagedStatus(profile, {
          state: "ready",
          version: ext.version || (ext.manifest && ext.manifest.version) || null,
          error: null
        });
      });
      extensionEvents.on("extension-unloaded", (_event, ext) => {
        if (!ext || ext.id !== managedExtensionId) return;
        scheduleManagedReconciliation(profile);
      });
    }

    return profile;
  }

  function getProfile(profileIndex) {
    return profiles.get(profileIndex) || null;
  }

  function getManagedExtensionStatus(profileIndex) {
    const profile = getProfile(profileIndex);
    return profile
      ? { ...profile.managedStatus }
      : createManagedStatus(profileIndex);
  }

  async function ensureManagedExtension(profileIndex, sess, options = {}) {
    const profile = ensureProfile(profileIndex, sess);
    const extensionApi = getSessionExtensionApi(sess);
    if (!profile || !extensionApi) {
      throw new Error("Extensions are unavailable for this browser profile.");
    }

    const existing = extensionApi.getExtension(managedExtensionId);
    if (existing && !options.force) {
      setManagedStatus(profile, {
        state: "ready",
        version: existing.version || (existing.manifest && existing.manifest.version) || null,
        error: null
      });
      return existing;
    }
    if (profile.managedInstallPromise) return profile.managedInstallPromise;

    setManagedStatus(profile, {
      state: "installing",
      version: null,
      error: null
    });

    profile.managedInstallPromise = (async () => {
      await profile.webStoreReady;
      const loaded = extensionApi.getExtension(managedExtensionId);
      const extension = loaded || await chromeWebStore.installExtension(managedExtensionId, {
        session: sess,
        extensionsPath: profile.extensionsPath
      });
      if (!extension || extension.id !== managedExtensionId) {
        throw new Error("Chrome Web Store returned an unexpected extension.");
      }
      setManagedStatus(profile, {
        state: "ready",
        version: extension.version || (extension.manifest && extension.manifest.version) || null,
        error: null
      });
      return extension;
    })().catch((error) => {
      const message = error && error.message ? error.message : "Unable to install uBlock Origin Lite.";
      setManagedStatus(profile, {
        state: "error",
        version: null,
        error: message
      });
      throw error;
    }).finally(() => {
      profile.managedInstallPromise = null;
    });

    return profile.managedInstallPromise;
  }

  function addTab(profileIndex, webContents, ownerWindow) {
    const profile = getProfile(profileIndex);
    if (!profile || !webContents || !ownerWindow || webContents.isDestroyed()) return false;
    profile.extensions.addTab(webContents, ownerWindow);
    return true;
  }

  function selectTrackedTab(profileIndex, webContents) {
    const profile = getProfile(profileIndex);
    if (!profile || !webContents || webContents.isDestroyed()) return false;
    profile.extensions.selectTab(webContents);
    return true;
  }

  function removeTrackedTab(webContents) {
    if (!webContents || webContents.isDestroyed()) return false;
    for (const profile of profiles.values()) {
      try {
        profile.extensions.removeTab(webContents);
        return true;
      } catch (_error) {}
    }
    return false;
  }

  function getContextMenuItems(webContents, params = {}) {
    if (!webContents || webContents.isDestroyed()) return [];
    for (const profile of profiles.values()) {
      if (profile.session !== webContents.session) continue;
      try {
        return profile.extensions.getContextMenuItems(webContents, params);
      } catch (_error) {
        return [];
      }
    }
    return [];
  }

  async function loadUnpackedExtension(profileIndex, sess, extensionPath, loadOptions = {}) {
    const profile = ensureProfile(profileIndex, sess);
    const extensionApi = getSessionExtensionApi(sess);
    if (!profile || !extensionApi) throw new Error("Extensions are unavailable for this browser profile.");
    await profile.webStoreReady;
    return extensionApi.loadExtension(extensionPath, loadOptions);
  }

  function getExtensions(profileIndex, sess) {
    const profile = ensureProfile(profileIndex, sess);
    const extensionApi = getSessionExtensionApi(sess);
    if (!profile || !extensionApi) return [];
    return extensionApi.getAllExtensions().map((ext) => (
      createExtensionSummary(ext, profile.extensionsPath, managedExtensionId)
    ));
  }

  async function removeExtension(profileIndex, sess, extensionId) {
    const profile = ensureProfile(profileIndex, sess);
    const extensionApi = getSessionExtensionApi(sess);
    if (!profile || !extensionApi) return { success: false, error: "Extensions are unavailable for this browser profile." };
    if (extensionId === managedExtensionId) {
      return {
        success: false,
        error: MANAGED_EXTENSION_ERROR,
        id: extensionId,
        managed: true
      };
    }

    const ext = extensionApi.getExtension(extensionId);
    const source = ext ? getExtensionSource(ext.path, profile.extensionsPath) : null;
    if (source === WEB_STORE_SOURCE) {
      await chromeWebStore.uninstallExtension(extensionId, {
        session: sess,
        extensionsPath: profile.extensionsPath
      });
    } else if (ext) {
      extensionApi.removeExtension(extensionId);
    }

    return {
      success: true,
      id: extensionId,
      path: ext && ext.path ? ext.path : null,
      source: source || UNPACKED_SOURCE
    };
  }

  async function updateExtensions(profileIndex, sess) {
    const profile = ensureProfile(profileIndex, sess);
    if (!profile) return { success: false, error: "Extensions are unavailable for this browser profile." };
    await chromeWebStore.updateExtensions(sess);
    return { success: true };
  }

  return {
    addTab,
    ensureProfile,
    ensureManagedExtension,
    getContextMenuItems,
    getExtensions,
    getManagedExtensionStatus,
    getProfile,
    getProfileExtensionsPath,
    loadUnpackedExtension,
    removeExtension,
    removeTrackedTab,
    selectTab: selectTrackedTab,
    updateExtensions
  };
}

module.exports = {
  CHROME_WEB_STORE_URL,
  EXTENSION_LICENSE,
  MANAGED_EXTENSION_ERROR,
  UBLOCK_ORIGIN_LITE_ID,
  UNPACKED_SOURCE,
  WEB_STORE_SOURCE,
  collectManifestPermissions,
  createExtensionManager,
  createExtensionSummary,
  getSessionExtensionApi,
  isPathInside
};
