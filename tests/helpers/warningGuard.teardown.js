// Jest globalTeardown — see warningGuard.setup.js.
module.exports = async () => {
  const seen = globalThis.__maxListenerWarnings || [];
  if (seen.length === 0) return;
  console.error(`\n❌ ${seen.length} MaxListenersExceededWarning(s) during the test run:\n\n${seen.join("\n\n")}\n`);
  process.exitCode = 1; // Jest keeps a non-zero exit code set here
};
