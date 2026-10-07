// routes/categoryRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const {
  getCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { isAdmin } = require("../middleware/adminMiddleware");
const { validateCategory, validateIdParam } = require("../middleware/validationMiddleware");

// Public routes
// Reject malformed ObjectIds with 400 before any controller runs
router.param("id", validateIdParam);

router.get("/", getCategories);
router.get("/:id", getCategoryById);

// Admin-protected routes
router.post("/", isAuthenticated, isAdmin, validateCategory, createCategory);
router.put("/:id", isAuthenticated, isAdmin, validateCategory, updateCategory);
router.delete("/:id", isAuthenticated, isAdmin, deleteCategory);

module.exports = router;
