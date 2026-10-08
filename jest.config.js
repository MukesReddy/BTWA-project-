// jest.config.js
// Two test projects:
//   unit        — fast, NO database needed. Models are mocked, or pages run in jsdom.
//                 `npm test`
//   integration — real MongoDB: set MONGO_TEST_URI to an existing server, or leave it unset to use
//                 mongodb-memory-server (downloads a mongod binary on first run, so it needs
//                 internet access to fastdl.mongodb.org).   `npm run test:integration`
//                 NOTE: Jest ignores `testTimeout` inside a project config (it is global-only), so
//                 tests run under the default 5 s. Keep each test cheap instead of raising it.

const shared = {
  // Fails the run (with a stack trace) if any MaxListenersExceededWarning is emitted. See the helper.
  globalSetup: "<rootDir>/tests/helpers/warningGuard.setup.js",
  globalTeardown: "<rootDir>/tests/helpers/warningGuard.teardown.js",
  setupFiles: ["<rootDir>/tests/helpers/env.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/helpers/setupAfterEnv.js"],
  clearMocks: true,   // reset call history between tests
  restoreMocks: true, // undo every jest.spyOn after each test so mocks never leak between tests
  testEnvironment: "node",
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: "unit",
      setupFilesAfterEnv: [...shared.setupFilesAfterEnv, "<rootDir>/tests/helpers/setupUnit.js"],
      testMatch: ["<rootDir>/tests/unit/**/*.test.js", "<rootDir>/tests/frontend/**/*.test.js"],
    },
    {
      ...shared,
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.js"],
    },
  ],
};
