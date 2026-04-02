const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PERMISSION_DECISIONS = Object.freeze({
  ALLOW: "allow",
  DENY: "deny"
});

const PROMPTABLE_PERMISSIONS = Object.freeze([
  "fullscreen",
  "geolocation",
  "media",
  "notifications"
]);

const DENIED_BY_DEFAULT_PERMISSIONS = Object.freeze([
  "clipboard-read",
  "display-capture",
  "fileSystem",
  "hid",
  "idle-detection",
  "keyboardLock",
  "mediaKeySystem",
  "midi",
  "midiSysex",
  "openExternal",
  "pointerLock",
  "serial",
  "speaker-selection",
  "storage-access",
  "top-level-storage-access",
  "unknown",
  "usb",
  "window-management"
]);

function normalizePermissionOrigin(value) {
  if (!value || typeof value !== "string") return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch (_error) {
    return null;
  }
}

function sanitizePermissionStore(rawStore) {
  const store = {};
  if (!rawStore || typeof rawStore !== "object") return store;

  Object.entries(rawStore).forEach(([scopeKey, scopeValue]) => {
    if (!scopeValue || typeof scopeValue !== "object") return;

    const nextScope = {};
    Object.entries(scopeValue).forEach(([origin, permissions]) => {
      const safeOrigin = normalizePermissionOrigin(origin);
      if (!safeOrigin || !permissions || typeof permissions !== "object") return;

      const nextPermissions = {};
      Object.entries(permissions).forEach(([permission, decision]) => {
        if (
          typeof permission === "string" &&
          (decision === PERMISSION_DECISIONS.ALLOW || decision === PERMISSION_DECISIONS.DENY)
        ) {
          nextPermissions[permission] = decision;
        }
      });

      if (Object.keys(nextPermissions).length > 0) nextScope[safeOrigin] = nextPermissions;
    });

    if (Object.keys(nextScope).length > 0) store[String(scopeKey)] = nextScope;
  });

  return store;
}

function getPermissionDecision(store, scopeKey, origin, permission) {
  if (!store || !scopeKey || !permission) return null;
  const safeOrigin = normalizePermissionOrigin(origin);
  if (!safeOrigin) return null;
  const scope = store[scopeKey];
  if (!scope || typeof scope !== "object") return null;
  const originDecisions = scope[safeOrigin];
  if (!originDecisions || typeof originDecisions !== "object") return null;
  return originDecisions[permission] || null;
}

function setPermissionDecision(store, scopeKey, origin, permission, decision) {
  const safeOrigin = normalizePermissionOrigin(origin);
  if (
    !store ||
    typeof store !== "object" ||
    !scopeKey ||
    !permission ||
    !safeOrigin ||
    (decision !== PERMISSION_DECISIONS.ALLOW && decision !== PERMISSION_DECISIONS.DENY)
  ) {
    return store;
  }

  if (!store[scopeKey] || typeof store[scopeKey] !== "object") store[scopeKey] = {};
  if (!store[scopeKey][safeOrigin] || typeof store[scopeKey][safeOrigin] !== "object") {
    store[scopeKey][safeOrigin] = {};
  }
  store[scopeKey][safeOrigin][permission] = decision;
  return store;
}

function isPermissionPromptable(permission) {
  return PROMPTABLE_PERMISSIONS.includes(permission);
}

function shouldDenyPermissionByDefault(permission) {
  return DENIED_BY_DEFAULT_PERMISSIONS.includes(permission);
}

// Dangerous permissions that should trigger additional warnings
const DANGEROUS_EXTENSION_PERMISSIONS = Object.freeze([
  "webRequest",
  "webRequestBlocking",
  "proxy",
  "tabs",
  "webNavigation",
  "cookies",
  "history",
  "bookmarks",
  "downloads",
  "management",
  "privacy",
  "storage",
  "unlimitedStorage",
  "clipboardRead",
  "clipboardWrite",
  "geolocation",
  "notifications",
  "<all_urls>",
  "host:*/*",
  "content-script:*/*"
]);

function hasDangerousPermissions(permissions) {
  if (!Array.isArray(permissions)) return false;
  const dangerousFound = permissions.some(
    (perm) => DANGEROUS_EXTENSION_PERMISSIONS.includes(perm) ||
              perm.startsWith("host:*") ||
              perm.startsWith("content-script:*")
  );
  return dangerousFound;
}

function getDangerousPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return permissions.filter(
    (perm) => DANGEROUS_EXTENSION_PERMISSIONS.includes(perm) ||
              perm.startsWith("host:*") ||
              perm.startsWith("content-script:*")
  );
}

function collectManifestPermissions(manifest = {}) {
  const values = [];
  const maybePush = (entry, prefix = "") => {
    if (typeof entry !== "string") return;
    const trimmed = entry.trim();
    if (!trimmed) return;
    values.push(prefix ? `${prefix}${trimmed}` : trimmed);
  };

  ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions"].forEach((key) => {
    const entries = manifest[key];
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => maybePush(entry, key.includes("host") ? "host:" : ""));
  });

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts.forEach((entry) => {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.matches)) return;
      entry.matches.forEach((match) => maybePush(match, "content-script:"));
    });
  }

  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function collectDirectoryFiles(rootDir, currentDir = rootDir, files = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true, throwIfNoEntry: false })
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  entries.forEach((entry) => {
    const fullPath = path.join(currentDir, entry.name);
    
    // Check for symbolic links before accessing stats
    try {
      const lstats = fs.lstatSync(fullPath);
      if (lstats.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in unpacked extensions: ${fullPath}`);
      }
      
      if (lstats.isDirectory()) {
        collectDirectoryFiles(rootDir, fullPath, files);
        return;
      }
      
      if (lstats.isFile()) {
        // Verify the file is actually within rootDir (prevent bind mount attacks)
        const realPath = fs.realpathSync(fullPath);
        const realRoot = fs.realpathSync(rootDir);
        if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
          throw new Error(`File outside extension directory: ${fullPath}`);
        }
        files.push(fullPath);
      }
    } catch (error) {
      if (error.message.includes("Symbolic links") || error.message.includes("outside extension")) {
        throw error;
      }
      // Skip files that can't be accessed
    }
  });

  return files;
}

function computeDirectoryHash(rootDir) {
  const digest = crypto.createHash("sha256");
  const files = collectDirectoryFiles(rootDir);

  files.forEach((fullPath) => {
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    digest.update(relativePath);
    digest.update("\n");
    digest.update(fs.readFileSync(fullPath));
    digest.update("\n");
  });

  return digest.digest("hex");
}

function inspectExtensionDirectory(rootDir) {
  if (!rootDir || !path.isAbsolute(rootDir)) {
    throw new Error("Extension path must be absolute.");
  }
  
  // Resolve to real path to prevent symlink attacks
  let realRootDir;
  try {
    realRootDir = fs.realpathSync(rootDir);
  } catch (_error) {
    throw new Error("Extension path is not accessible or is a symbolic link.");
  }
  
  // Verify the resolved path is still within allowed directories
  // Extensions should only be loaded from user-selected locations, not system directories
  const normalizedPath = realRootDir.replace(/\\/g, "/").toLowerCase();
  const forbiddenPrefixes = [
    "/system", "/proc", "/dev", "/bin", "/sbin", "/usr", 
    "c:/windows", "c:/program files", "c:/programdata"
  ];
  
  if (forbiddenPrefixes.some(prefix => normalizedPath.startsWith(prefix))) {
    throw new Error("Extensions cannot be loaded from system directories.");
  }
  
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error("Extension folder does not exist.");
  }

  const manifestPath = path.join(rootDir, "manifest.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error("manifest.json is missing.");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_error) {
    throw new Error("manifest.json is invalid JSON.");
  }

  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest.json must define an object.");
  }

  const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
  if (!name) throw new Error("manifest.json must define a name.");

  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  const description = typeof manifest.description === "string" ? manifest.description.trim() : "";
  const manifestVersion = Number.isInteger(manifest.manifest_version) ? manifest.manifest_version : null;

  return {
    name,
    version,
    description,
    manifestVersion,
    manifestPath,
    permissions: collectManifestPermissions(manifest),
    hash: computeDirectoryHash(rootDir)
  };
}

module.exports = {
  DANGEROUS_EXTENSION_PERMISSIONS,
  DENIED_BY_DEFAULT_PERMISSIONS,
  PERMISSION_DECISIONS,
  PROMPTABLE_PERMISSIONS,
  collectManifestPermissions,
  computeDirectoryHash,
  getDangerousPermissions,
  getPermissionDecision,
  hasDangerousPermissions,
  inspectExtensionDirectory,
  isPermissionPromptable,
  normalizePermissionOrigin,
  sanitizePermissionStore,
  setPermissionDecision,
  shouldDenyPermissionByDefault
};
