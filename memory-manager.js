const RAM_LIMIT_MODE_OFF = "off";
const RAM_LIMIT_MODE_AUTOMATIC = "automatic";
const RAM_LIMIT_MODES = Object.freeze([RAM_LIMIT_MODE_OFF, RAM_LIMIT_MODE_AUTOMATIC]);
const MEBIBYTE_BYTES = 1024 * 1024;
const GIBIBYTE_BYTES = 1024 * MEBIBYTE_BYTES;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_RECLAIM_DELAY_MS = 1000;

function isValidRamLimitMb(value) {
  return Number.isInteger(value) && (
    value === 0 || (value >= 1024 && value % 1024 === 0)
  );
}

function sanitizeRamLimitMb(value) {
  return isValidRamLimitMb(value) ? value : 0;
}

function calculateAutomaticRamLimitMb(totalMemoryBytes) {
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) return 0;
  const halfMemoryGiB = Math.floor(totalMemoryBytes / (2 * GIBIBYTE_BYTES));
  return halfMemoryGiB >= 1 ? halfMemoryGiB * 1024 : 0;
}

function isValidRamLimitMode(value) {
  return typeof value === "string" && RAM_LIMIT_MODES.includes(value);
}

function sanitizeRamLimitMode(value) {
  return isValidRamLimitMode(value) ? value : RAM_LIMIT_MODE_OFF;
}

function resolveRamLimitMode(value, legacyRamLimitMb = 0) {
  if (isValidRamLimitMode(value)) return value;
  return Number.isFinite(legacyRamLimitMb) && legacyRamLimitMb > 0
    ? RAM_LIMIT_MODE_AUTOMATIC
    : RAM_LIMIT_MODE_OFF;
}

function resolveRamLimitMb(mode, automaticRamLimitMb) {
  if (sanitizeRamLimitMode(mode) !== RAM_LIMIT_MODE_AUTOMATIC) return 0;
  return sanitizeRamLimitMb(automaticRamLimitMb);
}

function sumWorkingSetKb(metrics) {
  if (!Array.isArray(metrics)) throw new TypeError("App metrics must be an array.");
  return metrics.reduce((total, metric) => {
    const value = metric && metric.memory && metric.memory.workingSetSize;
    return Number.isFinite(value) && value >= 0 ? total + value : total;
  }, 0);
}

function workingSetKbToMb(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round((value / 1024) * 10) / 10;
}

function attributeTabWorkingSets(metrics, processOwners = []) {
  if (!Array.isArray(metrics)) throw new TypeError("App metrics must be an array.");
  const workingSetByPid = new Map();
  metrics.forEach((metric) => {
    const pid = metric && metric.pid;
    const workingSetSize = metric && metric.memory && metric.memory.workingSetSize;
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(workingSetSize) || workingSetSize < 0) return;
    workingSetByPid.set(pid, (workingSetByPid.get(pid) || 0) + workingSetSize);
  });

  const tabIdsByPid = new Map();
  if (Array.isArray(processOwners)) {
    processOwners.forEach((owner) => {
      const tabId = owner && owner.tabId;
      const pid = owner && owner.pid;
      if (typeof tabId !== "string" || !tabId || !Number.isInteger(pid) || pid <= 0) return;
      if (!tabIdsByPid.has(pid)) tabIdsByPid.set(pid, new Set());
      tabIdsByPid.get(pid).add(tabId);
    });
  }

  const workingSetByTabId = new Map();
  tabIdsByPid.forEach((tabIds, pid) => {
    const workingSetSize = workingSetByPid.get(pid);
    if (!Number.isFinite(workingSetSize) || !tabIds.size) return;
    const share = workingSetSize / tabIds.size;
    tabIds.forEach((tabId) => {
      workingSetByTabId.set(tabId, (workingSetByTabId.get(tabId) || 0) + share);
    });
  });
  return workingSetByTabId;
}

function createTabMemoryHistory() {
  const peakWorkingSetByTabId = new Map();

  function observe(metrics, processOwners) {
    const samples = attributeTabWorkingSets(metrics, processOwners);
    samples.forEach((workingSetSize, tabId) => {
      const previousPeak = peakWorkingSetByTabId.get(tabId) || 0;
      if (workingSetSize > previousPeak) peakWorkingSetByTabId.set(tabId, workingSetSize);
    });
    return samples;
  }

  return {
    clear: () => peakWorkingSetByTabId.clear(),
    getPeakWorkingSetKb: (tabId) => peakWorkingSetByTabId.get(tabId) || 0,
    observe,
    remove: (tabId) => peakWorkingSetByTabId.delete(tabId),
    reset: (tabId) => peakWorkingSetByTabId.delete(tabId)
  };
}

function selectUnloadCandidate(candidates = []) {
  if (!Array.isArray(candidates)) return null;
  const eligible = candidates.filter((candidate) => (
    candidate &&
    typeof candidate.id === "string" &&
    candidate.id &&
    !candidate.active &&
    !candidate.audible &&
    !candidate.unloaded
  ));

  eligible.sort((left, right) => {
    const leftPeak = Number.isFinite(left.peakWorkingSetKb) && left.peakWorkingSetKb >= 0
      ? left.peakWorkingSetKb
      : 0;
    const rightPeak = Number.isFinite(right.peakWorkingSetKb) && right.peakWorkingSetKb >= 0
      ? right.peakWorkingSetKb
      : 0;
    if (leftPeak !== rightPeak) return rightPeak - leftPeak;
    const leftSequence = Number.isFinite(left.lastActiveSequence) ? left.lastActiveSequence : 0;
    const rightSequence = Number.isFinite(right.lastActiveSequence) ? right.lastActiveSequence : 0;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    return left.id.localeCompare(right.id);
  });

  return eligible[0] || null;
}

async function unloadTabPage(options = {}) {
  const view = options.view;
  const tab = options.tab;
  const webContents = view && view.webContents;
  if (
    !view || !tab || !webContents ||
    (typeof webContents.isDestroyed === "function" && webContents.isDestroyed()) ||
    view.memoryDiscarded || view.memoryDiscarding
  ) {
    return false;
  }

  const savedUrl = options.savedUrl || tab.url || view.tUrl || "chrome://newtab";
  const savedTitle = options.savedTitle || tab.title || savedUrl;
  const readerMode = !!options.readerMode;
  if (typeof options.syncTabRecord === "function") {
    options.syncTabRecord({
      url: savedUrl,
      title: savedTitle,
      readerMode
    });
  }
  view.tUrl = savedUrl;
  view.pendingReaderRestore = false;
  if (typeof options.destroyReaderView === "function") options.destroyReaderView();

  view.memoryDiscarding = true;
  view.memoryDiscarded = false;
  view.memoryRestoring = false;
  try {
    await webContents.loadURL("about:blank");
  } catch (_error) {
    if (view.memoryDiscarding) {
      view.memoryDiscarding = false;
      view.memoryDiscarded = false;
    }
    return false;
  }

  if (!view.memoryDiscarding) return false;
  view.memoryDiscarding = false;
  view.memoryDiscarded = true;
  if (typeof options.onDiscarded === "function") options.onDiscarded();
  return true;
}

function restoreUnloadedTabPage(options = {}) {
  const view = options.view;
  const tab = options.tab;
  if (!view || !tab || (!view.memoryDiscarded && !view.memoryDiscarding)) return false;

  view.memoryDiscarding = false;
  view.memoryDiscarded = false;
  view.memoryRestoring = true;
  view.pendingReaderRestore = !!tab.readerMode;
  const targetUrl = tab.url || view.tUrl || "chrome://newtab";
  view.tUrl = targetUrl;
  if (typeof options.loadUrl === "function") {
    void Promise.resolve(options.loadUrl(targetUrl)).catch(() => false);
  }
  return true;
}

function createMemoryController(options = {}) {
  const getMetrics = options.getMetrics;
  const getLimitMb = options.getLimitMb;
  const getCandidates = options.getCandidates;
  const unloadTab = options.unloadTab;
  const getUnloadedTabCount = options.getUnloadedTabCount;
  const observeMetrics = options.observeMetrics;
  const onStatus = options.onStatus;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
    ? Math.max(100, options.pollIntervalMs)
    : DEFAULT_POLL_INTERVAL_MS;
  const reclaimDelayMs = Number.isFinite(options.reclaimDelayMs)
    ? Math.max(0, options.reclaimDelayMs)
    : DEFAULT_RECLAIM_DELAY_MS;

  let running = false;
  let evaluating = false;
  let pendingEvaluation = false;
  let intervalTimer = null;
  let reclaimTimer = null;
  let status = {
    supported: true,
    enabled: false,
    usedMb: 0,
    limitMb: 0,
    overLimit: false,
    unloadedTabCount: 0
  };

  function readUnloadedTabCount() {
    try {
      const value = typeof getUnloadedTabCount === "function" ? getUnloadedTabCount() : 0;
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    } catch (_error) {
      return 0;
    }
  }

  function publishStatus(next) {
    status = Object.freeze({ ...next });
    if (typeof onStatus === "function") {
      try {
        onStatus(status);
      } catch (_error) {}
    }
    return status;
  }

  function scheduleReclaim() {
    if (!running || reclaimTimer) return;
    reclaimTimer = setTimeoutFn(() => {
      reclaimTimer = null;
      void evaluate();
    }, reclaimDelayMs);
  }

  async function evaluate() {
    if (evaluating) {
      pendingEvaluation = true;
      return status;
    }
    evaluating = true;
    pendingEvaluation = false;

    const limitMb = sanitizeRamLimitMb(typeof getLimitMb === "function" ? getLimitMb() : 0);
    const enabled = limitMb > 0;
    let supported = true;
    let usedMb = null;
    let metrics = null;

    try {
      if (typeof getMetrics !== "function") throw new TypeError("Memory metrics are unavailable.");
      metrics = getMetrics();
      usedMb = workingSetKbToMb(sumWorkingSetKb(metrics));
    } catch (_error) {
      supported = false;
    }

    if (supported && typeof observeMetrics === "function") {
      try {
        observeMetrics(metrics);
      } catch (_error) {}
    }

    const overLimit = supported && enabled && usedMb > limitMb;
    publishStatus({
      supported,
      enabled,
      usedMb,
      limitMb,
      overLimit,
      unloadedTabCount: readUnloadedTabCount()
    });

    let unloaded = false;
    if (overLimit && typeof getCandidates === "function" && typeof unloadTab === "function") {
      let candidate = null;
      try {
        candidate = selectUnloadCandidate(getCandidates());
      } catch (_error) {}

      if (candidate) {
        try {
          unloaded = (await unloadTab(candidate)) !== false;
        } catch (_error) {
          unloaded = false;
        }
        publishStatus({
          ...status,
          unloadedTabCount: readUnloadedTabCount()
        });
      }
    }

    evaluating = false;
    if (pendingEvaluation) {
      pendingEvaluation = false;
      void evaluate();
    } else if (unloaded && overLimit) {
      scheduleReclaim();
    }
    return status;
  }

  function requestEvaluation() {
    if (reclaimTimer) {
      clearTimeoutFn(reclaimTimer);
      reclaimTimer = null;
    }
    void evaluate();
  }

  function start() {
    if (running) return;
    running = true;
    intervalTimer = setIntervalFn(() => {
      void evaluate();
    }, pollIntervalMs);
    requestEvaluation();
  }

  function stop() {
    running = false;
    if (intervalTimer) {
      clearIntervalFn(intervalTimer);
      intervalTimer = null;
    }
    if (reclaimTimer) {
      clearTimeoutFn(reclaimTimer);
      reclaimTimer = null;
    }
  }

  return {
    evaluate,
    getStatus: () => status,
    requestEvaluation,
    start,
    stop
  };
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RECLAIM_DELAY_MS,
  RAM_LIMIT_MODE_AUTOMATIC,
  RAM_LIMIT_MODE_OFF,
  RAM_LIMIT_MODES,
  attributeTabWorkingSets,
  calculateAutomaticRamLimitMb,
  createMemoryController,
  createTabMemoryHistory,
  isValidRamLimitMode,
  isValidRamLimitMb,
  resolveRamLimitMb,
  resolveRamLimitMode,
  sanitizeRamLimitMode,
  sanitizeRamLimitMb,
  selectUnloadCandidate,
  sumWorkingSetKb,
  restoreUnloadedTabPage,
  unloadTabPage,
  workingSetKbToMb
};
