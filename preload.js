const { contextBridge, ipcRenderer } = require("electron");
const appUtils = require("./app-utils");

function getPageFile() {
  return appUtils.getLocalPageFileName(window.location.href);
}

function canUseChannel(method, channel) {
  return appUtils.canUseElectronChannel(getPageFile(), method, channel);
}

contextBridge.exposeInMainWorld(
  "electron",
  Object.freeze({
    invoke: (channel, ...args) => {
      if (!canUseChannel("invoke", channel)) return undefined;
      return ipcRenderer.invoke(channel, ...args);
    },
    send: (channel, ...args) => {
      if (!canUseChannel("send", channel)) return;
      ipcRenderer.send(channel, ...args);
    },
    on: (channel, listener) => {
      if (!canUseChannel("on", channel)) return () => {};
      const subscription = (event, ...args) => listener(event, ...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
  })
);
