const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { createCoalescedAtomicWriter } = require("./async-store");

const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WORKER_TIMEOUT_MS = 15000;
const MAX_WORKER_TIMEOUT_MS = 30000;
const COMPILED_CACHE_VERSION = 1;

const BUILTIN_LISTS = Object.freeze([
  {
    id: "easylist",
    name: "EasyList",
    url: "https://easylist.to/easylist/easylist.txt",
    description: "Primary ad blocking rules"
  },
  {
    id: "ublock-filters",
    name: "uBlock filters",
    url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
    description: "uBlock Origin filter subscriptions"
  }
]);

const REQUEST_TYPE_MAP = Object.freeze({
  mainFrame: "document",
  subFrame: "subdocument",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  object: "object",
  objectSubrequest: "object",
  xmlhttprequest: "xmlhttprequest",
  ping: "ping",
  csp_report: "other",
  media: "media",
  websocket: "websocket",
  other: "other"
});

const FILTER_RESOURCE_TYPES = new Set([
  "document",
  "subdocument",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other"
]);

function createBoundedCache(maxEntries = 4096) {
  const limit = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 4096;
  const entries = new Map();
  return {
    clear: () => entries.clear(),
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (limit === 0) return;
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    get size() {
      return entries.size;
    }
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function getSnapshotDigest(snapshot) {
  return sha256(JSON.stringify(snapshot));
}

function getContentHashSignature(lists, customRulesHash) {
  return sha256(JSON.stringify({
    version: COMPILED_CACHE_VERSION,
    lists,
    customRulesHash
  }));
}

function getInputSignature(input) {
  const lists = Array.isArray(input && input.listEntries) ? input.listEntries : [];
  return getContentHashSignature(lists.map((entry) => ({
    id: entry && entry.id,
    enabled: !!(entry && entry.enabled),
    contentHash: sha256(entry && entry.text ? entry.text : "")
  })), sha256(input && input.customRules ? input.customRules : ""));
}

function escapeRegexChar(ch) {
  return ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function normalizeHostname(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const parsed = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return (parsed.hostname || "").toLowerCase();
  } catch (_error) {
    return String(value).trim().toLowerCase();
  }
}

function getHostnameCandidates(hostname) {
  const clean = normalizeHostname(hostname);
  if (!clean) return [];
  const parts = clean.split(".").filter(Boolean);
  const candidates = [];
  for (let i = 0; i < parts.length; i += 1) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}

function isSameSiteHost(requestHost, pageHost) {
  const a = normalizeHostname(requestHost);
  const b = normalizeHostname(pageHost);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function getPageHostFromDetails(details, requestHost) {
  const candidates = [
    details && details.documentUrl,
    details && details.documentURL,
    details && details.referrer,
    details && details.initiator
  ];

  for (const candidate of candidates) {
    const host = getHostFromUrl(candidate);
    if (host) return host;
  }

  if (details && (details.resourceType === "mainFrame" || details.resourceType === "subFrame")) {
    return requestHost || "";
  }

  return "";
}

function getHostFromUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return (parsed.hostname || "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function splitFilterOptions(line) {
  let escaped = false;
  let regexDepth = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "/") {
      regexDepth = regexDepth === 0 ? 1 : 0;
      continue;
    }
    if (ch === "$" && regexDepth === 0) {
      return [line.slice(0, i), line.slice(i + 1)];
    }
  }
  return [line, ""];
}

function parseOptionTokens(optionText) {
  const tokens = optionText
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  const result = {
    badFilter: false,
    domainAllow: [],
    domainDeny: [],
    requestTypes: null,
    thirdParty: null
  };

  for (const token of tokens) {
    if (token === "badfilter") {
      result.badFilter = true;
      continue;
    }
    if (token === "third-party") {
      result.thirdParty = true;
      continue;
    }
    if (token === "~third-party") {
      result.thirdParty = false;
      continue;
    }
    if (token.startsWith("domain=")) {
      const domains = token.slice("domain=".length)
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const domain of domains) {
        if (domain.startsWith("~")) result.domainDeny.push(normalizeHostname(domain.slice(1)));
        else result.domainAllow.push(normalizeHostname(domain));
      }
      continue;
    }
    if (FILTER_RESOURCE_TYPES.has(token)) {
      if (!result.requestTypes) result.requestTypes = new Set();
      result.requestTypes.add(token);
    }
  }

  return result;
}

function buildRegexSource(pattern) {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      source += ".*";
    } else if (ch === "^") {
      source += "(?:[^\\w\\d_\\-.%]|$)";
    } else {
      source += escapeRegexChar(ch);
    }
    i += 1;
  }
  return source;
}

function extractHostAnchor(pattern) {
  const remainder = pattern.slice(2);
  const hostChars = [];
  let i = 0;
  while (i < remainder.length) {
    const ch = remainder[i];
    if (ch === "/" || ch === "^" || ch === "*" || ch === "|" || ch === "$") break;
    hostChars.push(ch);
    i += 1;
  }
  const host = normalizeHostname(hostChars.join(""));
  return {
    host,
    remainder: remainder.slice(i)
  };
}

function compilePattern(pattern) {
  if (!pattern) return null;

  let prefix = "";
  let suffix = "";
  let body = pattern;
  let hostAnchor = "";

  if (body.startsWith("||")) {
    const extracted = extractHostAnchor(body);
    if (extracted.host) hostAnchor = extracted.host;
    prefix = "(?:^[^:]+://)?(?:[^/?#]*\\.)?";
    body = body.slice(2);
  } else if (body.startsWith("|")) {
    prefix = "^";
    body = body.slice(1);
  }

  if (body.endsWith("|")) {
    suffix = "$";
    body = body.slice(0, -1);
  }

  const source = `${prefix}${buildRegexSource(body)}${suffix}`;
  try {
    return {
      hostAnchor,
      regex: new RegExp(source, "i"),
      regexSource: source
    };
  } catch (_error) {
    return null;
  }
}

function ruleTextLooksLikeNetworkRule(text) {
  if (!text) return false;
  if (text.startsWith("!") || text.startsWith("[") || text.startsWith("##")) return false;
  if (text.includes("#@#") || text.includes("##") || text.includes("#?#") || text.includes("#$#")) return false;
  return true;
}

function compileRuleDescriptor(line) {
  const raw = line.trim();
  if (!ruleTextLooksLikeNetworkRule(raw)) return null;

  const exception = raw.startsWith("@@");
  const ruleText = exception ? raw.slice(2) : raw;
  const [patternText, optionText] = splitFilterOptions(ruleText);
  const pattern = patternText.trim();
  if (!pattern) return null;

  const options = parseOptionTokens(optionText);
  if (options.badFilter) return null;

  const compiledPattern = compilePattern(pattern);
  if (!compiledPattern) return null;

  const hostKey = compiledPattern.hostAnchor || "";

  return {
    exception,
    hostKey,
    regexSource: compiledPattern.regexSource,
    requestTypes: options.requestTypes ? Array.from(options.requestTypes) : null,
    thirdParty: options.thirdParty,
    domainAllow: options.domainAllow,
    domainDeny: options.domainDeny
  };
}

function hydrateRuleDescriptor(descriptor) {
  if (!descriptor || !descriptor.regexSource) return null;
  const requestTypes = Array.isArray(descriptor.requestTypes)
    ? new Set(descriptor.requestTypes)
    : null;
  const domainAllow = Array.isArray(descriptor.domainAllow) ? descriptor.domainAllow : [];
  const domainDeny = Array.isArray(descriptor.domainDeny) ? descriptor.domainDeny : [];
  const hostKey = descriptor.hostKey || "";
  let regex;
  try {
    regex = new RegExp(descriptor.regexSource, "i");
  } catch (_error) {
    return null;
  }

  return {
    exception: !!descriptor.exception,
    hostKey,
    matcher: (context) => {
      if (!context || !context.url) return false;
      if (requestTypes && (!context.requestType || !requestTypes.has(context.requestType))) {
        return false;
      }
      if (descriptor.thirdParty !== null) {
        if (!context.pageHost) return false;
        const sameSite = isSameSiteHost(context.requestHost, context.pageHost);
        if (descriptor.thirdParty && sameSite) return false;
        if (descriptor.thirdParty === false && !sameSite) return false;
      }
      if (domainAllow.length || domainDeny.length) {
        if (!context.pageHost) return false;
        const pageHost = context.pageHost;
        const allowMatches = domainAllow.length === 0
          || domainAllow.some((domain) => domain && (pageHost === domain || pageHost.endsWith(`.${domain}`)));
        const denyMatches = domainDeny.some((domain) => domain && (pageHost === domain || pageHost.endsWith(`.${domain}`)));
        if (!allowMatches || denyMatches) return false;
      }
      if (hostKey && !context.requestHostCandidates.includes(hostKey)) {
        return false;
      }
      return regex.test(context.url);
    }
  };
}

function compileRule(line) {
  return hydrateRuleDescriptor(compileRuleDescriptor(line));
}

function parseFilterList(text = "") {
  const allowRules = [];
  const blockRules = [];
  const counts = {
    allow: 0,
    block: 0,
    ignored: 0
  };

  String(text)
    .split(/\r?\n/)
    .forEach((line) => {
      const rule = compileRule(line);
      if (!rule) {
        counts.ignored += line.trim() ? 1 : 0;
        return;
      }
      if (rule.exception) {
        allowRules.push(rule);
        counts.allow += 1;
      } else {
        blockRules.push(rule);
        counts.block += 1;
      }
    });

  return { allowRules, blockRules, counts };
}

function parseFilterListDescriptors(text = "") {
  const allowRules = [];
  const blockRules = [];
  const counts = { allow: 0, block: 0, ignored: 0 };

  String(text).split(/\r?\n/).forEach((line) => {
    const descriptor = compileRuleDescriptor(line);
    if (!descriptor) {
      counts.ignored += line.trim() ? 1 : 0;
      return;
    }
    if (descriptor.exception) {
      allowRules.push(descriptor);
      counts.allow += 1;
    } else {
      blockRules.push(descriptor);
      counts.block += 1;
    }
  });

  return { allowRules, blockRules, counts };
}

function compileFilterSnapshot(listEntries = [], customRulesText = "") {
  return {
    lists: listEntries.map((entry) => ({
      id: entry && entry.id,
      enabled: !!(entry && entry.enabled),
      parsed: parseFilterListDescriptors(entry && entry.text ? entry.text : "")
    })),
    custom: parseFilterListDescriptors(customRulesText || "")
  };
}

function isCompiledFilterSnapshot(snapshot) {
  const validParsedRules = (parsed) => parsed
    && Array.isArray(parsed.allowRules)
    && Array.isArray(parsed.blockRules)
    && parsed.counts && Number.isFinite(parsed.counts.allow)
    && Number.isFinite(parsed.counts.block);
  return !!snapshot
    && Array.isArray(snapshot.lists)
    && snapshot.lists.every((list) => list && typeof list.id === "string" && validParsedRules(list.parsed))
    && validParsedRules(snapshot.custom);
}

class FilterEngine {
  constructor() {
    this.allowBuckets = new Map();
    this.blockBuckets = new Map();
    this.allowGeneric = [];
    this.blockGeneric = [];
  }

  addRules(rules, bucketMap, genericBucket) {
    for (const rule of rules) {
      if (rule.hostKey) {
        if (!bucketMap.has(rule.hostKey)) bucketMap.set(rule.hostKey, []);
        bucketMap.get(rule.hostKey).push(rule);
      } else {
        genericBucket.push(rule);
      }
    }
  }

  reset() {
    this.allowBuckets = new Map();
    this.blockBuckets = new Map();
    this.allowGeneric = [];
    this.blockGeneric = [];
  }

  rebuild(listEntries, customRulesText) {
    this.reset();

    for (const entry of listEntries) {
      if (!entry || !entry.enabled || !entry.text) continue;
      const parsed = parseFilterList(entry.text);
      this.addRules(parsed.allowRules, this.allowBuckets, this.allowGeneric);
      this.addRules(parsed.blockRules, this.blockBuckets, this.blockGeneric);
    }

    const customParsed = parseFilterList(customRulesText || "");
    this.addRules(customParsed.allowRules, this.allowBuckets, this.allowGeneric);
    this.addRules(customParsed.blockRules, this.blockBuckets, this.blockGeneric);
  }

  rebuildFromSnapshot(snapshot) {
    this.reset();
    const addParsed = (parsed) => {
      if (!parsed) return;
      const allowRules = (parsed.allowRules || []).map(hydrateRuleDescriptor).filter(Boolean);
      const blockRules = (parsed.blockRules || []).map(hydrateRuleDescriptor).filter(Boolean);
      this.addRules(allowRules, this.allowBuckets, this.allowGeneric);
      this.addRules(blockRules, this.blockBuckets, this.blockGeneric);
    };
    for (const list of snapshot && Array.isArray(snapshot.lists) ? snapshot.lists : []) {
      if (list && list.enabled) addParsed(list.parsed);
    }
    addParsed(snapshot && snapshot.custom);
  }

  shouldBlockRequest(details) {
    if (!details || !details.url || !String(details.url).startsWith("http")) return false;
    const requestUrl = String(details.url);
    const requestHost = getHostFromUrl(requestUrl);
    const requestType = REQUEST_TYPE_MAP[details.resourceType] || "other";
    const pageHost = getPageHostFromDetails(details, requestHost);
    const context = {
      url: requestUrl,
      requestHost,
      pageHost,
      requestType,
      requestHostCandidates: getHostnameCandidates(requestHost)
    };

    for (const key of context.requestHostCandidates) {
      const allowRules = this.allowBuckets.get(key);
      if (allowRules && allowRules.some((rule) => rule.matcher(context))) return false;
    }
    if (this.allowGeneric.some((rule) => rule.matcher(context))) return false;

    for (const key of context.requestHostCandidates) {
      const blockRules = this.blockBuckets.get(key);
      if (blockRules && blockRules.some((rule) => rule.matcher(context))) return true;
    }
    return this.blockGeneric.some((rule) => rule.matcher(context));
  }
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  } catch (_error) {}
}

function formatIsoTimestamp(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  try {
    return new Date(value).toISOString();
  } catch (_error) {
    return null;
  }
}

function createAdblockManager(options = {}) {
  const userDataDir = options.userDataDir;
  if (!userDataDir) {
    throw new Error("createAdblockManager requires a userDataDir");
  }

  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
  const refreshIntervalMs = Number.isFinite(options.refreshIntervalMs)
    ? options.refreshIntervalMs
    : DEFAULT_REFRESH_INTERVAL_MS;
  const logger = options.logger || console;
  const workerPath = typeof options.workerPath === "string" && options.workerPath
    ? options.workerPath
    : null;
  const decisionCache = createBoundedCache(options.decisionCacheMaxEntries);
  const listDefinitions = Array.isArray(options.lists) ? options.lists : BUILTIN_LISTS;
  const statePath = path.join(userDataDir, "adblock-state.json");
  const cacheDir = path.join(userDataDir, "adblock-cache");
  const compiledCachePath = path.join(cacheDir, `compiled-v${COMPILED_CACHE_VERSION}.json`);
  const cacheVersion = 1;
  const workerTimeoutMs = Number.isFinite(options.workerTimeoutMs)
    ? Math.min(MAX_WORKER_TIMEOUT_MS, Math.max(100, Math.floor(options.workerTimeoutMs)))
    : DEFAULT_WORKER_TIMEOUT_MS;

  const baseState = {
    version: cacheVersion,
    customRules: "",
    lists: {}
  };

  for (const def of listDefinitions) {
    baseState.lists[def.id] = {
      enabled: true,
      lastUpdatedAt: null,
      lastError: null,
      ruleCount: 0,
      contentHash: null,
      sourceUrl: def.url,
      name: def.name
    };
  }

  let state = safeReadJson(statePath, baseState);
  if (!state || typeof state !== "object") state = { ...baseState };
  state.version = cacheVersion;
  state.customRules = typeof state.customRules === "string" ? state.customRules : "";
  state.lists = state.lists && typeof state.lists === "object" ? state.lists : {};
  for (const def of listDefinitions) {
    const current = state.lists[def.id] && typeof state.lists[def.id] === "object"
      ? state.lists[def.id]
      : {};
    state.lists[def.id] = {
      enabled: typeof current.enabled === "boolean" ? current.enabled : true,
      lastUpdatedAt: Number.isFinite(current.lastUpdatedAt) ? current.lastUpdatedAt : null,
      lastError: typeof current.lastError === "string" ? current.lastError : null,
      ruleCount: Number.isFinite(current.ruleCount) ? current.ruleCount : 0,
      contentHash: isSha256(current.contentHash) ? current.contentHash : null,
      sourceUrl: def.url,
      name: def.name
    };
  }

  const compiledLists = new Map();
  const stateWriter = createCoalescedAtomicWriter({
    filePath: statePath,
    delayMs: 100,
    serialize: (value) => JSON.stringify(value, null, 2)
  });
  const compiledCacheWriter = createCoalescedAtomicWriter({
    filePath: compiledCachePath,
    delayMs: 0,
    serialize: (value) => JSON.stringify(value)
  });
  const cacheWriters = new Map();
  let engine = new FilterEngine();
  let cacheHydrated = false;
  let blockingReady = false;
  let blockingProvisional = false;
  let initializationError = null;
  let blockingReadyPromise = null;
  let compilePromise = null;
  let configRevision = 0;
  let requestedRevision = -1;
  let appliedRevision = -1;
  let syncState = {
    status: "idle",
    message: "Adblock lists loaded from cache.",
    lastSyncAt: null,
    lastError: null
  };
  let refreshPromise = null;

  function getListCachePath(listId) {
    return path.join(cacheDir, `${listId}.txt`);
  }

  function persistState() {
    stateWriter.schedule(state);
  }

  function getCacheWriter(listId) {
    if (!cacheWriters.has(listId)) {
      cacheWriters.set(listId, createCoalescedAtomicWriter({
        filePath: getListCachePath(listId),
        delayMs: 50,
        serialize: (value) => String(value || "")
      }));
    }
    return cacheWriters.get(listId);
  }

  async function flushPersistence() {
    await Promise.all([
      stateWriter.flush(),
      compiledCacheWriter.flush(),
      ...Array.from(cacheWriters.values(), (writer) => writer.flush())
    ]);
  }

  function getCompiledListEntries() {
    return listDefinitions.map((def) => {
      const meta = state.lists[def.id] || {};
      const cached = compiledLists.get(def.id) || {};
      return {
        id: def.id,
        enabled: meta.enabled !== false,
        text: cached.text || ""
      };
    });
  }

  function markConfigurationChanged() {
    configRevision += 1;
    requestedRevision = Math.max(requestedRevision, configRevision);
    decisionCache.clear();
  }

  function captureCompileInput(revision = configRevision) {
    const listEntries = getCompiledListEntries().map((entry) => Object.freeze({
      id: entry.id,
      enabled: entry.enabled,
      text: entry.text
    }));
    for (const entry of listEntries) {
      if (state.lists[entry.id]) state.lists[entry.id].contentHash = sha256(entry.text);
    }
    return Object.freeze({
      revision,
      listEntries: Object.freeze(listEntries),
      customRules: state.customRules
    });
  }

  function getPersistedInputSignature() {
    const lists = [];
    for (const def of listDefinitions) {
      const meta = state.lists[def.id] || {};
      if (!isSha256(meta.contentHash)) return null;
      lists.push({
        id: def.id,
        enabled: meta.enabled !== false,
        contentHash: meta.contentHash
      });
    }
    return getContentHashSignature(lists, sha256(state.customRules));
  }

  function isValidCompiledEnvelope(envelope) {
    if (!envelope || envelope.version !== COMPILED_CACHE_VERSION || !isCompiledFilterSnapshot(envelope.snapshot)) {
      return false;
    }
    const expectedInputSignature = getPersistedInputSignature();
    if (!expectedInputSignature || envelope.inputSignature !== expectedInputSignature) return false;
    return isSha256(envelope.snapshotSignature)
      && envelope.snapshotSignature === getSnapshotDigest(envelope.snapshot);
  }

  function applyCompiledSnapshot(snapshot, revision = configRevision) {
    if (!isCompiledFilterSnapshot(snapshot)) {
      throw new Error("Adblock compiler returned an invalid snapshot");
    }
    const nextEngine = new FilterEngine();
    nextEngine.rebuildFromSnapshot(snapshot);
    for (const list of snapshot && Array.isArray(snapshot.lists) ? snapshot.lists : []) {
      if (!list || !state.lists[list.id] || !list.parsed || !list.parsed.counts) continue;
      state.lists[list.id].ruleCount = list.parsed.counts.block + list.parsed.counts.allow;
    }
    engine = nextEngine;
    decisionCache.clear();
    blockingReady = true;
    blockingProvisional = false;
    initializationError = null;
    appliedRevision = revision;
    persistState();
    return getState();
  }

  function hydrateCompiledEnvelope(envelope) {
    if (!isValidCompiledEnvelope(envelope)) return false;
    applyCompiledSnapshot(envelope.snapshot, configRevision);
    return true;
  }

  function tryHydrateCompiledSnapshot() {
    try {
      if (!fs.existsSync(compiledCachePath)) return false;
      return hydrateCompiledEnvelope(JSON.parse(fs.readFileSync(compiledCachePath, "utf8")));
    } catch (_error) {
      return false;
    }
  }

  async function tryHydrateCompiledSnapshotAsync() {
    try {
      const text = await fs.promises.readFile(compiledCachePath, "utf8");
      return hydrateCompiledEnvelope(JSON.parse(text));
    } catch (error) {
      if (error && error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      return false;
    }
  }

  function createCompiledEnvelope(snapshot, input) {
    return Object.freeze({
      version: COMPILED_CACHE_VERSION,
      inputSignature: getInputSignature(input),
      snapshotSignature: getSnapshotDigest(snapshot),
      snapshot
    });
  }

  async function persistCompiledSnapshot(snapshot, input) {
    persistState();
    await stateWriter.flush();
    compiledCacheWriter.schedule(createCompiledEnvelope(snapshot, input));
    await compiledCacheWriter.flush();
  }

  function compileSnapshotInWorker(input) {
    if (typeof options.compileSnapshotAsync === "function") {
      return Promise.resolve().then(() => options.compileSnapshotAsync(input));
    }
    if (!workerPath) {
      return Promise.resolve(compileFilterSnapshot(input.listEntries, input.customRules));
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath);
      const requestId = `${Date.now()}-${Math.random()}`;
      let settled = false;
      const timeout = setTimeout(() => finish(new Error("Timed out compiling adblock filters")), workerTimeoutMs);
      if (typeof timeout.unref === "function") timeout.unref();
      const cleanup = () => {
        clearTimeout(timeout);
        void worker.terminate().catch(() => {});
      };
      const finish = (error, snapshot) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(snapshot);
      };
      worker.once("error", (error) => {
        finish(error);
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) finish(new Error(`Adblock worker exited with code ${code}`));
      });
      worker.on("message", (message) => {
        if (!message || message.id !== requestId) return;
        if (message.ok) finish(null, message.snapshot);
        else finish(new Error(message.error || "Unable to compile adblock filters"));
      });
      worker.postMessage({
        type: "compile",
        id: requestId,
        listEntries: input.listEntries,
        customRules: input.customRules
      });
    });
  }

  function hasRuleSources(input) {
    return !!input.customRules.trim()
      || input.listEntries.some((entry) => entry.enabled && !!entry.text.trim());
  }

  function installProvisionalEmptyEngine() {
    engine = new FilterEngine();
    decisionCache.clear();
    blockingReady = true;
    blockingProvisional = true;
  }

  function scheduleCurrentCompilation() {
    void requestCurrentCompilation().catch((error) => {
      blockingReady = false;
      blockingProvisional = false;
      initializationError = error instanceof Error ? error : new Error(String(error));
      if (logger.error) {
        logger.error(`Failed to initialize adblock filters: ${initializationError.message}`);
      }
    });
  }

  async function requestCurrentCompilation() {
    requestedRevision = Math.max(requestedRevision, configRevision);
    if (compilePromise) return compilePromise;
    compilePromise = (async () => {
      while (!blockingReady || appliedRevision < requestedRevision) {
        const targetRevision = configRevision;
        requestedRevision = Math.max(requestedRevision, targetRevision);
        const input = captureCompileInput(targetRevision);
        const snapshot = hasRuleSources(input)
          ? await compileSnapshotInWorker(input)
          : compileFilterSnapshot(input.listEntries, input.customRules);
        if (targetRevision !== configRevision || targetRevision < requestedRevision) continue;
        applyCompiledSnapshot(snapshot, targetRevision);
        await persistCompiledSnapshot(snapshot, input);
      }
      return getState();
    })().finally(() => {
      compilePromise = null;
    });
    return compilePromise;
  }

  function loadCachedList(listId) {
    const cachePath = getListCachePath(listId);
    try {
      if (!fs.existsSync(cachePath)) return { exists: false, text: "" };
      return { exists: true, text: fs.readFileSync(cachePath, "utf8") };
    } catch (error) {
      throw new Error(`Unable to read cached adblock list ${listId}: ${error.message}`);
    }
  }

  function validateCachedList(def, cached) {
    const meta = state.lists[def.id];
    if ((!cached.exists || !cached.text) && meta.ruleCount > 0) {
      throw new Error(`Cached adblock list ${def.id} is missing or empty`);
    }
    const contentHash = sha256(cached.text);
    if (meta.contentHash && meta.contentHash !== contentHash) {
      throw new Error(`Cached adblock list ${def.id} failed its integrity check`);
    }
    meta.contentHash = contentHash;
    return cached.text;
  }

  function hydrateFromCache() {
    if (cacheHydrated) return;
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const def of listDefinitions) {
      if (compiledLists.has(def.id)) continue;
      const text = validateCachedList(def, loadCachedList(def.id));
      compiledLists.set(def.id, {
        text,
        lastUpdatedAt: state.lists[def.id].lastUpdatedAt,
        ruleCount: state.lists[def.id].ruleCount
      });
      if (text && !state.lists[def.id].ruleCount) {
        const parsed = parseFilterList(text);
        state.lists[def.id].ruleCount = parsed.counts.block + parsed.counts.allow;
      }
    }
    cacheHydrated = true;
  }

  async function hydrateFromCacheAsync() {
    if (cacheHydrated) return;
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await Promise.all(listDefinitions.map(async (def) => {
      if (compiledLists.has(def.id)) return;
      let cached = { exists: true, text: "" };
      try {
        cached.text = await fs.promises.readFile(getListCachePath(def.id), "utf8");
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
        cached = { exists: false, text: "" };
      }
      const text = validateCachedList(def, cached);
      compiledLists.set(def.id, {
        text,
        lastUpdatedAt: state.lists[def.id].lastUpdatedAt,
        ruleCount: state.lists[def.id].ruleCount
      });
    }));
    cacheHydrated = true;
  }

  function ensureBlockingReady() {
    if (blockingReady) return getState();
    if (tryHydrateCompiledSnapshot()) return getState();
    hydrateFromCache();
    const input = captureCompileInput(configRevision);
    const snapshot = compileFilterSnapshot(input.listEntries, input.customRules);
    applyCompiledSnapshot(snapshot, configRevision);
    compiledCacheWriter.schedule(createCompiledEnvelope(snapshot, input));
    return getState();
  }

  async function ensureBlockingReadyAsync() {
    if (initializationError) throw initializationError;
    if (blockingReady) return getState();
    if (!blockingReadyPromise) {
      blockingReadyPromise = (async () => {
        if (await tryHydrateCompiledSnapshotAsync()) return getState();
        await hydrateFromCacheAsync();
        const input = captureCompileInput(configRevision);
        if (!hasRuleSources(input)) {
          const snapshot = compileFilterSnapshot(input.listEntries, input.customRules);
          applyCompiledSnapshot(snapshot, configRevision);
          compiledCacheWriter.schedule(createCompiledEnvelope(snapshot, input));
          return getState();
        }
        installProvisionalEmptyEngine();
        scheduleCurrentCompilation();
        return getState();
      })().finally(() => {
        blockingReadyPromise = null;
      });
    }
    return blockingReadyPromise;
  }

  function rebuildBlockingEngine() {
    hydrateFromCache();
    const input = captureCompileInput(configRevision);
    const snapshot = compileFilterSnapshot(input.listEntries, input.customRules);
    applyCompiledSnapshot(snapshot, configRevision);
    compiledCacheWriter.schedule(createCompiledEnvelope(snapshot, input));
    return getState();
  }

  async function rebuildBlockingEngineAsync() {
    await hydrateFromCacheAsync();
    return requestCurrentCompilation();
  }

  async function fetchText(url) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Fetch API is unavailable");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.fetchTimeoutMs || 15000);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          "user-agent": options.userAgent || "Orion Adblock Updater"
        }
      });
      if (!response || !response.ok) {
        throw new Error(`Request failed with status ${response ? response.status : "unknown"}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function updateCompiledList(def, text) {
    const previousText = (compiledLists.get(def.id) || {}).text || "";
    const parsed = workerPath ? null : parseFilterList(text);
    const ruleCount = parsed
      ? parsed.counts.block + parsed.counts.allow
      : (state.lists[def.id].ruleCount || 0);
    const updatedAt = Date.now();
    compiledLists.set(def.id, {
      text,
      lastUpdatedAt: updatedAt,
      ruleCount
    });
    state.lists[def.id].lastUpdatedAt = updatedAt;
    state.lists[def.id].lastError = null;
    state.lists[def.id].ruleCount = ruleCount;
    state.lists[def.id].contentHash = sha256(text);
    if (previousText !== text) markConfigurationChanged();
    const writer = getCacheWriter(def.id);
    writer.schedule(text);
    await writer.flush();
  }

  function updateSyncState(patch) {
    syncState = { ...syncState, ...patch };
    return getState();
  }

  async function refreshList(def) {
    const text = await fetchText(def.url);
    await updateCompiledList(def, text);
  }

  async function refreshBuiltInLists(refreshOptions = {}) {
    if (refreshPromise) return refreshPromise;
    const now = Date.now();
    const staleLists = listDefinitions.filter((def) => {
      const meta = state.lists[def.id] || {};
      if (!meta.enabled) return false;
      if (refreshOptions.force) return true;
      if (!meta.lastUpdatedAt) return true;
      return now - meta.lastUpdatedAt >= refreshIntervalMs;
    });

    if (!staleLists.length) {
      updateSyncState({
        status: "ready",
        message: "Adblock lists are up to date.",
        lastSyncAt: now,
        lastError: null
      });
      return getState();
    }

    updateSyncState({
      status: "updating",
      message: "Refreshing adblock lists...",
      lastError: null
    });

    refreshPromise = (async () => {
      const failures = [];
      await Promise.all(staleLists.map(async (def) => {
        try {
          await refreshList(def);
        } catch (error) {
          const message = error && error.message ? error.message : "Unknown error";
          state.lists[def.id].lastError = message;
          failures.push(`${def.name}: ${message}`);
          logger.warn ? logger.warn(`Failed to refresh adblock list ${def.id}: ${message}`) : null;
        }
      }));
      persistState();
      if (workerPath || typeof options.compileSnapshotAsync === "function") {
        await rebuildBlockingEngineAsync();
      } else {
        rebuildBlockingEngine();
      }
      const summary = {
        status: failures.length ? "degraded" : "ready",
        message: failures.length
          ? `Some adblock lists could not be refreshed. Using cached data where available.`
          : "Adblock lists are up to date.",
        lastSyncAt: Date.now(),
        lastError: failures.length ? failures.join("\n") : null
      };
      updateSyncState(summary);
      persistState();
      await flushPersistence();
      return getState();
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  function getState() {
    const lists = listDefinitions.map((def) => {
      const meta = state.lists[def.id] || {};
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        url: def.url,
        enabled: meta.enabled !== false,
        lastUpdatedAt: meta.lastUpdatedAt || null,
        lastError: meta.lastError || null,
        ruleCount: meta.ruleCount || 0
      };
    });

    return {
      blockingReady,
      blockingProvisional,
      cacheHydrated,
      customRules: state.customRules,
      hasCustomRules: !!state.customRules.trim(),
      lists,
      syncState: { ...syncState },
      defaults: {
        refreshIntervalMs,
        builtInListCount: listDefinitions.length
      }
    };
  }

  function recompile() {
    if (blockingReady) {
      rebuildBlockingEngine();
    }
    persistState();
    return getState();
  }

  async function recompileAsync() {
    await rebuildBlockingEngineAsync();
    persistState();
    await flushPersistence();
    return getState();
  }

  function updateCustomRules(text) {
    const nextRules = String(text || "");
    if (state.customRules === nextRules) return getState();
    state.customRules = nextRules;
    markConfigurationChanged();
    return recompile();
  }

  async function updateCustomRulesAsync(text) {
    const nextRules = String(text || "");
    if (state.customRules === nextRules) return getState();
    state.customRules = nextRules;
    markConfigurationChanged();
    return recompileAsync();
  }

  function setListEnabled(listId, enabled) {
    if (!state.lists[listId]) return getState();
    const nextEnabled = !!enabled;
    if (state.lists[listId].enabled === nextEnabled) return getState();
    state.lists[listId].enabled = nextEnabled;
    markConfigurationChanged();
    return recompile();
  }

  async function setListEnabledAsync(listId, enabled) {
    if (!state.lists[listId]) return getState();
    const nextEnabled = !!enabled;
    if (state.lists[listId].enabled === nextEnabled) return getState();
    state.lists[listId].enabled = nextEnabled;
    markConfigurationChanged();
    return recompileAsync();
  }

  function resetToDefaults() {
    let changed = false;
    for (const def of listDefinitions) {
      if (!state.lists[def.id]) continue;
      changed = changed || state.lists[def.id].enabled !== true;
      state.lists[def.id].enabled = true;
    }
    if (!changed) return getState();
    markConfigurationChanged();
    return recompile();
  }

  async function resetToDefaultsAsync() {
    let changed = false;
    for (const def of listDefinitions) {
      if (state.lists[def.id]) {
        changed = changed || state.lists[def.id].enabled !== true;
        state.lists[def.id].enabled = true;
      }
    }
    if (!changed) return getState();
    markConfigurationChanged();
    return recompileAsync();
  }

  function shouldBlockRequest(details) {
    if (!blockingReady) return false;
    const cacheKey = [
      details && details.resourceType,
      details && details.url,
      details && (details.documentUrl || details.documentURL || details.initiator || details.referrer)
    ].join("\n");
    const cachedDecision = decisionCache.get(cacheKey);
    if (cachedDecision !== undefined) return cachedDecision;
    const decision = engine.shouldBlockRequest(details);
    decisionCache.set(cacheKey, decision);
    return decision;
  }

  function initialize(initOptions = {}) {
    cacheHydrated = false;
    blockingReady = false;
    blockingProvisional = false;
    initializationError = null;
    blockingReadyPromise = null;
    if (!initOptions || initOptions.lazy !== true) {
      ensureBlockingReady();
    }
    persistState();
    return getState();
  }

  async function initializeAsync(initOptions = {}) {
    cacheHydrated = false;
    blockingReady = false;
    blockingProvisional = false;
    initializationError = null;
    blockingReadyPromise = null;
    persistState();
    if (!initOptions || initOptions.lazy !== true) await ensureBlockingReadyAsync();
    return getState();
  }

  return {
    initialize,
    initializeAsync,
    getState,
    isBlockingReady: () => blockingReady,
    ensureBlockingReady,
    ensureBlockingReadyAsync,
    flushPersistence,
    resetToDefaults,
    resetToDefaultsAsync,
    refreshBuiltInLists,
    setListEnabled,
    setListEnabledAsync,
    shouldBlockRequest,
    updateCustomRules,
    updateCustomRulesAsync
  };
}

module.exports = {
  BUILTIN_LISTS,
  compileFilterSnapshot,
  createBoundedCache,
  createAdblockManager,
  parseFilterList,
  parseFilterListDescriptors
};
