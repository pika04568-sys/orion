const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const appUtils = require("../app-utils");

const preloadPath = path.join(__dirname, "..", "preload.js");
const preloadSource = fs.readFileSync(preloadPath, "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");

function runPreload(href, preloadDir = "C:\\Program Files\\Orion\\resources\\app.asar") {
  const requireCalls = [];
  const invokeCalls = [];
  const sendCalls = [];
  const onCalls = [];
  const onceCalls = [];
  const removeCalls = [];
  const exposedApis = {};
  let browserActionInjected = false;

  const ipcRenderer = {
    invoke: (...args) => {
      invokeCalls.push(args);
      return "invoke-result";
    },
    send: (...args) => {
      sendCalls.push(args);
    },
    on: (...args) => {
      onCalls.push(args);
    },
    once: (...args) => {
      onceCalls.push(args);
    },
    removeListener: (...args) => {
      removeCalls.push(args);
    }
  };

  const contextBridge = {
    exposeInMainWorld: (name, api) => {
      exposedApis[name] = api;
    }
  };

  const context = vm.createContext({
    URL,
    process: {
      argv: ["Orion Helper (Renderer)", `--app-path=${preloadDir}`]
    },
    window: { location: { href } },
    require: (moduleName) => {
      requireCalls.push(moduleName);
      if (moduleName === "./app-utils") return appUtils;
      if (moduleName === "electron") return { contextBridge, ipcRenderer };
      if (moduleName === "electron-chrome-extensions/browser-action") {
        return {
          injectBrowserAction: () => {
            browserActionInjected = true;
          }
        };
      }
      throw new Error(`Unexpected require: ${moduleName}`);
    }
  });

  vm.runInContext(preloadSource, context, { filename: "preload.js" });

  return {
    apis: exposedApis,
    requireCalls,
    invokeCalls,
    sendCalls,
    onCalls,
    onceCalls,
    removeCalls,
    browserActionInjected
  };
}

test("preload defers extension action controls until extensions are ready", () => {
  const runtime = runPreload("orion://app/index.html");
  assert.ok(runtime.apis.electron);
  assert.equal(runtime.browserActionInjected, false);
  assert.deepEqual(runtime.requireCalls, ["./app-utils", "electron"]);
  assert.equal(runtime.onceCalls[0][0], "extensions-ready");
  runtime.onceCalls[0][1]();
  assert.deepEqual(runtime.requireCalls, ["./app-utils", "electron", "electron-chrome-extensions/browser-action"]);
});

test("preload authorization is sourced from the shared page-channel contract", () => {
  assert.match(preloadSource, /require\(["']\.\/app-utils["']\)/);
  assert.match(preloadSource, /appUtils\.canUseElectronChannel/);
  assert.doesNotMatch(preloadSource, /const APP_(?:INVOKE|SEND|ON)_CHANNELS/);

  const runtime = runPreload("orion://app/index.html");
  const contract = appUtils.getElectronPageChannels("index.html");
  contract.invoke.forEach((channel) => runtime.apis.electron.invoke(channel));
  contract.send.forEach((channel) => runtime.apis.electron.send(channel));
  const unsubscribers = contract.on.map((channel) => runtime.apis.electron.on(channel, () => {}));
  unsubscribers.forEach((unsubscribe) => unsubscribe());

  assert.deepEqual(runtime.invokeCalls.map(([channel]) => channel), contract.invoke);
  assert.deepEqual(runtime.sendCalls.map(([channel]) => channel), contract.send);
  assert.deepEqual(runtime.onCalls.map(([channel]) => channel), contract.on);
  assert.equal(runtime.apis.electron.invoke("not-authorized"), undefined);
  runtime.apis.electron.send("not-authorized");
  runtime.apis.electron.on("not-authorized", () => {});
  assert.equal(runtime.invokeCalls.length, contract.invoke.length);
  assert.equal(runtime.sendCalls.length, contract.send.length);
  assert.equal(runtime.onCalls.length, contract.on.length);
});

test("every shell IPC channel used by the renderer is declared in the shared contract", () => {
  for (const method of ["invoke", "send", "on"]) {
    const used = new Set(Array.from(
      rendererSource.matchAll(new RegExp(`ipcRenderer\\.${method}\\(\\s*['\"]([^'\"]+)`, "g")),
      (match) => match[1]
    ));
    const allowed = new Set(appUtils.getElectronPageChannels("index.html")[method]);
    assert.deepEqual(
      Array.from(used).filter((channel) => !allowed.has(channel)),
      [],
      `undeclared renderer ${method} channels`
    );
  }
});

test("index page allows one bootstrap and navigation invokes", () => {
  const runtime = runPreload("orion://app/index.html");
  const { electron } = runtime.apis;

  const invokeResult = electron.invoke("navigate-to", "https://example.com");
  const bootstrapInvokeResult = electron.invoke("bootstrap-window");
  const settingsInvokeResult = electron.invoke("get-browser-settings");
  const settingsUpdateResult = electron.invoke("set-browser-settings", {
    showSeconds: true,
    httpsOnlyMode: true,
    antiFingerprinting: true,
    dnsOverHttpsEnabled: true
  });
  electron.send("renderer-ready");
  const unsubscribe = electron.on("tab-created", () => {});
  unsubscribe();

  assert.equal(invokeResult, "invoke-result");
  assert.equal(bootstrapInvokeResult, "invoke-result");
  assert.equal(settingsInvokeResult, "invoke-result");
  assert.equal(settingsUpdateResult, "invoke-result");
  assert.equal(runtime.invokeCalls.length, 4);
  assert.deepEqual(runtime.invokeCalls[0], ["navigate-to", "https://example.com"]);
  assert.deepEqual(runtime.invokeCalls[1], ["bootstrap-window"]);
  assert.deepEqual(runtime.invokeCalls[2], ["get-browser-settings"]);
  assert.deepEqual(runtime.invokeCalls[3], ["set-browser-settings", {
    showSeconds: true,
    httpsOnlyMode: true,
    antiFingerprinting: true,
    dnsOverHttpsEnabled: true
  }]);
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 1);
  assert.equal(runtime.onCalls[0][0], "tab-created");
  assert.equal(typeof runtime.onCalls[0][1], "function");
  assert.equal(runtime.removeCalls.length, 1);
  assert.equal(runtime.removeCalls[0][0], "tab-created");
  assert.equal(typeof runtime.removeCalls[0][1], "function");
});

test("index page exposes RAM status IPC without widening internal page access", () => {
  const runtime = runPreload("orion://app/index.html");
  const { electron } = runtime.apis;

  const statusResult = electron.invoke("get-memory-status");
  const unsubscribe = electron.on("memory-status-changed", () => {});
  unsubscribe();

  assert.equal(statusResult, "invoke-result");
  assert.deepEqual(runtime.invokeCalls, [["get-memory-status"]]);
  assert.equal(runtime.onCalls[0][0], "memory-status-changed");
  assert.equal(runtime.removeCalls[0][0], "memory-status-changed");
});

test("newtab page exposes only the scoped newtab helpers", async () => {
  const runtime = runPreload("orion://app/newtab.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);

  const navigateResult = await orionPage.navigateTo("example query");
  const bootstrapResult = await orionPage.getBootstrapState();
  const unsubscribe = orionPage.on("browser-settings-changed", () => {});
  unsubscribe();

  assert.equal(navigateResult, "invoke-result");
  assert.equal(bootstrapResult, "invoke-result");
  assert.equal(typeof orionPage.getLanguageSettings, "undefined");
  assert.equal(typeof orionPage.getBrowserSettings, "undefined");
  assert.equal(typeof orionPage.preconnectOrigin, "undefined");
  assert.equal(typeof orionPage.loadExtension, "undefined");
  assert.equal(typeof orionPage.openChromeWebStore, "undefined");
  assert.equal(typeof orionPage.updateExtensions, "undefined");
  assert.deepEqual(runtime.invokeCalls, [
    ["navigate-to", "example query"],
    ["bootstrap-newtab"]
  ]);
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 1);
  assert.equal(runtime.onCalls[0][0], "browser-settings-changed");
  assert.equal(typeof runtime.onCalls[0][1], "function");
  assert.equal(runtime.removeCalls.length, 1);
  assert.equal(runtime.removeCalls[0][0], "browser-settings-changed");
});

test("packaged file index page keeps the shell bridge", () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/index.html");
  const { electron } = runtime.apis;

  assert.ok(electron);
  assert.equal(electron.invoke("bootstrap-window"), "invoke-result");
  electron.send("renderer-ready");

  assert.deepEqual(runtime.invokeCalls, [["bootstrap-window"]]);
  assert.deepEqual(runtime.sendCalls, []);
});

test("packaged file newtab page keeps the scoped newtab bridge", async () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/newtab.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(await orionPage.getBootstrapState(), "invoke-result");
  assert.equal(await orionPage.navigateTo("example query"), "invoke-result");
  assert.deepEqual(runtime.invokeCalls, [
    ["bootstrap-newtab"],
    ["navigate-to", "example query"]
  ]);
});

test("offline page only exposes navigation back into the browser", async () => {
  const runtime = runPreload("orion://app/offline.html?game=snake");
  const { orionPage } = runtime.apis;

  const invokeResult = await orionPage.navigateTo("chrome://newtab");

  assert.equal(invokeResult, "invoke-result");
  assert.deepEqual(runtime.invokeCalls, [["navigate-to", "chrome://newtab"]]);
  assert.equal(typeof orionPage.getLanguageSettings, "undefined");
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 0);
});

test("packaged file offline page keeps the scoped offline bridge", async () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/offline.html?game=snake");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(await orionPage.navigateTo("chrome://newtab"), "invoke-result");
  assert.equal(typeof orionPage.getLanguageSettings, "undefined");
  assert.deepEqual(runtime.invokeCalls, [["navigate-to", "chrome://newtab"]]);
});

test("reader page keeps reader controls scoped to the reader surface", async () => {
  const runtime = runPreload("orion://app/reader.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(typeof orionPage.getLanguageSettings, "undefined");
  assert.equal(await orionPage.getReaderContent(), "invoke-result");
  assert.equal(await orionPage.closeReader(), "invoke-result");
  assert.deepEqual(runtime.invokeCalls, [
    ["get-reader-content"],
    ["close-reader"]
  ]);
});

test("packaged file reader page keeps reader controls scoped to the reader surface", async () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/reader.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(typeof orionPage.getLanguageSettings, "undefined");
  assert.equal(await orionPage.getReaderContent(), "invoke-result");
  assert.equal(await orionPage.closeReader(), "invoke-result");
  assert.deepEqual(runtime.invokeCalls, [
    ["get-reader-content"],
    ["close-reader"]
  ]);
});

test("extensions page keeps extension management scoped to its own page", async () => {
  const runtime = runPreload("orion://app/extensions.html");
  const { orionPage } = runtime.apis;

  const folderResult = await orionPage.selectExtensionFolder();
  const loadResult = await orionPage.loadExtension("/tmp/sample-extension");
  const webStoreResult = await orionPage.openChromeWebStore();
  const updateResult = await orionPage.updateExtensions();

  assert.equal(folderResult, "invoke-result");
  assert.equal(loadResult, "invoke-result");
  assert.equal(webStoreResult, "invoke-result");
  assert.equal(updateResult, "invoke-result");
  assert.equal(typeof orionPage.navigateTo, "undefined");
  assert.deepEqual(runtime.invokeCalls, [
    ["select-extension-folder"],
    ["load-extension", "/tmp/sample-extension"],
    ["open-chrome-web-store"],
    ["update-extensions"]
  ]);
});

test("packaged file extensions page keeps extension management scoped to its own page", async () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/extensions.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(await orionPage.selectExtensionFolder(), "invoke-result");
  assert.equal(await orionPage.loadExtension("C:\\Users\\username\\Downloads\\my-extension"), "invoke-result");
  assert.equal(await orionPage.openChromeWebStore(), "invoke-result");
  assert.equal(await orionPage.updateExtensions(), "invoke-result");
  assert.equal(typeof orionPage.navigateTo, "undefined");
  assert.deepEqual(runtime.invokeCalls, [
    ["select-extension-folder"],
    ["load-extension", "C:\\Users\\username\\Downloads\\my-extension"],
    ["open-chrome-web-store"],
    ["update-extensions"]
  ]);
});

test("non-app pages block all privileged channels", () => {
  const runtime = runPreload("https://example.com/index.html");
  assert.deepEqual(runtime.apis, {});
  assert.deepEqual(runtime.requireCalls, []);
  assert.equal(runtime.invokeCalls.length, 0);
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 0);
  assert.equal(runtime.removeCalls.length, 0);
});

test("nested and encoded custom-protocol pages do not receive a privileged bridge", () => {
  const nested = runPreload("orion://app/nested/index.html");
  const encoded = runPreload("orion://app/nested%2Findex.html");

  assert.deepEqual(nested.apis, {});
  assert.deepEqual(encoded.apis, {});
  assert.equal(nested.invokeCalls.length, 0);
  assert.equal(encoded.invokeCalls.length, 0);
});

test("file pages outside the exact preload directory do not receive a privileged bridge", () => {
  const nested = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/nested/index.html");
  const outside = runPreload("file:///C:/Users/username/Downloads/index.html");

  assert.deepEqual(nested.apis, {});
  assert.deepEqual(outside.apis, {});
});
