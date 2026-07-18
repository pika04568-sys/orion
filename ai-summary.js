/**
 * AI Summary Main Process Service
 * Manages the Electron utility process for model download and inference.
 */
const fs = require("node:fs/promises");
const path = require("node:path");

function getElectronApp() {
  return require("electron").app;
}

let worker = null;
let currentResolve = null;
let currentReject = null;
let activeRequest = null;
let idleTimeout = null;

const requestQueue = [];
let processing = false;

// Global model status
const modelStatus = {
  state: "missing", // "missing" | "downloading" | "ready" | "error"
  modelId: "onnx-community/Qwen3-0.6B-Instruct-ONNX",
  progress: 0,
  loadedBytes: 0,
  totalBytes: 0,
  error: null
};

function buildSummaryResult(snapshot, summary, mode, reasonText) {
  return {
    ok: true,
    requestId: require("crypto").randomUUID(),
    title: snapshot.title || "",
    siteName: snapshot.siteName || "",
    sourceUrl: snapshot.sourceUrl || "",
    sourceType: snapshot.sourceType || "page",
    summary: summary,
    mode,
    localOnly: true,
    readingTimeMinutes: calculateReadingTime(snapshot),
    ...(reasonText ? { reason: reasonText } : {})
  };
}

// Tracks individual files being downloaded to compute total progress
const fileProgress = new Map();

function logMessage(msg, err) {
  console.log(`[AI Summary] ${msg}`, err ? err : "");
}

// Emits status changed event to all open browser windows
function emitStatusChanged() {
  const { BrowserWindow } = require("electron");
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send("ai-model-status-changed", { ...modelStatus });
    }
  }
}

// Reset the worker idle timer
function resetIdleTimeout() {
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  if (modelStatus.state === "downloading") return;

  idleTimeout = setTimeout(() => {
    if (worker) {
      logMessage("Idle timeout reached. Terminating utility worker process.");
      worker.kill();
      worker = null;
    }
  }, 120000); // 2 minutes idle period
}

// Spawn the utility process
function getWorker(cacheDir) {
  if (worker) {
    resetIdleTimeout();
    return worker;
  }

  logMessage("Spawning utility process worker");
  const { utilityProcess } = require("electron");
  
  // Utility worker script is compiled to the same directory (.build) as main.cjs
  const workerPath = path.join(__dirname, "ai-summary-worker.js");
  worker = utilityProcess.fork(workerPath);

  worker.on("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    resetIdleTimeout();

    switch (msg.type) {
      case "log":
        logMessage(`Worker Log: ${msg.message}`, msg.error);
        break;

      case "download-progress":
        handleWorkerDownloadProgress(msg);
        break;

      case "ready":
        modelStatus.state = "ready";
        modelStatus.progress = 100;
        modelStatus.error = null;
        emitStatusChanged();
        break;

      case "error":
        modelStatus.state = "error";
        modelStatus.error = msg.error;
        emitStatusChanged();
        if (currentReject) {
          currentReject(new Error(msg.error));
        }
        break;

      case "summary-result":
        if (currentResolve) {
          currentResolve(msg.summary);
        }
        clearActiveRequest();
        break;

      case "generation-error":
        if (currentReject) {
          currentReject(new Error(msg.error));
        }
        clearActiveRequest();
        break;
    }
  });

  worker.on("exit", (code) => {
    logMessage(`Worker exited with code ${code}`);
    worker = null;
    if (modelStatus.state === "downloading") {
      modelStatus.state = "error";
      modelStatus.error = "Model download was interrupted.";
      emitStatusChanged();
    }
    if (currentReject) {
      currentReject(new Error("Worker terminated."));
    }
    clearActiveRequest();
  });

  worker.postMessage({ type: "init", cacheDir });
  resetIdleTimeout();

  return worker;
}

function handleWorkerDownloadProgress(msg) {
  fileProgress.set(msg.file, {
    loaded: msg.loaded,
    total: msg.total || 0
  });

  let totalLoaded = 0;
  let totalBytes = 0;
  for (const p of fileProgress.values()) {
    totalLoaded += p.loaded;
    totalBytes += p.total;
  }

  // Fallback to approximate total size if files don't report total size yet
  if (totalBytes < 900000000) {
    totalBytes = 997000000;
  }

  modelStatus.state = "downloading";
  modelStatus.loadedBytes = totalLoaded;
  modelStatus.totalBytes = totalBytes;
  modelStatus.progress = Math.min(99, Math.round((totalLoaded / totalBytes) * 100));
  modelStatus.error = null;

  emitStatusChanged();
}

function clearActiveRequest() {
  currentResolve = null;
  currentReject = null;
}

async function findFileNamed(dir, fileName) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await findFileNamed(fullPath, fileName);
        if (found) return true;
      } else if (entry.isFile() && entry.name === fileName) {
        const stat = await fs.stat(fullPath);
        if (stat.size > 900000000) { // Check size is >900MB
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

async function checkModelDownloaded(cacheDir) {
  const modelDir = path.join(cacheDir, "models--onnx-community--Qwen3-0.6B-Instruct-ONNX");
  try {
    await fs.access(modelDir);
    return await findFileNamed(modelDir, "model_q4.onnx");
  } catch (e) {
    return false;
  }
}

// Public API
async function getAiModelStatus() {
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  const isDownloaded = await checkModelDownloaded(cacheDir);
  if (isDownloaded) {
    modelStatus.state = "ready";
    modelStatus.progress = 100;
    modelStatus.error = null;
  } else if (modelStatus.state === "ready") {
    modelStatus.state = "missing";
    modelStatus.progress = 0;
  }
  return { ...modelStatus };
}

async function cancelAiModelDownload() {
  logMessage("Cancelling model download and cleaning cache folder");
  if (worker) {
    worker.kill();
    worker = null;
  }

  modelStatus.state = "missing";
  modelStatus.progress = 0;
  modelStatus.loadedBytes = 0;
  modelStatus.totalBytes = 0;
  modelStatus.error = null;
  fileProgress.clear();
  emitStatusChanged();

  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  const modelDir = path.join(cacheDir, "models--onnx-community--Qwen3-0.6B-Instruct-ONNX");
  try {
    await fs.rm(modelDir, { recursive: true, force: true });
    logMessage("Cleaned up partial model directory successfully");
  } catch (e) {
    logMessage("Error cleaning model directory", e);
  }
}

async function removeAiModel() {
  logMessage("Removing model files");
  await cancelAiModelDownload();
}

async function summarizeSnapshot(snapshot) {
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  const isDownloaded = await checkModelDownloaded(cacheDir);

  if (isDownloaded) {
    modelStatus.state = "ready";
    modelStatus.progress = 100;
  }

  if (modelStatus.state !== "ready") {
    if (modelStatus.state !== "downloading") {
      logMessage("Model not ready. Initiating download automatically.");
      getWorker(cacheDir); // Spawns worker and starts download
    }
    logMessage("Model is downloading. Returning deterministic fallback summary.");
    return runFallbackSummary(snapshot, "Model is downloading.");
  }

  return new Promise((resolve) => {
    queueRequest(snapshot, resolve);
  });
}

function cancelPageSummary() {
  logMessage("Cancelling current page summary request");
  if (worker) {
    worker.postMessage({ type: "cancel" });
  }
  if (currentReject) {
    currentReject(new Error("cancelled"));
  }
  clearActiveRequest();
}

function queueRequest(snapshot, resolve) {
  requestQueue.push({ snapshot, resolve });
  processNextRequest();
}

async function processNextRequest() {
  if (processing || requestQueue.length === 0) return;
  processing = true;

  const req = requestQueue.shift();
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");

  try {
    const w = getWorker(cacheDir);
    const prompt = buildMultilingualPrompt(req.snapshot);

    const summary = await runWorkerInference(w, prompt);
    const isValid = validateSummaryOutput(summary, req.snapshot);

    if (isValid) {
      req.resolve(buildSummaryResult(req.snapshot, summary, "model"));
    } else {
      logMessage("Generated summary failed output validation. Returning fallback.");
      req.resolve(runFallbackSummary(req.snapshot, "Output validation failed."));
    }
  } catch (error) {
    logMessage("Inference error or cancelled. Returning fallback.", error);
    req.resolve(runFallbackSummary(req.snapshot, error.message));
  } finally {
    processing = false;
    processNextRequest();
  }
}

function runWorkerInference(w, prompt) {
  return new Promise((resolve, reject) => {
    currentResolve = resolve;
    currentReject = reject;
    w.postMessage({
      type: "summarize",
      prompt,
      maxNewTokens: 120,
      timeoutMs: 30000
    });
  });
}

// Multilingual Prompt & Diversity Scoring Implementation
function buildMultilingualPrompt(snapshot) {
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  const allSentences = [];

  blocks.forEach((b) => {
    if (b && b.text && b.type !== "heading") {
      const split = b.text.match(/[^.!?。！？\n]+(?:[.!?。！？\n]+|$)/g) || [b.text];
      split.forEach((s) => {
        const clean = s.trim().replace(/\s+/g, " ");
        if (clean.length > 15) {
          allSentences.push(clean);
        }
      });
    }
  });

  let selected = [];
  if (allSentences.length <= 15) {
    selected = allSentences;
  } else {
    const zoneSize = Math.floor(allSentences.length / 3);
    const zones = [
      allSentences.slice(0, zoneSize),
      allSentences.slice(zoneSize, zoneSize * 2),
      allSentences.slice(zoneSize * 2)
    ];

    const globalFreqs = new Map();
    allSentences.forEach((s) => {
      tokenizeMultilingual(s).forEach((t) => globalFreqs.set(t, (globalFreqs.get(t) || 0) + 1));
    });

    const coveredTokens = new Set();

    zones.forEach((zone) => {
      const zoneSelected = [];
      for (let step = 0; step < 4; step++) {
        let bestSentence = null;
        let bestScore = -1;

        for (const s of zone) {
          if (zoneSelected.includes(s)) continue;
          const tokens = tokenizeMultilingual(s);
          if (tokens.length === 0) continue;

          let baseScore = 0;
          let overlapCount = 0;
          tokens.forEach((t) => {
            baseScore += 1 / (globalFreqs.get(t) || 1);
            if (coveredTokens.has(t)) overlapCount++;
          });

          baseScore = baseScore / tokens.length;
          const penalty = tokens.length > 0 ? (1 - overlapCount / tokens.length) : 0;
          const score = baseScore * penalty;

          if (score > bestScore) {
            bestScore = score;
            bestSentence = s;
          }
        }

        if (bestSentence) {
          zoneSelected.push(bestSentence);
          tokenizeMultilingual(bestSentence).forEach((t) => coveredTokens.add(t));
        }
      }
      selected.push(...zoneSelected);
    });
  }

  const sentenceIndexMap = new Map(allSentences.map((s, idx) => [s, idx]));
  selected.sort((a, b) => sentenceIndexMap.get(a) - sentenceIndexMap.get(b));

  const textToSummarize = selected.join(" ");

  const systemPrompt = `You are a helpful assistant. Write a summary of the provided text.
Requirements:
1. Write exactly ONE paragraph of 40 to 70 words.
2. Write the summary in the same language as the text.
3. Do NOT use markdown (no bold, no italics, no bullet points).
4. Do NOT output any thinking process, <think> tags, or explanations. Only output the summary paragraph.
5. Do NOT include any HTML, URLs, or unsupported formatting.`;

  const userPrompt = `Source text:
${textToSummarize}

Summary:`;

  return `<|im_start|>system
${systemPrompt}<|im_end|>
<|im_start|>user
${userPrompt}<|im_end|>
<|im_start|>assistant
`;
}

function tokenizeMultilingual(text) {
  if (!text) return [];
  const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;
  const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const cjks = text.match(cjkRegex) || [];
  return [...words, ...cjks];
}

// Output Validation
function validateSummaryOutput(summary, snapshot) {
  if (!summary || typeof summary !== "string") return false;
  const trimmed = summary.trim();
  if (!trimmed) return false;

  if (/[*_#`\[\]]/.test(trimmed)) {
    logMessage("Validation: Contains markdown formatting.");
    return false;
  }
  if (/<[^>]+>/.test(trimmed)) {
    logMessage("Validation: Contains HTML tags.");
    return false;
  }
  if (trimmed.includes("\n")) {
    logMessage("Validation: Contains newlines (not a single paragraph).");
    return false;
  }
  if (/https?:\/\/[^\s]+/.test(trimmed) || /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(trimmed)) {
    logMessage("Validation: Contains URLs or emails.");
    return false;
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 5) {
    const uniqueWords = new Set(words);
    const ratio = uniqueWords.size / words.length;
    if (ratio < 0.55) {
      logMessage(`Validation: Too repetitive (${ratio.toFixed(2)})`);
      return false;
    }
  }

  const isCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(trimmed);
  const count = isCJK ? trimmed.replace(/\s+/g, "").length : trimmed.split(/\s+/).filter(Boolean).length;
  
  const minLimit = isCJK ? 80 : 40;
  const maxLimit = isCJK ? 240 : 70;
  if (count < minLimit || count > maxLimit) {
    logMessage(`Validation: Length out of bounds (${count}). CJK=${isCJK}`);
    return false;
  }

  const summarySentences = trimmed.match(/[^.!?。！？\n]+(?:[.!?。！？\n]+|$)/g) || [trimmed];
  const sourceBlocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  const sourceSentences = [];
  sourceBlocks.forEach((b) => {
    if (b && b.text) {
      const split = b.text.match(/[^.!?。！？\n]+(?:[.!?。！？\n]+|$)/g) || [b.text];
      split.forEach((s) => sourceSentences.push(s.trim().toLowerCase()));
    }
  });

  for (const ss of summarySentences) {
    const cleanSs = ss.trim().toLowerCase();
    if (cleanSs.length < 10) continue;
    for (const os of sourceSentences) {
      if (os.length < 10) continue;
      const tokensSs = new Set(tokenizeMultilingual(cleanSs));
      const tokensOs = new Set(tokenizeMultilingual(os));
      if (tokensSs.size === 0 || tokensOs.size === 0) continue;

      let intersection = 0;
      tokensSs.forEach((t) => { if (tokensOs.has(t)) intersection++; });
      const similarity = intersection / Math.min(tokensSs.size, tokensOs.size);
      if (similarity > 0.85) {
        logMessage(`Validation: Sentence copies source too closely (${similarity.toFixed(2)})`);
        return false;
      }
    }
  }

  return true;
}

// Fallback sentence ranker
const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be", "because", "been",
  "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "more", "new", "not", "of", "on", "one",
  "or", "our", "out", "over", "said", "say", "she", "so", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "to", "up", "was", "we", "were", "what", "when", "which",
  "who", "will", "with", "would", "you", "your"
]);

function tokenize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function calculateReadingTime(snapshot) {
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  let wordCount = 0;
  blocks.forEach((b) => {
    if (b && b.text) {
      wordCount += b.text.split(/\s+/).filter(Boolean).length;
    }
  });
  return Math.max(1, Math.ceil(wordCount / 220));
}

function runFallbackSummary(snapshot, reasonText) {
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  const sentences = [];
  blocks.forEach((b) => {
    if (b && b.text && b.type !== "heading") {
      const split = b.text.match(/[^.!?。！？\n]+(?:[.!?。！？\n]+|$)/g) || [b.text];
      split.forEach((s) => {
        const clean = s.trim().replace(/\s+/g, " ");
        if (clean.length >= 45 && clean.length <= 260) {
          sentences.push(clean);
        }
      });
    }
  });

  let selectedSentences = [];
  if (sentences.length < 2) {
    selectedSentences = sentences;
  } else {
    const freqs = new Map();
    sentences.forEach((s) => {
      tokenize(s).forEach((t) => freqs.set(t, (freqs.get(t) || 0) + 1));
    });

    const scored = sentences.map((s, idx) => {
      const tokens = tokenize(s);
      if (!tokens.length) return { s, score: 0, idx };
      const fScore = tokens.reduce((acc, t) => acc + Math.min(4, freqs.get(t) || 0), 0) / tokens.length;
      const leadScore = Math.max(0, 1.5 - (idx / sentences.length) * 1.5);
      return { s, score: fScore + leadScore, idx };
    });

    scored.sort((a, b) => b.score - a.score);

    const selected = [];
    for (const item of scored) {
      if (selected.length >= 3) break;
      const tooSimilar = selected.some((sel) => {
        const t1 = new Set(tokenize(item.s));
        const t2 = new Set(tokenize(sel));
        let overlap = 0;
        t1.forEach((t) => { if (t2.has(t)) overlap++; });
        return t1.size > 0 && (overlap / Math.min(t1.size, t2.size)) > 0.7;
      });
      if (!tooSimilar) selected.push(item.s);
    }
    selectedSentences = selected;
  }

  const paragraph = selectedSentences.join(" ");

  return {
    ok: paragraph.length > 20,
    requestId: require("crypto").randomUUID(),
    title: snapshot.title || "",
    siteName: snapshot.siteName || "",
    sourceUrl: snapshot.sourceUrl || "",
    sourceType: snapshot.sourceType || "page",
    summary: paragraph || "This page does not contain enough text to summarize.",
    mode: "fallback",
    localOnly: true,
    readingTimeMinutes: calculateReadingTime(snapshot),
    reason: reasonText
  };
}

module.exports = {
  getAiModelStatus,
  cancelAiModelDownload,
  removeAiModel,
  summarizeSnapshot,
  cancelPageSummary,
  buildSummaryResult,
  runFallbackSummary,
  validateSummaryOutput
};
