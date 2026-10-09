// routes/paymentRoutes.js
// Online (UPI QR) payments: mounted at /api/payments
// BTWA Module 8: REST routing · Module 9: middleware chaining
//
// NOTE: POST /api/payments/webhook is NOT here. It is registered in server.js BEFORE the CSRF middleware
// (it is called by a payment provider, not a browser, and is authenticated by an HMAC signature instead).

const express = require("express");
const router = express.Router();

const { getMethods, initiateUpi, getPaymentStatus } = require("../controllers/paymentController");
const { isAuthenticated } = require("../middleware/authMiddleware");
const { validateUpiPayment, validateIdParam } = require("../middleware/validationMiddleware");

router.use(isAuthenticated);
router.param("id", validateIdParam);

router.get("/methods", getMethods);
router.post("/upi", validateUpiPayment, initiateUpi); // same order-rate-limit as POST /api/orders (see server.js)
router.get("/:id", getPaymentStatus);

module.exports = router;
