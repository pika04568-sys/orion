/**
 * AI Summary Utility Process Worker
 * Runs the selected local ONNX model for download and inference.
 */
const { pipeline, env } = require("@huggingface/transformers");

let generator = null;
let currentAbortController = null;
let modelLoadingPromise = null;
let modelConfig = null;

// Send logs to parent port
function log(msg, err) {
  process.parentPort.postMessage({
    type: "log",
    message: msg,
    error: err ? err.stack || err.message || String(err) : undefined
  });
}

// Receive messages from main process
process.parentPort.on("message", async (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "init":
    case "download":
      handleInit(msg.cacheDir, msg.model);
      break;

    case "summarize":
      handleGenerate(msg.prompt, msg.cacheDir, msg.maxNewTokens, msg.timeoutMs, "summary-result");
      break;

    case "answer":
      handleGenerate(msg.prompt, msg.cacheDir, msg.maxNewTokens, msg.timeoutMs, "answer-result");
      break;

    case "cancel":
      handleCancel();
      break;

    default:
      log("Unknown message type in worker: " + msg.type);
  }
});

async function handleInit(cacheDir, nextModelConfig = modelConfig) {
  try {
    if (modelLoadingPromise) {
      await modelLoadingPromise;
      return;
    }

    modelLoadingPromise = (async () => {
      env.cacheDir = cacheDir;
      // Do not use local models only, since we need to download it
      env.allowLocalModels = false;

      modelConfig = nextModelConfig || modelConfig;
      if (!modelConfig || !modelConfig.modelId || !modelConfig.revision) {
        throw new Error("Missing AI model configuration.");
      }
      const modelId = modelConfig.modelId;
      const revision = modelConfig.revision;

      log(`Starting model loading for ${modelId} (revision: ${revision})`);

      const options = {
        revision,
        dtype: modelConfig.dtype || "q4",
        progress_callback: (progressEvent) => {
          if (progressEvent.status === "downloading" || progressEvent.status === "done" || progressEvent.status === "ready") {
            process.parentPort.postMessage({
              type: "download-progress",
              file: progressEvent.file,
              loaded: progressEvent.loaded || 0,
              total: progressEvent.total || 0,
              status: progressEvent.status
            });
          }
        }
      };

      // Try WebGPU first, then WASM
      try {
        log("Attempting WebGPU inference");
        const pipe = await pipeline("text-generation", modelId, {
          ...options,
          device: "webgpu"
        });
        generator = pipe;
        log("Model loaded successfully using WebGPU");
        process.parentPort.postMessage({ type: "ready", device: "webgpu" });
      } catch (webgpuError) {
        log("WebGPU failed, attempting WASM/CPU fallback", webgpuError);
        try {
          const pipe = await pipeline("text-generation", modelId, {
            ...options,
            device: "wasm"
          });
          generator = pipe;
          log("Model loaded successfully using WASM/CPU");
          process.parentPort.postMessage({ type: "ready", device: "wasm" });
        } catch (wasmError) {
          log("WASM/CPU fallback failed", wasmError);
          process.parentPort.postMessage({
            type: "error",
            error: "Failed to initialize both WebGPU and WASM/CPU: " + wasmError.message
          });
          modelLoadingPromise = null;
        }
      }
    })();

    await modelLoadingPromise;
  } catch (error) {
    log("Error during handleInit", error);
    process.parentPort.postMessage({ type: "error", error: error.message });
    modelLoadingPromise = null;
  }
}

async function handleGenerate(prompt, cacheDir, maxNewTokens = 120, timeoutMs = 30000, resultType = "summary-result") {
  let timeout = null;
  try {
    if (!generator) {
      log("Generator not ready, initializing now");
      await handleInit(cacheDir, modelConfig);
      if (!generator) {
        throw new Error("Model is not initialized and failed to load.");
      }
    }

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    // Build-in generation timeout
    timeout = setTimeout(() => {
      if (currentAbortController) {
        log("Generation timed out in worker, aborting");
        currentAbortController.abort();
      }
    }, timeoutMs);

    log("Starting text generation");
    const result = await generator(prompt, {
      max_new_tokens: maxNewTokens,
      signal,
      temperature: 0.3,
      top_p: 0.9,
      do_sample: false
    });

    clearTimeout(timeout);
    timeout = null;
    currentAbortController = null;

    if (!result || !result[0] || typeof result[0].generated_text !== "string") {
      throw new Error("Invalid output structure from generator");
    }

    const generatedText = result[0].generated_text;
    
    // Parse response
    const assistantMarker = "<|im_start|>assistant";
    const markerIndex = generatedText.lastIndexOf(assistantMarker);
    let outputText = generatedText;
    if (markerIndex !== -1) {
      outputText = generatedText.slice(markerIndex + assistantMarker.length);
    }

    // Strip thinking block
    outputText = outputText.replace(/<think>[\s\S]*?<\/think>/gi, "");
    outputText = outputText.replace(/<think>[\s\S]*/gi, ""); // strip unclosed thinking blocks
    outputText = outputText.replace(/<\|im_end\|>/gi, "").replace(/<\|endoftext\|>/gi, "").trim();

    log("Generation completed successfully");
    process.parentPort.postMessage({
      type: resultType,
      summary: outputText
    });
  } catch (error) {
    log("Generation failed or aborted", error);
    process.parentPort.postMessage({
      type: "generation-error",
      error: error.name === "AbortError" ? "cancelled" : error.message
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    currentAbortController = null;
  }
}

function handleCancel() {
  if (currentAbortController) {
    log("Aborting active generation due to cancel message");
    currentAbortController.abort();
    currentAbortController = null;
  }
}
