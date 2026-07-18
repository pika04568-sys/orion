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

test("privacy settings strings are localized for the settings panel and HTTPS-only interstitial", () => {
  assert.equal(localization.t("en", "settings.privacyTitle"), "Privacy");
  assert.equal(localization.t("fr", "settings.httpsOnly"), "Mode HTTPS uniquement");
  assert.equal(localization.t("de", "settings.doh"), "DNS-over-HTTPS");
  assert.equal(localization.t("ja", "settings.antiFingerprinting"), "アンチフィンガープリンティング");
  assert.equal(localization.t("en", "privacy.httpsOnlyErrorTitle"), "Secure connection required");
});

test("managed uBlock Origin Lite status and badge strings are localized", () => {
  for (const locale of ["en", "fr", "de", "ja"]) {
    assert.notEqual(localization.t(locale, "managedExtension.installingTitle"), "managedExtension.installingTitle");
    assert.notEqual(localization.t(locale, "managedExtension.errorBody"), "managedExtension.errorBody");
    assert.notEqual(localization.t(locale, "managedExtension.retry"), "managedExtension.retry");
    assert.notEqual(localization.t(locale, "extension.managed"), "extension.managed");
  }
});

test("RAM limiter settings and status strings are localized", () => {
  assert.equal(localization.t("en", "settings.performanceTitle"), "Performance");
  assert.equal(localization.t("fr", "settings.ramOff"), "Désactivée");
  assert.equal(localization.t("de", "settings.ramUnavailable"), "Nutzung nicht verfügbar");
  assert.equal(localization.t("ja", "settings.ramLimitLabel"), "RAM 上限");
  assert.equal(
    localization.t("en", "settings.ramAutomatic", { limit: "16" }),
    "Automatic (16 GB)"
  );
  assert.equal(
    localization.t("fr", "settings.ramAutomatic", { limit: "16" }),
    "Automatique (16 Go)"
  );
  assert.equal(
    localization.t("de", "settings.ramAutomaticUnavailable"),
    "Automatisch (nicht verfügbar)"
  );
  assert.equal(localization.t("ja", "settings.ramAutomatic", { limit: "16" }), "自動（16 GB）");
  assert.equal(
    localization.t("en", "settings.ramUsageWithLimit", { used: "900", limit: "1" }),
    "900 MB / 1 GB"
  );
  assert.match(localization.t("en", "settings.ramWarning"), /highest observed memory use/);
  assert.match(localization.t("fr", "settings.ramWarning"), /mémoire observée/);
  assert.match(localization.t("de", "settings.ramWarning"), /beobachteten Speichernutzung/);
  assert.match(localization.t("ja", "settings.ramWarning"), /観測されたメモリ使用量/);
});
