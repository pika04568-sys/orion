const { parentPort } = require("node:worker_threads");
const fs = require("node:fs/promises");
const { compileFilterSnapshot } = require("./adblock");

if (parentPort) {
  parentPort.on("message", async (message) => {
    if (!message || message.type !== "compile") return;
    try {
      const listEntries = await Promise.all((message.listEntries || []).map(async (entry) => {
        if (!entry || !entry.filePath) return entry || {};
        let text = "";
        try {
          text = await fs.readFile(entry.filePath, "utf8");
        } catch (error) {
          if (!error || error.code !== "ENOENT") throw error;
        }
        return { id: entry.id, enabled: entry.enabled, text };
      }));
      parentPort.postMessage({
        id: message.id,
        ok: true,
        snapshot: compileFilterSnapshot(listEntries, message.customRules || "")
      });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  });
}
