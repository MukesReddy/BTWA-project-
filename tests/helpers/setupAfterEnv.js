// Runs before every test file, inside the test environment (jest "setupFilesAfterEnv").

// Silence + spy on the file logger (it appends to logs/application.log).
jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  readLogs: jest.fn(),
}));
