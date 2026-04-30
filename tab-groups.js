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
  deleteGroup,
  getVisibleTabIds,
  renameGroup,
  sanitizeGroups,
  sanitizeRecoveryState,
  sanitizeTabs,
  toggleGroupCollapsed
};
