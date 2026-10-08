// Jest globalSetup — runs in the REAL Node process (test files run in a sandboxed copy of `process`,
// which never sees Node's warnings). Records every MaxListenersExceededWarning and switches on the
// equivalent of `node --trace-warnings` so the report names the emitter and who added the listeners.
// warningGuard.teardown.js then fails the whole run if any were seen. This does NOT raise or hide
// the limit: the warning stays a failure until the listener accumulation is fixed at its source.
globalThis.__maxListenerWarnings = [];
process.traceProcessWarnings = true;
process.on("warning", (warning) => {
  if (warning.name !== "MaxListenersExceededWarning") return;
  globalThis.__maxListenerWarnings.push(
    `${warning.message}\n  emitter: ${warning.emitter && warning.emitter.constructor && warning.emitter.constructor.name} | event: ${String(warning.type)} | count: ${warning.count}\n${warning.stack}`
  );
});
module.exports = async () => {};
