const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createCoalescedAtomicWriter } = require("../async-store");
const { createProtocolAssetHandler } = require("../protocol-assets");
const {
  createIntentPreconnector,
  getInitialMaterializedTabId,
  normalizePreconnectOrigin
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

test("protocol assets are read asynchronously once and memoized", async () => {
  let reads = 0;
  const handler = createProtocolAssetHandler({
    resolveAssetPath: (url) => url === "orion://app/renderer.js" ? "/app/renderer.js" : null,
    getContentType: () => "application/javascript",
    readFile: async () => {
      reads += 1;
      return Buffer.from("window.ready=true;");
    }
  });

  const first = await handler({ url: "orion://app/renderer.js" });
  const second = await handler({ url: "orion://app/renderer.js" });
  const missing = await handler({ url: "orion://app/main.js" });

  assert.equal(first.status, 200);
  assert.equal(second.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(missing.status, 404);
  assert.equal(reads, 1);
});

test("preconnect validation reduces input to an HTTP(S) origin", () => {
  assert.equal(normalizePreconnectOrigin("https://example.com/path?q=1"), "https://example.com");
  assert.equal(normalizePreconnectOrigin("http://example.com:8080/a"), "http://example.com:8080");
  assert.equal(normalizePreconnectOrigin("https://user:pass@example.com"), null);
  assert.equal(normalizePreconnectOrigin("file:///tmp/test"), null);
  assert.equal(normalizePreconnectOrigin("javascript:alert(1)"), null);
});

test("intent preconnect debounces by sender and opens one socket", async () => {
  const calls = [];
  const controller = createIntentPreconnector({ delayMs: 10 });
  const session = { preconnect: (options) => calls.push(options) };

  assert.equal(controller.schedule(7, session, "https://first.example/path"), true);
  assert.equal(controller.schedule(7, session, "https://second.example/next"), true);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.deepEqual(calls, [{ url: "https://second.example", numSockets: 1 }]);
  controller.clear();
});

test("restored tabs materialize only the requested active record", () => {
  const tabs = Array.from({ length: 50 }, (_, index) => ({ id: `tab-${index + 1}` }));
  assert.equal(getInitialMaterializedTabId(tabs, "tab-37"), "tab-37");
  assert.equal(getInitialMaterializedTabId(tabs, "missing"), "tab-1");
  assert.equal(getInitialMaterializedTabId([], "missing"), null);
});

test("main startup creates the shell before deferred services and navigation is not adblock-gated", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const readyBlock = source.slice(source.indexOf("app.whenReady().then"));
  const createWindowIndex = readyBlock.indexOf("createW(0)");

  assert.ok(createWindowIndex >= 0);
  assert.ok(createWindowIndex < readyBlock.indexOf("runLegacyIncognitoPartitionMigration"));
  assert.ok(createWindowIndex < readyBlock.indexOf("initializeMemoryController"));
  assert.ok(createWindowIndex < readyBlock.indexOf("configureAutoUpdater"));
  assert.doesNotMatch(source, /prepareAdblockForNavigation/);
  assert.match(source, /return view\.webContents\.loadURL\(normalizedUrl\)/);
  assert.match(source, /if \(!w\) return;/);
});
