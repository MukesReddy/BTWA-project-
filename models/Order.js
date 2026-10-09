// models/Order.js
// Mongoose Order Schema and Model
// BTWA Module 3: Complex schema, references, embedded docs, enums
// BTWA Module 2: Embedded documents, arrays, price snapshots

const mongoose = require("mongoose");

/**
 * Order Item sub-schema
 * Stores a SNAPSHOT of food name and price at time of order
 * This is critical: even if food price changes later, order is accurate
 * BTWA Module 2: Embedded documents, data snapshots
 */
const orderItemSchema = new mongoose.Schema(
  {
    food: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Food",
    },
    foodName: {
      type: String, // Snapshot — stored permanently at order time
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
    },
    price: {
      type: Number, // Snapshot of price at time of order
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

/**
 * Delivery Address sub-schema (embedded document)
 * Stored as a snapshot — independent of user's current address
 */
const deliveryAddressSchema = new mongoose.Schema(
  {
    street:  { type: String, required: true, trim: true },
    city:    { type: String, required: true, trim: true },
    state:   { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
  },
  { _id: false }
);

/**
 * Order Schema
 * BTWA Module 3: Full order lifecycle, status tracking
 */
const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: [orderItemSchema], // Array of ordered items with snapshots
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryAddress: deliveryAddressSchema, // Embedded delivery address
    paymentMethod: {
      type: String,
      enum: ["Cash on Delivery", "UPI"],
      default: "Cash on Delivery",
    },

    // ── Payment (separate from the order lifecycle below) ──────────────────────────────────
    // Cash on Delivery orders: paymentStatus stays PENDING (the cash is collected at the door; it is not tracked here).
    // UPI orders: PENDING until a VERIFIED confirmation arrives (signed webhook, or an admin who checked the bank
    //   statement) → PAID. A payment can also end as FAILED (provider said so), EXPIRED (nobody paid in time) or
    //   CANCELLED (the customer/admin cancelled the unpaid order). Old orders have no paymentStatus: they read as PENDING.
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELLED"],
      default: "PENDING",
    },
    paymentRef: { type: String },            // our reference printed in the QR (UPI orders only)
    paymentExpiresAt: { type: Date },        // after this a still-PENDING UPI payment is closed
    paidAt: { type: Date },
    paymentTransactionId: { type: String },  // the bank/provider reference (UTR) of the verified payment
    paymentVerifiedBy: { type: String, enum: ["webhook", "admin"] },
    orderStatus: {
      type: String,
      // BTWA Module 2: Enum field in MongoDB
      enum: [
        "Pending",
        "Confirmed",
        "Preparing",
        "Out for Delivery",
        "Delivered",
        "Cancelled",
      ],
      default: "Pending",
    },
  },
  {
    timestamps: true, // BTWA Module 3: Auto timestamps
  }
);

// ─── MongoDB Indexes ──────────────────────────────────────────────────────────
// BTWA Module 3: Indexes for common query patterns

// Index on user for "my orders" queries
orderSchema.index({ user: 1 });

// Index on orderStatus for admin filtering
orderSchema.index({ orderStatus: 1 });

// Index on createdAt for date-based queries and sorting (descending)
orderSchema.index({ createdAt: -1 });

// Compound index: user + createdAt for efficient user order history
orderSchema.index({ user: 1, createdAt: -1 });
// A payment reference / bank transaction id can belong to ONE order only (also stops a duplicate or replayed
// confirmation from paying two orders). "partial" = only orders that have the field, so Cash on Delivery orders are not indexed.
orderSchema.index({ paymentRef: 1 }, { unique: true, partialFilterExpression: { paymentRef: { $type: "string" } } });
orderSchema.index({ paymentTransactionId: 1 }, { unique: true, partialFilterExpression: { paymentTransactionId: { $type: "string" } } });
// The expiry job: "UPI orders still waiting for payment whose time is up".
orderSchema.index({ paymentMethod: 1, paymentStatus: 1, paymentExpiresAt: 1 });

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;
