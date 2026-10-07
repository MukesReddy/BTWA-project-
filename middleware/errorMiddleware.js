// middleware/errorMiddleware.js
// Centralized error-handling middleware
// BTWA Module 9: Error handling middleware

const logger = require("../utils/logger");
const emitter = require("../utils/eventEmitter");

/**
 * 404 Not Found handler
 * Catches requests to undefined routes
 * Must be registered AFTER all route definitions
 */
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error); // Pass to the global error handler
};

/**
 * normalizeError
 * Translates the many kinds of errors that can reach the handler
 * (Mongoose, MongoDB driver, body-parser, our own) into a
 * { statusCode, message, errors? } triple. Anything we do not recognise is a
 * genuine server bug (500).
 */
const normalizeError = (err) => {
  // Invalid ObjectId / value that cannot be cast to the schema type
  if (err.name === "CastError") {
    return { statusCode: 400, message: `Invalid value for '${err.path}'` };
  }
  if (err.name === "ObjectParameterError") {
    return { statusCode: 400, message: "Invalid request parameters" };
  }

  // Mongoose schema validation failure
  if (err.name === "ValidationError" && err.errors) {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return {
      statusCode: 400,
      message: errors.map((e) => e.message).join(", "),
      errors,
    };
  }

  // Duplicate key (unique index violation)
  if (err.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    const what = fields.length ? fields.join(", ") : "value";
    return { statusCode: 409, message: `A record with this ${what} already exists` };
  }

  // body-parser (express.json) problems
  if (err.type === "entity.parse.failed") {
    return { statusCode: 400, message: "Invalid JSON in request body" };
  }
  if (err.type === "entity.too.large") {
    return { statusCode: 413, message: "Request body is too large" };
  }

  // Errors we raised ourselves with err.statusCode (404, 409 …)
  const status = err.statusCode || err.status;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { statusCode: status, message: err.message };
  }

  // Unknown error → 500. Do not leak internals in production.
  return {
    statusCode: 500,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message || "Internal Server Error",
  };
};

/**
 * Global Error Handler
 * Catches all errors passed via next(error)
 * Returns consistent JSON error responses
 * BTWA Module 9: Centralized error handling
 *
 * (The 4 parameters are required for Express to recognise an error handler.)
 */
const errorHandler = (err, req, res, next) => {
  // If the response has already started we cannot send JSON — let Express close it.
  if (res.headersSent) return next(err);

  const { statusCode, message, errors } = normalizeError(err);

  // Log (BTWA Module 4: filesystem logging). Client mistakes are warnings; real bugs are errors.
  if (statusCode >= 500) {
    logger.error(`${statusCode} — ${err.message} | ${req.method} ${req.originalUrl}`);
    // Emit appError event (BTWA Module 5: EventEmitter)
    emitter.emit("appError", { message: err.message, stack: err.stack });
  } else {
    logger.warn(`${statusCode} — ${message} | ${req.method} ${req.originalUrl}`);
  }

  // Consistent error response (BTWA Module 8). Stack traces only in development.
  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
