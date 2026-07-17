const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { _electron: electron } = require("playwright-core");
const { stageElectronExecutable } = require("./electron-executable");

const projectRoot = path.resolve(__dirname, "..");
const tempRoots = [];
const activeApps = new Set();
const fixtureRequests = new Map();
const sampleCount = Math.max(1, Number.parseInt(process.env.ORION_PERF_SAMPLES || "20", 10) || 20);
let runtimeRoot = projectRoot;
let electronPath = null;

const trace = (value) => {
  if (process.env.ORION_PERF_TRACE === "1") process.stderr.write(`[orion-perf] ${value}\n`);
};

function epochNow() {
  return performance.timeOrigin + performance.now();
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index];
}

function summarize(samples, field) {
  const values = samples.map((sample) => Number(sample[field])).filter(Number.isFinite);
  return {
    samples: values.length,
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function createProfile(tabCount) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orion-perf-profile-"));
  tempRoots.push(profile);
  fs.writeFileSync(path.join(profile, "browser_settings.json"), JSON.stringify({
    locale: "en",
    onboardingCompleted: true,
    httpsOnlyMode: false,
    antiFingerprinting: true,
    dnsOverHttpsEnabled: false,
    ramLimitMode: "off"
  }));
  if (tabCount > 1) {
    const tabs = Array.from({ length: tabCount }, (_, index) => ({
      id: `perf-tab-${index + 1}`,
      url: "chrome://newtab",
      title: `Performance Tab ${index + 1}`,
      readerMode: false
    }));
    fs.writeFileSync(path.join(profile, "browser_session_recovery.json"), JSON.stringify({
      version: 1,
      profiles: [{ id: 0, name: "Default", tabs, groups: [], activeTabId: tabs[0].id }]
    }));
  }
  return profile;
}

function stageLocalAppRuntime() {
  electronPath = stageElectronExecutable(projectRoot);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orion-perf-app-"));
  tempRoots.push(root);
  runtimeRoot = path.join(root, "app");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.cpSync(path.join(projectRoot, ".build"), path.join(runtimeRoot, ".build"), {
    recursive: true,
    preserveTimestamps: true
  });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({
    name: "orion-perf-runtime",
    version: "1.1.0",
    main: ".build/main.cjs"
  }));
}

async function waitForExit(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode != null) return true;
  return Promise.race([
    new Promise((resolve) => processHandle.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

async function closeElectron(app) {
  if (!app) return;
  activeApps.delete(app);
  const processHandle = app.process();
  await withTimeout(app.evaluate(({ app: electronApp }) => {
    setImmediate(() => electronApp.quit());
    return true;
  }).catch(() => {}), 750, "Electron quit request").catch(() => {});

  if (!await waitForExit(processHandle, 3000)) {
    try { processHandle.kill("SIGTERM"); } catch (_error) {}
  }
  if (!await waitForExit(processHandle, 1500)) {
    try { processHandle.kill("SIGKILL"); } catch (_error) {}
    await waitForExit(processHandle, 1000);
  }
  await withTimeout(app.close().catch(() => {}), 1000, "Playwright Electron cleanup").catch(() => {});
}

function getTabIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get("tabId");
  } catch (_error) {
    return null;
  }
}

async function waitForTabPage(app, tabId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.context().pages().find((candidate) => getTabIdFromUrl(candidate.url()) === tabId);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for WebContents for tab ${tabId}`);
}

async function getMainTabPerformance(app, tabId) {
  return app.evaluate(({ webContents }, requestedTabId) => {
    const target = webContents.getAllWebContents().find((candidate) => candidate.__orionTabId === requestedTabId);
    return target && target.__orionPerformance ? { ...target.__orionPerformance } : null;
  }, tabId);
}

async function readShellPerformance(shell, startup) {
  const renderer = await shell.evaluate(() => {
    const interactive = performance.getEntriesByName("orion-shell-interactive").at(-1);
    const paints = performance.getEntriesByType("paint");
    const firstPaint = paints.find((entry) => entry.name === "first-contentful-paint") || paints[0] || null;
    return {
      interactiveEpochMs: interactive ? performance.timeOrigin + interactive.startTime : null,
      firstPaintEpochMs: firstPaint ? performance.timeOrigin + firstPaint.startTime : null
    };
  });
  const processOrigin = Number(startup.mainTimeOriginMs);
  return {
    shellInteractiveMs: Number.isFinite(renderer.interactiveEpochMs) && Number.isFinite(processOrigin)
      ? renderer.interactiveEpochMs - processOrigin
      : null,
    shellPaintMs: Number.isFinite(renderer.firstPaintEpochMs) && Number.isFinite(processOrigin)
      ? renderer.firstPaintEpochMs - processOrigin
      : null
  };
}

async function measureActions(app, shell, fixtureOrigin, sampleIndex) {
  const previousTabId = await shell.locator(".tab.active").getAttribute("data-id");
  await shell.click("#new-tab-btn");
  await shell.waitForFunction((oldId) => {
    const active = document.querySelector(".tab.active");
    return active && active.dataset.id && active.dataset.id !== oldId;
  }, previousTabId);
  const tabId = await shell.locator(".tab.active").getAttribute("data-id");
  const tabPage = await waitForTabPage(app, tabId);
  await tabPage.waitForFunction(() => document.documentElement.dataset.orionNewtabReady === "true");
  const newTabInteractiveMs = await tabPage.evaluate(() => {
    const mark = performance.getEntriesByName("orion-newtab-interactive").at(-1);
    const startedAt = Number(new URL(location.href).searchParams.get("startedAt"));
    return mark && Number.isFinite(startedAt)
      ? performance.timeOrigin + mark.startTime - startedAt
      : null;
  });

  const firstPanelOpenMs = await withTimeout(shell.evaluate(async () => {
    const panel = document.querySelector("#settings-sidebar");
    const button = document.querySelector("#settings-btn");
    const startedAt = performance.now();
    button.click();
    while (
      !panel.classList.contains("open")
      || panel.dataset.initialized !== "true"
      || panel.dataset.orionPanelReady !== "true"
      || panel.getBoundingClientRect().width <= 0
      || getComputedStyle(panel).visibility === "hidden"
      || getComputedStyle(panel).display === "none"
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - startedAt;
  }), 5000, "settings panel readiness");
  await shell.click("#close-settings");

  const token = `${sampleIndex}-${Date.now()}`;
  const fixturePath = `/perf-navigation?token=${encodeURIComponent(token)}`;
  fixtureRequests.delete(token);
  await shell.fill("#address-bar", `${fixtureOrigin}${fixturePath}`);
  await shell.press("#address-bar", "Enter");
  const requestDeadline = Date.now() + 5000;
  while (!fixtureRequests.has(token) && Date.now() < requestDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const requestEpochMs = fixtureRequests.get(token);
  if (!Number.isFinite(requestEpochMs)) throw new Error("Navigation did not reach the deterministic fixture");
  await tabPage.waitForLoadState("load");
  await tabPage.waitForFunction(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    return navigation && navigation.loadEventEnd > 0;
  });
  const mainPerformance = await getMainTabPerformance(app, tabId);
  const pagePerformance = await tabPage.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    return {
      fcpEpochMs: paint ? performance.timeOrigin + paint.startTime : null,
      loadEpochMs: navigation && navigation.loadEventEnd > 0
        ? performance.timeOrigin + navigation.loadEventEnd
        : null
    };
  });
  const navigationStartedAt = Number(mainPerformance && mainPerformance.navigationStartedAtEpochMs);
  const navigationDispatchedAt = Number(mainPerformance && mainPerformance.navigationDispatchedAtEpochMs);

  return {
    tabId,
    newTabInteractiveMs,
    firstPanelOpenMs,
    navigationDispatchMs: Number.isFinite(navigationStartedAt) && Number.isFinite(navigationDispatchedAt)
      ? navigationDispatchedAt - navigationStartedAt
      : null,
    navigationReachedFixture: Number.isFinite(requestEpochMs),
    fixtureFcpMs: Number.isFinite(pagePerformance.fcpEpochMs) && Number.isFinite(navigationStartedAt)
      ? pagePerformance.fcpEpochMs - navigationStartedAt
      : null,
    fixtureLoadMs: Number.isFinite(pagePerformance.loadEpochMs) && Number.isFinite(navigationStartedAt)
      ? pagePerformance.loadEpochMs - navigationStartedAt
      : null
  };
}

async function measureLaunch(profile, fixtureOrigin, options = {}) {
  const wallStartedAt = performance.now();
  const launchPromise = electron.launch({
    executablePath: electronPath,
    args: [runtimeRoot],
    cwd: runtimeRoot,
    timeout: 15000,
    env: {
      ...process.env,
      ORION_DISABLE_BACKGROUND_NETWORK: "1",
      ORION_USER_DATA_DIR: profile
    }
  });
  let app;
  try {
    app = await withTimeout(launchPromise, 17000, "Electron launch");
  } catch (error) {
    void launchPromise.then((lateApp) => closeElectron(lateApp)).catch(() => {});
    throw error;
  }
  activeApps.add(app);
  try {
    const shell = await withTimeout(app.firstWindow(), 10000, "first browser window");
    await shell.waitForFunction(() => document.documentElement.dataset.orionReady === "true");
    const harnessInteractiveMs = performance.now() - wallStartedAt;
    const startup = await shell.evaluate(() => window.__orionStartupPerformance || {});
    const shellMetrics = await readShellPerformance(shell, startup);
    const webContents = await app.evaluate(({ BrowserWindow: ElectronBrowserWindow, webContents: electronWebContents }) => {
      const all = electronWebContents.getAllWebContents();
      const shellIds = new Set(ElectronBrowserWindow.getAllWindows().map((window) => window.webContents.id));
      const tabIds = all
        .filter((candidate) => typeof candidate.__orionTabId === "string")
        .map((candidate) => candidate.__orionTabId);
      return {
        total: all.length,
        shellCount: all.filter((candidate) => shellIds.has(candidate.id)).length,
        tabCount: tabIds.length,
        tabIds,
        unownedCount: all.filter((candidate) => (
          !shellIds.has(candidate.id) && typeof candidate.__orionTabId !== "string"
        )).length
      };
    });
    const measuredEventLoopDelay = Number.isFinite(startup.maxMainEventLoopDelayMs)
      ? Number(startup.maxMainEventLoopDelayMs)
      : null;
    const result = {
      ...shellMetrics,
      harnessInteractiveMs,
      mainEventLoopDelayMs: measuredEventLoopDelay,
      materializedWebContents: webContents.total,
      materializedShells: webContents.shellCount,
      materializedTabs: webContents.tabCount,
      materializedTabIds: webContents.tabIds,
      unownedWebContents: webContents.unownedCount
    };
    if (options.measureActions) {
      Object.assign(result, await measureActions(app, shell, fixtureOrigin, options.sampleIndex));
    }
    return result;
  } finally {
    await closeElectron(app);
  }
}

function assertBudget(label, value, budget) {
  if (!Number.isFinite(value) || value > budget) {
    throw new Error(`${label} ${Number.isFinite(value) ? value.toFixed(1) : value}ms exceeded ${budget}ms`);
  }
}

function createSummary(cold, warm, fiftyTabs) {
  const metrics = [
    "shellPaintMs",
    "shellInteractiveMs",
    "mainEventLoopDelayMs",
    "newTabInteractiveMs",
    "firstPanelOpenMs",
    "navigationDispatchMs",
    "fixtureFcpMs",
    "fixtureLoadMs"
  ];
  return {
    cold: Object.fromEntries(metrics.map((metric) => [metric, summarize(cold, metric)])),
    warm: {
      shellInteractiveMs: summarize(warm, "shellInteractiveMs"),
      mainEventLoopDelayMs: summarize(warm, "mainEventLoopDelayMs")
    },
    fiftyTabs: {
      shellInteractiveMs: summarize(fiftyTabs, "shellInteractiveMs"),
      mainEventLoopDelayMs: summarize(fiftyTabs, "mainEventLoopDelayMs")
    }
  };
}

async function main() {
  stageLocalAppRuntime();
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    if (requestUrl.pathname === "/perf-navigation") {
      const token = requestUrl.searchParams.get("token");
      if (token && !fixtureRequests.has(token)) fixtureRequests.set(token, epochNow());
      const scripts = Array.from({ length: 100 }, (_, index) => `<script src="/asset-${index}.js"></script>`).join("");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><title>Perf Fixture</title><main>ready</main>${scripts}`);
      return;
    }
    if (/^\/asset-\d+\.js$/.test(requestUrl.pathname)) {
      response.writeHead(200, { "content-type": "application/javascript", "cache-control": "public, max-age=3600" });
      response.end("void 0;");
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

  const cold = [];
  const warm = [];
  const fiftyTabs = [];
  try {
    for (let index = 0; index < sampleCount; index += 1) {
      trace(`sample ${index + 1}/${sampleCount}`);
      const oneTabProfile = createProfile(1);
      cold.push(await measureLaunch(oneTabProfile, fixtureOrigin, { measureActions: true, sampleIndex: index }));
      warm.push(await measureLaunch(oneTabProfile, fixtureOrigin));
      fiftyTabs.push(await measureLaunch(createProfile(50), fixtureOrigin, { expectedActiveTabId: "perf-tab-1" }));
    }

    const summary = createSummary(cold, warm, fiftyTabs);
    const coldInteractiveP95 = summary.cold.shellInteractiveMs.p95;
    const restoreInteractiveP95 = summary.fiftyTabs.shellInteractiveMs.p95;
    const restoreDeltaPercent = coldInteractiveP95 > 0
      ? ((restoreInteractiveP95 - coldInteractiveP95) / coldInteractiveP95) * 100
      : Infinity;
    const budgets = {
      coldShellPaintMs: 900,
      coldInteractiveMs: 1200,
      warmInteractiveMs: 500,
      newTabInteractiveMs: 200,
      firstPanelOpenMs: 100,
      navigationDispatchMs: 20,
      fixtureFcpMs: 250,
      fixtureLoadMs: 500,
      mainEventLoopDelayMs: 50,
      fiftyTabRestoreDeltaPercent: 10
    };
    const results = {
      capturedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      sampleCount,
      summary,
      restoreDeltaPercent,
      budgets,
      samples: { cold, warm, fiftyTabs }
    };

    const outputDirectory = path.join(os.tmpdir(), "orion-perf-results");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `orion-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ ...results, samples: undefined, outputPath }, null, 2));

    assertBudget("Cold shell paint p95", summary.cold.shellPaintMs.p95, budgets.coldShellPaintMs);
    assertBudget("Cold shell interactive p95", coldInteractiveP95, budgets.coldInteractiveMs);
    assertBudget("Warm shell interactive p95", summary.warm.shellInteractiveMs.p95, budgets.warmInteractiveMs);
    assertBudget("New tab interactive p95", summary.cold.newTabInteractiveMs.p95, budgets.newTabInteractiveMs);
    assertBudget("First panel open p95", summary.cold.firstPanelOpenMs.p95, budgets.firstPanelOpenMs);
    assertBudget("Navigation dispatch p95", summary.cold.navigationDispatchMs.p95, budgets.navigationDispatchMs);
    assertBudget("Fixture FCP p95", summary.cold.fixtureFcpMs.p95, budgets.fixtureFcpMs);
    assertBudget("Fixture load p95", summary.cold.fixtureLoadMs.p95, budgets.fixtureLoadMs);
    assertBudget("Cold maximum main event-loop delay", summary.cold.mainEventLoopDelayMs.max, budgets.mainEventLoopDelayMs);
    assertBudget("Warm maximum main event-loop delay", summary.warm.mainEventLoopDelayMs.max, budgets.mainEventLoopDelayMs);
    assertBudget("50-tab maximum main event-loop delay", summary.fiftyTabs.mainEventLoopDelayMs.max, budgets.mainEventLoopDelayMs);
    assertBudget("50-tab restore delta", Math.max(0, restoreDeltaPercent), budgets.fiftyTabRestoreDeltaPercent);
    const eagerRestore = fiftyTabs.find((sample) => (
      sample.materializedWebContents !== 2
      || sample.materializedShells !== 1
      || sample.materializedTabs !== 1
      || sample.unownedWebContents !== 0
      || sample.materializedTabIds[0] !== "perf-tab-1"
    ));
    if (eagerRestore) {
      throw new Error(`50-tab restore materialization mismatch: ${JSON.stringify({
        total: eagerRestore.materializedWebContents,
        shells: eagerRestore.materializedShells,
        tabs: eagerRestore.materializedTabIds,
        unowned: eagerRestore.unownedWebContents
      })}`);
    }
  } finally {
    await Promise.all(Array.from(activeApps, (app) => closeElectron(app)));
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await withTimeout(new Promise((resolve) => server.close(resolve)), 2000, "fixture shutdown").catch(() => {});
    tempRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  }
);
