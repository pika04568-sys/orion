const test = require("node:test");
const assert = require("node:assert/strict");

const appUtils = require("../app-utils");

test("reader pages map to the internal alias and stay trusted only through bundled app paths", () => {
  const readerUrl = appUtils.getAppPageUrl("reader.html");
  const newtabUrl = appUtils.getAppPageUrl("newtab.html");
  const trustedFiles = new Set(["index.html", "newtab.html", "offline.html", "extensions.html", "reader.html"]);

  assert.equal(appUtils.normalizeInternalUrl(readerUrl, ""), "chrome://reader");
  assert.equal(appUtils.normalizeInternalUrl(newtabUrl, ""), "chrome://newtab");
  assert.equal(appUtils.isTrustedAppPage(readerUrl, trustedFiles), true);
  assert.equal(appUtils.isTrustedAppPage("https://example.com/reader.html", trustedFiles), false);
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
