// routes/cartRoutes.js
// BTWA Module 8: REST routing

const express = require("express");
const router = express.Router();

const { getCart, addToCart, updateCartItem, removeCartItem, clearCart } = require("../controllers/cartController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateCartItem } = require("../middleware/validationMiddleware");

// All cart routes require authentication (BTWA Module 10: Protected routes)
router.use(isAuthenticated);

router.get("/", getCart);
router.post("/", validateCartItem, addToCart);
router.put("/:foodId", updateCartItem);
router.delete("/clear", clearCart);        // Must be before /:foodId
router.delete("/:foodId", removeCartItem);

module.exports = router;
