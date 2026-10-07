// controllers/userController.js
// User profile management controller
// BTWA Module 2: findById, findByIdAndUpdate

const User = require("../models/User");
const { sendSuccess, sendError, sanitizeUser } = require("../utils/helpers");

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

module.exports = { getProfile, updateProfile };
