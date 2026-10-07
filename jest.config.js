// jest.config.js
// Two test projects:
//   unit        — fast, NO database needed. Models are mocked, or pages run in jsdom.
//                 `npm test`
//   integration — real MongoDB through mongodb-memory-server (downloads a mongod
//                 binary on first run, so it needs internet access to fastdl.mongodb.org).
//                 `npm run test:integration`   (or set MONGO_TEST_URI to use an existing server)

const shared = {
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
      testMatch: ["<rootDir>/tests/unit/**/*.test.js", "<rootDir>/tests/frontend/**/*.test.js"],
    },
    {
      ...shared,
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.js"],
      testTimeout: 120000, // first run downloads the mongod binary
    },
  ],
};
