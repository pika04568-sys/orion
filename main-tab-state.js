const appUtils = require("./app-utils");

function getProfileTabs(profileTabs) {
  return Array.isArray(profileTabs) ? profileTabs : [];
}

function updateTabOnNavigate(profileTabs, tabId, rawUrl) {
  const tabs = getProfileTabs(profileTabs);
  const normalizedUrl = appUtils.normalizeInternalUrl(rawUrl, rawUrl || "");
  return appUtils.syncTabRecord(tabs, tabId, { url: normalizedUrl });
}

function updateTabOnTitle(profileTabs, tabId, title, rawUrl) {
  const tabs = getProfileTabs(profileTabs);
  const patch = {};

  if (rawUrl) patch.url = appUtils.normalizeInternalUrl(rawUrl, rawUrl);
  if (typeof title !== "undefined") patch.title = title;

  return appUtils.syncTabRecord(tabs, tabId, patch);
}

function buildTabSwitchPayload(profileTabs, tabId, rawUrl, rawTitle) {
  const tabs = getProfileTabs(profileTabs);
  const normalizedUrl = appUtils.normalizeInternalUrl(rawUrl, rawUrl || "");
  const currentTab = tabs.find((tab) => tab && tab.id === tabId) || null;
  const title = rawTitle || (currentTab && currentTab.title) || normalizedUrl || "New Tab";
  const updatedTab = appUtils.syncTabRecord(tabs, tabId, {
    url: normalizedUrl,
    title
  });

  return {
    tabId,
    url: (updatedTab && updatedTab.url) || normalizedUrl,
    title: (updatedTab && updatedTab.title) || title,
    incognito: !!(currentTab && currentTab.incognito)
  };
}

module.exports = {
  buildTabSwitchPayload,
  updateTabOnNavigate,
  updateTabOnTitle
};
