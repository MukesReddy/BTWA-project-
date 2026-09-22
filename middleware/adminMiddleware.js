// middleware/adminMiddleware.js
// Admin authorization middleware — verifies user has admin role
// BTWA Module 10: Role-based authorization
// BTWA Module 9: Custom middleware

const { sendError } = require("../utils/helpers");

/**
 * isAdmin middleware
 * Must be used AFTER isAuthenticated middleware
 * Verifies that the logged-in user has the "admin" role
 *
 * Security: Authorization is ALWAYS verified server-side
 * Frontend admin buttons are just UI — the real gate is here
 *
 * BTWA Module 10: Role-based access control
 *
 * @param {object} req - Express request (contains req.session.role)
 * @param {object} res - Express response
 * @param {function} next - Next middleware
 */
const isAdmin = (req, res, next) => {
  // req.session.role is set during login
  if (req.session && req.session.role === "admin") {
    return next(); // Admin confirmed, proceed
  }

  // Authenticated but not admin → 403 Forbidden
  return sendError(res, 403, "Access denied. Admin privileges required.");
};

module.exports = { isAdmin };
