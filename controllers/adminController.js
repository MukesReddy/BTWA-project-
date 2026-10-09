// controllers/adminController.js
// Admin controller — dashboard, user management, order management, CSV export
// BTWA Module 3: Aggregation framework
// BTWA Module 5: Node.js Streams and Pipes (CSV export)
// BTWA Module 9: Admin middleware (authorization)

const User = require("../models/User");
const Order = require("../models/Order");
const Food = require("../models/Food");
const Cart = require("../models/Cart");
const { getDashboardStats } = require("../services/analyticsService");
const { sendSuccess, sendError, sanitizeUser, escapeRegex, csvCell } = require("../utils/helpers");
const { ORDER_STATUSES } = require("../utils/constants");
const { Readable, Transform } = require("stream"); // BTWA Module 5: Node.js Streams
const { transitionOrderStatus } = require("../services/orderService"); // atomic status change + EventEmitter
const { revokeUserSessions } = require("../utils/sessions");
const logger = require("../utils/logger");

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get dashboard statistics from MongoDB aggregation
 * @access  Admin
 * BTWA Module 3: Aggregation pipeline via analyticsService
 */
const getDashboard = async (req, res, next) => {
  try {
    const stats = await getDashboardStats();
    return sendSuccess(res, 200, "Dashboard data retrieved", stats);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/admin/users
 * @desc    Get all users (admin view)
 * @access  Admin
 * BTWA Module 2: find() with query by role
 */
const getAllUsers = async (req, res, next) => {
  try {
    const { role, search } = req.query;
    const query = {};

    // Filter by role (BTWA Module 2: Query operators) — role is validated by validateUserQuery
    if (role) {
      query.role = role;
    }

    // Search by name or email (BTWA Module 2: $or, $regex). Escaped: matched literally, never as a pattern.
    if (search) {
      const pattern = escapeRegex(search);
      query.$or = [
        { name: { $regex: pattern, $options: "i" } },
        { email: { $regex: pattern, $options: "i" } },
      ];
    }

    // BTWA Module 2: find(), sort() cursor operations
    const users = await User.find(query).sort({ createdAt: -1 });
    const safeUsers = users.map(sanitizeUser);

    return sendSuccess(res, 200, "Users retrieved", safeUsers);
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/admin/orders
 * @desc    Get all orders with optional status filter
 * @access  Admin
 * BTWA Module 2: Queries by status, date; populate
 */
const getAllOrders = async (req, res, next) => {
  try {
    const { status } = req.query; // status / page / limit are validated by validateOrderQuery
    const pageNum = parseInt(req.query.page, 10) || 1;
    const limitNum = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const query = {};

    // Filter by status (BTWA Module 2: Query by enum field)
    if (status) {
      query.orderStatus = status;
    }

    const skip = (pageNum - 1) * limitNum;

    // BTWA Module 3: Mongoose populate — Order → User
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("user", "name email phone");

    const total = await Order.countDocuments(query);

    return sendSuccess(res, 200, "Orders retrieved", {
      orders,
      pagination: { total, page: pageNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/admin/orders/:id/status
 * @desc    Update order status (only legal lifecycle steps; 409 otherwise)
 * @access  Admin
 * BTWA Module 2: findOneAndUpdate with the expected status in the filter (atomic)
 * BTWA Module 5: EventEmitter ("orderStatusUpdated", emitted by orderService after the update)
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validStatuses = ORDER_STATUSES;

    if (!status || !validStatuses.includes(status)) {
      return sendError(res, 400, `Invalid status. Valid values: ${validStatuses.join(", ")}`);
    }

    // Lifecycle rules + atomic update + event: see services/orderService.js (409 on illegal / lost race)
    const { order: updatedOrder } = await transitionOrderStatus(req.params.id, status);

    return sendSuccess(res, 200, `Order status updated to ${status}`, updatedOrder);
  } catch (error) {
    if (error.statusCode) return sendError(res, error.statusCode, error.message);
    next(error);
  }
};

/**
 * @route   GET /api/admin/export/orders
 * @desc    Export orders as CSV using Node.js Streams
 * @access  Admin
 *
 * BTWA Module 5: Node.js Streams and Pipes
 * Flow: MongoDB data → Readable stream → Transform (CSV format) → HTTP response (Writable stream)
 */
const exportOrdersCSV = async (req, res, next) => {
  try {
    // Fetch orders from MongoDB
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .populate("user", "name email")
      .lean(); // Use .lean() for plain JS objects (faster)

    // Set response headers for CSV download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=orders.csv");

    // ── BTWA Module 5: Readable Stream ──────────────────────────────────────
    // Create a Readable stream from the orders array
    let index = 0;
    const readable = new Readable({
      objectMode: true,
      read() {
        if (index < orders.length) {
          this.push(orders[index++]); // Push one order at a time
        } else {
          this.push(null); // Signal end of stream
        }
      },
    });

    // ── BTWA Module 5: Transform Stream ─────────────────────────────────────
    // Transform each order object into a CSV row
    const CSV_HEADER = "Order ID,User Name,User Email,Total Amount,Status,Payment Method,Date\n";
    let headerWritten = false;
    const transform = new Transform({
      objectMode: true,
      transform(order, encoding, callback) {
        // Write CSV header on first item
        if (!headerWritten) {
          this.push(CSV_HEADER);
          headerWritten = true;
        }

        // Format each order as a CSV row (same 7 columns as the header).
        // csvCell quotes values that need it, and {text:true} neutralises spreadsheet formulas in
        // anything a user typed (name, email); see utils/helpers.js.
        const row = [
          csvCell(order._id.toString()),
          csvCell(order.user?.name || "N/A", { text: true }),
          csvCell(order.user?.email || "N/A", { text: true }),
          csvCell(order.totalAmount),
          csvCell(order.orderStatus, { text: true }),
          csvCell(order.paymentMethod, { text: true }),
          csvCell(new Date(order.createdAt).toLocaleDateString("en-IN")),
        ].join(",") + "\n";

        this.push(row);
        callback();
      },
      // No orders at all → the transform() above never ran, so without this the admin would download a
      // completely empty file. flush() runs once when the input ends: write the header if nothing did.
      flush(callback) {
        if (!headerWritten) {
          this.push(CSV_HEADER);
          headerWritten = true;
        }
        callback();
      },
    });

    // ── BTWA Module 5: Pipe — Readable → Transform → Writable (res) ─────────
    readable.pipe(transform).pipe(res);

    readable.on("error", (err) => next(err));
    transform.on("error", (err) => next(err));

  } catch (error) {
    next(error);
  }
};

/**
 * @route   DELETE /api/admin/users/:id
 * @desc    Delete a user, or deactivate them if they have orders (admin only)
 * @access  Admin
 */
const deleteUser = async (req, res, next) => {
  try {
    // Prevent deleting self
    if (req.params.id === req.session.userId) {
      return sendError(res, 400, "You cannot delete your own account");
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Referential integrity: orders point at their user. A user who has placed
    // orders is DEACTIVATED (history keeps its owner, admin order views keep working);
    // a user with no orders is deleted outright.
    const hasOrders = await Order.exists({ user: user._id });

    if (hasOrders) {
      await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
    } else {
      await User.deleteOne({ _id: user._id });
    }

    // Either way the account is gone from the customer's point of view:
    // drop their cart and log them out of every device.
    await Cart.deleteOne({ user: user._id });
    await revokeUserSessions(user._id);

    if (hasOrders) {
      return sendSuccess(
        res,
        200,
        "User deactivated. Their order history has been kept.",
        { action: "deactivated" }
      );
    }
    return sendSuccess(res, 200, "User deleted successfully", { action: "deleted" });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   PUT /api/admin/users/:id/reactivate
 * @desc    Undo a deactivation: the user can log in again (admin only)
 * @access  Admin
 * BTWA Module 2: findOneAndUpdate with the expected state in the filter (atomic)
 *
 * The counterpart of deleteUser, which DEACTIVATES (isActive:false) users who have placed orders.
 * - Atomic: only a user who is currently isActive:false matches, so two admins clicking at once
 *   cannot both "win" and a user who is already active is never touched.
 * - Reads nothing from the request body: the role, password and every other field stay exactly as
 *   they were (reactivating an admin gives that admin their admin role back — that is the point).
 * - Does NOT bring back the old cart or sessions: deleteUser removed them on purpose, so the user
 *   must log in again with their own password.
 * Errors: 404 no such user · 409 the account is already active · 400 malformed id (route param check)
 */
const reactivateUser = async (req, res, next) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, isActive: false }, // only a deactivated account matches ({isActive:undefined} legacy docs are "active")
      { $set: { isActive: true } },
      { new: true }
    );

    if (!user) {
      // Nothing matched: either there is no such user, or the account is already active.
      const exists = await User.exists({ _id: req.params.id });
      if (!exists) {
        return sendError(res, 404, "User not found");
      }
      return sendError(res, 409, "This account is already active");
    }

    logger.info(`Admin ${req.session.userId} reactivated user ${user._id}`);
    return sendSuccess(res, 200, "User reactivated. They can log in again.", sanitizeUser(user));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboard,
  getAllUsers,
  getAllOrders,
  updateOrderStatus,
  exportOrdersCSV,
  deleteUser,
  reactivateUser,
};
