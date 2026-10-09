// routes/userRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { getProfile, updateProfile, changePassword } = require("../controllers/userController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateProfile, validatePasswordChange } = require("../middleware/validationMiddleware");

// All user routes require authentication
router.use(isAuthenticated);

router.get("/profile", getProfile);
router.put("/profile", validateProfile, updateProfile);

// Change your own password (rate-limited in server.js: failed attempts only, per user)
router.put("/password", validatePasswordChange, changePassword);

module.exports = router;
