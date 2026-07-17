const readerUtils = require("./reader-utils");

const DEFAULT_CACHE_SIZE = 32;
const DEFAULT_LOAD_TIMEOUT_MS = 3000;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 5000;

function normalizeCommittedUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch (_error) {
    return "";
  }
}

function freezeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  if (Array.isArray(snapshot.blocks)) {
    snapshot.blocks.forEach((block) => Object.freeze(block));
    Object.freeze(snapshot.blocks);
  }
  if (Array.isArray(snapshot.images)) {
    snapshot.images.forEach((image) => Object.freeze(image));
    Object.freeze(snapshot.images);
  }
  return Object.freeze(snapshot);
}

function createReaderExtractionService(options = {}) {
  const analysisSource = typeof options.analysisSource === "string" ? options.analysisSource : "";
  const buildSnapshot = typeof options.buildSnapshot === "function"
    ? options.buildSnapshot
    : readerUtils.buildReaderSnapshot;
  const cacheSize = Math.max(1, Math.floor(options.cacheSize || DEFAULT_CACHE_SIZE));
  const loadTimeoutMs = Math.max(1, Math.floor(options.loadTimeoutMs || DEFAULT_LOAD_TIMEOUT_MS));
  const extractionTimeoutMs = Math.max(1, Math.floor(options.extractionTimeoutMs || DEFAULT_EXTRACTION_TIMEOUT_MS));
  const snapshotCache = new Map();
  const inFlight = new Map();

  function getWebContentsKey(webContents) {
    return webContents && webContents.id != null ? `id:${webContents.id}` : webContents;
  }

  function getCachedSnapshot(cacheKey) {
    const cached = snapshotCache.get(cacheKey);
    if (!cached) return null;
    snapshotCache.delete(cacheKey);
    snapshotCache.set(cacheKey, cached);
    return cached;
  }

  function setCachedSnapshot(cacheKey, snapshot) {
    snapshotCache.delete(cacheKey);
    snapshotCache.set(cacheKey, snapshot);
    while (snapshotCache.size > cacheSize) {
      snapshotCache.delete(snapshotCache.keys().next().value);
    }
  }

  function createOperation(webContents) {
    const cancelListeners = new Set();
    const cleanupListeners = [];
    const operation = {
      cancelled: false,
      onCancel(listener) {
        if (operation.cancelled) {
          listener();
          return () => {};
        }
        cancelListeners.add(listener);
        return () => cancelListeners.delete(listener);
      },
      cancel() {
        if (operation.cancelled) return;
        operation.cancelled = true;
        for (const listener of cancelListeners) listener();
        cancelListeners.clear();
      },
      cleanup() {
        for (const cleanup of cleanupListeners) cleanup();
        cleanupListeners.length = 0;
        cancelListeners.clear();
      }
    };

    if (webContents && typeof webContents.on === "function") {
      const attach = (eventName, listener) => {
        webContents.on(eventName, listener);
        cleanupListeners.push(() => {
          if (typeof webContents.removeListener === "function") {
            webContents.removeListener(eventName, listener);
          }
        });
      };
      const cancelForMainFrameNavigation = (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame !== false) operation.cancel();
      };
      const cancelForMainFrameInPageNavigation = (_event, _url, isMainFrame) => {
        if (isMainFrame !== false) operation.cancel();
      };
      attach("did-start-navigation", cancelForMainFrameNavigation);
      attach("did-navigate-in-page", cancelForMainFrameInPageNavigation);
      attach("destroyed", () => operation.cancel());
      attach("render-process-gone", () => operation.cancel());
    }

    return operation;
  }

  function bounded(operation, promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      let timeout = null;
      let removeCancelListener = () => {};
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        removeCancelListener();
        resolve(result);
      };
      timeout = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
      removeCancelListener = operation.onCancel(() => finish({ status: "cancelled" }));
      Promise.resolve(promise).then(
        (value) => finish({ status: "value", value }),
        () => finish({ status: "error" })
      );
    });
  }

  async function waitForLoad(webContents, operation) {
    if (!webContents.isLoading()) return true;
    let onStopLoading;
    const stopped = new Promise((resolve) => {
      onStopLoading = () => resolve(true);
      webContents.once("did-stop-loading", onStopLoading);
    });
    try {
      const result = await bounded(operation, stopped, loadTimeoutMs);
      return result.status === "value";
    } finally {
      if (onStopLoading && typeof webContents.removeListener === "function") {
        webContents.removeListener("did-stop-loading", onStopLoading);
      }
    }
  }

  function cancel(webContents) {
    const pending = inFlight.get(getWebContentsKey(webContents));
    if (pending) pending.operation.cancel();
  }

  function clearContext(contextKey) {
    const prefix = `${String(contextKey || "default")}\n`;
    for (const key of snapshotCache.keys()) {
      if (key.startsWith(prefix)) snapshotCache.delete(key);
    }
  }

  function resolve(webContents, resolveOptions = {}) {
    if (!analysisSource || !webContents || webContents.isDestroyed()) return Promise.resolve(null);
    const committedUrl = normalizeCommittedUrl(webContents.getURL());
    if (!committedUrl) return Promise.resolve(null);

    const contextKey = String(resolveOptions.contextKey || "default");
    const allowCache = resolveOptions.cache !== false;
    const cacheKey = `${contextKey}\n${committedUrl}`;
    if (allowCache) {
      const cached = getCachedSnapshot(cacheKey);
      if (cached) return Promise.resolve(cached);
    }

    const webContentsKey = getWebContentsKey(webContents);
    const pending = inFlight.get(webContentsKey);
    if (pending && pending.committedUrl === committedUrl && pending.contextKey === contextKey) {
      return pending.promise;
    }
    if (pending) pending.operation.cancel();

    const operation = createOperation(webContents);
    const promise = (async () => {
      try {
        if (!await waitForLoad(webContents, operation)) return null;
        if (operation.cancelled || webContents.isDestroyed()) return null;
        if (normalizeCommittedUrl(webContents.getURL()) !== committedUrl) return null;

        const execution = bounded(
          operation,
          webContents.executeJavaScript(`(${analysisSource})()`, true),
          extractionTimeoutMs
        );
        const result = await execution;
        if (result.status !== "value" || operation.cancelled || webContents.isDestroyed()) return null;
        if (normalizeCommittedUrl(webContents.getURL()) !== committedUrl) return null;

        const snapshot = buildSnapshot(result.value || {});
        if (!snapshot || !snapshot.readable) return snapshot || null;
        const sanitizedSnapshot = freezeSnapshot({ ...snapshot, sourceUrl: committedUrl });
        if (allowCache) setCachedSnapshot(cacheKey, sanitizedSnapshot);
        return sanitizedSnapshot;
      } catch (_error) {
        return null;
      } finally {
        operation.cleanup();
        const current = inFlight.get(webContentsKey);
        if (current && current.operation === operation) inFlight.delete(webContentsKey);
      }
    })();

    inFlight.set(webContentsKey, { committedUrl, contextKey, operation, promise });
    return promise;
  }

  return {
    cancel,
    clearContext,
    get cacheSize() {
      return snapshotCache.size;
    },
    resolve
  };
}

module.exports = {
  createReaderExtractionService,
  normalizeCommittedUrl
};
