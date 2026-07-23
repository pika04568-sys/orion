const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const esbuild = require("esbuild");
const localization = require("../localization");

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
  "offline-game-helpers.js": "OfflineArcadeHelpers"
});

const htmlEntries = [
  "extensions.html",
  "index.html",
  "newtab.html",
  "offline.html",
  "reader.html"
];

const lazyMainServiceEntries = [
  "ai-models.js",
  "ai-summary.js",
  "ai-summary-worker.js",
  "extension-manager.js",
  "memory-manager.js",
  "reader-extraction.js"
];

async function emitHtmlWithExtractedStyles(file, scriptDigests) {
  const sourcePath = path.join(projectRoot, file);
  const html = await fs.readFile(sourcePath, "utf8");
  const stylePattern = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi;
  const styleBlocks = Array.from(html.matchAll(stylePattern), (match) => match[1]);
  if (!styleBlocks.length) {
    await fs.copyFile(sourcePath, path.join(publicRoot, file));
    return;
  }

  const transformed = await esbuild.transform(styleBlocks.join("\n"), {
    legalComments: "none",
    loader: "css",
    minify: true
  });
  const digest = crypto.createHash("sha256").update(transformed.code).digest("hex").slice(0, 12);
  const styleFile = `${path.basename(file, ".html")}.${digest}.css`;
  await fs.writeFile(path.join(publicRoot, styleFile), transformed.code, "utf8");
  let emittedLink = false;
  const withExtractedStyles = html.replace(stylePattern, () => {
    if (emittedLink) return "";
    emittedLink = true;
    return `<link rel="stylesheet" href="${styleFile}">`;
  });
  const rewritten = withExtractedStyles.replace(
    /(<script\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,
    (match, prefix, source, suffix) => {
      const fileName = source.split(/[?#]/, 1)[0].replace(/^\.\//, "");
      const digest = scriptDigests.get(fileName);
      return digest ? `${prefix}${fileName}?v=${digest}${suffix}` : match;
    }
  );
  await fs.writeFile(path.join(publicRoot, file), rewritten, "utf8");
}

async function minifyBrowserScript(source, sourcefile) {
  const transformed = await esbuild.transform(source, {
    legalComments: "none",
    loader: "js",
    minify: true,
    sourcefile,
    target: "chrome140"
  });
  return transformed.code;
}

async function emitBrowserLocalization() {
  const localeVersions = {};
  for (const locale of localization.SUPPORTED_LOCALES) {
    if (locale === localization.DEFAULT_LOCALE) continue;
    const fileName = `locale-${locale}.js`;
    const source = `window.OrionLocalization&&window.OrionLocalization.registerLocale(${JSON.stringify(locale)},${JSON.stringify(localization.TRANSLATIONS[locale])});`;
    const code = await minifyBrowserScript(source, fileName);
    localeVersions[locale] = crypto.createHash("sha256").update(code).digest("hex").slice(0, 12);
    await fs.writeFile(path.join(publicRoot, fileName), code, "utf8");
  }

  const profileMessages = Object.fromEntries(localization.SUPPORTED_LOCALES.map((locale) => [locale, {
    default: localization.TRANSLATIONS[locale]["profile.default"],
    named: localization.TRANSLATIONS[locale]["profile.named"],
    incognito: localization.TRANSLATIONS[locale]["profile.incognito"]
  }]));
  const runtimeConfig = JSON.stringify({
    defaultLocale: localization.DEFAULT_LOCALE,
    intlLocales: localization.INTL_LOCALES,
    languageOptions: localization.getLanguageOptions(),
    localeVersions,
    messages: localization.TRANSLATIONS[localization.DEFAULT_LOCALE],
    profileMessages,
    supportedLocales: localization.SUPPORTED_LOCALES
  });
  const source = `(() => {
    const config = ${runtimeConfig};
    const messages = Object.create(null);
    const pending = new Map();
    messages[config.defaultLocale] = Object.freeze(config.messages);
    const sanitizeLocale = (locale) => config.supportedLocales.includes(locale) ? locale : null;
    const resolveLocale = (locale, fallback = config.defaultLocale) => sanitizeLocale(locale) || fallback;
    const interpolate = (template, vars = {}) => String(template).replace(/\\{\\{(\\w+)\\}\\}/g, (_, key) => Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : "");
    const getMessages = (locale) => messages[resolveLocale(locale)] || messages[config.defaultLocale];
    const t = (locale, key, vars = {}) => {
      const selected = getMessages(locale);
      const template = selected[key] != null ? selected[key] : messages[config.defaultLocale][key];
      return template == null ? key : interpolate(template, vars);
    };
    const normalizeUiPlatform = (platform) => {
      const value = String(platform == null ? "" : platform).trim().toLowerCase();
      if (value === "mac" || value === "macos" || value === "darwin" || value === "osx" || value.includes("mac") || value.includes("darwin") || value.includes("os x")) return "mac";
      if (value === "windows" || value === "win32" || value === "win64" || value.includes("windows") || /\\bwin(?:32|64)?\\b/.test(value)) return "windows";
      return "linux";
    };
    const getUiPlatformText = (locale, platform) => {
      const resolvedLocale = resolveLocale(locale);
      const resolvedPlatform = normalizeUiPlatform(platform);
      const modifier = resolvedLocale === "de" && resolvedPlatform !== "mac" ? "Strg" : (resolvedPlatform === "mac" ? "Cmd" : "Ctrl");
      const paths = { windows: "C:\\\\Users\\\\username\\\\Downloads\\\\my-extension", mac: "/Users/username/Downloads/my-extension", linux: "/home/username/Downloads/my-extension" };
      return { platform: resolvedPlatform, primaryModifierLabel: modifier, extensionPathExample: paths[resolvedPlatform], extensionPathPlaceholder: paths[resolvedPlatform] };
    };
    const registerLocale = (locale, dictionary) => {
      const safeLocale = sanitizeLocale(locale);
      if (!safeLocale || !dictionary || typeof dictionary !== "object") return false;
      messages[safeLocale] = Object.freeze({ ...dictionary });
      return true;
    };
    const loadLocale = (locale) => {
      const safeLocale = resolveLocale(locale);
      if (messages[safeLocale] || typeof document === "undefined") return Promise.resolve(getMessages(safeLocale));
      if (pending.has(safeLocale)) return pending.get(safeLocale);
      const promise = new Promise((resolve) => {
        const script = document.createElement("script");
        const finish = () => {
          clearTimeout(timer);
          script.remove();
          pending.delete(safeLocale);
          resolve(getMessages(safeLocale));
        };
        const timer = setTimeout(finish, 1500);
        script.async = true;
        script.src = "locale-" + safeLocale + ".js?v=" + (config.localeVersions[safeLocale] || "1");
        script.onload = finish;
        script.onerror = finish;
        document.head.appendChild(script);
      });
      pending.set(safeLocale, promise);
      return promise;
    };
    const getProfileTemplate = (locale, key) => (config.profileMessages[resolveLocale(locale)] || config.profileMessages[config.defaultLocale])[key];
    const getProfileName = (locale, index) => index === 0 ? getProfileTemplate(locale, "default") : interpolate(getProfileTemplate(locale, "named"), { index });
    const getIncognitoProfileName = (locale) => getProfileTemplate(locale, "incognito");
    const isGeneratedProfileName = (name, index) => !!name && config.supportedLocales.some((locale) => name === getProfileName(locale, index) || name === getIncognitoProfileName(locale));
    window.OrionLocalization = {
      DEFAULT_LOCALE: config.defaultLocale,
      INTL_LOCALES: Object.freeze(config.intlLocales),
      SUPPORTED_LOCALES: Object.freeze(config.supportedLocales),
      TRANSLATIONS: messages,
      getIntlLocale: (locale) => config.intlLocales[resolveLocale(locale)] || config.intlLocales[config.defaultLocale],
      getIncognitoProfileName,
      getLanguageOptions: () => config.languageOptions.slice(),
      getMessages,
      getProfileName,
      getUiPlatformText,
      isGeneratedProfileName,
      loadLocale,
      normalizeUiPlatform,
      registerLocale,
      resolveLocale,
      sanitizeLocale,
      t
    };
  })();`;
  const code = await minifyBrowserScript(source, "localization.js");
  await fs.writeFile(path.join(publicRoot, "localization.js"), code, "utf8");
}

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

  await emitBrowserLocalization();

  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: [path.join(projectRoot, "main.js")],
      external: [
        "electron",
        "electron-chrome-extensions",
        "electron-chrome-extensions/*",
        "electron-chrome-web-store",
        "electron-updater",
        "./ai-summary",
        "./reader-extraction",
        "./extension-manager",
        "./memory-manager"
      ],
      format: "cjs",
      outfile: path.join(buildRoot, "main-app.cjs"),
      platform: "node",
      target: "node22"
    }),
    esbuild.build({
      ...shared,
      entryPoints: [path.join(projectRoot, "preload.js")],
      external: ["electron"],
      format: "cjs",
      outfile: path.join(buildRoot, "preload.cjs"),
      platform: "node",
      target: "node22"
    }),
    ...lazyMainServiceEntries.map((file) => esbuild.build({
      ...shared,
      entryPoints: [path.join(projectRoot, file)],
      external: [
        "electron",
        "@huggingface/transformers"
      ],
      format: "cjs",
      outfile: path.join(buildRoot, file),
      platform: "node",
      target: "node22"
    })),
    ...browserEntries.filter((file) => file !== "localization.js").map((file) => {
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
    })
  ]);

  const bootstrapSource = `"use strict";const{monitorEventLoopDelay,performance}=require("node:perf_hooks");const eventLoopDelay=monitorEventLoopDelay({resolution:10});eventLoopDelay.enable();globalThis.__orionEarlyStartupPerformance={eventLoopDelay,bootstrapStartedMs:performance.now(),timeOriginMs:performance.timeOrigin};require("./main-app.cjs");\n`;
  await fs.writeFile(path.join(buildRoot, "main.cjs"), bootstrapSource, "utf8");

  const scriptDigests = new Map(await Promise.all(browserEntries.map(async (file) => {
    const content = await fs.readFile(path.join(publicRoot, file));
    const digest = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
    return [file, digest];
  })));
  await Promise.all(htmlEntries.map((file) => emitHtmlWithExtractedStyles(file, scriptDigests)));
}

buildRuntime().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
