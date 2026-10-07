// controllers/orderController.js
// Order controller — place order, view orders, view details
// BTWA Module 6: Async operations, event loop
// BTWA Module 5: EventEmitter integration via orderService

const Order = require("../models/Order");
const { createOrder } = require("../services/orderService");
const { sendSuccess, sendError } = require("../utils/helpers");

/**
 * @route   POST /api/orders
 * @desc    Place a new order
 * @access  Authenticated
 * BTWA Module 5: EventEmitter (via orderService)
 * BTWA Module 8: Order creation with server-side price validation
 */
const placeOrder = async (req, res, next) => {
  try {
    const { deliveryAddress, paymentMethod } = req.body;

    // Create order via service (validates prices, availability, fires event)
    const order = await createOrder(
      req.session.userId,
      deliveryAddress,
      paymentMethod
    );

    // Set flash success (BTWA Module 10: Flash messages)
    req.session.flash = {
      type: "success",
      message: `Order #${order._id} placed successfully!`,
    };

    return sendSuccess(res, 201, "Order placed successfully", { order });
  } catch (error) {
    // Pass to centralized error handler (BTWA Module 9)
    if (error.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    next(error);
  }
};

/**
 * @route   GET /api/orders
 * @desc    Get logged-in user's order history
 * @access  Authenticated
 * BTWA Module 2: Query by user, sort by date
 */
const getMyOrders = async (req, res, next) => {
  try {
    // BTWA Module 2: Query by user reference, sort descending by date
    const orders = await Order.find({ user: req.session.userId })
      .sort({ createdAt: -1 }) // Newest first
      .populate("user", "name email");

    return sendSuccess(res, 200, "Orders retrieved", orders);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/orders/:id
 * @desc    Get specific order details (must belong to logged-in user or admin)
 * @access  Authenticated
 */
const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate("user", "name email");

    if (!order) {
      return sendError(res, 404, "Order not found");
    }

    // Authorization: customer can only see their own orders
    // order.user can be null if the owner no longer exists, so read the id safely
    const ownerId = order.user ? order.user._id.toString() : null;
    if (req.session.role !== "admin" && ownerId !== req.session.userId) {
      return sendError(res, 403, "You are not authorized to view this order");
    }

    return sendSuccess(res, 200, "Order retrieved", order);
  } catch (error) {
    next(error);
  }
};

module.exports = { placeOrder, getMyOrders, getOrderById };
