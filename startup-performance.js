function normalizePreconnectOrigin(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;
    return parsed.origin;
  } catch (_error) {
    return null;
  }
}

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

function createIntentPreconnector(options = {}) {
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : 200;
  const timers = new Map();

  function schedule(key, session, value) {
    const origin = normalizePreconnectOrigin(value);
    if (!origin || !session || typeof session.preconnect !== "function") return false;
    if (timers.has(key)) clearTimeout(timers.get(key));
    const timer = setTimeout(() => {
      timers.delete(key);
      try {
        session.preconnect({ url: origin, numSockets: 1 });
      } catch (_error) {}
    }, delayMs);
    if (typeof timer.unref === "function") timer.unref();
    timers.set(key, timer);
    return true;
  }

  function cancel(key) {
    if (!timers.has(key)) return false;
    clearTimeout(timers.get(key));
    timers.delete(key);
    return true;
  }

  function clear() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { cancel, clear, schedule };
}

module.exports = {
  createIntentPreconnector,
  getInitialMaterializedTabId,
  normalizePreconnectOrigin
};
