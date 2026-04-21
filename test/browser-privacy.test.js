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
