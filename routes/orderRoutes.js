// routes/orderRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { placeOrder, getMyOrders, getOrderById } = require("../controllers/orderController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateOrder, validateIdParam } = require("../middleware/validationMiddleware");

// All order routes require authentication
router.use(isAuthenticated);

// Reject malformed ObjectIds with 400 before any controller runs
router.param("id", validateIdParam);

router.post("/", validateOrder, placeOrder);
router.get("/", getMyOrders);
router.get("/:id", getOrderById);

module.exports = router;
