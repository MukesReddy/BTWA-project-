// routes/authRoutes.js
// Authentication routes
// BTWA Module 8: REST API routing, HTTP methods
// BTWA Module 9: Validation middleware

const express = require("express");
const router = express.Router();

const { register, login, logout, getMe } = require("../controllers/authController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateRegister, validateLogin } = require("../middleware/validationMiddleware");

// POST /api/auth/register — public
router.post("/register", validateRegister, register);

// POST /api/auth/login — public
router.post("/login", validateLogin, login);

// POST /api/auth/logout — protected
router.post("/logout", isAuthenticated, logout);

// GET /api/auth/me — protected
router.get("/me", isAuthenticated, getMe);

module.exports = router; // BTWA Module 5: module.exports
