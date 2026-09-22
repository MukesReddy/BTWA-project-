// utils/helpers.js
// General utility/helper functions
// BTWA Module 5: Custom modules, require/exports

/**
 * Send a standardized success API response
 * BTWA Module 8: Consistent REST API responses
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {*} data - Response data (optional)
 */
const sendSuccess = (res, statusCode, message, data = null) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  return res.status(statusCode).json(response);
};

/**
 * Send a standardized error API response
 * BTWA Module 8: Consistent REST API responses
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({ success: false, message });
};

/**
 * Calculate order total from items array
 * Each item: { price, quantity }
 * @param {Array} items - Array of order items
 * @returns {number} Total amount
 */
const calculateTotal = (items) => {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
};

/**
 * Validate MongoDB ObjectId format
 * @param {string} id - ID to validate
 * @returns {boolean}
 */
const isValidObjectId = (id) => {
  return /^[a-fA-F0-9]{24}$/.test(id);
};

/**
 * Sanitize user object — remove sensitive fields before sending to client
 * @param {object} user - Mongoose user document
 * @returns {object} Safe user object
 */
const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  return obj;
};

/**
 * Format currency for display (Indian Rupees)
 * @param {number} amount
 * @returns {string}
 */
const formatCurrency = (amount) => {
  return `₹${Number(amount).toFixed(2)}`;
};

// BTWA Module 5: module.exports
module.exports = {
  sendSuccess,
  sendError,
  calculateTotal,
  isValidObjectId,
  sanitizeUser,
  formatCurrency,
};
