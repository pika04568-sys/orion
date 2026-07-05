const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  EXTENSION_LICENSE,
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
  const extensionApi = {
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
      loadedExtensions.delete(id);
    },
    seed: (extension) => {
      loadedExtensions.set(extension.id, extension);
    }
  };

  return {
    extensions: extensionApi,
    isPersistent: () => true,
    storagePath: "/tmp/orion-profile"
  };
}

function createHarness() {
  MockElectronChromeExtensions.reset();
  const installCalls = [];
  const uninstallCalls = [];
  const updateCalls = [];
  const chromeWebStore = {
    installChromeWebStore: async (options) => {
      installCalls.push(options);
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
    requestPermissions: async () => true
  });

  return { chromeWebStore, installCalls, manager, uninstallCalls, updateCalls };
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
      canUpdate: true
    },
    {
      id: "local",
      name: "Local Extension",
      version: "2.0.0",
      description: "",
      source: UNPACKED_SOURCE,
      manifestVersion: 3,
      canUpdate: false
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
