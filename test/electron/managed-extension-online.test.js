const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const UBLOCK_ORIGIN_LITE_ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";
const onlineEnabled = process.env.ORION_TEST_WEBSTORE === "1";
const projectRoot = path.resolve(__dirname, "..", "..");

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function closeApp(app) {
  if (!app) return;
  const processHandle = app.process();
  await app.evaluate(({ app: electronApp }) => {
    setImmediate(() => electronApp.quit());
    return true;
  }).catch(() => {});
  await withTimeout(new Promise((resolve) => processHandle.once("exit", resolve)), 3000).catch(() => {
    try { processHandle.kill("SIGTERM"); } catch (_error) {}
  });
  await withTimeout(app.close().catch(() => {}), 1000).catch(() => {});
}

async function findExtensionsPage(app, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.context().pages().find((candidate) => candidate.url().includes("orion://app/extensions.html"));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the extensions page.");
}

async function launchWithManagedExtension(profile, fixturePort) {
  const { _electron: electron } = require("playwright-core");
  const { stageElectronExecutable } = require("../../scripts/electron-executable");
  const electronPath = stageElectronExecutable(projectRoot);
  const app = await electron.launch({
    executablePath: electronPath,
    args: [
      "--disable-gpu",
      `--host-resolver-rules=MAP doubleclick.net 127.0.0.1`,
      projectRoot
    ],
    cwd: projectRoot,
    timeout: 30000,
    env: {
      ...process.env,
      ORION_USER_DATA_DIR: profile,
      ORION_TEST_FIXTURE_PORT: String(fixturePort)
    }
  });
  const shell = await app.firstWindow({ timeout: 60000 });
  await shell.waitForFunction(
    () => document.documentElement.dataset.orionReady === "true",
    null,
    { timeout: 60000 }
  );
  await shell.waitForFunction(
    () => document.documentElement.dataset.extensionsReady === "true",
    null,
    { timeout: 120000 }
  );
  await shell.evaluate(() => window.electron.invoke("navigate-to", "chrome://extensions"));
  const extensionsPage = await findExtensionsPage(app);
  await extensionsPage.waitForFunction(() => !!window.orionPage);
  await extensionsPage.waitForFunction(
    async (extensionId) => {
      const extensions = await window.orionPage.getExtensions();
      return Array.isArray(extensions) && extensions.some((extension) => (
        extension.id === extensionId
        && extension.managed === true
        && extension.removable === false
      ));
    },
    UBLOCK_ORIGIN_LITE_ID,
    { timeout: 120000 }
  );
  const managedExtension = await extensionsPage.evaluate(async (extensionId) => {
    const extensions = await window.orionPage.getExtensions();
    return extensions.find((extension) => extension.id === extensionId);
  }, UBLOCK_ORIGIN_LITE_ID);
  return { app, managedExtension, shell };
}

test("online uBlock Origin Lite install survives restart and blocks a known ad host", {
  skip: onlineEnabled ? false : "Set ORION_TEST_WEBSTORE=1 to exercise the live Chrome Web Store.",
  timeout: 180000
}, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orion-ubol-online-"));
  fs.writeFileSync(path.join(profile, "browser_settings.json"), JSON.stringify({
    locale: "en",
    onboardingCompleted: true,
    httpsOnlyMode: false,
    antiFingerprinting: false,
    dnsOverHttpsEnabled: false,
    ramLimitMode: "off"
  }));

  let blockedHostRequests = 0;
  const fixture = http.createServer((request, response) => {
    if (String(request.headers.host || "").startsWith("doubleclick.net")) {
      blockedHostRequests += 1;
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end("globalThis.__adFixtureReached = true;");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><script src="http://doubleclick.net:${fixture.address().port}/blocked.js"></script><h1>fixture</h1>`);
  });
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));

  let first;
  let restarted;
  try {
    first = await launchWithManagedExtension(profile, fixture.address().port);
    const firstVersion = first.managedExtension.version;
    assert.ok(firstVersion);
    await closeApp(first.app);
    first = null;

    restarted = await launchWithManagedExtension(profile, fixture.address().port);
    const restartedVersion = restarted.managedExtension.version;
    assert.equal(restartedVersion, firstVersion);

    await restarted.shell.evaluate((url) => window.electron.invoke("navigate-to", url), `http://127.0.0.1:${fixture.address().port}/`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(blockedHostRequests, 0);
  } finally {
    await closeApp(first && first.app);
    await closeApp(restarted && restarted.app);
    if (typeof fixture.closeAllConnections === "function") fixture.closeAllConnections();
    await withTimeout(new Promise((resolve) => fixture.close(resolve)), 2000).catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
