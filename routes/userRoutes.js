// routes/userRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { getProfile, updateProfile } = require("../controllers/userController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateProfile } = require("../middleware/validationMiddleware");

// All user routes require authentication
router.use(isAuthenticated);

router.get("/profile", getProfile);
router.put("/profile", validateProfile, updateProfile);

module.exports = router;
