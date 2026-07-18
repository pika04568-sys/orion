const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const {
  EXTENSION_LICENSE,
  MANAGED_EXTENSION_ERROR,
  UBLOCK_ORIGIN_LITE_ID,
  UNPACKED_SOURCE,
  WEB_STORE_SOURCE,
  collectManifestPermissions,
  createExtensionManager
} = require("../extension-manager");

class MockElectronChromeExtensions {
  static instances = [];
  static handledSessions = [];

  static reset() {
    MockElectronChromeExtensions.instances = [];
    MockElectronChromeExtensions.handledSessions = [];
  }

  static handleCRXProtocol(session) {
    MockElectronChromeExtensions.handledSessions.push(session);
  }

  constructor(options) {
    this.options = options;
    this.tabs = [];
    this.selectedTabs = [];
    this.removedTabs = [];
    MockElectronChromeExtensions.instances.push(this);
  }

  addTab(webContents, ownerWindow) {
    this.tabs.push({ webContents, ownerWindow });
  }

  selectTab(webContents) {
    this.selectedTabs.push(webContents);
  }

  removeTab(webContents) {
    this.removedTabs.push(webContents);
  }

  getContextMenuItems() {
    return [{ label: "Extension item" }];
  }
}

function createMockSession() {
  const loadedExtensions = new Map();
  let mockSession = null;
  const extensionApi = Object.assign(new EventEmitter(), {
    loadExtension: async (extensionPath) => {
      const id = path.basename(extensionPath).replace(/[^a-z0-9]/gi, "").toLowerCase() || "extension";
      const extension = {
        id,
        name: "Loaded Extension",
        version: "1.0.0",
        description: "Loaded from test",
        path: extensionPath,
        manifest: {
          manifest_version: 3,
          name: "Loaded Extension",
          version: "1.0.0",
          description: "Loaded from test"
        }
      };
      loadedExtensions.set(id, extension);
      return extension;
    },
    getAllExtensions: () => Array.from(loadedExtensions.values()),
    getExtension: (id) => loadedExtensions.get(id) || null,
    removeExtension: (id) => {
      const extension = loadedExtensions.get(id);
      loadedExtensions.delete(id);
      if (extension) (mockSession || extensionApi).emit("extension-unloaded", {}, extension);
    },
    seed: (extension) => {
      loadedExtensions.set(extension.id, extension);
    }
  });

  mockSession = Object.assign(new EventEmitter(), {
    extensions: extensionApi,
    isPersistent: () => true,
    storagePath: "/tmp/orion-profile"
  });
  return mockSession;
}

function createHarness(options = {}) {
  MockElectronChromeExtensions.reset();
  const installCalls = [];
  const uninstallCalls = [];
  const updateCalls = [];
  const managedInstallCalls = [];
  let remainingInstallFailures = options.installFailures || 0;
  const chromeWebStore = {
    installChromeWebStore: async (options) => {
      installCalls.push(options);
    },
    installExtension: async (id, installOptions) => {
      managedInstallCalls.push({ id, options: installOptions });
      if (remainingInstallFailures > 0) {
        remainingInstallFailures -= 1;
        throw new Error("offline");
      }
      const extension = {
        id,
        name: "uBlock Origin Lite",
        version: "2026.7.17",
        path: path.join(installOptions.extensionsPath, id, "2026.7.17_0"),
        manifest: {
          manifest_version: 3,
          name: "uBlock Origin Lite",
          version: "2026.7.17"
        }
      };
      installOptions.session.extensions.seed(extension);
      installOptions.session.emit("extension-loaded", {}, extension);
      return extension;
    },
    uninstallExtension: async (id, options) => {
      uninstallCalls.push({ id, options });
      options.session.extensions.removeExtension(id);
    },
    updateExtensions: async (session) => {
      updateCalls.push(session);
    }
  };
  const manager = createExtensionManager({
    app: { getPath: () => "/tmp/orion-user-data" },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    ElectronChromeExtensions: MockElectronChromeExtensions,
    chromeWebStore,
    createTab: async () => {},
    selectTab: () => {},
    removeTab: () => {},
    createWindow: async () => {},
    removeWindow: () => {},
    assignTabDetails: () => {},
    requestPermissions: async () => true,
    managedReconcileDelayMs: 0
  });

  return { chromeWebStore, installCalls, managedInstallCalls, manager, uninstallCalls, updateCalls };
}

test("collectManifestPermissions merges extension, host, and content script permissions", () => {
  assert.deepEqual(
    collectManifestPermissions({
      permissions: ["storage"],
      optional_permissions: ["tabs"],
      host_permissions: ["https://example.com/*"],
      content_scripts: [{ matches: ["https://*.openai.com/*"] }]
    }),
    [
      "content-script:https://*.openai.com/*",
      "host:https://example.com/*",
      "storage",
      "tabs"
    ]
  );
});

test("manager initializes one Chrome extension layer per persistent profile session", async () => {
  const { installCalls, manager } = createHarness();
  const session = createMockSession();

  const profile = manager.ensureProfile(2, session);
  const repeated = manager.ensureProfile(2, session);

  assert.equal(profile, repeated);
  assert.equal(MockElectronChromeExtensions.instances.length, 1);
  assert.equal(MockElectronChromeExtensions.instances[0].options.license, EXTENSION_LICENSE);
  assert.equal(MockElectronChromeExtensions.instances[0].options.session, session);
  assert.deepEqual(MockElectronChromeExtensions.handledSessions, [session]);

  await profile.webStoreReady;
  assert.equal(installCalls.length, 1);
  assert.equal(installCalls[0].session, session);
  assert.equal(installCalls[0].extensionsPath, path.join("/tmp/orion-user-data", "Extensions", "profile-2"));
  assert.equal(typeof installCalls[0].beforeInstall, "function");
  assert.equal(installCalls[0].autoUpdate, true);
  assert.equal(installCalls[0].loadExtensions, true);
  assert.deepEqual(installCalls[0].denylist, [UBLOCK_ORIGIN_LITE_ID]);
});

test("manager provisions the exact managed extension once per profile", async () => {
  const { managedInstallCalls, manager } = createHarness();
  const session = createMockSession();

  const [first, repeated] = await Promise.all([
    manager.ensureManagedExtension(3, session),
    manager.ensureManagedExtension(3, session)
  ]);

  assert.equal(first.id, UBLOCK_ORIGIN_LITE_ID);
  assert.equal(repeated, first);
  assert.equal(managedInstallCalls.length, 1);
  assert.equal(managedInstallCalls[0].id, UBLOCK_ORIGIN_LITE_ID);
  assert.equal(managedInstallCalls[0].options.session, session);
  assert.deepEqual(manager.getManagedExtensionStatus(3), {
    profileIndex: 3,
    extensionId: UBLOCK_ORIGIN_LITE_ID,
    state: "ready",
    version: "2026.7.17",
    error: null
  });
});

test("manager uses the cached managed extension without downloading it again", async () => {
  const { managedInstallCalls, manager } = createHarness();
  const session = createMockSession();
  const cached = {
    id: UBLOCK_ORIGIN_LITE_ID,
    name: "uBlock Origin Lite",
    version: "1.2.3",
    path: path.join(manager.getProfileExtensionsPath(1), UBLOCK_ORIGIN_LITE_ID, "1.2.3_0"),
    manifest: { manifest_version: 3, name: "uBlock Origin Lite", version: "1.2.3" }
  };
  session.extensions.seed(cached);

  assert.equal(await manager.ensureManagedExtension(1, session), cached);
  assert.equal(managedInstallCalls.length, 0);
  assert.equal(manager.getManagedExtensionStatus(1).version, "1.2.3");
});

test("manager exposes installation errors and retries cleanly", async () => {
  const { managedInstallCalls, manager } = createHarness({ installFailures: 1 });
  const session = createMockSession();

  await assert.rejects(manager.ensureManagedExtension(5, session), /offline/);
  assert.equal(manager.getManagedExtensionStatus(5).state, "error");
  assert.equal(manager.getManagedExtensionStatus(5).error, "offline");

  const installed = await manager.ensureManagedExtension(5, session);
  assert.equal(installed.id, UBLOCK_ORIGIN_LITE_ID);
  assert.equal(managedInstallCalls.length, 2);
  assert.equal(manager.getManagedExtensionStatus(5).state, "ready");
});

test("manager marks uBlock Origin Lite as managed and rejects direct removal", async () => {
  const { manager } = createHarness();
  const session = createMockSession();
  await manager.ensureManagedExtension(6, session);

  const summary = manager.getExtensions(6, session).find((extension) => extension.id === UBLOCK_ORIGIN_LITE_ID);
  assert.equal(summary.managed, true);
  assert.equal(summary.removable, false);
  assert.deepEqual(await manager.removeExtension(6, session, UBLOCK_ORIGIN_LITE_ID), {
    success: false,
    error: MANAGED_EXTENSION_ERROR,
    id: UBLOCK_ORIGIN_LITE_ID,
    managed: true
  });
  assert.ok(session.extensions.getExtension(UBLOCK_ORIGIN_LITE_ID));
});

test("manager reconciles an unexpected managed-extension unload", async () => {
  const { managedInstallCalls, manager } = createHarness();
  const session = createMockSession();
  await manager.ensureManagedExtension(7, session);
  session.extensions.removeExtension(UBLOCK_ORIGIN_LITE_ID);

  assert.equal(manager.getManagedExtensionStatus(7).state, "installing");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(session.extensions.getExtension(UBLOCK_ORIGIN_LITE_ID));
  assert.equal(managedInstallCalls.length, 2);
  assert.equal(manager.getManagedExtensionStatus(7).state, "ready");
});

test("manager reports Web Store and unpacked extension metadata", () => {
  const { manager } = createHarness();
  const session = createMockSession();
  manager.ensureProfile(1, session);
  const webStorePath = path.join(manager.getProfileExtensionsPath(1), "abcd", "1.0.0_0");

  session.extensions.seed({
    id: "webstore",
    name: "Store Extension",
    version: "1.0.0",
    path: webStorePath,
    manifest: { manifest_version: 3, name: "Store Extension", version: "1.0.0" }
  });
  session.extensions.seed({
    id: "local",
    name: "Local Extension",
    version: "2.0.0",
    path: "/Users/example/local-extension",
    manifest: { manifest_version: 3, name: "Local Extension", version: "2.0.0" }
  });

  assert.deepEqual(manager.getExtensions(1, session), [
    {
      id: "webstore",
      name: "Store Extension",
      version: "1.0.0",
      description: "",
      source: WEB_STORE_SOURCE,
      manifestVersion: 3,
      canUpdate: true,
      managed: false,
      removable: true
    },
    {
      id: "local",
      name: "Local Extension",
      version: "2.0.0",
      description: "",
      source: UNPACKED_SOURCE,
      manifestVersion: 3,
      canUpdate: false,
      managed: false,
      removable: true
    }
  ]);
});

test("manager loads unpacked extensions and routes remove/update calls", async () => {
  const { manager, uninstallCalls, updateCalls } = createHarness();
  const session = createMockSession();
  const profile = manager.ensureProfile(4, session);
  await profile.webStoreReady;

  const loaded = await manager.loadUnpackedExtension(4, session, "/Users/example/dev-extension");
  assert.equal(loaded.id, "devextension");
  assert.equal(session.extensions.getExtension("devextension"), loaded);

  const webStorePath = path.join(manager.getProfileExtensionsPath(4), "storeext", "1.0.0_0");
  session.extensions.seed({
    id: "storeext",
    name: "Store Extension",
    version: "1.0.0",
    path: webStorePath,
    manifest: { manifest_version: 3, name: "Store Extension", version: "1.0.0" }
  });

  assert.deepEqual(await manager.removeExtension(4, session, "storeext"), {
    success: true,
    id: "storeext",
    path: webStorePath,
    source: WEB_STORE_SOURCE
  });
  assert.equal(uninstallCalls.length, 1);
  assert.equal(session.extensions.getExtension("storeext"), null);

  assert.deepEqual(await manager.removeExtension(4, session, "devextension"), {
    success: true,
    id: "devextension",
    path: "/Users/example/dev-extension",
    source: UNPACKED_SOURCE
  });
  assert.equal(session.extensions.getExtension("devextension"), null);

  assert.deepEqual(await manager.updateExtensions(4, session), { success: true });
  assert.deepEqual(updateCalls, [session]);
});
