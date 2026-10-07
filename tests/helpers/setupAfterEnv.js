// Runs before every test file, inside the test environment (jest "setupFilesAfterEnv").

const { closeServers } = require("./client");

// Silence + spy on the file logger (it appends to logs/application.log).
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  readLogs: jest.fn(),
}));

// Close the shared listening test servers (tests/helpers/client.js) when the file is done.
afterAll(closeServers);
