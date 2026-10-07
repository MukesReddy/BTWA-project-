// middleware/authMiddleware.js
// Authentication middleware — verifies user is logged in via session
// BTWA Module 10: Sessions, cookies, authentication middleware

const User = require("../models/User");
const { sendError } = require("../utils/helpers");

/** Destroys the session and clears the browser cookie (same attributes it was set with). */
const endSession = (req, res) =>
  new Promise((resolve) => {
    req.session.destroy(() => {
      const { name, maxAge, ...cookieOptions } = req.app.locals.config.cookie; // clearCookie must match path/sameSite/secure
      res.clearCookie(name, cookieOptions);
      resolve();
    });
  });

/**
 * isAuthenticated middleware
 * 1. A session with a userId must exist (Browser → Cookie → Session).
 * 2. The account behind that session must STILL be allowed to use the site.
 *
 * Step 2 is the important one. A session is just a cookie pointing at stored data, so on its own it
 * would keep working after an admin deactivates or deletes the account, or demotes an admin. We
 * therefore re-read the user (role + isActive only) from MongoDB on every authenticated request:
 *   • user deleted or deactivated → session destroyed, 401
 *   • role changed                → session role refreshed, so isAdmin sees the new role immediately
 * (utils/sessions.js additionally purges stored sessions on delete/deactivate — belt and braces —
 *  but nothing depends on it: this check works with any session store.)
 *
 * Flow: Browser → Cookie → Session → Middleware → DB check → Protected Route
 * BTWA Module 10: Session-based authentication
 *
 * @param {object} req - Express request (contains req.session)
 * @param {object} res - Express response
 * @param {function} next - Next middleware function
 */
const isAuthenticated = async (req, res, next) => {
  const userId = req.session && req.session.userId;
  if (!userId) {
    return sendError(res, 401, "Authentication required. Please log in.");
  }

  try {
    // BTWA Module 2: query with projection (only the two fields we need)
    const user = await User.findOne({ _id: userId }).select("role isActive").lean();

    if (!user || user.isActive === false) {
      await endSession(req, res);
      return sendError(res, 401, "Your session has ended because this account is no longer active. Please log in again.");
    }

    if (req.session.role !== user.role) {
      req.session.role = user.role; // promoted/demoted since login
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { isAuthenticated, endSession };
