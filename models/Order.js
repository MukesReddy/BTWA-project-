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
      enum: ["Cash on Delivery"],
      default: "Cash on Delivery",
    },
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

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;
