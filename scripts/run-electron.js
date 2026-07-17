const { spawn } = require("node:child_process");
const os = require("node:os");
const { stageElectronExecutable } = require("./electron-executable");

const electronPath = stageElectronExecutable();
const args = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, {
  env,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (!signal) {
    process.exitCode = code == null ? 1 : code;
    return;
  }
  const signalNumber = os.constants.signals[signal];
  process.exitCode = Number.isInteger(signalNumber) ? 128 + signalNumber : 1;
  process.removeAllListeners(signal);
  try {
    process.kill(process.pid, signal);
  } catch (_error) { }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
