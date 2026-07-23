const MODEL_DEFINITIONS = Object.freeze({
  standard: Object.freeze({
    key: "standard",
    modelId: "onnx-community/Qwen3-0.6B-Instruct-ONNX",
    revision: "54250909aca286a05b9d013c8af7a21859ee6ead",
    dtype: "q4",
    modelFile: "model_q4.onnx",
    minimumBytes: 900000000,
    cacheDirectory: "models--onnx-community--Qwen3-0.6B-Instruct-ONNX",
    labelKey: "settings.aiModelStandard"
  }),
  lite: Object.freeze({
    key: "lite",
    modelId: "onnx-community/SmolLM2-360M-ONNX",
    revision: "539c1088be2dcd673c39059d25a6bc4aec625504",
    dtype: "q4",
    modelFile: "model_q4.onnx",
    minimumBytes: 250000000,
    cacheDirectory: "models--onnx-community--SmolLM2-360M-ONNX",
    labelKey: "settings.aiModelLite"
  })
});

const DEFAULT_MODEL_KEY = "standard";

function normalizeModelKey(value) {
  return Object.prototype.hasOwnProperty.call(MODEL_DEFINITIONS, value)
    ? value
    : DEFAULT_MODEL_KEY;
}

function getModelDefinition(value) {
  return MODEL_DEFINITIONS[normalizeModelKey(value)];
}

module.exports = {
  DEFAULT_MODEL_KEY,
  MODEL_DEFINITIONS,
  getModelDefinition,
  normalizeModelKey
};
