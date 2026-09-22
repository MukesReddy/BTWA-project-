// services/orderService.js
// Order business logic service
// BTWA Module 5: Custom service module
// BTWA Module 4: Async operations

const Cart = require("../models/Cart");
const Food = require("../models/Food");
const Order = require("../models/Order");
const emitter = require("../utils/eventEmitter");

/**
 * createOrder
 * Core order creation logic
 * 
 * Security rules enforced here:
 * - Food existence verified from DB
 * - Food availability verified from DB
 * - Prices retrieved from DB (never trust client price)
 * - Total calculated on server side
 * - Cart cleared only after successful order
 *
 * BTWA Module 5: Custom service module
 * BTWA Module 5: EventEmitter — emits orderPlaced event
 *
 * @param {string} userId - Logged-in user ID
 * @param {object} deliveryAddress - Delivery address object
 * @param {string} paymentMethod - Payment method string
 * @returns {object} Created order document
 */
const createOrder = async (userId, deliveryAddress, paymentMethod) => {
  // 1. Get user's cart
  const cart = await Cart.findOne({ user: userId }).populate("items.food");
  if (!cart || cart.items.length === 0) {
    const err = new Error("Your cart is empty. Add items before placing an order.");
    err.statusCode = 400;
    throw err;
  }

  // 2. Build order items — verify each food and use DB prices (security)
  const orderItems = [];
  let totalAmount = 0;

  for (const cartItem of cart.items) {
    // Re-fetch food from DB to verify existence and get current price
    const food = await Food.findById(cartItem.food._id);

    if (!food) {
      const err = new Error(`Food item "${cartItem.food.name}" no longer exists.`);
      err.statusCode = 400;
      throw err;
    }

    if (!food.available) {
      const err = new Error(`"${food.name}" is currently unavailable. Please remove it from your cart.`);
      err.statusCode = 400;
      throw err;
    }

    // Use price from DB — not from cart (security: BTWA Module 8 requirement)
    const itemTotal = food.price * cartItem.quantity;
    totalAmount += itemTotal;

    orderItems.push({
      food: food._id,
      foodName: food.name,       // Snapshot
      quantity: cartItem.quantity,
      price: food.price,         // DB price snapshot
    });
  }

  // 3. Create the order
  const order = await Order.create({
    user: userId,
    items: orderItems,
    totalAmount,
    deliveryAddress,
    paymentMethod,
    orderStatus: "Pending",
  });

  // 4. Clear the cart after successful order creation
  await Cart.findOneAndDelete({ user: userId });

  // 5. Emit orderPlaced event (BTWA Module 5: EventEmitter)
  emitter.emit("orderPlaced", {
    orderId: order._id,
    userId,
    totalAmount,
  });

  return order;
};

module.exports = { createOrder };
