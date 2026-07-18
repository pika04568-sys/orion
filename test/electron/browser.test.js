const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");
const { stageElectronExecutable } = require("../../scripts/electron-executable");

const projectRoot = path.resolve(__dirname, "..", "..");
const electronPath = stageElectronExecutable(projectRoot);
const profiles = [];
let fixtureServer;
let fixtureOrigin;

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function waitForExit(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode != null) return true;
  return Promise.race([
    new Promise((resolve) => processHandle.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

function createProfile(tabs = null) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orion-electron-test-"));
  profiles.push(profile);
  fs.writeFileSync(path.join(profile, "browser_settings.json"), JSON.stringify({
    locale: "en",
    onboardingCompleted: true,
    httpsOnlyMode: false,
    antiFingerprinting: true,
    dnsOverHttpsEnabled: false,
    ramLimitMode: "off"
  }));
  if (tabs) {
    fs.writeFileSync(path.join(profile, "browser_session_recovery.json"), JSON.stringify({
      version: 1,
      profiles: [{
        id: 0,
        name: "Default",
        tabs,
        groups: [],
        activeTabId: tabs[0].id
      }]
    }));
  }
  return profile;
}

async function launchOrion(profile, extraEnv = {}) {
  const errors = [];
  const processLogs = [];
  const app = await electron.launch({
    executablePath: electronPath,
    args: ["--disable-gpu", projectRoot],
    cwd: projectRoot,
    timeout: 15000,
    env: {
      ...process.env,
      ORION_DISABLE_BACKGROUND_NETWORK: "1",
      ORION_LOG_IPC: "1",
      ORION_USER_DATA_DIR: profile,
      ...extraEnv
    }
  });
  try {
    if (app.process().stdout) app.process().stdout.on("data", (chunk) => processLogs.push(String(chunk)));
    if (app.process().stderr) app.process().stderr.on("data", (chunk) => processLogs.push(String(chunk)));
    const attachPage = (page) => {
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.stack || error.message));
    };
    app.context().pages().forEach(attachPage);
    app.context().on("page", attachPage);
    const shell = await app.firstWindow({ timeout: 20000 });
    await shell.waitForFunction(
      () => document.documentElement.dataset.orionReady === "true",
      null,
      { timeout: 30000 }
    );
    return { app, errors, processLogs, shell };
  } catch (error) {
    await quitOrion(app);
    throw error;
  }
}

async function findPage(app, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.context().pages().filter(predicate).at(-1);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Electron WebContents page. Open pages: ${app.context().pages().map((page) => page.url()).join(", ")}`);
}

async function quitOrion(app) {
  if (!app) return;
  const processHandle = app.process();
  await withTimeout(
    app.evaluate(({ app: electronApp }) => {
      setImmediate(() => electronApp.quit());
      return true;
    }).catch(() => {}),
    500
  ).catch(() => {});
  if (!await waitForExit(processHandle, 3000)) {
    try { processHandle.kill("SIGTERM"); } catch (_error) {}
  }
  if (!await waitForExit(processHandle, 1000)) {
    try { processHandle.kill("SIGKILL"); } catch (_error) {}
    await waitForExit(processHandle, 1000);
  }
  await withTimeout(app.close().catch(() => {}), 1000).catch(() => {});
}

test.before(async () => {
  fixtureServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Orion Fixture</title><main id='fixture-ready'>Fast local fixture</main>");
  });
  await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
  fixtureOrigin = `http://127.0.0.1:${fixtureServer.address().port}`;
});

test.after(async () => {
  if (fixtureServer) {
    if (typeof fixtureServer.closeAllConnections === "function") fixtureServer.closeAllConnections();
    await withTimeout(new Promise((resolve) => fixtureServer.close(resolve)), 2000).catch(() => {});
  }
  profiles.forEach((profile) => fs.rmSync(profile, { recursive: true, force: true }));
});

test("shell paints, core controls work, and hidden panels initialize on demand", async () => {
  const runtime = await launchOrion(createProfile());
  const { app, errors, processLogs, shell } = runtime;
  try {
    await assert.doesNotReject(() => shell.locator("#chrome-container").waitFor({ state: "visible" }));
    const diagnostics = await shell.evaluate(() => ({
      bootstrapSnapshot: window.__orionBootstrapSnapshot,
      bootstrapError: window.__orionBootstrapError || null
    }));
    assert.equal(await shell.locator(".tab").count(), 1, JSON.stringify({ ...diagnostics, errors, processLogs }));
    assert.equal(await shell.getAttribute("html", "data-extensions-ready"), "true");

    await shell.click("#new-tab-btn");
    await shell.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
    const newtab = await findPage(app, (page) => page.url().includes("orion://app/newtab.html"));
    await newtab.waitForFunction(() => document.documentElement.dataset.orionNewtabReady === "true");
    await newtab.screenshot({ path: path.join(os.tmpdir(), "orion-electron-newtab.png") });

    await shell.fill("#address-bar", `${fixtureOrigin}/navigation`);
    await shell.press("#address-bar", "Enter");
    const fixturePage = await findPage(app, (page) => page.url().startsWith(fixtureOrigin));
    await fixturePage.locator("#fixture-ready").waitFor();

    assert.equal(await shell.locator("#profile-color-picker").count(), 0);
    assert.equal(await shell.getAttribute("#settings-sidebar", "data-mounted"), null);
    await shell.click("#settings-btn");
    await shell.locator("#settings-sidebar.open").waitFor();
    assert.equal(await shell.getAttribute("#settings-sidebar", "data-mounted"), "true");
    assert.ok(await shell.locator("#profile-color-picker .color-option").count() > 0);
    assert.deepEqual(
      await shell.evaluate(() => Object.keys(window.OrionLocalization.TRANSLATIONS).sort()),
      ["en"]
    );
    await shell.locator('#settings-language-picker button', { hasText: "Français" }).click();
    await shell.waitForFunction(() => (
      document.documentElement.lang === "fr"
      && document.querySelector('#settings-sidebar [data-i18n="settings.title"]')?.textContent === "Réglages"
    ));
    assert.deepEqual(
      await shell.evaluate(() => Object.keys(window.OrionLocalization.TRANSLATIONS).sort()),
      ["en", "fr"]
    );
    await shell.click("#close-settings");
    await shell.click("#settings-btn");
    assert.equal(await shell.locator("#profile-color-picker").count(), 1);
    assert.equal(
      await shell.locator('#settings-sidebar [data-i18n="settings.title"]').textContent(),
      "Réglages"
    );
    await shell.click("#close-settings");

    assert.equal(await shell.locator("#managed-extension-overlay").evaluate((node) => node.classList.contains("show")), false);
    assert.equal(
      await shell.evaluate(() => window.__orionBootstrapSnapshot.managedExtensionStatus.state),
      "ready"
    );

    await shell.click("#downloads-btn");
    assert.equal(await shell.getAttribute("#downloads-sidebar", "data-initialized"), "true");
    await shell.screenshot({ path: path.join(os.tmpdir(), "orion-electron-shell.png") });
    assert.deepEqual(errors, []);
  } finally {
    await quitOrion(app);
  }
});

test("restored tabs stay unmaterialized until selected and can close before selection", async () => {
  const tabs = [
    { id: "tab-1", url: "chrome://newtab", title: "New Tab", readerMode: false },
    { id: "tab-2", url: `${fixtureOrigin}/restored`, title: "Restored", readerMode: false },
    { id: "tab-3", url: `${fixtureOrigin}/never-opened`, title: "Never opened", readerMode: false }
  ];
  const runtime = await launchOrion(createProfile(tabs));
  const { app, errors, processLogs, shell } = runtime;
  try {
    const diagnostics = await shell.evaluate(() => ({
      bootstrapSnapshot: window.__orionBootstrapSnapshot,
      bootstrapError: window.__orionBootstrapError || null
    }));
    assert.equal(await shell.locator(".tab").count(), 3, JSON.stringify({ ...diagnostics, errors, processLogs }));
    const before = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
    assert.ok(before <= 3, `expected shell plus one active view, got ${before} WebContents`);

    await shell.click('.tab[data-id="tab-3"] .tab-close');
    await shell.waitForFunction(() => !document.querySelector('.tab[data-id="tab-3"]'));
    assert.equal(await shell.locator(".tab").count(), 2);

    await shell.click('.tab[data-id="tab-2"]');
    const restoredPage = await findPage(app, (page) => page.url().includes("/restored"));
    await restoredPage.locator("#fixture-ready").waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await quitOrion(app);
  }
});

test("managed extension failure blocks web navigation until Retry succeeds", async () => {
  const runtime = await launchOrion(createProfile(), {
    ORION_TEST_MANAGED_EXTENSION_MODE: "fail-until-retry"
  });
  const { app, errors, shell } = runtime;
  try {
    await shell.locator("#managed-extension-overlay.show").waitFor();
    await shell.waitForFunction(() => (
      document.querySelector("#managed-extension-overlay")?.dataset.state === "error"
      && !document.querySelector("#managed-extension-retry")?.hidden
    ));

    await shell.fill("#address-bar", `${fixtureOrigin}/blocked-until-ready`);
    await shell.press("#address-bar", "Enter");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(app.context().pages().some((page) => page.url().includes("/blocked-until-ready")), false);

    await shell.evaluate(() => document.querySelector("#managed-extension-retry").click());
    await shell.waitForFunction(() => !document.querySelector("#managed-extension-overlay")?.classList.contains("show"));
    const resumedPage = await findPage(app, (page) => page.url().includes("/blocked-until-ready"));
    await resumedPage.locator("#fixture-ready").waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await quitOrion(app);
  }
});
