// controllers/paymentController.js
// Online (UPI QR) payments. Business rules live in services/paymentService.js; see its header for the key rule:
// only a signed webhook or an admin can mark a payment PAID: never the browser.

const {
  getPaymentMethods,
  initiateUpiPayment,
  getPaymentForUser,
  recordPaymentResult,
  verifyWebhookSignature,
  parseWebhookPayload,
} = require("../services/paymentService");
const { sendSuccess, sendError } = require("../utils/helpers");
const logger = require("../utils/logger");

const fail = (res, next, error) => {
  if (error.statusCode) return sendError(res, error.statusCode, error.message);
  return next(error);
};

/**
 * @route   GET /api/payments/methods
 * @desc    Which payment methods checkout may offer (UPI only when UPI_ID is configured)
 * @access  Authenticated
 */
const getMethods = (req, res) =>
  sendSuccess(res, 200, "Payment methods retrieved", { methods: getPaymentMethods(req.app.locals.config.payment) });

/**
 * @route   POST /api/payments/upi
 * @desc    Turn the cart into a Pending UPI order and return the QR for its server-calculated total
 * @access  Authenticated
 * Body:    { deliveryAddress }  ← any "amount" the client sends is ignored on purpose
 */
const initiateUpi = async (req, res, next) => {
  try {
    const payment = await initiateUpiPayment(req.session.userId, req.body.deliveryAddress, req.app.locals.config.payment);
    return sendSuccess(res, 201, "Payment started. Scan the QR code to pay.", payment);
  } catch (error) {
    return fail(res, next, error);
  }
};

/**
 * @route   GET /api/payments/:id
 * @desc    Status of an order's payment (and the QR while it is still pending). :id = order id
 * @access  The order's owner, or an admin
 */
const getPaymentStatus = async (req, res, next) => {
  try {
    const actor = { id: req.session.userId, role: req.session.role };
    const payment = await getPaymentForUser(req.params.id, actor, req.app.locals.config.payment);
    return sendSuccess(res, 200, "Payment status retrieved", payment);
  } catch (error) {
    return fail(res, next, error);
  }
};

/**
 * @route   POST /api/payments/webhook
 * @desc    Payment result pushed by the payment provider (or a bank-side script)
 * @access  Public but AUTHENTICATED BY SIGNATURE: header X-Payment-Signature = hex HMAC-SHA256 of the raw body
 *          with PAYMENT_WEBHOOK_SECRET. This is the one route outside CSRF protection: a provider is not a browser,
 *          so it has no session or CSRF token; the signature is what authenticates it.
 * Answers: 503 not configured · 401 bad signature · 400 bad payload / wrong amount · 404 unknown reference ·
 *          409 conflicting result · 200 applied, or already applied (safe to retry)
 */
const receiveWebhook = async (req, res, next) => {
  try {
    const { webhookSecret } = req.app.locals.config.payment;
    if (!webhookSecret) return sendError(res, 503, "The payment webhook is not configured on this server");

    if (!verifyWebhookSignature(req.rawBody, req.get("x-payment-signature"), webhookSecret)) {
      logger.warn("Rejected a payment webhook with a missing or invalid signature");
      return sendError(res, 401, "Invalid signature");
    }

    const event = parseWebhookPayload(req.body);
    const { order, duplicate } = await recordPaymentResult({ ...event, source: "webhook" });
    return sendSuccess(res, 200, duplicate ? "Notification already processed" : "Payment result recorded", {
      orderId: String(order._id),
      paymentStatus: order.paymentStatus,
      duplicate,
    });
  } catch (error) {
    return fail(res, next, error);
  }
};

module.exports = { getMethods, initiateUpi, getPaymentStatus, receiveWebhook };
