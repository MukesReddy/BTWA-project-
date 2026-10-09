// services/paymentService.js
// Online payment by UPI QR: starting a payment, describing it (with the QR), and RECORDING THE RESULT.
//
// THE RULE THAT SHAPES THIS FILE:
//   A QR code is only a payment *request*. Nothing in the browser, and nothing in "the QR was shown", ever makes an
//   order PAID. An order becomes PAID in exactly two ways, both server-side and both authenticated:
//     1. an HMAC-signed webhook   (POST /api/payments/webhook, key = PAYMENT_WEBHOOK_SECRET), or
//     2. an administrator who checked the bank statement and typed the bank reference (UTR)
//        (PUT /api/admin/orders/:id/payment).
//   Both end in recordPaymentResult(), which checks the order, the amount and the final status.
//
// Why no direct "scan → paid" automation? A personal/static merchant UPI ID gives the app no callback. Automatic
// confirmation needs a payment provider (Razorpay, Cashfree, PhonePe PG ...) whose server calls our webhook; that
// needs a merchant account and a small adapter (see README → "UPI QR payments → Limitations"). Nothing here pretends otherwise.
//
// All amounts are compared as whole PAISE (integers), never as floating-point rupees.

const crypto = require("crypto");
const Order = require("../models/Order");
const logger = require("../utils/logger");
const eventEmitter = require("../utils/eventEmitter");
const { createOrder, restoreCartFromOrder, httpError } = require("./orderService");
const { toPaise, newPaymentRef, buildUpiUri, qrDataUrl } = require("../utils/upi");

const PAYMENT_REF_PATTERN = /^FH[0-9A-F]{16}$/;
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/; // UPI UTRs are 12 digits; providers use ids like pay_Abc123
const STILL_PAYABLE = ["PENDING", "EXPIRED", "CANCELLED"]; // a verified payment may arrive after the window closed

const MESSAGES = {
  PENDING: "Waiting for your payment. This page updates automatically once the payment is verified.",
  PAID: "Payment received and verified.",
  FAILED: "The payment failed. You have not been charged for this order. Your cart is back, so you can try again.",
  EXPIRED: "The payment window expired before a payment was verified. Your cart is back, so you can try again.",
  CANCELLED: "This payment was cancelled. Your cart is back, so you can try again.",
};

const upiAvailable = (payment) => Boolean(payment && payment.upiEnabled && payment.upiId);

/** Payment methods the checkout page may offer. UPI is "available" only when UPI_ID is configured. */
const getPaymentMethods = (payment) => [
  { id: "Cash on Delivery", label: "Cash on Delivery", available: true },
  { id: "UPI", label: "Online UPI QR Payment", available: upiAvailable(payment) },
];

const isExpired = (order, now = new Date()) =>
  Boolean(order.paymentExpiresAt) && new Date(order.paymentExpiresAt).getTime() <= now.getTime();

/**
 * What the payment page needs. The QR (and UPI link) are included ONLY while the payment is still pending and in
 * time: a finished or expired payment must not offer a scannable code. The amount comes from order.totalAmount,
 * which the server computed from the database prices when the order was created.
 */
const describePayment = async (order, payment) => {
  const status = order.paymentStatus || "PENDING";
  const result = {
    orderId: String(order._id),
    orderStatus: order.orderStatus,
    paymentMethod: order.paymentMethod,
    paymentStatus: status,
    amount: order.totalAmount,
    currency: "INR",
    items: (order.items || []).map((item) => ({ name: item.foodName, quantity: item.quantity, price: item.price })),
    paymentRef: order.paymentRef || null,
    expiresAt: order.paymentExpiresAt || null,
    paidAt: order.paidAt || null,
    message: MESSAGES[status] || "",
  };
  if (order.paymentMethod === "UPI" && status === "PENDING" && !isExpired(order) && upiAvailable(payment)) {
    const uri = buildUpiUri({
      upiId: payment.upiId,
      payeeName: payment.upiPayeeName,
      amountPaise: toPaise(order.totalAmount),
      reference: order.paymentRef,
      note: `FoodieHub ${order.paymentRef}`,
    });
    result.payee = { name: payment.upiPayeeName, upiId: payment.upiId };
    result.upiUri = uri;
    result.qrDataUrl = await qrDataUrl(uri);
  }
  return result;
};

/**
 * Close an UNPAID UPI order (payment → FAILED / EXPIRED, order → Cancelled) in one atomic update whose filter says
 * "still unpaid and still Pending". If a verified payment landed a millisecond earlier the filter no longer matches
 * and nothing is closed: a paid order can never be cancelled by the expiry job or by a failure notice.
 * @returns the closed order, or null when it was not (or no longer) closable
 */
const closeUnpaid = async (extraFilter, newPaymentStatus) => {
  const closed = await Order.findOneAndUpdate(
    { ...extraFilter, paymentMethod: "UPI", paymentStatus: "PENDING", orderStatus: "Pending" },
    { $set: { paymentStatus: newPaymentStatus, orderStatus: "Cancelled" } },
    { new: true }
  ).lean();
  if (closed) {
    eventEmitter.emit("orderStatusUpdated", { orderId: closed._id, oldStatus: "Pending", newStatus: "Cancelled" });
    await restoreCartFromOrder(closed); // the customer gets the cart back to try again
    logger.info(`Payment ${closed.paymentRef} closed as ${newPaymentStatus} (order ${closed._id})`);
  }
  return closed;
};

/** Start an online payment: the cart becomes a Pending UPI order priced by the server, plus the QR to pay it. */
const initiateUpiPayment = async (userId, deliveryAddress, payment) => {
  if (!upiAvailable(payment)) {
    throw httpError(503, "UPI payments are not available right now. Please choose Cash on Delivery.");
  }
  // createOrder = the same checkout used for Cash on Delivery: server-side prices, availability checks, atomic cart claim.
  const order = await createOrder(userId, deliveryAddress, "UPI", {
    paymentStatus: "PENDING",
    paymentRef: newPaymentRef(),
    paymentExpiresAt: new Date(Date.now() + payment.windowMinutes * 60 * 1000),
  });
  if (toPaise(order.totalAmount) <= 0) {
    // A UPI request for ₹0 is invalid. Undo this order and give the cart back.
    await closeUnpaid({ _id: order._id }, "CANCELLED");
    throw httpError(400, "This order has nothing to pay online. Please choose Cash on Delivery.");
  }
  return describePayment(order.toObject ? order.toObject() : order, payment);
};

/** Close one order whose payment window ran out (no-op when it is not pending / not due). Returns the fresh order. */
const expireIfDue = async (order) => {
  if (order.paymentMethod !== "UPI" || (order.paymentStatus || "PENDING") !== "PENDING" || !isExpired(order)) return order;
  const closed = await closeUnpaid({ _id: order._id, paymentExpiresAt: { $lte: new Date() } }, "EXPIRED");
  return closed || (await Order.findById(order._id).lean()) || order;
};

/** Customer (owner) or admin reads the state of a payment. Also closes the payment if its time ran out. */
const getPaymentForUser = async (orderId, actor, payment) => {
  const order = await Order.findById(orderId).lean();
  if (!order) throw httpError(404, "Order not found");
  if (actor.role !== "admin" && String(order.user) !== String(actor.id)) {
    throw httpError(403, "You are not authorized to view this payment");
  }
  if (order.paymentMethod !== "UPI") throw httpError(409, "This order is not an online (UPI) payment");
  return describePayment(await expireIfDue(order), payment);
};

/** Background job body: close every UPI payment whose window ran out. @returns number closed */
const expireStalePayments = async (limit = 100) => {
  const due = await Order.find({ paymentMethod: "UPI", paymentStatus: "PENDING", paymentExpiresAt: { $lte: new Date() } })
    .select("_id")
    .limit(limit)
    .lean();
  let closedCount = 0;
  for (const { _id } of due) {
    if (await closeUnpaid({ _id, paymentExpiresAt: { $lte: new Date() } }, "EXPIRED")) closedCount += 1;
  }
  return closedCount;
};

/** Start the periodic expiry job. The timer is unref'd, so it never keeps the process (or Jest) alive. */
const startExpiryJob = (intervalMs = 60 * 1000) => {
  const timer = setInterval(() => {
    expireStalePayments().catch((error) => logger.error(`Payment expiry job failed: ${error.message}`));
  }, intervalMs);
  timer.unref();
  return timer;
};

/**
 * THE ONLY place a payment result is applied. Safe to call repeatedly and concurrently:
 *  - every change is one atomic findOneAndUpdate whose filter states the status we expect;
 *  - the same notification twice → the second answers `duplicate: true`, nothing changes;
 *  - a different transaction id for an already-paid order → 409; one transaction id for two orders → 409
 *    (unique index on paymentTransactionId);
 *  - a paid amount that differs from the order total → 400 and the order is NOT marked paid.
 *
 * @param {{orderId?:string, paymentRef?:string, outcome:"PAID"|"FAILED", amountPaise?:number,
 *          transactionId?:string, source:"webhook"|"admin"}} result
 * @returns {{order, duplicate:boolean, closedBeforePayment?:boolean}}
 */
const recordPaymentResult = async ({ orderId, paymentRef, outcome, amountPaise, transactionId, source }) => {
  const order = await Order.findOne(orderId ? { _id: orderId } : { paymentRef }).lean();
  if (!order) throw httpError(404, "No order matches this payment");
  if (order.paymentMethod !== "UPI") throw httpError(409, "This order is not an online (UPI) order");

  if (outcome === "PAID") {
    if (!transactionId) throw httpError(400, "A transaction id is required to mark a payment as paid");
    if (amountPaise !== undefined && amountPaise !== toPaise(order.totalAmount)) {
      logger.warn(`Payment amount mismatch for order ${order._id}: reported ${amountPaise} paise, expected ${toPaise(order.totalAmount)}`);
      throw httpError(400, "The paid amount does not match the order total. The payment was NOT applied.");
    }

    let updated;
    try {
      updated = await Order.findOneAndUpdate(
        { _id: order._id, paymentMethod: "UPI", paymentStatus: { $in: STILL_PAYABLE } },
        { $set: { paymentStatus: "PAID", paidAt: new Date(), paymentTransactionId: transactionId, paymentVerifiedBy: source } },
        { new: true }
      ).lean();
    } catch (error) {
      if (error.code === 11000) throw httpError(409, "This transaction id was already used for another payment");
      throw error;
    }

    if (updated) {
      const closedBeforePayment = updated.orderStatus === "Cancelled";
      if (closedBeforePayment) {
        logger.warn(`Order ${updated._id} was paid (${transactionId}) AFTER it was cancelled/expired: manual refund required`);
      } else {
        logger.info(`Order ${updated._id} payment verified via ${source} (${transactionId})`);
      }
      return { order: updated, duplicate: false, closedBeforePayment };
    }

    const current = await Order.findById(order._id).lean();
    if (current && current.paymentStatus === "PAID") {
      if (current.paymentTransactionId === transactionId) return { order: current, duplicate: true };
      throw httpError(409, "This order was already paid with a different transaction. Nothing was changed.");
    }
    throw httpError(409, `This payment is already closed as ${current ? current.paymentStatus : "unknown"} and cannot be marked paid`);
  }

  // outcome === "FAILED"
  const closed = await closeUnpaid({ _id: order._id }, "FAILED");
  if (closed) return { order: closed, duplicate: false };
  const current = await Order.findById(order._id).lean();
  if (current && current.paymentStatus === "PAID") {
    throw httpError(409, "This order is already paid, so it cannot be marked as failed");
  }
  return { order: current || order, duplicate: true }; // FAILED/EXPIRED/CANCELLED already: repeating is harmless
};

// ── Webhook ────────────────────────────────────────────────────────────────────────────────

/** Constant-time check of "X-Payment-Signature" = hex(HMAC-SHA256(rawBody, secret)). */
const verifyWebhookSignature = (rawBody, signature, secret) => {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signature !== "string") return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const given = Buffer.from(signature.trim().replace(/^sha256=/i, "").toLowerCase(), "utf8");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

/**
 * Validate a (signature-verified) webhook body:
 *   { "paymentRef": "FH…", "status": "SUCCESS" | "FAILED", "amount": 249.9, "transactionId": "…" }
 * amount = rupees; required for SUCCESS.
 * @throws 400
 */
const parseWebhookPayload = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "Invalid webhook body");
  const { paymentRef, status, amount, transactionId } = body;
  if (typeof paymentRef !== "string" || !PAYMENT_REF_PATTERN.test(paymentRef)) throw httpError(400, "Invalid paymentRef");
  if (status !== "SUCCESS" && status !== "FAILED") throw httpError(400, 'status must be "SUCCESS" or "FAILED"');
  if (transactionId !== undefined && (typeof transactionId !== "string" || !TRANSACTION_ID_PATTERN.test(transactionId))) {
    throw httpError(400, "Invalid transactionId");
  }
  const parsed = { paymentRef, outcome: status === "SUCCESS" ? "PAID" : "FAILED", transactionId };
  if (status === "SUCCESS") {
    if (!transactionId) throw httpError(400, "transactionId is required for a successful payment");
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      throw httpError(400, "amount must be a positive number of rupees with at most 2 decimals");
    }
    parsed.amountPaise = toPaise(amount);
  }
  return parsed;
};

module.exports = {
  getPaymentMethods,
  describePayment,
  initiateUpiPayment,
  getPaymentForUser,
  expireIfDue,
  expireStalePayments,
  startExpiryJob,
  recordPaymentResult,
  verifyWebhookSignature,
  parseWebhookPayload,
};
