const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createReaderExtractionService } = require("../reader-extraction");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class FakeWebContents extends EventEmitter {
  constructor(id, url, execute) {
    super();
    this.id = id;
    this.url = url;
    this.loading = false;
    this.destroyed = false;
    this.execute = execute;
    this.executeCalls = 0;
  }

  getURL() {
    return this.url;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isLoading() {
    return this.loading;
  }

  executeJavaScript(source, userGesture) {
    this.executeCalls += 1;
    return this.execute(source, userGesture);
  }
}

function createService(options = {}) {
  return createReaderExtractionService({
    analysisSource: "function collect() { return {}; }",
    buildSnapshot: (analysis) => ({
      blocks: [{ type: "paragraph", text: "Readable content" }],
      images: [],
      readable: analysis.readable !== false,
      title: analysis.title || "Story"
    }),
    cacheSize: 2,
    loadTimeoutMs: 20,
    extractionTimeoutMs: 20,
    ...options
  });
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("deduplicates extraction and reuses a frozen snapshot for the same committed URL", async () => {
  const execution = deferred();
  const webContents = new FakeWebContents(1, "https://example.com/story", () => execution.promise);
  const service = createService();

  const first = service.resolve(webContents, { contextKey: "profile:0" });
  const duplicate = service.resolve(webContents, { contextKey: "profile:0" });
  await nextTurn();
  assert.equal(webContents.executeCalls, 1);
  execution.resolve({ title: "First" });

  const [firstSnapshot, duplicateSnapshot] = await Promise.all([first, duplicate]);
  assert.equal(firstSnapshot, duplicateSnapshot);
  assert.equal(firstSnapshot.sourceUrl, "https://example.com/story");
  assert.equal(Object.isFrozen(firstSnapshot), true);
  assert.equal(Object.isFrozen(firstSnapshot.blocks), true);

  const cached = await service.resolve(webContents, { contextKey: "profile:0" });
  assert.equal(cached, firstSnapshot);
  assert.equal(webContents.executeCalls, 1);
});

test("keeps snapshot caches isolated by context and supports disabling cache", async () => {
  const webContents = new FakeWebContents(2, "https://example.com/story", async () => ({ title: "Story" }));
  const service = createService();

  await service.resolve(webContents, { contextKey: "profile:0" });
  await service.resolve(webContents, { contextKey: "profile:1" });
  await service.resolve(webContents, { contextKey: "private", cache: false });
  await service.resolve(webContents, { contextKey: "private", cache: false });

  assert.equal(webContents.executeCalls, 4);
  assert.equal(service.cacheSize, 2);
});

test("bounds the cache with least-recently-used eviction", async () => {
  const service = createService({ cacheSize: 2 });
  const first = new FakeWebContents(3, "https://example.com/one", async () => ({ title: "One" }));
  const second = new FakeWebContents(4, "https://example.com/two", async () => ({ title: "Two" }));
  const third = new FakeWebContents(5, "https://example.com/three", async () => ({ title: "Three" }));

  await service.resolve(first);
  await service.resolve(second);
  await service.resolve(first);
  await service.resolve(third);
  await service.resolve(second);

  assert.equal(first.executeCalls, 1);
  assert.equal(second.executeCalls, 2);
  assert.equal(third.executeCalls, 1);
  assert.equal(service.cacheSize, 2);
});

for (const lifecycleEvent of ["destroyed", "render-process-gone"]) {
  test(`cancels extraction when WebContents emits ${lifecycleEvent}`, async () => {
    const execution = deferred();
    const webContents = new FakeWebContents(`lifecycle-${lifecycleEvent}`, "https://example.com/story", () => execution.promise);
    const service = createService({ extractionTimeoutMs: 100 });
    const result = service.resolve(webContents);
    await nextTurn();
    if (lifecycleEvent === "destroyed") webContents.destroyed = true;
    webContents.emit(lifecycleEvent, {});

    assert.equal(await result, null);
    assert.equal(webContents.listenerCount("did-start-navigation"), 0);
    execution.resolve({ title: "Too late" });
  });
}

test("cancels extraction on main-frame navigation but ignores subframe navigation", async () => {
  const firstExecution = deferred();
  const webContents = new FakeWebContents(6, "https://example.com/story", () => firstExecution.promise);
  const service = createService({ extractionTimeoutMs: 100 });
  const cancelled = service.resolve(webContents);
  await nextTurn();
  webContents.emit("did-start-navigation", {}, "https://example.com/next", false, true);
  assert.equal(await cancelled, null);
  firstExecution.resolve({ title: "Too late" });

  const secondExecution = deferred();
  webContents.execute = () => secondExecution.promise;
  const retained = service.resolve(webContents);
  await nextTurn();
  webContents.emit("did-start-navigation", {}, "https://frame.example/", false, false);
  secondExecution.resolve({ title: "Still current" });
  assert.equal((await retained).title, "Still current");
});

test("rejects results when the committed URL changes before extraction completes", async () => {
  const execution = deferred();
  const webContents = new FakeWebContents(7, "https://example.com/old", () => execution.promise);
  const service = createService({ extractionTimeoutMs: 100 });
  const result = service.resolve(webContents);
  await nextTurn();
  webContents.url = "https://example.com/new";
  execution.resolve({ title: "Stale" });

  assert.equal(await result, null);
  assert.equal(service.cacheSize, 0);
});

test("bounds load waiting and extraction execution while cleaning listeners", async () => {
  const loading = new FakeWebContents(8, "https://example.com/loading", async () => ({ title: "Never" }));
  loading.loading = true;
  const service = createService({ loadTimeoutMs: 5 });
  assert.equal(await service.resolve(loading), null);
  assert.equal(loading.executeCalls, 0);
  assert.equal(loading.listenerCount("did-stop-loading"), 0);
  assert.equal(loading.listenerCount("destroyed"), 0);

  const execution = deferred();
  const slow = new FakeWebContents(9, "https://example.com/slow", () => execution.promise);
  const boundedService = createService({ extractionTimeoutMs: 5 });
  assert.equal(await boundedService.resolve(slow), null);
  assert.equal(slow.listenerCount("render-process-gone"), 0);
  execution.resolve({ title: "Too late" });
});

test("does not cache unreadable snapshots or surface extraction failures", async () => {
  let shouldThrow = false;
  const webContents = new FakeWebContents(10, "https://example.com/story", async () => {
    if (shouldThrow) throw new Error("renderer unavailable");
    return { readable: false, title: "Unreadable" };
  });
  const service = createService();

  assert.equal((await service.resolve(webContents)).readable, false);
  assert.equal((await service.resolve(webContents)).readable, false);
  assert.equal(webContents.executeCalls, 2);
  assert.equal(service.cacheSize, 0);

  shouldThrow = true;
  assert.equal(await service.resolve(webContents), null);
});
