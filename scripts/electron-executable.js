const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getElectronExecutableRelativePath(platform = process.platform) {
  if (platform === "darwin") return path.join("Electron.app", "Contents", "MacOS", "Electron");
  if (platform === "win32") return "electron.exe";
  return "electron";
}

function resolveElectronExecutable(projectRoot = path.resolve(__dirname, "..")) {
  if (process.env.ELECTRON_PATH) return path.resolve(process.env.ELECTRON_PATH);

  const executable = path.join(
    projectRoot,
    "node_modules",
    "electron",
    "dist",
    getElectronExecutableRelativePath()
  );
  if (!fs.existsSync(executable)) throw new Error("Electron executable is missing. Run npm ci first.");
  return executable;
}

function getElectronVersion(projectRoot) {
  const packagePath = path.join(projectRoot, "node_modules", "electron", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (!packageJson.version) throw new Error("Unable to determine the installed Electron version.");
  return String(packageJson.version);
}

function getStagedElectronCacheRoot(options = {}) {
  if (options.cacheRoot) return path.resolve(options.cacheRoot);
  if (process.env.ORION_ELECTRON_CACHE_DIR) return path.resolve(process.env.ORION_ELECTRON_CACHE_DIR);
  return path.join(os.tmpdir(), "orion-electron-runtime-cache");
}

function stageElectronExecutable(projectRoot = path.resolve(__dirname, ".."), options = {}) {
  if (process.env.ELECTRON_PATH) return path.resolve(process.env.ELECTRON_PATH);

  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const version = options.version || getElectronVersion(projectRoot);
  const cacheRoot = getStagedElectronCacheRoot(options);
  const cacheKey = `electron-${version}-${platform}-${arch}`;
  const stagedRoot = path.join(cacheRoot, cacheKey);
  const stagedDist = path.join(stagedRoot, "dist");
  const executableRelativePath = getElectronExecutableRelativePath(platform);
  const stagedExecutable = path.join(stagedDist, executableRelativePath);
  const markerPath = path.join(stagedRoot, "runtime.json");

  if (fs.existsSync(stagedExecutable) && fs.existsSync(markerPath)) return stagedExecutable;

  const sourceDist = path.join(projectRoot, "node_modules", "electron", "dist");
  const sourceExecutable = path.join(sourceDist, executableRelativePath);
  if (!fs.existsSync(sourceExecutable)) throw new Error("Electron executable is missing. Run npm ci first.");

  fs.mkdirSync(cacheRoot, { recursive: true });
  if (fs.existsSync(stagedRoot)) fs.rmSync(stagedRoot, { recursive: true, force: true });
  const stagingRoot = path.join(cacheRoot, `.${cacheKey}-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.cpSync(sourceDist, path.join(stagingRoot, "dist"), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    });
    const stagingExecutable = path.join(stagingRoot, "dist", executableRelativePath);
    if (!fs.existsSync(stagingExecutable)) throw new Error("Staged Electron runtime is incomplete.");
    fs.writeFileSync(path.join(stagingRoot, "runtime.json"), JSON.stringify({ version, platform, arch }));
    fs.renameSync(stagingRoot, stagedRoot);
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (fs.existsSync(stagedExecutable) && fs.existsSync(markerPath)) return stagedExecutable;
    throw error;
  }

  return stagedExecutable;
}

module.exports = {
  getElectronExecutableRelativePath,
  getStagedElectronCacheRoot,
  resolveElectronExecutable,
  stageElectronExecutable
};
