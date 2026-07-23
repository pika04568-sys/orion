const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_MODEL_KEY,
  MODEL_DEFINITIONS,
  getModelDefinition,
  normalizeModelKey
} = require("../ai-models");

test("AI model registry keeps Standard as the default and exposes SmolLM Lite", () => {
  assert.equal(DEFAULT_MODEL_KEY, "standard");
  assert.equal(getModelDefinition("standard").modelId, "onnx-community/Qwen3-0.6B-Instruct-ONNX");
  assert.equal(getModelDefinition("lite").modelId, "onnx-community/SmolLM2-360M-ONNX");
  assert.equal(getModelDefinition("lite").modelFile, "model_q4.onnx");
  assert.ok(getModelDefinition("lite").revision);
  assert.ok(getModelDefinition("lite").minimumBytes < getModelDefinition("standard").minimumBytes);
});

test("AI model selection normalizes missing and invalid persisted values", () => {
  assert.equal(normalizeModelKey(undefined), "standard");
  assert.equal(normalizeModelKey("unknown"), "standard");
  assert.equal(normalizeModelKey("lite"), "lite");
  assert.deepEqual(Object.keys(MODEL_DEFINITIONS), ["standard", "lite"]);
});
