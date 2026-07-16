const test = require("node:test");
const assert = require("node:assert/strict");

const browserPrivacy = require("../browser-privacy");

test("privacy settings default to strict HTTPS-only, anti-fingerprinting, and Cloudflare DoH", () => {
  assert.deepEqual(browserPrivacy.sanitizePrivacySettings({}), {
    httpsOnlyMode: true,
    antiFingerprinting: true,
    dnsOverHttpsEnabled: true,
    dnsOverHttpsMode: "secure",
    dnsOverHttpsTemplate: "https://cloudflare-dns.com/dns-query"
  });
});

test("browser settings payload preserves showSeconds while adding privacy settings", () => {
  assert.deepEqual(browserPrivacy.buildBrowserSettingsPayload({ showSeconds: true }), {
    showSeconds: true,
    httpsOnlyMode: true,
    antiFingerprinting: true,
    dnsOverHttpsEnabled: true,
    dnsOverHttpsMode: "secure",
    dnsOverHttpsTemplate: "https://cloudflare-dns.com/dns-query"
  });
});

test("privacy settings patch updates only provided keys", () => {
  const result = browserPrivacy.updatePrivacySettings(
    {
      httpsOnlyMode: true,
      antiFingerprinting: true,
      dnsOverHttpsEnabled: true,
      dnsOverHttpsMode: "secure",
      dnsOverHttpsTemplate: "https://cloudflare-dns.com/dns-query"
    },
    {
      antiFingerprinting: false,
      dnsOverHttpsEnabled: false
    }
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.next, {
    httpsOnlyMode: true,
    antiFingerprinting: false,
    dnsOverHttpsEnabled: false,
    dnsOverHttpsMode: "secure",
    dnsOverHttpsTemplate: "https://cloudflare-dns.com/dns-query"
  });
});

test("HTTPS-only upgrades HTTP URLs without changing existing HTTPS URLs", () => {
  assert.deepEqual(browserPrivacy.upgradeToHttps("http://example.com/path?q=1"), {
    url: "https://example.com/path?q=1",
    upgraded: true
  });
  assert.deepEqual(browserPrivacy.upgradeToHttps("https://example.com/path?q=1"), {
    url: "https://example.com/path?q=1",
    upgraded: false
  });
});

test("anti-fingerprinting header hardening strips client hints and normalizes Accept-Language", () => {
  assert.deepEqual(
    browserPrivacy.hardenRequestHeaders({
      "Accept-Language": "de-DE,de;q=0.9",
      "Sec-CH-UA": "\"Chromium\";v=\"125\"",
      "User-Agent": "Example"
    }),
    {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Example"
    }
  );
});

test("anti-fingerprinting script contains the expected normalized surfaces", () => {
  const script = browserPrivacy.createFingerprintingProtectionScript();
  assert.match(script, /hardwareConcurrency/);
  assert.match(script, /deviceMemory/);
  assert.match(script, /timeZone: "UTC"/);
  assert.match(script, /37445/);
});

test("HTTPS-only error page uses a data URL interstitial", () => {
  const page = browserPrivacy.buildHttpsOnlyErrorPage("https://example.com");
  assert.match(page, /^data:text\/html;charset=utf-8,/);
  assert.match(page, /Secure%20connection%20required/);
  assert.match(page, /example\.com/);
});

test("legacy persistent incognito partitions exclude normal profiles", () => {
  assert.deepEqual(
    browserPrivacy.getLegacyPersistentIncognitoPartitionNames([
      "profile-0",
      "profile-9999",
      "profile-10000",
      "profile-10002",
      "profile-not-a-number",
      { name: "profile-10001" }
    ]),
    ["profile-10000", "profile-10001", "profile-10002"]
  );
});

test("legacy persistent incognito cleanup clears storage and cache", async () => {
  const calls = [];
  const result = await browserPrivacy.clearLegacyPersistentIncognitoPartitions({
    partitionNames: ["profile-0", "profile-10000", "profile-10001"],
    getSession: (partition) => ({
      clearStorageData: async () => calls.push([partition, "storage"]),
      clearCache: async () => calls.push([partition, "cache"])
    })
  });

  assert.deepEqual(result, {
    cleared: ["profile-10000", "profile-10001"],
    failed: [],
    complete: true
  });
  assert.deepEqual(calls, [
    ["persist:profile-10000", "storage"],
    ["persist:profile-10000", "cache"],
    ["persist:profile-10001", "storage"],
    ["persist:profile-10001", "cache"]
  ]);
});

test("legacy persistent incognito cleanup reports failures for retry", async () => {
  const result = await browserPrivacy.clearLegacyPersistentIncognitoPartitions({
    partitionNames: ["profile-10000", "profile-10001"],
    getSession: (partition) => ({
      clearStorageData: async () => {
        if (partition.endsWith("10001")) throw new Error("locked");
      },
      clearCache: async () => {}
    })
  });

  assert.deepEqual(result, {
    cleared: ["profile-10000"],
    failed: ["profile-10001"],
    complete: false
  });
});
