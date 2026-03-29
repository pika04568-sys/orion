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

  restarted.initialize();
  assert.equal(
    restarted.shouldBlockRequest({
      url: "https://custom.example.com/ad.js",
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
