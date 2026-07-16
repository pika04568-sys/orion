const fs = require("node:fs");

function createProtocolAssetHandler(options = {}) {
  const resolveAssetPath = options.resolveAssetPath;
  const getContentType = options.getContentType;
  const readFile = options.readFile || fs.promises.readFile.bind(fs.promises);
  const responseCache = new Map();

  if (typeof resolveAssetPath !== "function" || typeof getContentType !== "function") {
    throw new Error("createProtocolAssetHandler requires asset resolver functions");
  }

  function notFound() {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff"
      }
    });
  }

  async function loadAsset(filePath) {
    if (!responseCache.has(filePath)) {
      const loadPromise = readFile(filePath).catch((error) => {
        responseCache.delete(filePath);
        throw error;
      });
      responseCache.set(filePath, loadPromise);
    }
    return responseCache.get(filePath);
  }

  return async function handleProtocolRequest(request) {
    const filePath = resolveAssetPath(request && request.url);
    if (!filePath) return notFound();
    const contentType = getContentType(filePath);

    try {
      const fileContent = await loadAsset(filePath);
      const isText = /^(text\/|application\/(javascript|json))/.test(contentType);
      const headers = {
        "cache-control": contentType === "text/html"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
        "content-type": isText ? `${contentType}; charset=utf-8` : contentType,
        "x-content-type-options": "nosniff"
      };
      if (contentType === "text/html") headers["content-security-policy"] = "frame-ancestors 'none'";
      return new Response(fileContent, { status: 200, headers });
    } catch (_error) {
      return notFound();
    }
  };
}

module.exports = { createProtocolAssetHandler };
