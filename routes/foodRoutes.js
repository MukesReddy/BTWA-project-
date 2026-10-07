// routes/foodRoutes.js
// BTWA Module 8: REST routing, route parameters

const express = require("express");
const router = express.Router();

const { getFoods, getFoodById, createFood, updateFood, deleteFood } = require("../controllers/foodController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { isAdmin } = require("../middleware/adminMiddleware");
const { validateFood, validateFoodQuery, validateIdParam } = require("../middleware/validationMiddleware");

// Public routes
// Reject malformed ObjectIds with 400 before any controller runs
router.param("id", validateIdParam);

router.get("/", validateFoodQuery, getFoods);
router.get("/:id", getFoodById);

// Admin-protected routes
router.post("/", isAuthenticated, isAdmin, validateFood, createFood);
router.put("/:id", isAuthenticated, isAdmin, validateFood, updateFood);
router.delete("/:id", isAuthenticated, isAdmin, deleteFood);

module.exports = router;
