// controllers/userController.js
// User profile management controller
// BTWA Module 2: findById, findByIdAndUpdate

const User = require("../models/User");
const { sendSuccess, sendError, sanitizeUser } = require("../utils/helpers");
const { revokeUserSessions, regenerateSession } = require("../utils/sessions");
const logger = require("../utils/logger");

/**
 * @route   GET /api/users/profile
 * @desc    Get logged-in user's profile
 * @access  Authenticated
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return sendError(res, 404, "User not found");
    }
    return sendSuccess(res, 200, "Profile retrieved", sanitizeUser(user));
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/users/profile
 * @desc    Update logged-in user's profile
 * @access  Authenticated
 * BTWA Module 2: Update operation
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, address } = req.body;

    // Only update allowed fields (security: role cannot be changed here).
    // `!== undefined` (not truthiness) so phone can be cleared with ''.
    const updateData = {};
    if (name !== undefined)  updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) {
      // Whitelist address keys — never store arbitrary client-supplied properties
      updateData.address = {
        street:  address.street,
        city:    address.city,
        state:   address.state,
        pincode: address.pincode,
      };
    }

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Keep the session copy of the name in sync with the database
    req.session.userName = user.name;

    return sendSuccess(res, 200, "Profile updated successfully", sanitizeUser(user));
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/users/password
 * @desc    Change the logged-in user's own password
 * @access  Authenticated (any role; deactivated accounts never get this far — isAuthenticated refuses them)
 * BTWA Module 10: bcrypt verification, session management
 *
 * Steps (the order matters):
 *  1. validatePasswordChange has already checked the shapes (new: 6–72 chars, different from current).
 *  2. The CURRENT password must be right (bcrypt). A stolen session alone therefore cannot take the account over;
 *     guessing through a stolen session is throttled by the passwordChange limiter (failed attempts only).
 *     Wrong → 400 (not 401: in this app 401 means "your session ended").
 *  3. Save: the model's pre-save hook hashes the new password. Only the password is validated
 *     (validateModifiedOnly), so an unrelated legacy field cannot block the change.
 *  4. Sign the account out EVERYWHERE (every stored session is deleted), then give THIS device a brand-new
 *     session id and keep it logged in. Anyone who had the old password and a session is now locked out.
 * The password (old or new) is never logged, never returned, and never put in a URL.
 * Concurrent changes: last write wins (each one verified the password that was current when it started).
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.session.userId).select("+password");
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    if (!(await user.comparePassword(currentPassword))) {
      return sendError(res, 400, "Current password is incorrect");
    }

    user.password = newPassword; // hashed by the pre-save hook
    await user.save({ validateModifiedOnly: true });

    await revokeUserSessions(user._id); // every stored session of this user, including this one
    await regenerateSession(req);       // this device: fresh session id (also drops the old CSRF token)
    req.session.userId = user._id.toString();
    req.session.role = user.role;
    req.session.userName = user.name;

    logger.info(`User ${user._id} changed their password`); // ids only — never a password

    return sendSuccess(res, 200, "Password changed. Other devices have been signed out.");
  } catch (error) {
    next(error);
  }
};

module.exports = { getProfile, updateProfile, changePassword };
