const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { _electron: electron } = require("playwright-core");
const { resolveElectronExecutable } = require("./electron-executable");

const projectRoot = path.resolve(__dirname, "..");
let runtimeRoot = projectRoot;
let electronPath = resolveElectronExecutable(projectRoot);
const tempRoots = [];
let fixtureRequestAt = 0;
const trace = (value) => {
  if (process.env.ORION_PERF_TRACE === "1") process.stderr.write(`[orion-perf] ${value}\n`);
};

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

function stageLocalRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orion-perf-runtime-"));
  tempRoots.push(root);
  runtimeRoot = path.join(root, "app");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.cpSync(path.join(projectRoot, ".build"), path.join(runtimeRoot, ".build"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({
    name: "orion-perf-runtime",
    version: "1.1.0",
    main: ".build/main.cjs"
  }));

  const stagedDist = path.join(root, "electron-dist");
  fs.cpSync(path.join(projectRoot, "node_modules", "electron", "dist"), stagedDist, {
    recursive: true,
    verbatimSymlinks: true
  });
  electronPath = process.platform === "darwin"
    ? path.join(stagedDist, "Electron.app", "Contents", "MacOS", "Electron")
    : process.platform === "win32"
      ? path.join(stagedDist, "electron.exe")
      : path.join(stagedDist, "electron");
}

async function waitForNewPage(app, previousPages, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.context().pages().find((candidate) => !previousPages.has(candidate) && predicate(candidate));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for a newly materialized tab");
}

async function waitForMeasuredNewTab(app, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = app.context().pages().filter((page) => page.url().includes("orion://app/newtab.html"));
    for (const page of candidates.reverse()) {
      try {
        const measured = await page.evaluate(() => Number(window.__orionNewtabInteractiveMs));
        if (Number.isFinite(measured) && measured > 0) return { page, measured };
      } catch (_error) {}
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the warm new-tab milestone");
}

async function closeElectron(app) {
  const processHandle = app.process();
  await Promise.race([
    app.evaluate(({ app: electronApp }) => {
      setImmediate(() => electronApp.quit());
      return true;
    }).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 500))
  ]);
  if (processHandle.exitCode == null) {
    await Promise.race([
      new Promise((resolve) => processHandle.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  }
  if (processHandle.exitCode == null) {
    processHandle.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => processHandle.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  }
}

async function measureLaunch(profile, fixtureOrigin, options = {}) {
  trace(`launch ${path.basename(profile)}`);
  const startedAt = performance.now();
  const app = await electron.launch({
    executablePath: electronPath,
    args: [runtimeRoot],
    cwd: runtimeRoot,
    env: {
      ...process.env,
      ORION_DISABLE_BACKGROUND_NETWORK: "1",
      ORION_USER_DATA_DIR: profile
    }
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForFunction(() => document.documentElement.dataset.orionReady === "true");
    trace(`interactive ${path.basename(profile)}`);
    const harnessInteractiveMs = performance.now() - startedAt;
    const startup = await shell.evaluate(() => window.__orionStartupPerformance || {});
    const interactiveMs = Number.isFinite(Number(startup.shellInteractiveMs))
      ? Number(startup.shellInteractiveMs)
      : harnessInteractiveMs;
    const materializedWebContents = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
    const result = {
      interactiveMs,
      harnessInteractiveMs,
      mainEventLoopDelayMs: Number(startup.maxMainEventLoopDelayMs || 0),
      materializedWebContents,
      startupMilestones: startup
    };

    if (options.measureActions) {
      const warmDeadline = Date.now() + 5000;
      while (Date.now() < warmDeadline) {
        const readyNewTabs = await Promise.all(app.context().pages()
          .filter((page) => page.url().includes("orion://app/newtab.html"))
          .map((page) => page.evaluate(() => document.documentElement.dataset.orionNewtabReady === "true").catch(() => false)));
        if (readyNewTabs.filter(Boolean).length >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const newTabStartedAt = performance.now();
      await shell.click("#new-tab-btn");
      const { page: newtab, measured: newTabMilestoneMs } = await waitForMeasuredNewTab(app);
      trace("new-tab interactive");
      result.newTabInteractiveMs = newTabMilestoneMs || (performance.now() - newTabStartedAt);

      fixtureRequestAt = 0;
      await shell.fill("#address-bar", `${fixtureOrigin}/perf-navigation`);
      await shell.press("#address-bar", "Enter");
      result.navigationDispatchMs = await shell.evaluate(() => window.__orionLastNavigationDispatchPromise);
      const deadline = Date.now() + 5000;
      while (!fixtureRequestAt && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      result.navigationReachedFixture = !!fixtureRequestAt;
      trace("navigation dispatched");
    }
    return result;
  } finally {
    trace(`close ${path.basename(profile)}`);
    await closeElectron(app);
    trace(`closed ${path.basename(profile)}`);
  }
}

function assertBudget(label, value, budget) {
  if (!Number.isFinite(value) || value > budget) {
    throw new Error(`${label} ${value.toFixed ? value.toFixed(1) : value}ms exceeded ${budget}ms`);
  }
}

async function main() {
  stageLocalRuntime();
  const server = http.createServer((_request, response) => {
    fixtureRequestAt = performance.now();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Perf Fixture</title><main>ready</main>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;

  try {
    const oneTabProfile = createProfile(1);
    const cold = await measureLaunch(oneTabProfile, fixtureOrigin, { measureActions: true });
    await measureLaunch(oneTabProfile, fixtureOrigin);
    const warm = await measureLaunch(oneTabProfile, fixtureOrigin);
    const fiftyTabs = await measureLaunch(createProfile(50), fixtureOrigin);
    const restoreBudgetMs = Math.max(100, cold.interactiveMs * 0.10);
    const results = {
      capturedAt: new Date().toISOString(),
      cold,
      warm,
      fiftyTabs,
      restoreDeltaMs: fiftyTabs.interactiveMs - cold.interactiveMs,
      budgets: {
        coldInteractiveMs: 1200,
        warmInteractiveMs: 700,
        navigationDispatchMs: 50,
        newTabInteractiveMs: 200,
        restoreDeltaMs: restoreBudgetMs,
        mainEventLoopDelayMs: 50
      }
    };

    const outputDirectory = path.join(os.tmpdir(), "orion-perf-results");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, `orion-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ ...results, outputPath }, null, 2));

    assertBudget("Cold shell interactive", cold.interactiveMs, 1200);
    assertBudget("Warm shell interactive", warm.interactiveMs, 700);
    assertBudget("Navigation dispatch", cold.navigationDispatchMs, 50);
    assertBudget("Warm new tab", cold.newTabInteractiveMs, 200);
    assertBudget("50-tab restore delta", results.restoreDeltaMs, restoreBudgetMs);
    assertBudget("Cold main event-loop delay", cold.mainEventLoopDelayMs, 50);
    assertBudget("Warm main event-loop delay", warm.mainEventLoopDelayMs, 50);
    assertBudget("50-tab main event-loop delay", fiftyTabs.mainEventLoopDelayMs, 50);
    if (!cold.navigationReachedFixture) {
      throw new Error("Navigation dispatch did not reach the local fixture");
    }
    if (fiftyTabs.materializedWebContents > 3) {
      throw new Error(`50-tab restore eagerly created ${fiftyTabs.materializedWebContents} WebContents`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    tempRoots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
