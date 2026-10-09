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
 * Escape text so it is matched LITERALLY inside a MongoDB $regex / JavaScript RegExp.
 * Without this, a search for "C++" or "(" is an invalid pattern (500), ".*" matches everything,
 * and a crafted pattern like "(a+)+$" can freeze the database (ReDoS).
 * @param {string} text
 * @returns {string}
 */
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");

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

/**
 * Format one value as a CSV cell (RFC 4180) that is also safe to open in a spreadsheet.
 *
 * 1. QUOTING — a value containing a comma, double quote, CR or LF is wrapped in double quotes and its
 *    inner quotes are doubled, so "Smith, John" stays ONE column instead of shifting every column after it.
 * 2. FORMULA INJECTION — Excel / Sheets / LibreOffice run a cell that starts with = + - @ (or a tab / CR)
 *    as a FORMULA. A customer chooses their own name, so {text: true} (use it for every user-controlled
 *    value) prefixes such a cell with an apostrophe, which spreadsheets show as plain text.
 *    Numbers, ids and dates are not user text, so they are left exactly as they are (a negative number
 *    must stay a number).
 * null / undefined become an empty cell.
 * BTWA Module 5: used by the CSV export (streams)
 *
 * @param {*} value
 * @param {{text?: boolean}} [options] text: true → neutralise a leading formula character
 * @returns {string}
 */
const csvCell = (value, { text = false } = {}) => {
  let cell = value === null || value === undefined ? "" : String(value);
  if (text && /^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
};

// BTWA Module 5: module.exports
module.exports = {
  csvCell,
  sendSuccess,
  sendError,
  calculateTotal,
  isValidObjectId,
  escapeRegex,
  sanitizeUser,
  formatCurrency,
};
