// routes/foodRoutes.js
// BTWA Module 8: REST routing, route parameters

const express = require("express");
const router = express.Router();

const { getFoods, getFoodById, createFood, updateFood, deleteFood } = require("../controllers/foodController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { isAdmin } = require("../middleware/adminMiddleware");
const { validateFood } = require("../middleware/validationMiddleware");

// Public routes
router.get("/", getFoods);
router.get("/:id", getFoodById);

// Admin-protected routes
router.post("/", isAuthenticated, isAdmin, validateFood, createFood);
router.put("/:id", isAuthenticated, isAdmin, validateFood, updateFood);
router.delete("/:id", isAuthenticated, isAdmin, deleteFood);

module.exports = router;
