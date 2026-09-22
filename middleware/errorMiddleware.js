// middleware/errorMiddleware.js
// Centralized error-handling middleware
// BTWA Module 9: Error handling middleware

const logger = require("../utils/logger");
const emitter = require("../utils/eventEmitter");

/**
 * 404 Not Found handler
 * Catches requests to undefined routes
 * Must be registered AFTER all route definitions
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
const notFound = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error); // Pass to the global error handler
};

/**
 * Global Error Handler
 * Catches all errors passed via next(error)
 * Returns consistent JSON error responses
 * BTWA Module 9: Centralized error handling
 *
 * @param {Error} err - Error object
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Next middleware (required for Express to recognize as error handler)
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  // Log the error (BTWA Module 4: filesystem logging)
  logger.error(`${statusCode} — ${message} | URL: ${req.originalUrl}`);

  // Emit appError event (BTWA Module 5: EventEmitter)
  emitter.emit("appError", { message, stack: err.stack });

  // Send consistent error response (BTWA Module 8: API response format)
  // Never expose stack trace to client in production
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = { notFound, errorHandler };
