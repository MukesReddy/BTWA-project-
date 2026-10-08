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

/**
 * isCustomer middleware
 * Must be used AFTER isAuthenticated middleware (which refreshes req.session.role from the database)
 * Lets only a normal customer through. Fails closed: any other role, admins included, gets 403.
 * Used for customer-only actions such as cancelling your own order; admins have their own
 * admin endpoints for managing orders.
 */
const isCustomer = (req, res, next) => {
  if (req.session && req.session.role === "customer") {
    return next();
  }
  return sendError(res, 403, "This action is for customer accounts. Admins manage orders from the admin panel.");
};

module.exports = { isAdmin, isCustomer };
