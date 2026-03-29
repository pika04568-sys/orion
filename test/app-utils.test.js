const test = require("node:test");
const assert = require("node:assert/strict");

const appUtils = require("../app-utils");

test("reader pages map to the internal alias and stay trusted only through bundled app paths", () => {
  const readerUrl = appUtils.getAppPageUrl("reader.html");
  const trustedFiles = new Set(["index.html", "newtab.html", "offline.html", "extensions.html", "reader.html"]);

  assert.equal(appUtils.normalizeInternalUrl(readerUrl, ""), "chrome://reader");
  assert.equal(appUtils.isTrustedAppPage(readerUrl, trustedFiles), true);
  assert.equal(appUtils.isTrustedAppPage("https://example.com/reader.html", trustedFiles), false);
});
