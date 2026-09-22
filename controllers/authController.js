// controllers/authController.js
// Authentication controller — register, login, logout, me
// BTWA Module 10: Cookies, sessions, bcrypt authentication

const User = require("../models/User");
const { sendSuccess, sendError, sanitizeUser } = require("../utils/helpers");
const logger = require("../utils/logger");
const emitter = require("../utils/eventEmitter");

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 * BTWA Module 10: Registration with bcrypt password hashing
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, address } = req.body;

    // Check if email already exists (BTWA Module 2: Query by field)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return sendError(res, 409, "An account with this email already exists");
    }

    // Create user — password is hashed by Mongoose pre-save hook (BTWA Module 10: bcrypt)
    const user = await User.create({ name, email, password, phone, address });

    // Emit event (BTWA Module 5: EventEmitter)
    emitter.emit("userRegistered", { userId: user._id, email: user.email, role: user.role });

    // Set flash message in session (BTWA Module 10: Flash messages via session)
    req.session.flash = { type: "success", message: "Registration successful! Please log in." };

    return sendSuccess(res, 201, "Registration successful", { userId: user._id });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    Login and create session
 * @access  Public
 * BTWA Module 10: Session-based authentication, bcrypt comparison
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user by email — explicitly select password (select: false in schema)
    // BTWA Module 2: Query with projection
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) {
      return sendError(res, 401, "Invalid email or password");
    }

    // Compare password using bcrypt (BTWA Module 10)
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return sendError(res, 401, "Invalid email or password");
    }

    // Create session — store userId and role (BTWA Module 10: express-session)
    req.session.userId = user._id.toString();
    req.session.role = user.role;
    req.session.userName = user.name;

    // Emit login event (BTWA Module 5: EventEmitter)
    emitter.emit("userLoggedIn", { userId: user._id, email: user.email });

    // Set flash success (BTWA Module 10: Flash messages)
    req.session.flash = { type: "success", message: `Welcome back, ${user.name}!` };

    // Return user data (without password)
    const safeUser = sanitizeUser(user);

    return sendSuccess(res, 200, `Welcome back, ${user.name}!`, { user: safeUser });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/auth/logout
 * @desc    Logout and destroy session
 * @access  Authenticated
 * BTWA Module 10: Session destruction, cookie clearing
 */
const logout = (req, res, next) => {
  const userId = req.session.userId;

  // Emit logout event before destroying session
  emitter.emit("userLoggedOut", { userId });

  // Destroy the session (BTWA Module 10: express-session destroy)
  req.session.destroy((err) => {
    if (err) {
      return next(err);
    }

    // Clear the session cookie from browser (BTWA Module 10: Cookies)
    res.clearCookie("foodiehub.sid");

    return sendSuccess(res, 200, "Logged out successfully");
  });
};

/**
 * @route   GET /api/auth/me
 * @desc    Get current logged-in user details
 * @access  Authenticated
 */
const getMe = async (req, res, next) => {
  try {
    // BTWA Module 2: findById query
    const user = await User.findById(req.session.userId);
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Also send flash message if any, then clear it
    const flash = req.session.flash || null;
    req.session.flash = null;

    return sendSuccess(res, 200, "User retrieved successfully", {
      user: sanitizeUser(user),
      flash,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, logout, getMe };
