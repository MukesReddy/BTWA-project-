// routes/authRoutes.js
// Authentication routes
// BTWA Module 8: REST API routing, HTTP methods
// BTWA Module 9: Validation middleware

const express = require("express");
const router = express.Router();

const { register, login, logout, getMe, getDemoAccounts } = require("../controllers/authController");
const { getCsrfToken } = require("../middleware/csrfMiddleware");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateRegister, validateLogin } = require("../middleware/validationMiddleware");

// GET /api/auth/csrf — public: issues the CSRF token every write request must send back (P1.5)
router.get("/csrf", getCsrfToken);

// GET /api/auth/demo-accounts — public, 404 unless demo login is enabled (development only by default)
router.get("/demo-accounts", getDemoAccounts);

// POST /api/auth/register — public
router.post("/register", validateRegister, register);

// POST /api/auth/login — public
router.post("/login", validateLogin, login);

// POST /api/auth/logout — protected
router.post("/logout", isAuthenticated, logout);

// GET /api/auth/me — protected
router.get("/me", isAuthenticated, getMe);

module.exports = router; // BTWA Module 5: module.exports
