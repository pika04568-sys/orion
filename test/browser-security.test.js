const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const browserSecurity = require("../browser-security");

test("permission decisions are sanitized and stored by origin", () => {
  const store = browserSecurity.sanitizePermissionStore({
    "profile:0": {
      "https://example.com": {
        notifications: "allow",
        usb: "deny",
        invalid: "maybe"
      },
      "file:///tmp/index.html": {
        notifications: "allow"
      }
    }
  });

  assert.deepEqual(store, {
    "profile:0": {
      "https://example.com": {
        notifications: "allow",
        usb: "deny"
      }
    }
  });

  browserSecurity.setPermissionDecision(
    store,
    "profile:0",
    "https://openai.com/some/path",
    "geolocation",
    browserSecurity.PERMISSION_DECISIONS.DENY
  );

  assert.equal(
    browserSecurity.getPermissionDecision(store, "profile:0", "https://openai.com", "geolocation"),
    browserSecurity.PERMISSION_DECISIONS.DENY
  );
});

test("permission origin normalization only accepts web origins", () => {
  assert.equal(browserSecurity.normalizePermissionOrigin("https://example.com/a"), "https://example.com");
  assert.equal(browserSecurity.normalizePermissionOrigin("http://example.com:8080/path"), "http://example.com:8080");
  assert.equal(browserSecurity.normalizePermissionOrigin("orion://app/index.html"), null);
  assert.equal(browserSecurity.normalizePermissionOrigin("file:///tmp/index.html"), null);
});

test("extension inspection summarizes manifest permissions and computes a stable hash", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orion-extension-"));
  const extensionRoot = path.join(tempRoot, "sample-extension");
  fs.mkdirSync(extensionRoot, { recursive: true });
  fs.writeFileSync(path.join(extensionRoot, "background.js"), "console.log('hello');\n");
  fs.writeFileSync(
    path.join(extensionRoot, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Sample Extension",
      version: "1.0.0",
      permissions: ["storage", "tabs"],
      host_permissions: ["https://example.com/*"],
      content_scripts: [
        {
          matches: ["https://*.openai.com/*"]
        }
      ]
    }, null, 2)
  );

  const inspection = browserSecurity.inspectExtensionDirectory(extensionRoot);

  assert.equal(inspection.name, "Sample Extension");
  assert.equal(inspection.version, "1.0.0");
  assert.equal(inspection.manifestVersion, 3);
  assert.deepEqual(inspection.permissions, [
    "content-script:https://*.openai.com/*",
    "host:https://example.com/*",
    "storage",
    "tabs"
  ]);
  assert.match(inspection.hash, /^[a-f0-9]{64}$/);
});

test("extension inspection rejects symbolic links", { skip: process.platform === "win32" }, () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orion-extension-link-"));
  const extensionRoot = path.join(tempRoot, "sample-extension");
  fs.mkdirSync(extensionRoot, { recursive: true });
  fs.writeFileSync(
    path.join(extensionRoot, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Linked Extension",
      version: "1.0.0"
    }, null, 2)
  );
  fs.symlinkSync(path.join(extensionRoot, "manifest.json"), path.join(extensionRoot, "manifest-link.json"));

  assert.throws(
    () => browserSecurity.inspectExtensionDirectory(extensionRoot),
    /Symbolic links are not allowed/
  );
});
