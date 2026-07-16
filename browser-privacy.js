const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";
const DEFAULT_DOH_TEMPLATE = "https://cloudflare-dns.com/dns-query";
const INCOGNITO_PROFILE_BASE = 10000;
const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  httpsOnlyMode: true,
  antiFingerprinting: true,
  dnsOverHttpsEnabled: true,
  dnsOverHttpsMode: "secure",
  dnsOverHttpsTemplate: DEFAULT_DOH_TEMPLATE
});

function sanitizePrivacySettings(raw = {}) {
  const next = {
    ...DEFAULT_PRIVACY_SETTINGS
  };

  if (typeof raw.httpsOnlyMode === "boolean") next.httpsOnlyMode = raw.httpsOnlyMode;
  if (typeof raw.antiFingerprinting === "boolean") next.antiFingerprinting = raw.antiFingerprinting;
  if (typeof raw.dnsOverHttpsEnabled === "boolean") next.dnsOverHttpsEnabled = raw.dnsOverHttpsEnabled;
  if (raw.dnsOverHttpsMode === "secure") next.dnsOverHttpsMode = "secure";
  if (typeof raw.dnsOverHttpsTemplate === "string" && raw.dnsOverHttpsTemplate.trim()) {
    next.dnsOverHttpsTemplate = raw.dnsOverHttpsTemplate.trim();
  }

  return next;
}

function buildBrowserSettingsPayload(raw = {}) {
  const settings = sanitizePrivacySettings(raw);
  return {
    showSeconds: typeof raw.showSeconds === "boolean" ? raw.showSeconds : undefined,
    httpsOnlyMode: settings.httpsOnlyMode,
    antiFingerprinting: settings.antiFingerprinting,
    dnsOverHttpsEnabled: settings.dnsOverHttpsEnabled,
    dnsOverHttpsMode: settings.dnsOverHttpsMode,
    dnsOverHttpsTemplate: settings.dnsOverHttpsTemplate
  };
}

function updatePrivacySettings(currentRaw = {}, patch = {}) {
  const current = sanitizePrivacySettings(currentRaw);
  const next = sanitizePrivacySettings({
    ...current,
    ...patch
  });

  const changed = Object.keys(DEFAULT_PRIVACY_SETTINGS).some((key) => current[key] !== next[key]);
  return { current, next, changed };
}

function upgradeToHttps(url) {
  if (!url || typeof url !== "string") return { url, upgraded: false };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return { url: parsed.href, upgraded: false };
    parsed.protocol = "https:";
    return { url: parsed.href, upgraded: true };
  } catch (_error) {
    return { url, upgraded: false };
  }
}

function hardenRequestHeaders(inputHeaders = {}) {
  const headers = {};

  Object.entries(inputHeaders).forEach(([key, value]) => {
    if (/^sec-ch-/i.test(key)) return;
    headers[key] = value;
  });

  let acceptLanguageKey = null;
  Object.keys(headers).forEach((key) => {
    if (key.toLowerCase() === "accept-language") acceptLanguageKey = key;
  });

  if (acceptLanguageKey) headers[acceptLanguageKey] = DEFAULT_ACCEPT_LANGUAGE;
  else headers["Accept-Language"] = DEFAULT_ACCEPT_LANGUAGE;

  return headers;
}

function createFingerprintingProtectionScript() {
  return `(() => {
    try {
      const defineValue = (target, key, value) => {
        try {
          Object.defineProperty(target, key, {
            configurable: true,
            enumerable: true,
            get: () => value
          });
        } catch (_error) {}
      };
      const navigatorProto = Object.getPrototypeOf(window.navigator);
      if (navigatorProto) {
        defineValue(navigatorProto, "hardwareConcurrency", 4);
        defineValue(navigatorProto, "deviceMemory", 8);
        defineValue(navigatorProto, "platform", "Win32");
        defineValue(navigatorProto, "language", "en-US");
        defineValue(navigatorProto, "languages", Object.freeze(["en-US", "en"]));
      }
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      if (typeof originalResolvedOptions === "function") {
        Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptionsPatched(...args) {
          const result = originalResolvedOptions.apply(this, args);
          return {
            ...result,
            timeZone: "UTC"
          };
        };
      }
      const patchWebGLContext = (proto) => {
        if (!proto || typeof proto.getParameter !== "function") return;
        const originalGetParameter = proto.getParameter;
        proto.getParameter = function getParameterPatched(parameter) {
          if (parameter === 37445) return "Intel Inc.";
          if (parameter === 37446) return "Intel Iris OpenGL Engine";
          return originalGetParameter.call(this, parameter);
        };
      };
      patchWebGLContext(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
      patchWebGLContext(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
    } catch (_error) {}
  })();`;
}

function buildHttpsOnlyErrorPage(url, localeStrings = {}) {
  const title = localeStrings.title || "Secure connection required";
  const body = localeStrings.body || "Orion upgraded this request to HTTPS, but the secure version of the site could not be loaded.";
  const detail = localeStrings.detail || "HTTP fallback is disabled in HTTPS-Only Mode.";
  const safeUrl = typeof url === "string" ? url : "";
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f5f7fb 0%, #eef2f7 100%);
        color: #10233b;
        display: grid;
        min-height: 100vh;
        place-items: center;
      }
      main {
        max-width: 640px;
        margin: 24px;
        padding: 32px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 20px 60px rgba(16, 35, 59, 0.12);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 30px;
      }
      p {
        line-height: 1.55;
      }
      code {
        display: inline-block;
        margin-top: 8px;
        padding: 10px 12px;
        border-radius: 12px;
        background: #eef3f8;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${body}</p>
      <p>${detail}</p>
      ${safeUrl ? `<code>${safeUrl}</code>` : ""}
    </main>
  </body>
</html>`)}`
}

function getLegacyPersistentIncognitoPartitionNames(entries = []) {
  if (!Array.isArray(entries)) return [];

  return Array.from(new Set(entries.map((entry) => {
    if (typeof entry === "string") return entry;
    return entry && typeof entry.name === "string" ? entry.name : "";
  }).filter((name) => {
    const match = /^profile-(\d+)$/.exec(name);
    return !!match && Number(match[1]) >= INCOGNITO_PROFILE_BASE;
  }))).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function clearLegacyPersistentIncognitoPartitions(options = {}) {
  const partitionNames = getLegacyPersistentIncognitoPartitionNames(options.partitionNames);
  const getSession = options.getSession;
  const cleared = [];
  const failed = [];

  if (typeof getSession !== "function") {
    return { cleared, failed: partitionNames, complete: false };
  }

  for (const partitionName of partitionNames) {
    try {
      const targetSession = getSession(`persist:${partitionName}`);
      if (
        !targetSession ||
        typeof targetSession.clearStorageData !== "function" ||
        typeof targetSession.clearCache !== "function"
      ) {
        throw new Error("Session cleanup APIs are unavailable.");
      }

      const results = await Promise.allSettled([
        targetSession.clearStorageData(),
        targetSession.clearCache()
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("One or more session cleanup operations failed.");
      }
      cleared.push(partitionName);
    } catch (_error) {
      failed.push(partitionName);
    }
  }

  return { cleared, failed, complete: failed.length === 0 };
}

module.exports = {
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_DOH_TEMPLATE,
  DEFAULT_PRIVACY_SETTINGS,
  DEFAULT_USER_AGENT,
  buildBrowserSettingsPayload,
  buildHttpsOnlyErrorPage,
  clearLegacyPersistentIncognitoPartitions,
  createFingerprintingProtectionScript,
  getLegacyPersistentIncognitoPartitionNames,
  hardenRequestHeaders,
  sanitizePrivacySettings,
  updatePrivacySettings,
  upgradeToHttps
};
