const MIN_SENTENCE_LENGTH = 45;
const MAX_SENTENCE_LENGTH = 260;
const MAX_SOURCE_CHARS = 24000;

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be", "because", "been",
  "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "more", "new", "not", "of", "on", "one",
  "or", "our", "out", "over", "said", "say", "she", "so", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "to", "up", "was", "we", "were", "what", "when", "which",
  "who", "will", "with", "would", "you", "your"
]);

function normalizeWhitespace(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => {
      if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
      if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
      if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
      return token;
    })
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function splitSentences(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const matches = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) || [normalized];
  return matches
    .map(normalizeWhitespace)
    .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH && sentence.length <= MAX_SENTENCE_LENGTH);
}

function getSourceEntries(snapshot = {}) {
  const entries = [];
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  let sourceLength = 0;

  blocks.forEach((block, blockIndex) => {
    if (sourceLength >= MAX_SOURCE_CHARS) return;
    const text = normalizeWhitespace(block && block.text);
    if (!text) return;
    sourceLength += text.length;
    const sentences = block.type === "heading" ? [text] : splitSentences(text);
    sentences.forEach((sentence, sentenceIndex) => {
      entries.push({
        sentence,
        blockType: block.type || "paragraph",
        blockIndex,
        sentenceIndex
      });
    });
  });

  return entries;
}

function createFrequencyMap(entries, title = "") {
  const frequencies = new Map();
  const titleTokens = new Set(tokenize(title));

  entries.forEach((entry) => {
    tokenize(entry.sentence).forEach((token) => {
      frequencies.set(token, (frequencies.get(token) || 0) + (titleTokens.has(token) ? 1.6 : 1));
    });
  });

  return frequencies;
}

function scoreEntry(entry, index, entries, frequencies, titleTokens) {
  const tokens = tokenize(entry.sentence);
  if (!tokens.length) return 0;

  const frequencyScore = tokens.reduce((total, token) => total + Math.min(4, frequencies.get(token) || 0), 0) / tokens.length;
  const titleScore = tokens.filter((token) => titleTokens.has(token)).length * 0.7;
  const leadScore = Math.max(0, 1.5 - (index / Math.max(1, entries.length)) * 1.5);
  const headingScore = entry.blockType === "heading" ? 1.3 : 0;
  const idealLength = entry.sentence.length >= 75 && entry.sentence.length <= 190 ? 0.8 : 0;

  return frequencyScore + titleScore + leadScore + headingScore + idealLength;
}

function isTooSimilar(sentence, selected) {
  const tokens = new Set(tokenize(sentence));
  if (!tokens.size) return false;

  return selected.some((entry) => {
    const otherTokens = new Set(tokenize(entry.sentence));
    let overlap = 0;
    tokens.forEach((token) => {
      if (otherTokens.has(token)) overlap += 1;
    });
    return overlap / Math.min(tokens.size, otherTokens.size || 1) > 0.72;
  });
}

function summarizeSnapshot(snapshot = {}, options = {}) {
  const entries = getSourceEntries(snapshot);
  const title = normalizeWhitespace(snapshot.title || "");
  const siteName = normalizeWhitespace(snapshot.siteName || "");
  const sourceUrl = normalizeWhitespace(snapshot.sourceUrl || "");
  const maxBullets = Math.max(2, Math.min(6, Math.floor(options.maxBullets || 4)));

  if (entries.length < 2) {
    return {
      ok: false,
      reason: "There is not enough readable text on this page to summarize on device.",
      title,
      siteName,
      sourceUrl,
      bullets: []
    };
  }

  const frequencies = createFrequencyMap(entries, title);
  const titleTokens = new Set(tokenize(title));
  const ranked = entries
    .map((entry, index) => ({
      ...entry,
      index,
      score: scoreEntry(entry, index, entries, frequencies, titleTokens)
    }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  for (const entry of ranked) {
    if (selected.length >= maxBullets) break;
    if (isTooSimilar(entry.sentence, selected)) continue;
    selected.push(entry);
  }

  selected.sort((a, b) => a.index - b.index);

  if (!selected.length) {
    return {
      ok: false,
      reason: "Orion could not identify enough distinct points to summarize.",
      title,
      siteName,
      sourceUrl,
      bullets: []
    };
  }

  const wordCount = entries.reduce((total, entry) => {
    return total + normalizeWhitespace(entry.sentence).split(/\s+/).filter(Boolean).length;
  }, 0);

  return {
    ok: true,
    title,
    siteName,
    sourceUrl,
    generatedAt: Date.now(),
    localOnly: true,
    readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 220)),
    bullets: selected.map((entry) => entry.sentence)
  };
}

module.exports = {
  splitSentences,
  summarizeSnapshot,
  tokenize
};
