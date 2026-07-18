const test = require("node:test");
const assert = require("node:assert/strict");

const appUtils = require("../app-utils");

function createMockDocument() {
  return {
    createElement(tagName) {
      return {
        tagName,
        children: [],
        className: "",
        textContent: "",
        appendChild(child) {
          this.children.push(child);
          return child;
        }
      };
    }
  };
}

test("reader pages map to the internal alias and stay trusted only through bundled app paths", () => {
  const readerUrl = appUtils.getAppPageUrl("reader.html");
  const newtabUrl = appUtils.getAppPageUrl("newtab.html");
  const trustedFiles = new Set(["index.html", "newtab.html", "offline.html", "extensions.html", "reader.html"]);

  assert.equal(appUtils.normalizeInternalUrl(readerUrl, ""), "chrome://reader");
  assert.equal(appUtils.normalizeInternalUrl(newtabUrl, ""), "chrome://newtab");
  assert.equal(appUtils.isTrustedAppPage(readerUrl, trustedFiles), true);
  assert.equal(appUtils.isTrustedAppPage("https://example.com/reader.html", trustedFiles), false);
});

test("games command resolves to the offline arcade page", () => {
  const trustedFiles = new Set(["index.html", "newtab.html", "offline.html", "extensions.html", "reader.html"]);

  assert.equal(appUtils.getAppPageFileName("orion://games"), "offline.html");
  assert.equal(appUtils.normalizeInternalUrl("orion://games", "fallback"), "chrome://offline");
  assert.equal(appUtils.isTrustedAppPage("orion://games", trustedFiles), true);
});

test("reader button state exposes translated labels and pressed state", () => {
  const inactive = appUtils.getReaderButtonState(false, (key) => key === "reader.enterMode" ? "Reader Mode" : key);
  const active = appUtils.getReaderButtonState(true, (key) => key === "reader.exitMode" ? "Exit Reader Mode" : key);

  assert.deepEqual(inactive, {
    title: "Reader Mode",
    ariaLabel: "Reader Mode",
    ariaPressed: "false"
  });
  assert.deepEqual(active, {
    title: "Exit Reader Mode",
    ariaLabel: "Exit Reader Mode",
    ariaPressed: "true"
  });
});

test("deferred startup controller runs window-ready work once and only once", () => {
  const events = [];
  const controller = appUtils.createDeferredStartupController();

  controller.scheduleAfterWindowReady(() => events.push("queued"));
  assert.equal(controller.markWindowReady(), true);
  assert.equal(controller.markWindowReady(), false);

  controller.scheduleAfterWindowReady(() => events.push("immediate"));

  assert.deepEqual(events, ["queued", "immediate"]);
});

test("deferred startup controller triggers first-navigation work only for http urls", () => {
  const events = [];
  const controller = appUtils.createDeferredStartupController();

  controller.scheduleOnFirstNavigation((url) => events.push(url));

  assert.equal(controller.markNavigation("chrome://newtab"), false);
  assert.equal(controller.markNavigation("https://example.com"), true);
  assert.equal(controller.markNavigation("https://second.example.com"), false);

  assert.deepEqual(events, ["https://example.com"]);
});

test("extension cards hide removal for managed extensions only", () => {
  const doc = createMockDocument();
  const managed = appUtils.createExtensionCard(doc, {
    name: "uBlock Origin Lite",
    managed: true,
    removable: false
  }, { managed: "Managed by Orion" });
  const normal = appUtils.createExtensionCard(doc, {
    name: "Other extension",
    managed: false,
    removable: true
  });

  assert.equal(managed.removeBtn, null);
  assert.equal(managed.card.children[3].children[0].className, "managed-extension-badge");
  assert.equal(managed.card.children[3].children[0].textContent, "Managed by Orion");
  assert.equal(normal.removeBtn.className, "remove-btn");
});
