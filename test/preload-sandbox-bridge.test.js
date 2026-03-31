const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const preloadPath = path.join(__dirname, "..", "preload.js");
const preloadSource = fs.readFileSync(preloadPath, "utf8");

function runPreload(href) {
  const requireCalls = [];
  const invokeCalls = [];
  const sendCalls = [];
  const onCalls = [];
  const removeCalls = [];
  const exposedApis = {};

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
    window: { location: { href } },
    require: (moduleName) => {
      requireCalls.push(moduleName);
      if (moduleName === "electron") return { contextBridge, ipcRenderer };
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
    removeCalls
  };
}

test("preload only requires electron in sandbox bridge", () => {
  const runtime = runPreload("orion://app/index.html");
  assert.ok(runtime.apis.electron);
  assert.deepEqual(runtime.requireCalls, ["electron"]);
});

test("index page allows renderer-ready send and startup/navigation invokes", () => {
  const runtime = runPreload("orion://app/index.html");
  const { electron } = runtime.apis;

  const invokeResult = electron.invoke("navigate-to", "https://example.com");
  const bootstrapInvokeResult = electron.invoke("get-window-bootstrap-state");
  const settingsInvokeResult = electron.invoke("get-browser-settings");
  const settingsUpdateResult = electron.invoke("set-browser-settings", { showSeconds: true });
  electron.send("renderer-ready");
  const unsubscribe = electron.on("tab-created", () => {});
  unsubscribe();

  assert.equal(invokeResult, "invoke-result");
  assert.equal(bootstrapInvokeResult, "invoke-result");
  assert.equal(settingsInvokeResult, "invoke-result");
  assert.equal(settingsUpdateResult, "invoke-result");
  assert.equal(runtime.invokeCalls.length, 4);
  assert.deepEqual(runtime.invokeCalls[0], ["navigate-to", "https://example.com"]);
  assert.deepEqual(runtime.invokeCalls[1], ["get-window-bootstrap-state"]);
  assert.deepEqual(runtime.invokeCalls[2], ["get-browser-settings"]);
  assert.deepEqual(runtime.invokeCalls[3], ["set-browser-settings", { showSeconds: true }]);
  assert.equal(runtime.sendCalls.length, 1);
  assert.deepEqual(runtime.sendCalls[0], ["renderer-ready"]);
  assert.equal(runtime.onCalls.length, 1);
  assert.equal(runtime.onCalls[0][0], "tab-created");
  assert.equal(typeof runtime.onCalls[0][1], "function");
  assert.equal(runtime.removeCalls.length, 1);
  assert.equal(runtime.removeCalls[0][0], "tab-created");
  assert.equal(typeof runtime.removeCalls[0][1], "function");
});

test("newtab page exposes only the scoped newtab helpers", async () => {
  const runtime = runPreload("orion://app/newtab.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);

  const navigateResult = await orionPage.navigateTo("example query");
  const localeResult = await orionPage.getLanguageSettings();
  const settingsResult = await orionPage.getBrowserSettings();
  const unsubscribe = orionPage.on("browser-settings-changed", () => {});
  unsubscribe();

  assert.equal(navigateResult, "invoke-result");
  assert.equal(localeResult, "invoke-result");
  assert.equal(settingsResult, "invoke-result");
  assert.equal(typeof orionPage.loadExtension, "undefined");
  assert.deepEqual(runtime.invokeCalls, [
    ["navigate-to", "example query"],
    ["get-language-settings"],
    ["get-browser-settings"]
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
  assert.equal(electron.invoke("get-window-bootstrap-state"), "invoke-result");
  electron.send("renderer-ready");

  assert.deepEqual(runtime.invokeCalls, [["get-window-bootstrap-state"]]);
  assert.deepEqual(runtime.sendCalls, [["renderer-ready"]]);
});

test("packaged file newtab page keeps the scoped newtab bridge", async () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/newtab.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(await orionPage.getLanguageSettings(), "invoke-result");
  assert.equal(await orionPage.getBrowserSettings(), "invoke-result");
  assert.equal(await orionPage.navigateTo("example query"), "invoke-result");
  assert.deepEqual(runtime.invokeCalls, [
    ["get-language-settings"],
    ["get-browser-settings"],
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

  assert.equal(folderResult, "invoke-result");
  assert.equal(loadResult, "invoke-result");
  assert.equal(typeof orionPage.navigateTo, "undefined");
  assert.deepEqual(runtime.invokeCalls, [
    ["select-extension-folder"],
    ["load-extension", "/tmp/sample-extension"]
  ]);
});

test("packaged file extensions page keeps extension management scoped to its own page", async () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/extensions.html");
  const { orionPage, electron } = runtime.apis;

  assert.equal(electron, undefined);
  assert.ok(orionPage);
  assert.equal(await orionPage.selectExtensionFolder(), "invoke-result");
  assert.equal(await orionPage.loadExtension("C:\\Users\\username\\Downloads\\my-extension"), "invoke-result");
  assert.equal(typeof orionPage.navigateTo, "undefined");
  assert.deepEqual(runtime.invokeCalls, [
    ["select-extension-folder"],
    ["load-extension", "C:\\Users\\username\\Downloads\\my-extension"]
  ]);
});

test("non-app pages block all privileged channels", () => {
  const runtime = runPreload("https://example.com/index.html");
  assert.deepEqual(runtime.apis, {});
  assert.equal(runtime.invokeCalls.length, 0);
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 0);
  assert.equal(runtime.removeCalls.length, 0);
});
