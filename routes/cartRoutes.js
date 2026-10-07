// routes/cartRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { getCart, addToCart, updateCartItem, removeCartItem, clearCart } = require("../controllers/cartController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateCartItem, validateCartUpdate, validateIdParam } = require("../middleware/validationMiddleware");

// All cart routes require authentication (BTWA Module 10: Protected routes)
router.use(isAuthenticated);

// Reject malformed ObjectIds with 400 before any controller runs
router.param("foodId", validateIdParam);

router.get("/", getCart);
router.post("/", validateCartItem, addToCart);
router.put("/:foodId", validateCartUpdate, updateCartItem);
router.delete("/clear", clearCart);        // Must be before /:foodId
router.delete("/:foodId", removeCartItem);

module.exports = router;
