const test = require("node:test");
const assert = require("node:assert/strict");

const aiSummary = require("../ai-summary");

test("on-device summary extracts concise points from reader snapshots", () => {
  const summary = aiSummary.summarizeSnapshot({
    title: "Orion adds private local summaries",
    siteName: "Example News",
    sourceUrl: "https://example.com/orion-summary",
    readable: true,
    blocks: [
      { type: "heading", text: "Orion adds private local summaries for long articles" },
      { type: "paragraph", text: "Orion now extracts readable article text locally before creating a summary, which keeps the original page content on the user's device." },
      { type: "paragraph", text: "The browser scores sentences by repeated topical terms, title matches, and the position of each sentence in the article." },
      { type: "paragraph", text: "The feature returns a small set of distinct bullet points so readers can scan the page before opening reader mode or continuing through the full story." },
      { type: "paragraph", text: "Pages without enough readable text return a clear unavailable state instead of sending content to a remote service." }
    ]
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.localOnly, true);
  assert.ok(summary.bullets.length >= 2);
  assert.ok(summary.bullets.length <= 4);
  assert.equal(summary.title, "Orion adds private local summaries");
});

test("on-device summary rejects pages without enough text", () => {
  const summary = aiSummary.summarizeSnapshot({
    title: "Tiny",
    blocks: [
      { type: "paragraph", text: "Short text." }
    ]
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(summary.bullets, []);
});
