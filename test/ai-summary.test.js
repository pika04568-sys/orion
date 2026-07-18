const test = require("node:test");
const assert = require("node:assert/strict");

const aiSummary = require("../ai-summary");

test("fallback summaries become a single paragraph with a reason", () => {
  const snapshot = {
    title: "Example page",
    siteName: "Example",
    sourceUrl: "https://example.com",
    sourceType: "page",
    blocks: [
      { type: "paragraph", text: "This page explains a clear topic with practical detail for readers who want a useful overview." },
      { type: "paragraph", text: "It also includes concrete examples so the summary remains concise and informative." }
    ]
  };

  const result = aiSummary.runFallbackSummary(snapshot, "Model unavailable");

  assert.equal(result.ok, true);
  assert.equal(result.mode, "fallback");
  assert.equal(result.reason, "Model unavailable");
  assert.equal(result.summary.includes("\n"), false);
  assert.match(result.summary, /\w/);
});

test("validation rejects markdown and copied-source output", () => {
  const snapshot = {
    blocks: [
      { type: "paragraph", text: "This article describes a product launch and why the new release matters for everyday users." },
      { type: "paragraph", text: "The launch also introduces new features that help teams work faster and stay organized." }
    ]
  };

  assert.equal(aiSummary.validateSummaryOutput("**bad** markdown output", snapshot), false);
  assert.equal(aiSummary.validateSummaryOutput("This article describes a product launch and why the new release matters for everyday users.", snapshot), false);
  assert.equal(aiSummary.validateSummaryOutput("A concise summary captures the main point while avoiding direct quotation and preserving a fresh perspective for readers who need a clear overview of the topic without copying the source wording or repeating the same phrases too often in a way that feels natural and helpful.", snapshot), true);
});
