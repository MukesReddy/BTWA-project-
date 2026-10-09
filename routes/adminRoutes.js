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
  verifyOrderPayment,
  exportOrdersCSV,
  deleteUser,
  reactivateUser,
} = require("../controllers/adminController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { isAdmin } = require("../middleware/adminMiddleware");
const { validateIdParam, validateUserQuery, validateOrderQuery, validateAdminPayment } = require("../middleware/validationMiddleware");

// Apply auth + admin middleware to ALL admin routes
router.use(isAuthenticated, isAdmin);

// Reject malformed ObjectIds with 400 (runs after the auth checks above)
router.param("id", validateIdParam);

// Dashboard
router.get("/dashboard", getDashboard);

// User management
router.get("/users", validateUserQuery, getAllUsers);
router.delete("/users/:id", deleteUser);
router.put("/users/:id/reactivate", reactivateUser); // undo a deactivation (see deleteUser)

// Order management
router.get("/orders", validateOrderQuery, getAllOrders);
router.put("/orders/:id/status", updateOrderStatus);
router.put("/orders/:id/payment", validateAdminPayment, verifyOrderPayment); // confirm/reject a UPI payment (UTR required)

// CSV Export (BTWA Module 5: Streams demo)
router.get("/export/orders", exportOrdersCSV);

module.exports = router;
