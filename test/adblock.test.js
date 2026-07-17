const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const adblock = require("../adblock");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orion-adblock-"));
}

function makeFetchStub(routes) {
  return async (url) => {
    const value = routes[url];
    if (value instanceof Error) throw value;
    if (typeof value !== "string") throw new Error(`Unexpected adblock list url: ${url}`);
    return {
      ok: true,
      text: async () => value
    };
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for asynchronous adblock test state");
}

test("bounded adblock decision cache evicts least-recently-used entries", () => {
  const cache = adblock.createBoundedCache(2);
  cache.set("first", true);
  cache.set("second", false);
  assert.equal(cache.get("first"), true);
  cache.set("third", true);

  assert.equal(cache.size, 2);
  assert.equal(cache.get("second"), undefined);
  assert.equal(cache.get("first"), true);
  assert.equal(cache.get("third"), true);
});

test("configured worker compiles refreshed lists before the engine swap", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/worker-list.txt";
  const manager = adblock.createAdblockManager({
    userDataDir,
    workerPath: path.join(__dirname, "..", "adblock-worker.js"),
    lists: [{ id: "worker-list", name: "Worker list", url: listUrl, description: "Test list" }],
    fetchImpl: makeFetchStub({ [listUrl]: "||worker.example.com^" })
  });

  await manager.initializeAsync({ lazy: true });
  const state = await manager.refreshBuiltInLists({ force: true });

  assert.equal(state.blockingReady, true);
  assert.equal(state.lists[0].ruleCount, 1);
  assert.equal(manager.shouldBlockRequest({
    url: "https://worker.example.com/ad.js",
    resourceType: "script",
    referrer: "https://news.example.org/"
  }), true);
});

test("adblock manager blocks EasyList-style filters, exceptions, and third-party rules", async () => {
  const userDataDir = createTempDir();
  const manager = adblock.createAdblockManager({
    userDataDir,
    lists: [
      {
        id: "easylist",
        name: "EasyList",
        url: "https://lists.local/easylist.txt",
        description: "Test list"
      },
      {
        id: "ublock-filters",
        name: "uBlock filters",
        url: "https://lists.local/ublock.txt",
        description: "Test list"
      }
    ],
    fetchImpl: makeFetchStub({
      "https://lists.local/easylist.txt": [
        "||ads.example.com^",
        "@@||ads.example.com/allow",
        "||cdn.example.org/banner*$image"
      ].join("\n"),
      "https://lists.local/ublock.txt": [
        "||tracker.example.net^$third-party"
      ].join("\n")
    })
  });

  manager.initialize();
  await manager.refreshBuiltInLists({ force: true });

  assert.equal(
    manager.shouldBlockRequest({
      url: "https://ads.example.com/banner.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    true
  );
  assert.equal(
    manager.shouldBlockRequest({
      url: "https://ads.example.com/allow.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    false
  );
  assert.equal(
    manager.shouldBlockRequest({
      url: "https://tracker.example.net/pixel.gif",
      resourceType: "image",
      referrer: "https://news.example.org/"
    }),
    true
  );
  assert.equal(
    manager.shouldBlockRequest({
      url: "https://tracker.example.net/pixel.gif",
      resourceType: "image",
      referrer: "https://tracker.example.net/article.html"
    }),
    false
  );
});

test("custom rules persist and survive restart from the cached state", async () => {
  const userDataDir = createTempDir();
  const manager = adblock.createAdblockManager({
    userDataDir,
    lists: [],
    fetchImpl: async () => ({ ok: true, text: async () => "" })
  });

  manager.initialize();
  manager.updateCustomRules([
    "||custom.example.com^",
    "@@||custom.example.com/allow"
  ].join("\n"));
  await manager.flushPersistence();

  assert.equal(
    manager.shouldBlockRequest({
      url: "https://custom.example.com/ad.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    true
  );
  assert.equal(
    manager.shouldBlockRequest({
      url: "https://custom.example.com/allow.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    false
  );

  const restarted = adblock.createAdblockManager({
    userDataDir,
    lists: [],
    fetchImpl: async () => ({ ok: true, text: async () => "" })
  });

  const restartedState = restarted.initialize({ lazy: true });
  assert.equal(restartedState.blockingReady, false);
  assert.equal(
    restarted.shouldBlockRequest({
      url: "https://custom.example.com/ad.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    false
  );
  restarted.ensureBlockingReady();
  assert.equal(
    restarted.shouldBlockRequest({
      url: "https://custom.example.com/ad.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    true
  );
});

test("lazy initialization returns state before filter compilation and compiles on demand", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/easylist.txt";
  const manager = adblock.createAdblockManager({
    userDataDir,
    lists: [
      {
        id: "easylist",
        name: "EasyList",
        url: listUrl,
        description: "Test list"
      }
    ],
    fetchImpl: makeFetchStub({ [listUrl]: "||lazy.example.com^" })
  });

  manager.initialize();
  await manager.refreshBuiltInLists({ force: true });

  const restarted = adblock.createAdblockManager({
    userDataDir,
    lists: [
      {
        id: "easylist",
        name: "EasyList",
        url: listUrl,
        description: "Test list"
      }
    ],
    fetchImpl: makeFetchStub({ [listUrl]: "||lazy.example.com^" })
  });

  const initialState = restarted.initialize({ lazy: true });
  assert.equal(initialState.blockingReady, false);
  assert.equal(initialState.cacheHydrated, false);
  assert.equal(initialState.lists[0].ruleCount, 1);

  restarted.ensureBlockingReady();
  const readyState = restarted.getState();
  assert.equal(readyState.blockingReady, true);
  assert.equal(
    restarted.shouldBlockRequest({
      url: "https://lazy.example.com/ad.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    true
  );
});

test("cached list data continues to block when refresh fails", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/easylist.txt";
  const successText = "||cached.example.com^";

  const first = adblock.createAdblockManager({
    userDataDir,
    lists: [
      {
        id: "easylist",
        name: "EasyList",
        url: listUrl,
        description: "Test list"
      }
    ],
    fetchImpl: makeFetchStub({ [listUrl]: successText })
  });

  first.initialize();
  await first.refreshBuiltInLists({ force: true });

  const second = adblock.createAdblockManager({
    userDataDir,
    lists: [
      {
        id: "easylist",
        name: "EasyList",
        url: listUrl,
        description: "Test list"
      }
    ],
    fetchImpl: makeFetchStub({ [listUrl]: new Error("offline") })
  });

  second.initialize();
  assert.equal(
    second.shouldBlockRequest({
      url: "https://cached.example.com/script.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    true
  );
});

test("built-in list toggles disable blocking without deleting cached data", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/easylist.txt";
  const manager = adblock.createAdblockManager({
    userDataDir,
    lists: [
      {
        id: "easylist",
        name: "EasyList",
        url: listUrl,
        description: "Test list"
      }
    ],
    fetchImpl: makeFetchStub({ [listUrl]: "||toggle.example.com^" })
  });

  manager.initialize();
  await manager.refreshBuiltInLists({ force: true });
  assert.equal(
    manager.shouldBlockRequest({
      url: "https://toggle.example.com/ad.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    true
  );

  manager.setListEnabled("easylist", false);
  assert.equal(
    manager.shouldBlockRequest({
      url: "https://toggle.example.com/ad.js",
      resourceType: "script",
      referrer: "https://news.example.org/"
    }),
    false
  );
});

test("empty first-run state becomes ready without waiting for the async compiler", async () => {
  const manager = adblock.createAdblockManager({
    userDataDir: createTempDir(),
    lists: [],
    compileSnapshotAsync: () => new Promise(() => {})
  });

  await manager.initializeAsync({ lazy: true });
  const result = await Promise.race([
    manager.ensureBlockingReadyAsync(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("empty initialization stalled")), 250))
  ]);

  assert.equal(result.blockingReady, true);
  assert.equal(manager.shouldBlockRequest({
    url: "https://first-run.example/",
    resourceType: "mainFrame"
  }), false);
});

test("legacy raw cache installs an empty engine without waiting for recompilation", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/legacy-list.txt";
  const lists = [{ id: "legacy", name: "Legacy", url: listUrl, description: "Test" }];
  const first = adblock.createAdblockManager({
    userDataDir,
    lists,
    fetchImpl: makeFetchStub({ [listUrl]: "||legacy-cache.example^" })
  });
  first.initialize();
  await first.refreshBuiltInLists({ force: true });
  await first.flushPersistence();
  fs.unlinkSync(path.join(userDataDir, "adblock-cache", "compiled-v1.json"));

  const compile = createDeferred();
  let capturedInput = null;
  const restarted = adblock.createAdblockManager({
    userDataDir,
    lists,
    compileSnapshotAsync: (input) => {
      capturedInput = input;
      return compile.promise;
    }
  });
  await restarted.initializeAsync({ lazy: true });
  const initialState = await Promise.race([
    restarted.ensureBlockingReadyAsync(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("legacy cache initialization stalled")), 250))
  ]);

  assert.equal(initialState.blockingReady, true);
  assert.equal(initialState.blockingProvisional, true);
  assert.equal(restarted.shouldBlockRequest({
    url: "https://legacy-cache.example/ad.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), false);
  await waitFor(() => !!capturedInput);
  compile.resolve(adblock.compileFilterSnapshot(capturedInput.listEntries, capturedInput.customRules));
  await waitFor(() => restarted.getState().blockingProvisional === false);
  assert.equal(restarted.shouldBlockRequest({
    url: "https://legacy-cache.example/ad.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), true);
});

test("async compiles discard stale results and atomically apply the latest revision", async () => {
  const compiles = [];
  const manager = adblock.createAdblockManager({
    userDataDir: createTempDir(),
    lists: [],
    compileSnapshotAsync: (input) => {
      const pending = createDeferred();
      compiles.push({ input, pending });
      return pending.promise;
    }
  });

  await manager.initializeAsync({ lazy: true });
  const firstUpdate = manager.updateCustomRulesAsync("||stale.example^");
  await waitFor(() => compiles.length === 1);
  const latestUpdate = manager.updateCustomRulesAsync("||latest.example^");

  compiles[0].pending.resolve(adblock.compileFilterSnapshot(
    compiles[0].input.listEntries,
    compiles[0].input.customRules
  ));
  await waitFor(() => compiles.length === 2);
  assert.equal(manager.isBlockingReady(), false);

  compiles[1].pending.resolve(adblock.compileFilterSnapshot(
    compiles[1].input.listEntries,
    compiles[1].input.customRules
  ));
  await Promise.all([firstUpdate, latestUpdate]);

  assert.equal(manager.shouldBlockRequest({
    url: "https://stale.example/ad.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), false);
  assert.equal(manager.shouldBlockRequest({
    url: "https://latest.example/ad.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), true);
  assert.equal(compiles.length, 2);
});

test("restart hydrates a signature-validated compiled snapshot without recompiling", async () => {
  const userDataDir = createTempDir();
  let initialCompileCount = 0;
  const first = adblock.createAdblockManager({
    userDataDir,
    lists: [],
    compileSnapshotAsync: async (input) => {
      initialCompileCount += 1;
      return adblock.compileFilterSnapshot(input.listEntries, input.customRules);
    }
  });
  await first.initializeAsync({ lazy: true });
  await first.updateCustomRulesAsync("||restart-cache.example^");
  await first.flushPersistence();
  assert.equal(initialCompileCount, 1);

  let restartCompileCount = 0;
  const restarted = adblock.createAdblockManager({
    userDataDir,
    lists: [],
    compileSnapshotAsync: async () => {
      restartCompileCount += 1;
      throw new Error("validated snapshot should avoid compilation");
    }
  });
  await restarted.initializeAsync({ lazy: true });
  await restarted.ensureBlockingReadyAsync();

  assert.equal(restartCompileCount, 0);
  assert.equal(restarted.shouldBlockRequest({
    url: "https://restart-cache.example/ad.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), true);
});

test("tampered compiled snapshots are rejected and rebuilt from immutable inputs", async () => {
  const userDataDir = createTempDir();
  const first = adblock.createAdblockManager({ userDataDir, lists: [] });
  first.initialize();
  await first.updateCustomRulesAsync("||signed.example^");
  await first.flushPersistence();

  const compiledPath = path.join(userDataDir, "adblock-cache", "compiled-v1.json");
  const envelope = JSON.parse(fs.readFileSync(compiledPath, "utf8"));
  envelope.snapshot.custom.blockRules[0].regexSource = ".*";
  fs.writeFileSync(compiledPath, JSON.stringify(envelope));

  let compileCount = 0;
  const restarted = adblock.createAdblockManager({
    userDataDir,
    lists: [],
    compileSnapshotAsync: async (input) => {
      compileCount += 1;
      return adblock.compileFilterSnapshot(input.listEntries, input.customRules);
    }
  });
  await restarted.initializeAsync({ lazy: true });
  await restarted.ensureBlockingReadyAsync();
  await waitFor(() => restarted.getState().blockingProvisional === false);

  assert.equal(compileCount, 1);
  assert.equal(restarted.shouldBlockRequest({
    url: "https://unrelated.example/content.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), false);
  assert.equal(restarted.shouldBlockRequest({
    url: "https://signed.example/content.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), true);
});

test("initialization rejects missing active cache instead of silently allowing", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/integrity-list.txt";
  const options = {
    userDataDir,
    lists: [{ id: "integrity", name: "Integrity", url: listUrl, description: "Test" }]
  };
  const first = adblock.createAdblockManager({
    ...options,
    fetchImpl: makeFetchStub({ [listUrl]: "||integrity.example^" })
  });
  first.initialize();
  await first.refreshBuiltInLists({ force: true });
  await first.flushPersistence();
  fs.unlinkSync(path.join(userDataDir, "adblock-cache", "compiled-v1.json"));
  fs.unlinkSync(path.join(userDataDir, "adblock-cache", "integrity.txt"));

  const restarted = adblock.createAdblockManager(options);
  await restarted.initializeAsync({ lazy: true });
  await assert.rejects(
    restarted.ensureBlockingReadyAsync(),
    /Cached adblock list integrity is missing or empty/
  );
  assert.equal(restarted.isBlockingReady(), false);
});

test("background initialization failures leave later requests fail-closed", async () => {
  const userDataDir = createTempDir();
  const listUrl = "https://lists.local/failing-worker-list.txt";
  const lists = [{ id: "failing", name: "Failing", url: listUrl, description: "Test" }];
  const first = adblock.createAdblockManager({
    userDataDir,
    lists,
    fetchImpl: makeFetchStub({ [listUrl]: "||failing-worker.example^" })
  });
  first.initialize();
  await first.refreshBuiltInLists({ force: true });
  await first.flushPersistence();
  fs.unlinkSync(path.join(userDataDir, "adblock-cache", "compiled-v1.json"));

  const loggedErrors = [];
  const restarted = adblock.createAdblockManager({
    userDataDir,
    lists,
    logger: { error: (message) => loggedErrors.push(message), warn: () => {} },
    compileSnapshotAsync: async () => {
      throw new Error("controlled compiler failure");
    }
  });
  await restarted.initializeAsync({ lazy: true });
  const initialState = await restarted.ensureBlockingReadyAsync();
  assert.equal(initialState.blockingProvisional, true);
  await waitFor(() => restarted.isBlockingReady() === false);

  await assert.rejects(restarted.ensureBlockingReadyAsync(), /controlled compiler failure/);
  assert.equal(loggedErrors.length, 1);
});

test("worker refresh never installs rules synchronously before compilation completes", async () => {
  const compile = createDeferred();
  let capturedInput = null;
  const listUrl = "https://lists.local/deferred-worker-list.txt";
  const manager = adblock.createAdblockManager({
    userDataDir: createTempDir(),
    workerPath: path.join(__dirname, "..", "adblock-worker.js"),
    lists: [{ id: "deferred", name: "Deferred", url: listUrl, description: "Test" }],
    fetchImpl: makeFetchStub({ [listUrl]: "||deferred.example^" }),
    compileSnapshotAsync: (input) => {
      capturedInput = input;
      return compile.promise;
    }
  });
  await manager.initializeAsync({ lazy: true });
  const refresh = manager.refreshBuiltInLists({ force: true });
  await waitFor(() => !!capturedInput);

  assert.equal(manager.isBlockingReady(), false);
  compile.resolve(adblock.compileFilterSnapshot(capturedInput.listEntries, capturedInput.customRules));
  await refresh;
  assert.equal(manager.shouldBlockRequest({
    url: "https://deferred.example/ad.js",
    resourceType: "script",
    referrer: "https://news.example/"
  }), true);
});
