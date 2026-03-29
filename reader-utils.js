function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeWhitespace(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeText(value, maxLength = 2000) {
  const text = normalizeWhitespace(value);
  return text ? text.slice(0, maxLength) : "";
}

function sanitizeUrl(value, baseUrl = "") {
  const candidate = sanitizeText(value, 2048);
  if (!candidate) return "";

  const lower = candidate.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return "";

  if (lower.startsWith("data:")) {
    return lower.startsWith("data:image/") ? candidate : "";
  }

  try {
    const resolved = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return "";
    return resolved.href;
  } catch (_error) {
    return "";
  }
}

function sanitizeBlocks(blocks = []) {
  if (!Array.isArray(blocks)) return [];

  const seen = new Set();
  const result = [];
  for (const block of blocks) {
    if (result.length >= 80) break;
    const type = block && typeof block.type === "string" ? block.type : "paragraph";
    const text = sanitizeText(block && (block.text != null ? block.text : block.content), 6000);
    if (!text || text.length < 20) continue;

    const dedupeKey = `${type}:${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({ type, text });
  }
  return result;
}

function sanitizeImages(images = [], baseUrl = "") {
  if (!Array.isArray(images)) return [];

  const result = [];
  const seen = new Set();
  for (const image of images) {
    if (result.length >= 8) break;
    const rawSrc = typeof image === "string" ? image : image && (image.src || image.url || image.currentSrc || image.data);
    const src = sanitizeUrl(rawSrc, baseUrl);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    result.push({
      src,
      alt: sanitizeText(image && (image.alt || image.description), 240)
    });
  }
  return result;
}

function computeReaderScore(analysis = {}) {
  const textLength = Math.max(0, Math.floor(Number(analysis.textLength) || 0));
  const paragraphCount = Math.max(0, Math.floor(Number(analysis.paragraphCount) || 0));
  const headingCount = Math.max(0, Math.floor(Number(analysis.headingCount) || 0));
  const imageCount = Math.max(0, Math.floor(Number(analysis.imageCount) || 0));
  const linkDensity = clampNumber(analysis.linkDensity, 0, 1);

  let score = 0;

  if (analysis.semanticRoot === "article") score += 24;
  else if (analysis.semanticRoot === "main") score += 18;
  else if (analysis.semanticRoot === "content") score += 10;

  if (analysis.hasByline) score += 5;
  if (analysis.hasPublishedDate) score += 4;
  if (analysis.hasCanonical) score += 3;

  score += Math.min(24, textLength / 140);
  score += Math.min(18, paragraphCount * 3.5);
  score += Math.min(8, headingCount * 1.5);
  score += Math.min(6, imageCount * 1.2);

  if (linkDensity > 0.5) score -= 20;
  else if (linkDensity > 0.35) score -= 12;
  else if (linkDensity > 0.22) score -= 6;

  score -= clampNumber(analysis.boilerplatePenalty, 0, 35);
  score += clampNumber(analysis.structureBonus, 0, 20);

  return clampNumber(Math.round(score), 0, 100);
}

function buildReaderSnapshot(analysis = {}) {
  const blocks = sanitizeBlocks(analysis.blocks);
  const sourceUrl = sanitizeUrl(analysis.sourceUrl || analysis.url || "");
  const canonicalUrl = sanitizeUrl(analysis.canonicalUrl || analysis.canonical || "", sourceUrl);
  const images = sanitizeImages(analysis.images || analysis.imageUrls || [], sourceUrl);
  const title = sanitizeText(analysis.title || analysis.documentTitle || "", 180);
  const siteName = sanitizeText(analysis.siteName || analysis.publisher || "", 120);
  const byline = sanitizeText(analysis.byline || analysis.author || "", 180);
  const publishedDate = sanitizeText(analysis.publishedDate || analysis.publishedTime || "", 120);
  const modifiedDate = sanitizeText(analysis.modifiedDate || analysis.modifiedTime || "", 120);
  const excerpt = sanitizeText(analysis.excerpt || (blocks[0] && blocks[0].text) || "", 360);
  const score = computeReaderScore({
    ...analysis,
    imageCount: images.length,
    paragraphCount: analysis.paragraphCount || blocks.filter((block) => block.type === "paragraph" || block.type === "quote").length,
    textLength: analysis.textLength || blocks.reduce((total, block) => total + block.text.length, 0),
    hasByline: !!byline,
    hasPublishedDate: !!publishedDate,
    hasCanonical: !!canonicalUrl
  });
  const confidence = score / 100;
  const textLength = Math.max(0, Math.floor(Number(analysis.textLength) || blocks.reduce((total, block) => total + block.text.length, 0)));
  const paragraphCount = Math.max(0, Math.floor(Number(analysis.paragraphCount) || blocks.filter((block) => block.type === "paragraph" || block.type === "quote").length));

  const readable = (
    confidence >= 0.58 &&
    textLength >= 420 &&
    paragraphCount >= 3 &&
    blocks.length >= 3
  );

  return {
    sourceUrl,
    canonicalUrl,
    title,
    siteName,
    byline,
    publishedDate,
    modifiedDate,
    excerpt,
    blocks,
    images,
    textLength,
    paragraphCount,
    headingCount: Math.max(0, Math.floor(Number(analysis.headingCount) || 0)),
    linkDensity: clampNumber(analysis.linkDensity, 0, 1),
    score,
    confidence,
    readable,
    reason: readable
      ? ""
      : sanitizeText(
          analysis.reason ||
          "Orion could not confidently identify a readable article on this page.",
          240
        )
  };
}

module.exports = {
  buildReaderSnapshot,
  clampNumber,
  computeReaderScore,
  normalizeWhitespace,
  sanitizeBlocks,
  sanitizeImages,
  sanitizeText,
  sanitizeUrl
};
