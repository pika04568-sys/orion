const appUtils = require("./app-utils");

const RECOVERY_VERSION = 1;
const GROUP_COLORS = Object.freeze([
  "#0f6bff",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be123c"
]);

const LOCAL_AI_GROUP_RULES = Object.freeze([
  { name: "Code", terms: ["github", "gitlab", "bitbucket", "stackoverflow", "stack overflow", "npm", "developer", "docs.api"] },
  { name: "Docs", terms: ["docs", "documentation", "wiki", "notion", "confluence", "readme", "guide", "manual"] },
  { name: "Mail", terms: ["mail", "gmail", "outlook", "inbox", "email"] },
  { name: "Calendar", terms: ["calendar", "meeting", "meet.google", "zoom", "teams.microsoft"] },
  { name: "Work", terms: ["jira", "linear", "asana", "trello", "slack", "figma", "miro"] },
  { name: "Learning", terms: ["course", "learn", "tutorial", "udemy", "coursera", "youtube.com/watch", "academy"] },
  { name: "News", terms: ["news", "nytimes", "bbc", "reuters", "guardian", "cnn", "techcrunch", "verge"] },
  { name: "Shopping", terms: ["amazon", "shop", "store", "cart", "checkout", "ebay", "etsy"] },
  { name: "Social", terms: ["twitter", "x.com", "facebook", "instagram", "linkedin", "reddit", "threads"] },
  { name: "Finance", terms: ["bank", "finance", "billing", "invoice", "paypal", "stripe", "coinbase", "trading"] },
  { name: "Media", terms: ["youtube", "netflix", "spotify", "podcast", "video", "music", "tv"] }
]);

const SML_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "how", "in", "into", "is", "it", "of", "on",
  "or", "the", "to", "with", "your"
]);

const LOCAL_SML_TOPICS = Object.freeze([
  {
    name: "Code",
    terms: [
      "api", "app", "build", "bug", "cache", "cli", "cluster", "code", "component", "container", "css",
      "database", "debug", "deploy", "developer", "endpoint", "framework", "function", "javascript",
      "kubernetes", "library", "package", "python", "react", "release", "repository", "server", "software",
      "typescript"
    ]
  },
  {
    name: "Docs",
    terms: [
      "article", "book", "chapter", "definition", "explainer", "faq", "guide", "handbook", "manual", "notes",
      "overview", "paper", "reference", "spec", "standard", "summary", "whitepaper"
    ]
  },
  {
    name: "Work",
    terms: [
      "brief", "client", "dashboard", "deadline", "design", "feedback", "handoff", "kanban", "milestone",
      "planning", "project", "proposal", "review", "roadmap", "sprint", "task", "workflow"
    ]
  },
  {
    name: "Learning",
    terms: [
      "assignment", "class", "course", "curriculum", "exercise", "lecture", "lesson", "practice", "quiz",
      "school", "study", "training", "tutorial", "workshop"
    ]
  },
  {
    name: "Finance",
    terms: [
      "accounting", "budget", "cashflow", "expense", "forecast", "investment", "loan", "payroll", "portfolio",
      "pricing", "profit", "receipt", "revenue", "runway", "tax", "transaction"
    ]
  },
  {
    name: "Shopping",
    terms: [
      "bag", "buy", "catalog", "coupon", "deal", "delivery", "discount", "order", "price", "product",
      "purchase", "return", "sale", "shipping"
    ]
  },
  {
    name: "News",
    terms: [
      "analysis", "breaking", "coverage", "election", "headline", "investigation", "live", "politics",
      "report", "science", "world"
    ]
  },
  {
    name: "Media",
    terms: [
      "album", "channel", "episode", "film", "movie", "playlist", "show", "song", "stream", "trailer", "video"
    ]
  },
  {
    name: "Travel",
    terms: [
      "booking", "flight", "hotel", "itinerary", "map", "reservation", "restaurant", "route", "ticket",
      "train", "trip", "visa"
    ]
  },
  {
    name: "Health",
    terms: [
      "appointment", "care", "clinic", "doctor", "fitness", "health", "medical", "medicine", "nutrition",
      "symptom", "therapy", "workout"
    ]
  }
]);

function normalizeProfileId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeColor(value, index = 0) {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
    return value.trim();
  }
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function normalizeSortText(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function stemSmlToken(token) {
  let next = normalizeSortText(token).replace(/[^a-z0-9]/g, "");
  if (next.length > 5 && next.endsWith("ies")) next = `${next.slice(0, -3)}y`;
  else if (next.length > 6 && next.endsWith("ing")) next = next.slice(0, -3);
  else if (next.length > 5 && next.endsWith("ed")) next = next.slice(0, -2);
  else if (next.length > 4 && next.endsWith("s")) next = next.slice(0, -1);
  return next;
}

function tokenizeSmlText(value) {
  return normalizeSortText(value)
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map(stemSmlToken)
    .filter((token) => token.length >= 3 && !SML_STOP_WORDS.has(token));
}

function getHostname(url) {
  if (typeof url !== "string" || !url.trim()) return "";
  if (/^(chrome|orion):\/\//i.test(url)) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getSiteName(url) {
  const hostname = getHostname(url);
  if (!hostname) return "";
  const labels = hostname.split(".").filter(Boolean);
  if (!labels.length) return "";
  const commonSecondLevel = new Set(["co", "com", "org", "net", "ac", "gov"]);
  let index = labels.length >= 2 ? labels.length - 2 : 0;
  if (labels.length >= 3 && commonSecondLevel.has(labels[labels.length - 2])) index = labels.length - 3;
  return titleCase(labels[index] || labels[0]);
}

function inferSmlGroupName(tab = {}) {
  const titleTokens = tokenizeSmlText(tab.title);
  const urlTokens = tokenizeSmlText(tab.url);
  const tokenWeights = new Map();

  titleTokens.forEach((token) => tokenWeights.set(token, (tokenWeights.get(token) || 0) + 2));
  urlTokens.forEach((token) => tokenWeights.set(token, (tokenWeights.get(token) || 0) + 1));
  if (!tokenWeights.size) return "";

  let bestName = "";
  let bestScore = 0;
  let secondScore = 0;

  LOCAL_SML_TOPICS.forEach((topic) => {
    const topicTokens = new Set(topic.terms.flatMap(tokenizeSmlText));
    let score = 0;
    tokenWeights.forEach((weight, token) => {
      if (topicTokens.has(token)) score += weight;
    });
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestName = topic.name;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });

  return bestScore >= 2 && bestScore > secondScore ? bestName : "";
}

function inferOnDeviceGroupName(tab = {}) {
  const title = normalizeSortText(tab.title);
  const url = normalizeSortText(tab.url);
  const hostname = getHostname(tab.url);
  if (!hostname && /^(chrome|orion):\/\/newtab/i.test(String(tab.url || ""))) return "Start";

  const haystack = `${title} ${url} ${hostname}`;
  const matchedRule = LOCAL_AI_GROUP_RULES.find((rule) => rule.terms.some((term) => haystack.includes(term)));
  if (matchedRule) return matchedRule.name;

  const smlGroupName = inferSmlGroupName(tab);
  if (smlGroupName) return smlGroupName;

  return getSiteName(tab.url) || "Other";
}

function slugifyGroupName(name, fallback = "group") {
  const slug = normalizeSortText(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || fallback;
}

function createAutoGroupId(name, index, seenIds) {
  const base = `ai-${slugifyGroupName(name)}-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (seenIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(candidate);
  return candidate;
}

function sanitizeGroup(group = {}, index = 0) {
  const id = normalizeString(group.id, `group-${Date.now()}-${index}`);
  return {
    id,
    name: normalizeString(group.name, `Group ${index + 1}`).slice(0, 48),
    color: normalizeColor(group.color, index),
    collapsed: !!group.collapsed,
    createdAt: Number.isFinite(group.createdAt) ? group.createdAt : Date.now()
  };
}

function sanitizeGroups(groups) {
  const seen = new Set();
  return (Array.isArray(groups) ? groups : [])
    .map((group, index) => sanitizeGroup(group, index))
    .filter((group) => {
      if (!group.id || seen.has(group.id)) return false;
      seen.add(group.id);
      return true;
    });
}

function sanitizeTab(tab = {}, pIdx = 0, index = 0, groupIds = new Set()) {
  const id = normalizeString(tab.id, `p-${pIdx}-t-${index + 1}`);
  const url = appUtils.normalizeInternalUrl(tab.url || "chrome://newtab", "chrome://newtab") || "chrome://newtab";
  const next = {
    id,
    url,
    title: normalizeString(tab.title, "New Tab"),
    incognito: !!tab.incognito,
    readerMode: false
  };
  if (typeof tab.groupId === "string" && groupIds.has(tab.groupId)) next.groupId = tab.groupId;
  return next;
}

function sanitizeTabs(tabs, pIdx = 0, groups = []) {
  const groupIds = new Set(groups.map((group) => group.id));
  const seen = new Set();
  return (Array.isArray(tabs) ? tabs : [])
    .map((tab, index) => sanitizeTab(tab, pIdx, index, groupIds))
    .filter((tab) => {
      if (!tab.id || seen.has(tab.id)) return false;
      seen.add(tab.id);
      return true;
    });
}

function sanitizeProfileSession(profile = {}) {
  const id = normalizeProfileId(profile.id);
  if (id === null) return null;
  const groups = sanitizeGroups(profile.groups);
  const tabs = sanitizeTabs(profile.tabs, id, groups).filter((tab) => !tab.incognito);
  if (!tabs.length) return null;
  const activeTabId = typeof profile.activeTabId === "string" && tabs.some((tab) => tab.id === profile.activeTabId)
    ? profile.activeTabId
    : tabs[0].id;
  return {
    id,
    name: typeof profile.name === "string" ? profile.name : "",
    tabs,
    groups,
    activeTabId
  };
}

function sanitizeRecoveryState(raw = {}) {
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : [])
    .map(sanitizeProfileSession)
    .filter(Boolean);
  return {
    version: RECOVERY_VERSION,
    profiles
  };
}

function buildRecoveryState(profileSessions = []) {
  return sanitizeRecoveryState({
    version: RECOVERY_VERSION,
    profiles: profileSessions
  });
}

function createGroup(groups, options = {}) {
  const existing = sanitizeGroups(groups);
  const id = normalizeString(options.id, `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const group = sanitizeGroup({
    id,
    name: options.name || `Group ${existing.length + 1}`,
    color: options.color || GROUP_COLORS[existing.length % GROUP_COLORS.length],
    collapsed: false,
    createdAt: Date.now()
  }, existing.length);
  return group;
}

function createOnDeviceTabGroups(tabs, groups, options = {}) {
  if (!Array.isArray(tabs) || !tabs.length || !Array.isArray(groups)) {
    return { created: 0, grouped: 0 };
  }

  const eligibleTabs = tabs.filter((tab) => tab && tab.id && !tab.incognito);
  if (!eligibleTabs.length) return { created: 0, grouped: 0 };

  const buckets = new Map();
  eligibleTabs.forEach((tab) => {
    const groupName = inferOnDeviceGroupName(tab);
    if (!buckets.has(groupName)) buckets.set(groupName, []);
    buckets.get(groupName).push(tab);
  });

  const sortedNames = Array.from(buckets.keys()).sort((a, b) => normalizeSortText(a).localeCompare(normalizeSortText(b)));
  const seenIds = new Set();
  const nextGroups = sortedNames.map((name, index) => sanitizeGroup({
    id: createAutoGroupId(name, index, seenIds),
    name,
    color: GROUP_COLORS[index % GROUP_COLORS.length],
    collapsed: false,
    createdAt: Number.isFinite(options.createdAt) ? options.createdAt : Date.now()
  }, index));
  const idByName = new Map(nextGroups.map((group) => [group.name, group.id]));

  sortedNames.forEach((name) => {
    buckets.get(name).sort((a, b) => {
      const byTitle = normalizeSortText(a.title).localeCompare(normalizeSortText(b.title));
      if (byTitle) return byTitle;
      return normalizeSortText(a.url).localeCompare(normalizeSortText(b.url));
    });
  });

  eligibleTabs.forEach((tab) => {
    tab.groupId = idByName.get(inferOnDeviceGroupName(tab));
  });

  groups.splice(0, groups.length, ...nextGroups);

  const sortedEligibleIds = new Set(sortedNames.flatMap((name) => buckets.get(name).map((tab) => tab.id)));
  const sortedEligibleTabs = sortedNames.flatMap((name) => buckets.get(name));
  const untouchedTabs = tabs.filter((tab) => !tab || !sortedEligibleIds.has(tab.id));
  tabs.splice(0, tabs.length, ...sortedEligibleTabs, ...untouchedTabs);

  return {
    created: nextGroups.length,
    grouped: eligibleTabs.length
  };
}

function renameGroup(groups, groupId, name) {
  const nextName = normalizeString(name, "").slice(0, 48);
  if (!nextName) return false;
  const group = Array.isArray(groups) ? groups.find((entry) => entry && entry.id === groupId) : null;
  if (!group) return false;
  group.name = nextName;
  return true;
}

function deleteGroup(groups, tabs, groupId) {
  if (!Array.isArray(groups) || !groupId) return false;
  const index = groups.findIndex((group) => group && group.id === groupId);
  if (index === -1) return false;
  groups.splice(index, 1);
  if (Array.isArray(tabs)) {
    tabs.forEach((tab) => {
      if (tab && tab.groupId === groupId) delete tab.groupId;
    });
  }
  return true;
}

function assignTabToGroup(tabs, groups, tabId, groupId) {
  if (!Array.isArray(tabs) || !tabId) return false;
  const tab = tabs.find((entry) => entry && entry.id === tabId);
  if (!tab) return false;
  if (!groupId) {
    delete tab.groupId;
    return true;
  }
  if (!Array.isArray(groups) || !groups.some((group) => group && group.id === groupId)) return false;
  tab.groupId = groupId;
  return true;
}

function toggleGroupCollapsed(groups, groupId, collapsed) {
  const group = Array.isArray(groups) ? groups.find((entry) => entry && entry.id === groupId) : null;
  if (!group) return false;
  group.collapsed = typeof collapsed === "boolean" ? collapsed : !group.collapsed;
  return true;
}

function getVisibleTabIds(tabs, groups, activeTabId) {
  const collapsedGroups = new Set((Array.isArray(groups) ? groups : [])
    .filter((group) => group && group.collapsed)
    .map((group) => group.id));
  return (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => tab && (!tab.groupId || !collapsedGroups.has(tab.groupId) || tab.id === activeTabId))
    .map((tab) => tab.id);
}

module.exports = {
  GROUP_COLORS,
  RECOVERY_VERSION,
  assignTabToGroup,
  buildRecoveryState,
  createGroup,
  createOnDeviceTabGroups,
  deleteGroup,
  inferOnDeviceGroupName,
  getVisibleTabIds,
  renameGroup,
  sanitizeGroups,
  sanitizeRecoveryState,
  sanitizeTabs,
  toggleGroupCollapsed
};
