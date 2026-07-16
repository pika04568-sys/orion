const fs = require("node:fs");
const path = require("node:path");

function resolveElectronExecutable(projectRoot = path.resolve(__dirname, "..")) {
  if (process.env.ELECTRON_PATH) return path.resolve(process.env.ELECTRON_PATH);

  const distRoot = path.join(projectRoot, "node_modules", "electron", "dist");
  const candidates = process.platform === "darwin"
    ? [path.join(distRoot, "Electron.app", "Contents", "MacOS", "Electron")]
    : process.platform === "win32"
      ? [path.join(distRoot, "electron.exe")]
      : [path.join(distRoot, "electron")];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("Electron executable is missing. Run npm ci first.");
  return executable;
}

module.exports = { resolveElectronExecutable };
