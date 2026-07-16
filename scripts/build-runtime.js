const fs = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(projectRoot, ".build");
const publicRoot = path.join(buildRoot, "public");

const browserEntries = [
  "app-utils.js",
  "extensions.js",
  "localization.js",
  "newtab.js",
  "offline-game-helpers.js",
  "offline.js",
  "reader.js",
  "renderer.js"
];

const browserGlobals = Object.freeze({
  "app-utils.js": "OrionAppUtils",
  "localization.js": "OrionLocalization",
  "offline-game-helpers.js": "OfflineArcadeHelpers"
});

const htmlEntries = [
  "extensions.html",
  "index.html",
  "newtab.html",
  "offline.html",
  "reader.html"
];

async function buildRuntime() {
  await fs.rm(buildRoot, { recursive: true, force: true });
  await fs.mkdir(publicRoot, { recursive: true });

  const shared = {
    bundle: true,
    legalComments: "none",
    logLevel: "info",
    minify: true,
    sourcemap: false
  };

  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: [path.join(projectRoot, "main.js")],
      external: [
        "electron",
        "electron-chrome-extensions",
        "electron-chrome-extensions/*",
        "electron-chrome-web-store",
        "electron-updater"
      ],
      format: "cjs",
      outfile: path.join(buildRoot, "main.cjs"),
      platform: "node",
      target: "node22"
    }),
    esbuild.build({
      ...shared,
      entryPoints: [path.join(projectRoot, "preload.js")],
      external: ["electron", "electron-chrome-extensions/browser-action"],
      format: "cjs",
      outfile: path.join(buildRoot, "preload.cjs"),
      platform: "node",
      target: "node22"
    }),
    esbuild.build({
      ...shared,
      entryPoints: [path.join(projectRoot, "adblock-worker.js")],
      format: "cjs",
      outfile: path.join(buildRoot, "adblock-worker.cjs"),
      platform: "node",
      target: "node22"
    }),
    ...browserEntries.map((file) => {
      const globalName = browserGlobals[file];
      return esbuild.build({
        ...shared,
        ...(globalName
          ? {
              stdin: {
                contents: `window.${globalName} = require(${JSON.stringify(`./${file}`)});`,
                resolveDir: projectRoot,
                sourcefile: `runtime-${file}`
              }
            }
          : { entryPoints: [path.join(projectRoot, file)] }),
        format: "iife",
        outfile: path.join(publicRoot, file),
        platform: "browser",
        target: "chrome140"
      });
    }),
    ...htmlEntries.map((file) => fs.copyFile(
      path.join(projectRoot, file),
      path.join(publicRoot, file)
    ))
  ]);
}

buildRuntime().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
