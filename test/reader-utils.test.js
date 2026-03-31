const test = require("node:test");
const assert = require("node:assert/strict");

const readerUtils = require("../reader-utils");

test("reader snapshots keep strong article pages and sanitize content", () => {
  const snapshot = readerUtils.buildReaderSnapshot({
    sourceUrl: "https://example.com/story",
    title: "A Deep Dive",
    siteName: "Example News",
    byline: "Ada Lovelace",
    publishedDate: "2026-03-28T10:30:00.000Z",
    blocks: [
      { type: "heading", text: "Lead" },
      { type: "paragraph", text: " ".repeat(4) + "This is a long article paragraph with useful detail and no clutter." },
      { type: "paragraph", text: "Another paragraph with supporting context, examples, and a second point." },
      { type: "quote", text: "A thoughtful pull quote." }
    ],
    images: [
      { src: "https://example.com/image.jpg", alt: "Hero image" },
      { src: "javascript:alert(1)", alt: "ignore me" }
    ],
    textLength: 1400,
    paragraphCount: 4,
    headingCount: 2,
    linkDensity: 0.08,
    semanticRoot: "article",
    structureBonus: 8
  });

  assert.equal(snapshot.readable, true);
  assert.equal(snapshot.title, "A Deep Dive");
  assert.equal(snapshot.byline, "Ada Lovelace");
  assert.equal(snapshot.images.length, 1);
  assert.equal(snapshot.blocks.length, 3);
  assert.ok(snapshot.score >= 60);
});

test("reader snapshots reject boilerplate-heavy pages", () => {
  const snapshot = readerUtils.buildReaderSnapshot({
    sourceUrl: "https://example.com/home",
    title: "Homepage",
    siteName: "Example",
    blocks: [
      { type: "paragraph", text: "Home" },
      { type: "paragraph", text: "Menu" }
    ],
    textLength: 180,
    paragraphCount: 1,
    headingCount: 0,
    linkDensity: 0.72,
    boilerplatePenalty: 24
  });

  assert.equal(snapshot.readable, false);
  assert.equal(snapshot.images.length, 0);
  assert.ok(snapshot.reason.length > 0);
});

test("reader snapshots accept shorter article-like pages when the structure is strong", () => {
  const snapshot = readerUtils.buildReaderSnapshot({
    sourceUrl: "https://example.com/article",
    title: "Short Feature",
    siteName: "Example News",
    byline: "Lin Chen",
    blocks: [
      { type: "heading", text: "A compact lead with enough context" },
      { type: "paragraph", text: "The opening paragraph still carries enough substance to read comfortably in reader mode." },
      { type: "paragraph", text: "A second paragraph with context, detail, and a clear article flow keeps the page useful." }
    ],
    textLength: 360,
    paragraphCount: 2,
    headingCount: 1,
    linkDensity: 0.12,
    semanticRoot: "article",
    structureBonus: 6
  });

  assert.equal(snapshot.readable, true);
  assert.equal(snapshot.byline, "Lin Chen");
  assert.equal(snapshot.blocks.length, 3);
});

test("reader snapshots accept BBC-style editorial pages with strong article signals", () => {
  const snapshot = readerUtils.buildReaderSnapshot({
    sourceUrl: "https://www.bbc.com/news/world-12345678",
    title: "World Update",
    siteName: "BBC News",
    byline: "BBC News",
    publishedDate: "2026-03-29T14:00:00.000Z",
    blocks: [
      { type: "heading", text: "A concise lead that still reads like an article" },
      { type: "paragraph", text: "The first paragraph explains the development in enough detail to be readable in reader mode." },
      { type: "paragraph", text: "A second paragraph adds context, background, and a little more depth for the story." }
    ],
    textLength: 560,
    paragraphCount: 2,
    headingCount: 1,
    linkDensity: 0.68,
    boilerplatePenalty: 28,
    structureBonus: 4
  });

  assert.equal(snapshot.readable, true);
  assert.equal(snapshot.siteName, "BBC News");
  assert.equal(snapshot.byline, "BBC News");
});
