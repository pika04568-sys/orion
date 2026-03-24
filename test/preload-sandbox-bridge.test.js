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
  let exposedApi = null;

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
      if (name === "electron") exposedApi = api;
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
    api: exposedApi,
    requireCalls,
    invokeCalls,
    sendCalls,
    onCalls,
    removeCalls
  };
}

test("preload only requires electron in sandbox bridge", () => {
  const runtime = runPreload("file:///Users/kenokayasu/Documents/MyBrowser/index.html");
  assert.ok(runtime.api);
  assert.deepEqual(runtime.requireCalls, ["electron"]);
});

test("index page allows renderer-ready send and navigate invoke", () => {
  const runtime = runPreload("file:///Users/kenokayasu/Documents/MyBrowser/index.html");
  const { api } = runtime;

  const invokeResult = api.invoke("navigate-to", "https://example.com");
  api.send("renderer-ready");
  const unsubscribe = api.on("tab-created", () => {});
  unsubscribe();

  assert.equal(invokeResult, "invoke-result");
  assert.equal(runtime.invokeCalls.length, 1);
  assert.deepEqual(runtime.invokeCalls[0], ["navigate-to", "https://example.com"]);
  assert.equal(runtime.sendCalls.length, 1);
  assert.deepEqual(runtime.sendCalls[0], ["renderer-ready"]);
  assert.equal(runtime.onCalls.length, 1);
  assert.equal(runtime.onCalls[0][0], "tab-created");
  assert.equal(typeof runtime.onCalls[0][1], "function");
  assert.equal(runtime.removeCalls.length, 1);
  assert.equal(runtime.removeCalls[0][0], "tab-created");
  assert.equal(typeof runtime.removeCalls[0][1], "function");
});

test("newtab page allows invoke but blocks send/on privileges", () => {
  const runtime = runPreload("file:///C:/Program%20Files/Orion/resources/app.asar/newtab.html");
  const { api } = runtime;

  const invokeResult = api.invoke("navigate-to", "example query");
  api.send("renderer-ready");
  const unsubscribe = api.on("tab-created", () => {});
  unsubscribe();

  assert.equal(invokeResult, "invoke-result");
  assert.equal(runtime.invokeCalls.length, 1);
  assert.deepEqual(runtime.invokeCalls[0], ["navigate-to", "example query"]);
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 0);
  assert.equal(runtime.removeCalls.length, 0);
});

test("non-file pages block all privileged channels", () => {
  const runtime = runPreload("https://example.com/index.html");
  const { api } = runtime;

  const invokeResult = api.invoke("navigate-to", "https://openai.com");
  api.send("renderer-ready");
  const unsubscribe = api.on("tab-created", () => {});
  unsubscribe();

  assert.equal(invokeResult, undefined);
  assert.equal(runtime.invokeCalls.length, 0);
  assert.equal(runtime.sendCalls.length, 0);
  assert.equal(runtime.onCalls.length, 0);
  assert.equal(runtime.removeCalls.length, 0);
});
