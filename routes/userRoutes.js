// routes/userRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { getProfile, updateProfile } = require("../controllers/userController");
const { isAuthenticated } = require("../middleware/authMiddleware");

// All user routes require authentication
router.use(isAuthenticated);

router.get("/profile", getProfile);
router.put("/profile", updateProfile);

module.exports = router;
