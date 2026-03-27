const test = require("node:test");
const assert = require("node:assert/strict");

const appUtils = require("../app-utils");

const TRUSTED_PAGE_FILES = new Set(["index.html", "newtab.html", "offline.html", "extensions.html"]);

test("getAppPageFileName handles Orion protocol URLs", () => {
  assert.equal(
    appUtils.getAppPageFileName("orion://app/index.html"),
    "index.html"
  );
  assert.equal(
    appUtils.getAppPageFileName("orion://app/newtab.html"),
    "newtab.html"
  );
});

test("getAppPageFileName still normalizes legacy file URLs for aliasing but rejects web URLs", () => {
  assert.equal(
    appUtils.getAppPageFileName("file:///Users/kenokayasu/Documents/MyBrowser/extensions.html"),
    "extensions.html"
  );
  assert.equal(
    appUtils.getAppPageFileName("file:///Users/kenokayasu/Documents/MyBrowser/offline.html?game=snake"),
    "offline.html"
  );
  assert.equal(appUtils.getAppPageFileName("https://example.com/index.html"), null);
  assert.equal(appUtils.getAppPageFileName("not a url"), null);
});

test("trusted Orion page recognition requires the custom app origin", () => {
  assert.equal(
    appUtils.isTrustedAppPage("orion://app/index.html", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedAppPage("orion://app/newtab.html", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedAppPage("orion://app/extensions.html", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedAppPage("orion://app/offline.html?game=tetris", TRUSTED_PAGE_FILES),
    true
  );
  assert.equal(
    appUtils.isTrustedAppPage("orion://app/unknown.html", TRUSTED_PAGE_FILES),
    false
  );
  assert.equal(appUtils.isTrustedAppPage("file:///Users/kenokayasu/Documents/MyBrowser/index.html", TRUSTED_PAGE_FILES), false);
  assert.equal(appUtils.isTrustedAppPage("https://example.com/index.html", TRUSTED_PAGE_FILES), false);
});

test("internal Orion URLs normalize to chrome aliases across protocol and legacy file paths", () => {
  assert.equal(
    appUtils.normalizeInternalUrl("orion://app/newtab.html", "fallback"),
    "chrome://newtab"
  );
  assert.equal(
    appUtils.normalizeInternalUrl(
      "file:///Users/kenokayasu/Documents/MyBrowser/extensions.html",
      "fallback"
    ),
    "chrome://extensions"
  );
  assert.equal(
    appUtils.normalizeInternalUrl(
      "file:///Users/kenokayasu/Documents/MyBrowser/offline.html?game=pacman",
      "fallback"
    ),
    "chrome://offline"
  );
});

test("index shell channels allow renderer IPC and events", () => {
  assert.equal(appUtils.canUseElectronChannel("index.html", "send", "renderer-ready"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "invoke", "create-tab"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "invoke", "get-window-bootstrap-state"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "invoke", "navigate-to"), true);
  assert.equal(appUtils.canUseElectronChannel("index.html", "on", "tab-created"), true);
});

test("internal pages keep restricted invoke access", () => {
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "invoke", "navigate-to"), true);
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "invoke", "get-language-settings"), true);
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "invoke", "load-extension"), false);
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "invoke", "get-window-bootstrap-state"), false);
  assert.equal(appUtils.canUseElectronChannel("newtab.html", "send", "renderer-ready"), false);
  assert.equal(appUtils.canUseElectronChannel("offline.html", "invoke", "navigate-to"), true);
  assert.equal(appUtils.canUseElectronChannel("offline.html", "invoke", "get-language-settings"), false);
  assert.equal(appUtils.canUseElectronChannel("offline.html", "invoke", "get-window-bootstrap-state"), false);
  assert.equal(appUtils.canUseElectronChannel("offline.html", "send", "renderer-ready"), false);
  assert.equal(appUtils.canUseElectronChannel("extensions.html", "invoke", "load-extension"), true);
  assert.equal(appUtils.canUseElectronChannel("extensions.html", "invoke", "navigate-to"), false);
  assert.equal(appUtils.canUseElectronChannel("extensions.html", "on", "tab-created"), false);
});

test("unknown pages do not get privileged channel access", () => {
  assert.equal(appUtils.canUseElectronChannel("https://example.com", "invoke", "navigate-to"), false);
  assert.equal(appUtils.canUseElectronChannel("unknown.html", "invoke", "get-window-bootstrap-state"), false);
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

test("browser shortcut resolver maps common navigation shortcuts", () => {
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, key: "l" }),
    "focus-address-bar"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, shift: true, key: "n" }),
    "new-incognito-tab"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", alt: true, key: "ArrowLeft" }),
    "go-back"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, key: "PageDown" }),
    "switch-tab-next"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, shift: true, key: "PageUp" }),
    "switch-tab-previous"
  );
});

test("browser shortcut resolver maps tab, reload, and panel shortcuts", () => {
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, key: "1" }),
    "switch-tab-1"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, shift: true, key: "t" }),
    "reopen-closed-tab"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, key: "r" }),
    "reload-page"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, shift: true, key: "r" }),
    "hard-reload-page"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, key: "," }),
    "show-settings"
  );
  assert.equal(
    appUtils.resolveBrowserShortcutAction({ type: "keyDown", control: true, key: "d" }),
    "bookmark-page"
  );
});
