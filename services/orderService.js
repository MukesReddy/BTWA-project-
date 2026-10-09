// services/orderService.js
// Order business logic service
// BTWA Module 5: Custom service module
// BTWA Module 4: Async operations

const Cart = require("../models/Cart");
const Food = require("../models/Food");
const Order = require("../models/Order");
const emitter = require("../utils/eventEmitter");
const { ORDER_TRANSITIONS, CUSTOMER_CANCEL_FROM } = require("../utils/constants");
const logger = require("../utils/logger");

/** Build an Error that the controller / central error handler turns into an HTTP status. */
const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

/** Round to 2 decimals (paise) to avoid floating-point artefacts like 0.1 + 0.2. */
const roundMoney = (amount) => Math.round(amount * 100) / 100;

/**
 * createOrder
 * Core order creation logic
 *
 * Integrity rules enforced here:
 * - Food existence verified from DB. A food deleted since it was added to the
 *   cart no longer crashes checkout: the stale line is removed from the cart
 *   and the customer gets a clear 409 asking them to review the cart.
 * - Food availability verified from DB (400 with the names of unavailable items)
 * - Prices come from the DB (never trust client / stale cart price)
 * - Total calculated on the server and rounded to paise
 * - The cart is CLAIMED atomically (findOneAndDelete on _id + updatedAt) BEFORE
 *   the order is created. Two simultaneous "Place order" requests therefore
 *   cannot both succeed (no duplicate orders), and an order can never be built
 *   from a cart that changed after it was priced.
 * - If creating the order fails after the claim, the cart is restored.
 *
 * BTWA Module 5: Custom service module
 * BTWA Module 5: EventEmitter — emits orderPlaced event
 *
 * @param {string} userId - Logged-in user ID
 * @param {object} deliveryAddress - Delivery address object
 * @param {string} paymentMethod - Payment method string ("Cash on Delivery" or "UPI")
 * @param {object} [paymentFields] - extra payment fields for the new order (UPI: paymentStatus, paymentRef,
 *   paymentExpiresAt). They are set by services/paymentService.js only; they can never override the
 *   user, items, total or lifecycle status, which are applied after them.
 * @returns {object} Created order document
 */
const createOrder = async (userId, deliveryAddress, paymentMethod, paymentFields = {}) => {
  // 1. Get user's cart
  const cart = await Cart.findOne({ user: userId });
  if (!cart || cart.items.length === 0) {
    throw httpError(400, "Your cart is empty. Add items before placing an order.");
  }

  // 2. Load the CURRENT food documents in a single query ($in)
  const foods = await Food.find({ _id: { $in: cart.items.map((i) => i.food) } }).select(
    "name price available"
  );
  const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

  const missingIds = [];
  const unavailableNames = [];
  const orderItems = [];
  let total = 0;

  for (const cartItem of cart.items) {
    const food = foodMap.get(cartItem.food.toString());

    if (!food) {
      missingIds.push(cartItem.food);
      continue;
    }
    if (!food.available) {
      unavailableNames.push(food.name);
      continue;
    }

    // Use price from DB — not from the cart (security: BTWA Module 8 requirement)
    total += food.price * cartItem.quantity;
    orderItems.push({
      food: food._id,
      foodName: food.name, // Snapshot
      quantity: cartItem.quantity,
      price: food.price, // DB price snapshot
    });
  }

  if (missingIds.length > 0) {
    // Self-heal: drop the dangling lines so the customer can simply retry
    await Cart.updateOne({ _id: cart._id }, { $pull: { items: { food: { $in: missingIds } } } });
    throw httpError(
      409,
      "Some items in your cart are no longer on the menu and were removed. Please review your cart and try again."
    );
  }
  if (unavailableNames.length > 0) {
    throw httpError(
      400,
      `Currently unavailable: ${unavailableNames.join(", ")}. Please remove ${
        unavailableNames.length > 1 ? "them" : "it"
      } from your cart.`
    );
  }

  const totalAmount = roundMoney(total);

  // 3. Claim the cart atomically. Matching on updatedAt means "only if the cart is
  //    still exactly the one we just priced". null → someone else claimed or changed it.
  const claimedCart = await Cart.findOneAndDelete({ _id: cart._id, updatedAt: cart.updatedAt });
  if (!claimedCart) {
    throw httpError(
      409,
      "Your cart changed or this order was already placed. Please review your cart and try again."
    );
  }

  // 4. Create the order; put the cart back if that fails so the customer loses nothing
  let order;
  try {
    order = await Order.create({
      ...paymentFields,
      user: userId,
      items: orderItems,
      totalAmount,
      deliveryAddress,
      paymentMethod,
      orderStatus: "Pending",
    });
  } catch (error) {
    try {
      await Cart.create({
        _id: claimedCart._id,
        user: claimedCart.user,
        items: claimedCart.toObject().items,
      });
    } catch (restoreError) {
      logger.error(`Could not restore cart ${claimedCart._id} after failed order: ${restoreError.message}`);
    }
    throw error;
  }

  // 5. Emit orderPlaced event (BTWA Module 5: EventEmitter)
  emitter.emit("orderPlaced", {
    orderId: order._id,
    userId,
    totalAmount,
  });

  return order;
};

// ─── Order status changes ────────────────────────────────────────────────────
// Every status change is ONE atomic findOneAndUpdate whose filter contains the status we expect the
// order to be in. If two requests race (two admins, or the customer cancelling while an admin
// confirms), MongoDB applies exactly one of them; the other matches nothing and gets 409.
// The "orderStatusUpdated" event is emitted only after a successful update, with the status the
// order REALLY moved from (the one in the filter), never a stale read.

/**
 * An unpaid online order was closed (cancelled / failed / expired): give the customer their cart back so they can
 * simply try again. Only when they have no cart at all right now: if they already started a new one (the unique
 * Cart.user index answers 11000) we leave it alone and never merge into someone's current cart.
 * Best effort: failing to restore must never fail the cancellation itself.
 * @returns {boolean} whether the cart was restored
 */
const restoreCartFromOrder = async (order) => {
  const items = (order.items || [])
    .filter((item) => item.food)
    .map((item) => ({ food: item.food, quantity: item.quantity, price: item.price }));
  if (!items.length) return false;
  const owner = order.user && order.user._id ? order.user._id : order.user;
  try {
    await Cart.create({ user: owner, items });
    return true;
  } catch (error) {
    if (error.code !== 11000) logger.error(`Could not restore the cart of order ${order._id}: ${error.message}`);
    return false;
  }
};

const isLegalTransition = (from, to) => (ORDER_TRANSITIONS[from] || []).includes(to);

const allowedNext = (from) => {
  const next = ORDER_TRANSITIONS[from] || [];
  return next.length ? next.join(" or ") : "none (this is a final status)";
};

/** The order lost a race (or vanished) between our read and our update: say which. */
const explainLostRace = async (orderId, message) => {
  const now = await Order.findById(orderId).select("orderStatus").lean();
  if (!now) throw httpError(404, "Order not found");
  throw httpError(409, `${message} (it is now "${now.orderStatus}"). Please reload and try again.`);
};

const announceStatusChange = (orderId, oldStatus, newStatus) =>
  emitter.emit("orderStatusUpdated", { orderId, oldStatus, newStatus });

/**
 * Admin: move an order along the lifecycle.
 * @throws 404 order missing · 409 transition not allowed, or the order changed under us
 * @returns {{order, oldStatus}}
 */
const transitionOrderStatus = async (orderId, newStatus) => {
  const current = await Order.findById(orderId).select("orderStatus paymentMethod paymentStatus").lean();
  if (!current) throw httpError(404, "Order not found");

  const oldStatus = current.orderStatus;
  if (!isLegalTransition(oldStatus, newStatus)) {
    throw httpError(
      409,
      `Cannot change an order from "${oldStatus}" to "${newStatus}". Allowed next status: ${allowedNext(oldStatus)}.`
    );
  }

  // Online (UPI) orders: the kitchen must not start on an order whose payment is not VERIFIED. Unpaid → only Cancel.
  const isUpi = current.paymentMethod === "UPI";
  const paymentStatus = current.paymentStatus || "PENDING";
  if (isUpi && paymentStatus !== "PAID" && newStatus !== "Cancelled") {
    throw httpError(
      409,
      `This is a UPI order and its payment is not verified yet (payment status: ${paymentStatus}). Verify the payment first; an unpaid order can only be cancelled.`
    );
  }

  const filter = { _id: orderId, orderStatus: oldStatus }; // ← the expected current status makes this atomic
  const changes = { orderStatus: newStatus };
  let closesUnpaidPayment = false;
  if (isUpi && newStatus !== "Cancelled") {
    filter.paymentStatus = "PAID"; // still paid at the instant of the update, not just when we read it
  } else if (isUpi && paymentStatus === "PENDING") {
    filter.paymentStatus = "PENDING"; // cancelling an unpaid order also closes its payment (a late payment is then flagged)
    changes.paymentStatus = "CANCELLED";
    closesUnpaidPayment = true;
  } else if (isUpi) {
    logger.warn(`Order ${orderId} was PAID online and is now Cancelled: a refund must be arranged manually`);
  }

  const order = await Order.findOneAndUpdate(filter, { $set: changes }, { new: true, runValidators: true }).populate(
    "user",
    "name email"
  );

  if (!order) {
    await explainLostRace(orderId, "This order was changed by someone else while you were updating it");
  }

  announceStatusChange(order._id, oldStatus, newStatus);
  if (closesUnpaidPayment) await restoreCartFromOrder(order);
  return { order, oldStatus };
};

/**
 * Customer: cancel their OWN order, only while it is still Pending.
 * @throws 404 missing · 403 not the owner · 409 no longer cancellable (or an admin got there first)
 * @returns {{order, oldStatus}}
 */
const cancelOrderAsCustomer = async (orderId, userId) => {
  const current = await Order.findById(orderId).select("user orderStatus paymentMethod paymentStatus").lean();
  if (!current) throw httpError(404, "Order not found");

  if (!current.user || current.user.toString() !== String(userId)) {
    throw httpError(403, "You are not authorized to cancel this order");
  }
  const isUpi = current.paymentMethod === "UPI";
  if (isUpi && current.paymentStatus === "PAID") {
    // Money has already arrived and there is no automatic refund: a person has to handle it.
    throw httpError(409, "This order was already paid online, so it cannot be cancelled here. Please contact the restaurant to cancel it and arrange a refund.");
  }
  if (!CUSTOMER_CANCEL_FROM.includes(current.orderStatus)) {
    throw httpError(409, `Only Pending orders can be cancelled. This order is "${current.orderStatus}".`);
  }

  const oldStatus = current.orderStatus;
  const filter = { _id: orderId, user: userId, orderStatus: oldStatus }; // owner AND expected status in the filter
  const changes = { orderStatus: "Cancelled" };
  if (isUpi) {
    filter.paymentStatus = "PENDING"; // never cancel an order that was paid a moment ago
    changes.paymentStatus = "CANCELLED";
  }
  const order = await Order.findOneAndUpdate(filter, { $set: changes }, { new: true, runValidators: true }).populate(
    "user",
    "name email"
  );

  if (!order) {
    await explainLostRace(orderId, "This order can no longer be cancelled");
  }

  announceStatusChange(order._id, oldStatus, "Cancelled");
  if (isUpi) await restoreCartFromOrder(order);
  return { order, oldStatus };
};

module.exports = { createOrder, transitionOrderStatus, cancelOrderAsCustomer, isLegalTransition, restoreCartFromOrder, httpError };
