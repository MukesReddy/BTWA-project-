// routes/adminRoutes.js
// Admin-only routes — all protected by isAuthenticated + isAdmin
// BTWA Module 8: REST routing
// BTWA Module 9: Middleware chaining

const express = require("express");
const router = express.Router();

const {
  getDashboard,
  getAllUsers,
  getAllOrders,
  updateOrderStatus,
  exportOrdersCSV,
  deleteUser,
} = require("../controllers/adminController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { isAdmin } = require("../middleware/adminMiddleware");

// Apply auth + admin middleware to ALL admin routes
router.use(isAuthenticated, isAdmin);

// Dashboard
router.get("/dashboard", getDashboard);

// User management
router.get("/users", getAllUsers);
router.delete("/users/:id", deleteUser);

// Order management
router.get("/orders", getAllOrders);
router.put("/orders/:id/status", updateOrderStatus);

// CSV Export (BTWA Module 5: Streams demo)
router.get("/export/orders", exportOrdersCSV);

module.exports = router;
