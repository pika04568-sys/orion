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

test("model prompts remain bounded for large website documents", () => {
  const snapshot = {
    blocks: Array.from({ length: 80 }, (_, index) => ({
      type: "paragraph",
      text: `Section ${index} contains enough article content to be useful for a summary and avoids being discarded as a short navigation label. ` + "detail ".repeat(100)
    }))
  };

  const prompt = aiSummary.buildMultilingualPrompt(snapshot);
  assert.ok(prompt.length <= 15000);
  assert.match(prompt, /Only output the summary paragraph/);
});

test("page chat prompts include bounded context and validate safe answers", () => {
  const snapshot = {
    blocks: [{ type: "paragraph", text: "Orion is a local browser that summarizes pages on the device." }]
  };
  const prompt = aiSummary.buildChatPrompt(snapshot, "What does Orion do?");

  assert.match(prompt, /What does Orion do\?/);
  assert.match(prompt, /Orion is a local browser/);
  assert.equal(aiSummary.validateChatOutput("It summarizes pages on the device."), true);
  assert.equal(aiSummary.validateChatOutput("<think>secret</think>answer"), false);
});
