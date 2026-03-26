const test = require("node:test");
const assert = require("node:assert/strict");

const offlineArcade = require("../offline-arcade");

test("offline load failures trigger the arcade only for the main frame", () => {
  assert.equal(
    offlineArcade.shouldTriggerOfflinePage({
      errorDescription: "net::ERR_INTERNET_DISCONNECTED",
      isMainFrame: true
    }),
    true
  );
  assert.equal(
    offlineArcade.shouldTriggerOfflinePage({
      errorDescription: "net::ERR_INTERNET_DISCONNECTED",
      isMainFrame: false
    }),
    false
  );
});

test("non-offline failures do not trigger the arcade page", () => {
  assert.equal(
    offlineArcade.shouldTriggerOfflinePage({
      errorDescription: "net::ERR_NAME_NOT_RESOLVED",
      isMainFrame: true
    }),
    false
  );
});

test("new tab routing flips to the offline arcade only when the browser is offline", () => {
  assert.equal(offlineArcade.shouldRouteNewTabToOffline(false), true);
  assert.equal(offlineArcade.shouldRouteNewTabToOffline(true), false);
});

test("reloading an offline tab retries the original target", () => {
  assert.equal(
    offlineArcade.resolveOfflineReloadTarget({ targetUrl: "https://example.com" }),
    "https://example.com"
  );
  assert.equal(
    offlineArcade.resolveOfflineReloadTarget({ targetUrl: "chrome://newtab" }),
    "chrome://newtab"
  );
});

test("abort failures are ignored so replacement navigation does not recurse", () => {
  assert.equal(
    offlineArcade.shouldIgnoreLoadFailure({
      errorDescription: "net::ERR_ABORTED",
      isMainFrame: true
    }),
    true
  );
  assert.equal(
    offlineArcade.shouldIgnoreLoadFailure({
      errorDescription: "net::ERR_INTERNET_DISCONNECTED",
      isMainFrame: true
    }),
    false
  );
});
