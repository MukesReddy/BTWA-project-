// Runs before every test file, inside the test environment (jest "setupFilesAfterEnv").

// Silence + spy on the file logger (it appends to logs/application.log).
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  readLogs: jest.fn(),
}));

// Unit tests: any query that is NOT explicitly mocked must fail immediately
// instead of hanging for 10s waiting for a connection that will never exist.
// (Integration tests connect for real, so this flag is harmless there.)
require("mongoose").set("bufferCommands", false);
