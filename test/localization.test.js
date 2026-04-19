const test = require("node:test");
const assert = require("node:assert/strict");

const localization = require("../localization");

test("UI platform text uses Windows-specific modifier labels and extension paths", () => {
  const uiText = localization.getUiPlatformText("en", "win32");

  assert.deepEqual(uiText, {
    platform: "windows",
    primaryModifierLabel: "Ctrl",
    extensionPathExample: "C:\\Users\\username\\Downloads\\my-extension",
    extensionPathPlaceholder: "C:\\Users\\username\\Downloads\\my-extension"
  });
  assert.equal(
    localization.t("en", "toolbar.newIncognitoTab", uiText),
    "New Incognito Tab (Ctrl+Shift+N)"
  );
  assert.equal(
    localization.t("en", "extension.loadExample", uiText),
    "(e.g., C:\\Users\\username\\Downloads\\my-extension)"
  );
});

test("UI platform text uses macOS-specific modifier labels", () => {
  const uiText = localization.getUiPlatformText("en", "darwin");

  assert.equal(uiText.platform, "mac");
  assert.equal(uiText.primaryModifierLabel, "Cmd");
  assert.equal(uiText.extensionPathExample, "/Users/username/Downloads/my-extension");
  assert.equal(
    localization.t("en", "toolbar.newIncognitoTab", uiText),
    "New Incognito Tab (Cmd+Shift+N)"
  );
});

test("UI platform text keeps Linux paths and localized modifier labels", () => {
  const uiText = localization.getUiPlatformText("de", "linux");

  assert.equal(uiText.platform, "linux");
  assert.equal(uiText.primaryModifierLabel, "Strg");
  assert.equal(uiText.extensionPathExample, "/home/username/Downloads/my-extension");
  assert.equal(
    localization.t("de", "toolbar.newIncognitoTab", uiText),
    "Neuer Inkognito-Tab (Strg+Umschalt+N)"
  );
});

test("reader strings are localized for internal reader mode surfaces", () => {
  assert.equal(localization.t("en", "reader.exitMode"), "Exit Reader Mode");
  assert.equal(localization.t("fr", "reader.backToPage"), "Retour à la page");
  assert.equal(localization.t("de", "reader.unavailable"), "Lesemodus nicht verfügbar");
  assert.equal(localization.t("ja", "reader.openCanonicalSource"), "正規ソースを開く");
  assert.equal(
    localization.t("en", "reader.updated", { value: "April 18, 2026" }),
    "Updated April 18, 2026"
  );
});
