/**
 * AI Summary Main Process Service
 * Manages the Electron utility process for model download and inference.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  DEFAULT_MODEL_KEY,
  MODEL_DEFINITIONS,
  getModelDefinition,
  normalizeModelKey
} = require("./ai-models");

function getElectronApp() {
  return require("electron").app;
}

let worker = null;
let workerModelKey = null;
let currentResolve = null;
let currentReject = null;
let activeRequest = null;
let idleTimeout = null;

const requestQueue = [];
let processing = false;
let selectedModelKey = DEFAULT_MODEL_KEY;
const MAX_PROMPT_CHARS = 12000;
const MAX_GENERATION_TOKENS = 160;
const GENERATION_TIMEOUT_MS = 30000;

const modelStatuses = Object.fromEntries(Object.keys(MODEL_DEFINITIONS).map((key) => [key, {
  key,
  state: "missing",
  modelId: MODEL_DEFINITIONS[key].modelId,
  progress: 0,
  loadedBytes: 0,
  totalBytes: 0,
  error: null
}]));

function getSelectedModel() {
  return getModelDefinition(selectedModelKey);
}

function getSelectedStatus() {
  return modelStatuses[selectedModelKey];
}

function getPublicStatus() {
  return {
    ...getSelectedStatus(),
    selectedModelKey,
    models: Object.values(modelStatuses).map((status) => ({ ...status }))
  };
}

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
      win.webContents.send("ai-model-status-changed", getPublicStatus());
    }
  }
}

// Reset the worker idle timer
function resetIdleTimeout() {
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  if (getSelectedStatus().state === "downloading") return;

  idleTimeout = setTimeout(() => {
    if (worker) {
      logMessage("Idle timeout reached. Terminating utility worker process.");
      worker.kill();
      worker = null;
    }
  }, 120000); // 2 minutes idle period
}

// Spawn the utility process
function getWorker(cacheDir, modelKey = selectedModelKey) {
  if (worker && workerModelKey !== modelKey) {
    logMessage(`Switching worker from ${workerModelKey} to ${modelKey}`);
    if (currentReject) currentReject(new Error("AI model changed."));
    worker.kill();
    worker = null;
    workerModelKey = null;
    clearActiveRequest();
  }
  if (worker) {
    resetIdleTimeout();
    return worker;
  }

  logMessage("Spawning utility process worker");
  const { utilityProcess } = require("electron");
  
  // Utility worker script is compiled to the same directory (.build) as main.cjs
  const workerPath = path.join(__dirname, "ai-summary-worker.js");
  const instance = utilityProcess.fork(workerPath);
  worker = instance;
  workerModelKey = modelKey;

  worker.on("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    if (worker !== instance) return;
    resetIdleTimeout();

    switch (msg.type) {
      case "log":
        logMessage(`Worker Log: ${msg.message}`, msg.error);
        break;

      case "download-progress":
        handleWorkerDownloadProgress(msg);
        break;

      case "ready": {
        const status = modelStatuses[modelKey];
        status.state = "ready";
        status.progress = 100;
        status.error = null;
        emitStatusChanged();
        break;
      }

      case "error": {
        const errorStatus = modelStatuses[modelKey];
        errorStatus.state = "error";
        errorStatus.error = msg.error;
        emitStatusChanged();
        if (currentReject) {
          currentReject(new Error(msg.error));
        }
        break;
      }

      case "summary-result":
        if (currentResolve) {
          currentResolve(msg.summary);
        }
        clearActiveRequest();
        break;

      case "answer-result":
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
    if (worker !== instance) return;
    logMessage(`Worker exited with code ${code}`);
    worker = null;
    workerModelKey = null;
    if (getSelectedStatus().state === "downloading") {
      getSelectedStatus().state = "error";
      getSelectedStatus().error = "Model download was interrupted.";
      emitStatusChanged();
    }
    if (currentReject) {
      currentReject(new Error("Worker terminated."));
    }
    clearActiveRequest();
  });

  fileProgress.clear();
  worker.postMessage({ type: "init", cacheDir, model: getModelDefinition(modelKey) });
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
  if (totalBytes < 250000000) {
    totalBytes = getModelDefinition(workerModelKey || selectedModelKey).minimumBytes;
  }

  const status = modelStatuses[workerModelKey || selectedModelKey];
  status.state = "downloading";
  status.loadedBytes = totalLoaded;
  status.totalBytes = totalBytes;
  status.progress = Math.min(99, Math.round((totalLoaded / totalBytes) * 100));
  status.error = null;

  emitStatusChanged();
}

function clearActiveRequest() {
  currentResolve = null;
  currentReject = null;
}

async function findFileNamed(dir, fileName, minimumBytes) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await findFileNamed(fullPath, fileName, minimumBytes);
        if (found) return true;
      } else if (entry.isFile() && entry.name === fileName) {
        const stat = await fs.stat(fullPath);
        if (stat.size > minimumBytes) {
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

async function checkModelDownloaded(cacheDir, modelKey = selectedModelKey) {
  const model = getModelDefinition(modelKey);
  const modelDir = path.join(cacheDir, model.cacheDirectory);
  try {
    await fs.access(modelDir);
    return await findFileNamed(modelDir, model.modelFile, model.minimumBytes);
  } catch (e) {
    return false;
  }
}

// Public API
async function getAiModelStatus() {
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  await Promise.all(Object.keys(MODEL_DEFINITIONS).map(async (key) => {
    const status = modelStatuses[key];
    const isDownloaded = await checkModelDownloaded(cacheDir, key);
    if (isDownloaded) {
      status.state = "ready";
      status.progress = 100;
      status.error = null;
    } else if (status.state === "ready") {
      status.state = "missing";
      status.progress = 0;
    }
  }));
  if (workerModelKey && workerModelKey !== selectedModelKey) {
    getWorker(cacheDir, selectedModelKey);
  }
  return getPublicStatus();
}

async function cancelAiModelDownload(modelKey = selectedModelKey, removeFiles = true) {
  const normalizedKey = normalizeModelKey(modelKey);
  logMessage("Cancelling model download and cleaning cache folder");
  if (worker && workerModelKey === normalizedKey) {
    if (currentReject) currentReject(new Error("AI model download cancelled."));
    worker.kill();
    worker = null;
    workerModelKey = null;
  }

  const status = modelStatuses[normalizedKey];
  status.state = "missing";
  status.progress = 0;
  status.loadedBytes = 0;
  status.totalBytes = 0;
  status.error = null;
  fileProgress.clear();
  emitStatusChanged();

  if (!removeFiles) return getPublicStatus();
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  const modelDir = path.join(cacheDir, getModelDefinition(normalizedKey).cacheDirectory);
  try {
    await fs.rm(modelDir, { recursive: true, force: true });
    logMessage("Cleaned up partial model directory successfully");
  } catch (e) {
    logMessage("Error cleaning model directory", e);
  }
  return getPublicStatus();
}

async function removeAiModel(modelKey = selectedModelKey) {
  logMessage("Removing model files");
  await cancelAiModelDownload(modelKey);
}

async function redownloadAiModel(modelKey = selectedModelKey) {
  const normalizedKey = normalizeModelKey(modelKey);
  await cancelAiModelDownload(normalizedKey, true);
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  getWorker(cacheDir, normalizedKey);
  return getPublicStatus();
}

function setAiModelKey(modelKey) {
  const nextKey = normalizeModelKey(modelKey);
  if (nextKey === selectedModelKey) return getPublicStatus();
  if (worker) {
    if (currentReject) currentReject(new Error("AI model changed."));
    worker.kill();
    worker = null;
    workerModelKey = null;
  }
  clearActiveRequest();
  fileProgress.clear();
  selectedModelKey = nextKey;
  emitStatusChanged();
  return getPublicStatus();
}

async function summarizeSnapshot(snapshot) {
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  const isDownloaded = await checkModelDownloaded(cacheDir);

  if (isDownloaded) {
    getSelectedStatus().state = "ready";
    getSelectedStatus().progress = 100;
  }

  if (getSelectedStatus().state !== "ready") {
    if (getSelectedStatus().state !== "downloading") {
      logMessage("Model not ready. Initiating download automatically.");
      getWorker(cacheDir, selectedModelKey); // Spawns worker and starts download
    }
    logMessage("Model is downloading. Returning deterministic fallback summary.");
    return runFallbackSummary(snapshot, "Model is downloading.");
  }

  return new Promise((resolve) => {
    queueRequest(snapshot, resolve, "summary");
  });
}

async function answerSnapshot(snapshot, question) {
  const normalizedQuestion = String(question || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!normalizedQuestion) return { ok: false, reason: "Ask a question about this page." };

  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");
  const isDownloaded = await checkModelDownloaded(cacheDir);
  if (isDownloaded) {
    getSelectedStatus().state = "ready";
    getSelectedStatus().progress = 100;
  }
  if (getSelectedStatus().state !== "ready") {
    if (getSelectedStatus().state !== "downloading") getWorker(cacheDir, selectedModelKey);
    return { ok: false, reason: "The local model is still downloading. Try again when it is ready." };
  }

  return new Promise((resolve) => {
    queueRequest({ ...snapshot, question: normalizedQuestion }, resolve, "answer");
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
  while (requestQueue.length) {
    const queued = requestQueue.shift();
    if (queued && typeof queued.resolve === "function") {
      queued.resolve(runFallbackSummary(queued.snapshot, "cancelled"));
    }
  }
}

function queueRequest(snapshot, resolve, kind = "summary") {
  requestQueue.push({ snapshot, resolve, kind });
  processNextRequest();
}

async function processNextRequest() {
  if (processing || requestQueue.length === 0) return;
  processing = true;

  const req = requestQueue.shift();
  const cacheDir = path.join(getElectronApp().getPath("userData"), "ai-models");

  try {
    const w = getWorker(cacheDir, selectedModelKey);
    const prompt = req.kind === "answer"
      ? buildChatPrompt(req.snapshot, req.snapshot.question)
      : buildMultilingualPrompt(req.snapshot);

    const summary = await runWorkerInference(w, prompt, req.kind === "answer" ? "answer" : "summarize");
    const isValid = req.kind === "answer"
      ? validateChatOutput(summary)
      : validateSummaryOutput(summary, req.snapshot);

    if (isValid) {
      req.resolve(req.kind === "answer"
        ? buildChatResult(req.snapshot, summary)
        : buildSummaryResult(req.snapshot, summary, "model"));
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

function runWorkerInference(w, prompt, type = "summarize") {
  return new Promise((resolve, reject) => {
    currentResolve = resolve;
    currentReject = reject;
    w.postMessage({
      type,
      prompt,
      maxNewTokens: MAX_GENERATION_TOKENS,
      timeoutMs: GENERATION_TIMEOUT_MS
    });
  });
}

function buildChatResult(snapshot, answer) {
  return {
    ok: true,
    requestId: require("crypto").randomUUID(),
    sourceUrl: snapshot.sourceUrl || "",
    answer: String(answer || "").replace(/\s+/g, " ").trim(),
    localOnly: true,
    mode: "model"
  };
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

  const textToSummarize = selected.join(" ").slice(0, MAX_PROMPT_CHARS);

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

function buildChatPrompt(snapshot, question) {
  const summaryPrompt = buildMultilingualPrompt(snapshot);
  const sourceMatch = summaryPrompt.match(/Source text:\n([\s\S]*?)\n\nSummary:/);
  const sourceText = (sourceMatch ? sourceMatch[1] : "").slice(0, MAX_PROMPT_CHARS);
  const safeQuestion = String(question || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  return `<|im_start|>system
You answer questions about the provided webpage using only its content.
Requirements:
1. Answer in the same language as the question when possible.
2. If the answer is not supported by the page, say that the page does not provide enough information.
3. Do not invent facts, URLs, citations, or details.
4. Do not use markdown, HTML, or thinking tags. Keep the answer concise.
<|im_end|>
<|im_start|>user
Page content:
${sourceText}

Question:
${safeQuestion}
<|im_end|>
<|im_start|>assistant
`;
}

function validateChatOutput(answer) {
  if (!answer || typeof answer !== "string") return false;
  const trimmed = answer.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 4000) return false;
  if (/<[^>]+>/.test(trimmed) || /<think>|<\|im_/i.test(trimmed)) return false;
  return true;
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
  setAiModelKey,
  getAiModelStatus,
  cancelAiModelDownload,
  removeAiModel,
  redownloadAiModel,
  summarizeSnapshot,
  answerSnapshot,
  cancelPageSummary,
  buildSummaryResult,
  buildMultilingualPrompt,
  buildChatPrompt,
  validateChatOutput,
  runFallbackSummary,
  validateSummaryOutput
};
