// middleware/authMiddleware.js
// Authentication middleware — verifies user is logged in via session
// BTWA Module 10: Sessions, cookies, authentication middleware

const { sendError } = require("../utils/helpers");

/**
 * isAuthenticated middleware
 * Checks if a valid session exists with a userId
 * Protects routes that require a logged-in user
 *
 * Flow: Browser → Cookie → Session → Middleware → Protected Route
 * BTWA Module 10: Session-based authentication
 *
 * @param {object} req - Express request (contains req.session)
 * @param {object} res - Express response
 * @param {function} next - Next middleware function
 */
const isAuthenticated = (req, res, next) => {
  // Check if session exists and has a userId
  if (req.session && req.session.userId) {
    return next(); // User is authenticated, proceed to route handler
  }

  // No valid session → 401 Unauthorized
  return sendError(res, 401, "Authentication required. Please log in.");
};

module.exports = { isAuthenticated };
