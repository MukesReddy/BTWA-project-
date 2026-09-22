// utils/logger.js
// Custom application logger using Node.js File System (fs)
// BTWA Module 4: Node.js filesystem, async operations
// BTWA Module 5: Custom modules, require/exports

const fs = require("fs");
const path = require("path");

// Ensure logs directory exists
const logsDir = path.join(__dirname, "../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFilePath = path.join(logsDir, "application.log");

/**
 * Format a log entry with timestamp and level
 * @param {string} level - Log level (INFO, ERROR, WARN)
 * @param {string} message - Log message
 * @returns {string} Formatted log string
 */
const formatLogEntry = (level, message) => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}\n`;
};

/**
 * Asynchronously append a log entry to the log file
 * BTWA Module 4: Asynchronous file operations using callbacks/async
 * @param {string} level - Log level
 * @param {string} message - Log message
 */
const log = (level, message) => {
  const entry = formatLogEntry(level, message);

  // Asynchronous file append — does not block the event loop
  // BTWA Module 4: Non-blocking I/O, BTWA Module 6: Event loop
  fs.appendFile(logFilePath, entry, (err) => {
    if (err) {
      console.error("Logger Error:", err.message);
    }
  });

  // Also output to console during development
  if (process.env.NODE_ENV === "development") {
    console.log(entry.trim());
  }
};

/**
 * Log informational messages
 * @param {string} message
 */
const info = (message) => log("INFO", message);

/**
 * Log error messages
 * @param {string} message
 */
const error = (message) => log("ERROR", message);

/**
 * Log warning messages
 * @param {string} message
 */
const warn = (message) => log("WARN", message);

/**
 * Read the log file content (demonstrates fs.readFile)
 * BTWA Module 4: Reading files asynchronously
 * @returns {Promise<string>} Log file content
 */
const readLogs = () => {
  return new Promise((resolve, reject) => {
    fs.readFile(logFilePath, "utf8", (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

// BTWA Module 5: module.exports — exporting custom module
module.exports = { info, error, warn, readLogs };
