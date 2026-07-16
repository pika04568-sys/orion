const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const memoryManager = require("../memory-manager");
const GIBIBYTE_BYTES = 1024 * 1024 * 1024;

test("RAM limit values accept whole GiB budgets and default invalid values to off", () => {
  assert.equal(memoryManager.sanitizeRamLimitMb(0), 0);
  assert.equal(memoryManager.sanitizeRamLimitMb(1024), 1024);
  assert.equal(memoryManager.sanitizeRamLimitMb(12288), 12288);
  assert.equal(memoryManager.sanitizeRamLimitMb(16384), 16384);
  assert.equal(memoryManager.sanitizeRamLimitMb(32768), 32768);
  assert.equal(memoryManager.sanitizeRamLimitMb(1536), 0);
  assert.equal(memoryManager.sanitizeRamLimitMb("2048"), 0);
  assert.equal(memoryManager.sanitizeRamLimitMb(null), 0);
});

test("automatic RAM limits use half of physical memory rounded down to a whole GiB", () => {
  const cases = [
    [8, 4],
    [16, 8],
    [24, 12],
    [32, 16],
    [64, 32]
  ];
  cases.forEach(([totalGiB, expectedLimitGiB]) => {
    assert.equal(
      memoryManager.calculateAutomaticRamLimitMb(totalGiB * GIBIBYTE_BYTES),
      expectedLimitGiB * 1024
    );
  });
  assert.equal(memoryManager.calculateAutomaticRamLimitMb(1.5 * GIBIBYTE_BYTES), 0);
  assert.equal(memoryManager.calculateAutomaticRamLimitMb(0), 0);
  assert.equal(memoryManager.calculateAutomaticRamLimitMb(-1), 0);
  assert.equal(memoryManager.calculateAutomaticRamLimitMb(Number.NaN), 0);
  assert.equal(memoryManager.calculateAutomaticRamLimitMb(null), 0);
});

test("RAM limit modes preserve explicit modes and migrate legacy numeric settings", () => {
  assert.equal(memoryManager.resolveRamLimitMode("off", 8192), "off");
  assert.equal(memoryManager.resolveRamLimitMode("automatic", 0), "automatic");
  assert.equal(memoryManager.resolveRamLimitMode(undefined, 0), "off");
  [1024, 2048, 4096, 8192].forEach((legacyLimitMb) => {
    assert.equal(memoryManager.resolveRamLimitMode(undefined, legacyLimitMb), "automatic");
  });
  assert.equal(memoryManager.resolveRamLimitMode("invalid", -1), "off");
  assert.equal(memoryManager.resolveRamLimitMb("off", 16384), 0);
  assert.equal(memoryManager.resolveRamLimitMb("automatic", 16384), 16384);
  assert.equal(memoryManager.resolveRamLimitMb("automatic", 0), 0);
});

test("working set aggregation totals valid Electron process metrics in KB", () => {
  assert.equal(memoryManager.sumWorkingSetKb([
    { memory: { workingSetSize: 512000 } },
    { memory: { workingSetSize: 256000 } },
    { memory: { workingSetSize: -1 } },
    { memory: {} },
    null
  ]), 768000);
  assert.equal(memoryManager.workingSetKbToMb(768000), 750);
  assert.throws(() => memoryManager.sumWorkingSetKb(null), /array/);
});

test("per-tab attribution divides shared renderers and adds Reader renderer memory", () => {
  const attributed = memoryManager.attributeTabWorkingSets([
    { pid: 10, memory: { workingSetSize: 600 } },
    { pid: 20, memory: { workingSetSize: 300 } },
    { pid: 30, memory: { workingSetSize: 900 } }
  ], [
    { tabId: "article", pid: 10 },
    { tabId: "article", pid: 10 },
    { tabId: "article", pid: 20 },
    { tabId: "shared", pid: 10 },
    { tabId: "missing", pid: 99 }
  ]);

  assert.equal(attributed.get("article"), 600);
  assert.equal(attributed.get("shared"), 300);
  assert.equal(attributed.has("missing"), false);
  assert.equal(attributed.has("unused-process"), false);
});

test("tab memory history retains peaks and supports navigation reset and close removal", () => {
  const history = memoryManager.createTabMemoryHistory();
  history.observe([
    { pid: 10, memory: { workingSetSize: 800 } }
  ], [{ tabId: "tab", pid: 10 }]);
  history.observe([
    { pid: 10, memory: { workingSetSize: 300 } }
  ], [{ tabId: "tab", pid: 10 }]);
  assert.equal(history.getPeakWorkingSetKb("tab"), 800);

  history.reset("tab");
  assert.equal(history.getPeakWorkingSetKb("tab"), 0);
  history.observe([
    { pid: 10, memory: { workingSetSize: 200 } }
  ], [{ tabId: "tab", pid: 10 }]);
  assert.equal(history.getPeakWorkingSetKb("tab"), 200);

  history.remove("tab");
  assert.equal(history.getPeakWorkingSetKb("tab"), 0);
});

test("highest historical memory wins before LRU ordering", () => {
  const candidate = memoryManager.selectUnloadCandidate([
    { id: "oldest", peakWorkingSetKb: 100, lastActiveSequence: 1 },
    { id: "heavy", peakWorkingSetKb: 900, lastActiveSequence: 12 }
  ]);
  assert.equal(candidate.id, "heavy");
});

test("LRU fallback excludes active, audible, and already unloaded tabs", () => {
  const candidate = memoryManager.selectUnloadCandidate([
    { id: "active", active: true, peakWorkingSetKb: 1000, lastActiveSequence: 1 },
    { id: "audible", audible: true, peakWorkingSetKb: 900, lastActiveSequence: 2 },
    { id: "unloaded", unloaded: true, lastActiveSequence: 0 },
    { id: "newer", lastActiveSequence: 12 },
    { id: "oldest", lastActiveSequence: 3 }
  ]);

  assert.equal(candidate.id, "oldest");
  assert.equal(memoryManager.selectUnloadCandidate([
    { id: "active", active: true },
    { id: "audible", audible: true }
  ]), null);
});

test("disabled controller reports usage without unloading tabs", async () => {
  let unloadCalls = 0;
  let observationCalls = 0;
  const controller = memoryManager.createMemoryController({
    getMetrics: () => [{ memory: { workingSetSize: 2 * 1024 * 1024 } }],
    getLimitMb: () => 0,
    observeMetrics: () => { observationCalls += 1; },
    getCandidates: () => [{ id: "background" }],
    unloadTab: async () => {
      unloadCalls += 1;
      return true;
    },
    getUnloadedTabCount: () => 0
  });

  const status = await controller.evaluate();
  assert.deepEqual(status, {
    supported: true,
    enabled: false,
    usedMb: 2048,
    limitMb: 0,
    overLimit: false,
    unloadedTabCount: 0
  });
  assert.equal(unloadCalls, 0);
  assert.equal(observationCalls, 1);
});

test("automatic mode enforces the calculated budget while Off remains non-enforcing", async () => {
  const automaticLimitMb = memoryManager.calculateAutomaticRamLimitMb(8 * GIBIBYTE_BYTES);
  const statuses = {};

  for (const mode of ["off", "automatic"]) {
    const controller = memoryManager.createMemoryController({
      getMetrics: () => [{ memory: { workingSetSize: 5 * 1024 * 1024 } }],
      getLimitMb: () => memoryManager.resolveRamLimitMb(mode, automaticLimitMb),
      getCandidates: () => [],
      getUnloadedTabCount: () => 0
    });
    statuses[mode] = await controller.evaluate();
  }

  assert.equal(statuses.off.enabled, false);
  assert.equal(statuses.off.overLimit, false);
  assert.equal(statuses.automatic.enabled, true);
  assert.equal(statuses.automatic.limitMb, 4096);
  assert.equal(statuses.automatic.overLimit, true);
});

test("over-budget evaluations unload one highest-peak tab at a time", async () => {
  const unloaded = new Set();
  const controller = memoryManager.createMemoryController({
    getMetrics: () => [{ memory: { workingSetSize: 2 * 1024 * 1024 } }],
    getLimitMb: () => 1024,
    getCandidates: () => [
      { id: "first", peakWorkingSetKb: 100, lastActiveSequence: 1, unloaded: unloaded.has("first") },
      { id: "second", peakWorkingSetKb: 900, lastActiveSequence: 2, unloaded: unloaded.has("second") }
    ],
    unloadTab: async (candidate) => {
      unloaded.add(candidate.id);
      return true;
    },
    getUnloadedTabCount: () => unloaded.size
  });

  await controller.evaluate();
  assert.deepEqual(Array.from(unloaded), ["second"]);
  assert.equal(controller.getStatus().unloadedTabCount, 1);

  await controller.evaluate();
  assert.deepEqual(Array.from(unloaded), ["second", "first"]);
  assert.equal(controller.getStatus().unloadedTabCount, 2);
});

test("running controller schedules a one-second remeasurement after reclamation", async () => {
  const scheduledTimeouts = [];
  let intervalCallback = null;
  const unloaded = [];
  const controller = memoryManager.createMemoryController({
    getMetrics: () => [{ memory: { workingSetSize: 2 * 1024 * 1024 } }],
    getLimitMb: () => 1024,
    getCandidates: () => unloaded.length
      ? []
      : [{ id: "background", lastActiveSequence: 1 }],
    unloadTab: async (candidate) => {
      unloaded.push(candidate.id);
      return true;
    },
    getUnloadedTabCount: () => unloaded.length,
    setIntervalFn: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearIntervalFn: () => {},
    setTimeoutFn: (callback, delay) => {
      scheduledTimeouts.push({ callback, delay });
      return scheduledTimeouts.length;
    },
    clearTimeoutFn: () => {}
  });

  controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof intervalCallback, "function");
  assert.deepEqual(unloaded, ["background"]);
  assert.equal(scheduledTimeouts.length, 1);
  assert.equal(scheduledTimeouts[0].delay, 1000);
  controller.stop();
});

test("metric failures report unsupported status and never unload", async () => {
  let unloadCalls = 0;
  let observationCalls = 0;
  const controller = memoryManager.createMemoryController({
    getMetrics: () => {
      throw new Error("metrics failed");
    },
    getLimitMb: () => 1024,
    observeMetrics: () => { observationCalls += 1; },
    getCandidates: () => [{ id: "background" }],
    unloadTab: async () => {
      unloadCalls += 1;
      return true;
    },
    getUnloadedTabCount: () => 0
  });

  const status = await controller.evaluate();
  assert.deepEqual(status, {
    supported: false,
    enabled: true,
    usedMb: null,
    limitMb: 1024,
    overLimit: false,
    unloadedTabCount: 0
  });
  assert.equal(unloadCalls, 0);
  assert.equal(observationCalls, 0);
});

test("per-tab observation failures preserve global metric support and LRU fallback", async () => {
  const controller = memoryManager.createMemoryController({
    getMetrics: () => [{ memory: { workingSetSize: 512 * 1024 } }],
    getLimitMb: () => 0,
    observeMetrics: () => {
      throw new Error("tab attribution failed");
    },
    getUnloadedTabCount: () => 0
  });

  const status = await controller.evaluate();
  assert.equal(status.supported, true);
  assert.equal(status.usedMb, 512);
});

test("ordinary tab unload preserves the record and WebContents identity", async () => {
  const navigations = [];
  const webContents = {
    isDestroyed: () => false,
    loadURL: async (url) => navigations.push(url)
  };
  const tab = { id: "ordinary", url: "https://example.com/old", title: "Old title", readerMode: false };
  const view = { webContents, tUrl: tab.url };
  let saved = false;

  const unloaded = await memoryManager.unloadTabPage({
    view,
    tab,
    savedUrl: "https://example.com/article",
    savedTitle: "Article",
    readerMode: false,
    syncTabRecord: (patch) => Object.assign(tab, patch),
    onDiscarded: () => { saved = true; }
  });

  assert.equal(unloaded, true);
  assert.equal(view.webContents, webContents);
  assert.deepEqual(navigations, ["about:blank"]);
  assert.deepEqual(tab, {
    id: "ordinary",
    url: "https://example.com/article",
    title: "Article",
    readerMode: false
  });
  assert.equal(view.memoryDiscarded, true);
  assert.equal(saved, true);
});

test("Reader tabs restore the saved URL with Reader intent", async () => {
  const loadedUrls = [];
  let readerViewDestroyed = false;
  const tab = { id: "reader", url: "https://example.com/story", title: "Story", readerMode: true };
  const view = {
    webContents: {
      isDestroyed: () => false,
      loadURL: async () => {}
    },
    tUrl: tab.url
  };

  await memoryManager.unloadTabPage({
    view,
    tab,
    savedUrl: tab.url,
    savedTitle: tab.title,
    readerMode: true,
    syncTabRecord: (patch) => Object.assign(tab, patch),
    destroyReaderView: () => { readerViewDestroyed = true; }
  });
  const restored = memoryManager.restoreUnloadedTabPage({
    view,
    tab,
    loadUrl: (url) => loadedUrls.push(url)
  });

  assert.equal(readerViewDestroyed, true);
  assert.equal(restored, true);
  assert.deepEqual(loadedUrls, ["https://example.com/story"]);
  assert.equal(view.pendingReaderRestore, true);
  assert.equal(view.memoryRestoring, true);
  assert.equal(view.memoryDiscarded, false);
});

test("profile and incognito metadata survive unloading", async () => {
  for (const incognito of [false, true]) {
    const tab = { id: `tab-${incognito}`, url: "https://example.com", title: "Example", incognito };
    const view = {
      profileIndex: incognito ? 10000 : 2,
      webContents: {
        isDestroyed: () => false,
        loadURL: async () => {}
      }
    };
    const profileIndex = view.profileIndex;

    await memoryManager.unloadTabPage({
      view,
      tab,
      syncTabRecord: (patch) => Object.assign(tab, patch)
    });

    assert.equal(tab.incognito, incognito);
    assert.equal(view.profileIndex, profileIndex);
  }
});

test("already-unloaded tabs are not navigated or counted as newly reclaimed", async () => {
  let loadCalls = 0;
  const view = {
    memoryDiscarded: true,
    webContents: {
      isDestroyed: () => false,
      loadURL: async () => { loadCalls += 1; }
    }
  };

  const unloaded = await memoryManager.unloadTabPage({
    view,
    tab: { id: "discarded", url: "https://example.com" }
  });

  assert.equal(unloaded, false);
  assert.equal(loadCalls, 0);
  assert.equal(view.memoryDiscarded, true);
});

test("packaged app includes the RAM limiter controller", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(packageJson.build.files.includes(".build/**"));
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert.match(readme, /highest observed memory use/);
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(mainSource, /calculateAutomaticRamLimitMb\(os\.totalmem\(\)\)/);
});

test("RAM settings expose only Off and Automatic choices", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(indexHtml, /<option value="off"[^>]*>/);
  assert.match(indexHtml, /<option[^>]*value="automatic"[^>]*>/);
  assert.doesNotMatch(indexHtml, /<option value="(?:1024|2048|4096|8192)"/);
});
