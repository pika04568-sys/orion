function getInitialMaterializedTabId(tabs, requestedActiveTabId) {
  if (!Array.isArray(tabs) || !tabs.length) return null;
  if (
    typeof requestedActiveTabId === "string"
    && tabs.some((tab) => tab && tab.id === requestedActiveTabId)
  ) {
    return requestedActiveTabId;
  }
  const first = tabs.find((tab) => tab && typeof tab.id === "string" && tab.id);
  return first ? first.id : null;
}

module.exports = {
  getInitialMaterializedTabId
};
