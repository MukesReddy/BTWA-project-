// routes/orderRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { placeOrder, getMyOrders, getOrderById, cancelOrder } = require("../controllers/orderController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { isCustomer } = require("../middleware/adminMiddleware");
const { validateOrder, validateIdParam } = require("../middleware/validationMiddleware");

// All order routes require authentication
router.use(isAuthenticated);

// Reject malformed ObjectIds with 400 before any controller runs
router.param("id", validateIdParam);

router.post("/", validateOrder, placeOrder);
router.get("/", getMyOrders);
router.get("/:id", getOrderById);
router.put("/:id/cancel", isCustomer, cancelOrder); // customer accounts only; owner only, Pending only (see orderService)

module.exports = router;
