const fs = require("node:fs");
const path = require("node:path");

const EMPTY = Symbol("empty");

function createCoalescedAtomicWriter(options = {}) {
  const filePath = options.filePath;
  if (!filePath) throw new Error("createCoalescedAtomicWriter requires a filePath");

  const fsPromises = options.fsPromises || fs.promises;
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : 100;
  const serialize = typeof options.serialize === "function"
    ? options.serialize
    : (value) => JSON.stringify(value);
  let pending = EMPTY;
  let timer = null;
  let flushing = null;
  let writeSequence = 0;

  async function writeAtomically(value) {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${writeSequence += 1}`;
    await fsPromises.mkdir(directory, { recursive: true });
    await fsPromises.writeFile(temporaryPath, serialize(value), "utf8");
    await fsPromises.rename(temporaryPath, filePath);
  }

  async function drain() {
    while (pending !== EMPTY) {
      const resolveValue = pending;
      pending = EMPTY;
      const value = resolveValue();
      await writeAtomically(value);
    }
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (flushing) return flushing;
    flushing = drain().finally(() => {
      flushing = null;
      if (pending !== EMPTY) void flush();
    });
    return flushing;
  }

  function scheduleFactory(factory) {
    if (typeof factory !== "function") {
      throw new TypeError("scheduleFactory requires a function");
    }
    pending = factory;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function schedule(value) {
    scheduleFactory(() => value);
  }

  async function read(fallback = null) {
    try {
      return JSON.parse(await fsPromises.readFile(filePath, "utf8"));
    } catch (_error) {
      return fallback;
    }
  }

  async function remove() {
    pending = EMPTY;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (flushing) await flushing.catch(() => {});
    try {
      await fsPromises.unlink(filePath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }

  return {
    flush,
    hasPending: () => pending !== EMPTY || !!timer || !!flushing,
    read,
    remove,
    schedule,
    scheduleFactory
  };
}

module.exports = { createCoalescedAtomicWriter };
