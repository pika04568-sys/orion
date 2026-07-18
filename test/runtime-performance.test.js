const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCoalescedAtomicWriter } = require("../async-store");
const { createProtocolAssetHandler } = require("../protocol-assets");
const {
  getElectronExecutableRelativePath,
  stageElectronExecutable
} = require("../scripts/electron-executable");
const {
  getInitialMaterializedTabId
} = require("../startup-performance");

test("coalesced atomic writes persist only the latest pending value", async () => {
  const files = new Map();
  let writeCount = 0;
  const writer = createCoalescedAtomicWriter({
    filePath: "/virtual/settings.json",
    delayMs: 1000,
    fsPromises: {
      mkdir: async () => {},
      writeFile: async (file, value) => {
        writeCount += 1;
        files.set(file, value);
      },
      rename: async (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      readFile: async (file) => files.get(file),
      unlink: async (file) => files.delete(file)
    }
  });

  writer.schedule({ value: 1 });
  writer.schedule({ value: 2 });
  writer.schedule({ value: 3 });
  await writer.flush();

  assert.equal(writeCount, 1);
  assert.deepEqual(JSON.parse(files.get("/virtual/settings.json")), { value: 3 });
});

test("coalesced atomic writers defer snapshot construction until flush", async () => {
  const files = new Map();
  let snapshots = 0;
  const writer = createCoalescedAtomicWriter({
    filePath: "/virtual/recovery.json",
    delayMs: 1000,
    fsPromises: {
      mkdir: async () => {},
      writeFile: async (file, value) => files.set(file, value),
      rename: async (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      readFile: async (file) => files.get(file),
      unlink: async (file) => files.delete(file)
    }
  });

  writer.scheduleFactory(() => ({ snapshot: ++snapshots }));
  writer.scheduleFactory(() => ({ snapshot: ++snapshots }));
  assert.equal(snapshots, 0);
  await writer.flush();

  assert.equal(snapshots, 1);
  assert.deepEqual(JSON.parse(files.get("/virtual/recovery.json")), { snapshot: 1 });
});

test("protocol assets share immutable buffers across session handlers", async () => {
  let reads = 0;
  const responseCache = new Map();
  const options = {
    resolveAssetPath: (url) => url === "orion://app/renderer.js" ? "/app/renderer.js" : null,
    getContentType: () => "application/javascript",
    responseCache,
    readFile: async () => {
      reads += 1;
      return Buffer.from("window.ready=true;");
    }
  };
  const handler = createProtocolAssetHandler(options);
  const secondSessionHandler = createProtocolAssetHandler(options);

  const first = await handler({ url: "orion://app/renderer.js" });
  const second = await secondSessionHandler({ url: "orion://app/renderer.js" });
  const missing = await handler({ url: "orion://app/main.js" });

  assert.equal(first.status, 200);
  assert.equal(second.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(missing.status, 404);
  assert.equal(reads, 1);
});

test("restored tabs materialize only the requested active record", () => {
  const tabs = Array.from({ length: 50 }, (_, index) => ({ id: `tab-${index + 1}` }));
  assert.equal(getInitialMaterializedTabId(tabs, "tab-37"), "tab-37");
  assert.equal(getInitialMaterializedTabId(tabs, "missing"), "tab-1");
  assert.equal(getInitialMaterializedTabId([], "missing"), null);
});

test("Electron runtime staging is versioned and reused outside the project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orion-runtime-stage-test-"));
  const projectRoot = path.join(root, "project");
  const cacheRoot = path.join(root, "cache");
  const relativeExecutable = getElectronExecutableRelativePath();
  const sourceExecutable = path.join(projectRoot, "node_modules", "electron", "dist", relativeExecutable);
  fs.mkdirSync(path.dirname(sourceExecutable), { recursive: true });
  fs.writeFileSync(sourceExecutable, "electron-runtime");
  fs.writeFileSync(
    path.join(projectRoot, "node_modules", "electron", "package.json"),
    JSON.stringify({ version: "99.1.2" })
  );
  const previousElectronPath = process.env.ELECTRON_PATH;
  delete process.env.ELECTRON_PATH;
  try {
    const first = stageElectronExecutable(projectRoot, { cacheRoot });
    const second = stageElectronExecutable(projectRoot, { cacheRoot });
    assert.equal(first, second);
    assert.equal(fs.readFileSync(first, "utf8"), "electron-runtime");
    assert.ok(first.startsWith(cacheRoot));
    assert.match(first, new RegExp(`electron-99\\.1\\.2-${process.platform}-${process.arch}`));
  } finally {
    if (previousElectronPath === undefined) delete process.env.ELECTRON_PATH;
    else process.env.ELECTRON_PATH = previousElectronPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("main startup creates the shell before deferred services and gates web navigation on uBlock Origin Lite", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const readyBlock = source.slice(source.indexOf("app.whenReady().then"));
  const createWindowIndex = readyBlock.indexOf("createW(0)");

  assert.ok(createWindowIndex >= 0);
  assert.ok(createWindowIndex < readyBlock.indexOf("runLegacyIncognitoPartitionMigration"));
  assert.ok(createWindowIndex < readyBlock.indexOf("initializeMemoryController"));
  assert.ok(createWindowIndex < readyBlock.indexOf("configureAutoUpdater"));
  assert.doesNotMatch(source, /prepareAdblockForNavigation|ensureAdblockRuntime|adblock-worker/);
  assert.match(source, /return queueManagedNavigation\(tabId, pIdx, normalizedUrl\)/);
  assert.match(source, /pendingManagedNavigations\.set\(tabId, pending\)/);
  assert.match(source, /manager\.ensureManagedExtension\(win\.profileIndex, sess\)/);
  assert.match(source, /state !== "ready"/);
  assert.match(source, /if \(!w\) return;/);
  assert.doesNotMatch(source, /preconnect-origin|prewarmedNewTabViews|scheduleNewTabPrewarm/);
  assert.doesNotMatch(source, /settingsWriter\.read/);
  assert.match(source, /recoveryWriter\.scheduleFactory\(buildCurrentRecoveryState\)/);
  assert.match(source, /createT\(pIdx, win, \{ quiet: true \}\)/);
  assert.match(source, /cleanupLegacyAdblockData\(\)/);

  const buildSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-runtime.js"), "utf8");
  assert.match(buildSource, /main-app\.cjs/);
  assert.match(buildSource, /__orionEarlyStartupPerformance/);
  assert.match(buildSource, /scriptDigests\.get\(fileName\)/);
  assert.match(buildSource, /emitBrowserLocalization/);
  assert.match(buildSource, /localeVersions/);
  assert.match(buildSource, /browserEntries\.filter\(\(file\) => file !== "localization\.js"\)/);
});
