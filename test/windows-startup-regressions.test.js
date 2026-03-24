const test = require("node:test");
const assert = require("node:assert/strict");

const appUtils = require("../app-utils");

const TRUSTED_PAGE_FILES = new Set(["index.html", "newtab.html", "extensions.html"]);

test("getLocalPageFileName handles packaged Windows file URLs", () => {
  assert.equal(
    appUtils.getLocalPageFileName("file:///C:/Program%20Files/Orion/resources/app.asar/index.html"),
    "index.html"
  );
  assert.equal(
    appUtils.getLocalPageFileName("file:///C:/Users/Ken/AppData/Local/Programs/Orion/resources/app.asar/newtab.html"),
    "newtab.html"
  );
});

test("getLocalPageFileName handles Unix file URLs and rejects non-file URLs", () => {
  assert.equal(
    appUtils.getLocalPageFileName("file:///Users/kenokayasu/Documents/MyBrowser/extensions.html"),
    "extensions.html"
  );
  assert.equal(appUtils.getLocalPageFileName("https://example.com/index.html"), null);
  assert.equal(appUtils.getLocalPageFileName("not a url"), null);
});

test("trusted local page recognition works for packaged and internal Orion pages", () => {
  assert.equal(
    appUtils.isTrustedLocalPage("file:///C:/Program%20Files/Orion/resources/app.asar/index.html", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedLocalPage("file:///Users/kenokayasu/Documents/MyBrowser/newtab.html", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedLocalPage("file:///Users/kenokayasu/Documents/MyBrowser/extensions.html", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedLocalPage("file:///C:/Program%20Files/Orion/resources/app.asar/unknown.html", TRUSTED_PAGE_FILES),
    false
  );
  assert.equal(appUtils.isTrustedLocalPage("https://example.com/index.html", TRUSTED_PAGE_FILES), false);
});

test("internal Orion file URLs normalize to chrome aliases across platforms", () => {
  assert.equal(
    appUtils.normalizeInternalUrl(
      "file:///C:/Program%20Files/Orion/resources/app.asar/newtab.html",
      "fallback"
    ),
    "chrome://newtab"
  );
  assert.equal(
    appUtils.normalizeInternalUrl(
      "file:///Users/kenokayasu/Documents/MyBrowser/extensions.html",
      "fallback"
    ),
    "chrome://extensions"
  );
});

test("index shell channels allow renderer IPC and events", () => {
  assert.equal(appUtils.canUseElectronChannel("index.html", "send", "renderer-ready"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "invoke", "create-tab"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "invoke", "navigate-to"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "on", "tab-created"), true);
});

test("internal pages keep restricted invoke access", () => {
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "invoke", "navigate-to"), true);
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "invoke", "get-language-settings"), true);
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "send", "renderer-ready"), false);
  assert.equal(appUtils.canUseElectronChannel("extensions.html", "invoke", "load-extension"), true);
  assert.equal(appUtils.canUseElectronChannel("extensions.html", "on", "tab-created"), false);
});

test("unknown pages do not get privileged channel access", () => {
  assert.equal(appUtils.canUseElectronChannel("https://example.com", "invoke", "navigate-to"), false);
  assert.equal(appUtils.canUseElectronChannel("unknown.html", "send", "renderer-ready"), false);
  assert.deepEqual(appUtils.getElectronPageChannels("unknown.html"), {
    invoke: [],
    send: [],
    on: []
  });
});

test("renderer bootstrap prefers saved settings locale", () => {
  const state = appUtils.resolveRendererBootstrapState({
    persistedLocale: "ja",
    storedLocale: "fr",
    defaultLocale: "en",
    sanitizeLocale: (locale) => ["en", "fr", "de", "ja"].includes(locale) ? locale : null
  });
  assert.deepEqual(state, {
    locale: "ja",
    showOnboarding: false,
    source: "settings"
  });
});

test("renderer bootstrap falls back to stored locale without showing onboarding", () => {
  const state = appUtils.resolveRendererBootstrapState({
    persistedLocale: null,
    storedLocale: "de",
    defaultLocale: "en",
    sanitizeLocale: (locale) => ["en", "fr", "de", "ja"].includes(locale) ? locale : null
  });
  assert.deepEqual(state, {
    locale: "de",
    showOnboarding: false,
    source: "local-storage"
  });
});

test("renderer bootstrap shows onboarding only when no valid locale exists", () => {
  const state = appUtils.resolveRendererBootstrapState({
    persistedLocale: null,
    storedLocale: "invalid",
    defaultLocale: "en",
    sanitizeLocale: (locale) => ["en", "fr", "de", "ja"].includes(locale) ? locale : null
  });
  assert.deepEqual(state, {
    locale: "en",
    showOnboarding: true,
    source: "default"
  });
});
