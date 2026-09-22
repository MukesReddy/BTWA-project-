// utils/eventEmitter.js
// Custom EventEmitter for application events
// BTWA Module 5: EventEmitter pattern
// BTWA Module 6: Node.js event-driven architecture

const EventEmitter = require("events"); // Built-in Node.js module
const logger = require("./logger");

/**
 * FoodieHub Application Event Emitter
 * Extends Node.js built-in EventEmitter
 * Demonstrates event-driven architecture central to Node.js
 */
class FoodieHubEmitter extends EventEmitter {}

// Create a singleton emitter instance
const emitter = new FoodieHubEmitter();

// ─── Event Listeners ────────────────────────────────────────────────────────

/**
 * Listener: orderPlaced
 * Fires when a customer successfully places an order
 * Logs the event to the application log file
 */
emitter.on("orderPlaced", (data) => {
  const { orderId, userId, totalAmount } = data;
  logger.info(
    `ORDER PLACED — OrderID: ${orderId} | UserID: ${userId} | Amount: ₹${totalAmount}`
  );
});

/**
 * Listener: orderStatusUpdated
 * Fires when an admin updates an order's status
 */
emitter.on("orderStatusUpdated", (data) => {
  const { orderId, oldStatus, newStatus } = data;
  logger.info(
    `ORDER STATUS UPDATED — OrderID: ${orderId} | ${oldStatus} → ${newStatus}`
  );
});

/**
 * Listener: userRegistered
 * Fires when a new user registers
 */
emitter.on("userRegistered", (data) => {
  const { userId, email, role } = data;
  logger.info(`USER REGISTERED — UserID: ${userId} | Email: ${email} | Role: ${role}`);
});

/**
 * Listener: userLoggedIn
 * Fires when a user logs in
 */
emitter.on("userLoggedIn", (data) => {
  const { userId, email } = data;
  logger.info(`USER LOGIN — UserID: ${userId} | Email: ${email}`);
});

/**
 * Listener: userLoggedOut
 * Fires when a user logs out
 */
emitter.on("userLoggedOut", (data) => {
  const { userId } = data;
  logger.info(`USER LOGOUT — UserID: ${userId}`);
});

/**
 * Listener: appError
 * Fires on application-level errors
 */
emitter.on("appError", (data) => {
  const { message, stack } = data;
  logger.error(`APP ERROR — ${message}`);
});

// BTWA Module 5: module.exports
module.exports = emitter;
