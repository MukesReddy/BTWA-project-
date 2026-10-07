// models/Cart.js
// Mongoose Cart Schema and Model
// BTWA Module 3: Schema with nested arrays, ObjectId references
// BTWA Module 2: Embedded documents, array of items

const mongoose = require("mongoose");
const { MAX_CART_QUANTITY } = require("../utils/constants");

/**
 * Cart Item sub-schema (embedded document)
 * Each cart item holds a food reference, quantity, and price snapshot
 * BTWA Module 2: Embedded documents
 */
const cartItemSchema = new mongoose.Schema(
  {
    food: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Food",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, "Quantity must be at least 1"],
      max: [MAX_CART_QUANTITY, `Quantity cannot exceed ${MAX_CART_QUANTITY}`],
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number",
      },
      default: 1,
    },
    price: {
      type: Number, // Price snapshot at time of adding to cart
      required: true,
      min: 0,
    },
  },
  { _id: false } // Don't generate _id for sub-documents
);

/**
 * Cart Schema
 * One cart per user (enforced at controller level)
 * BTWA Module 3: User reference, array of items
 */
const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // One cart per user
    },
    items: [cartItemSchema], // Array of cart items (BTWA Module 2: Arrays)
  },
  {
    timestamps: true,
  }
);

// Note: user index is auto-created by unique:true above.
// That unique index is also what makes concurrent "create cart" requests safe:
// the second insert fails with E11000 and the controller retries (see cartController).

const Cart = mongoose.model("Cart", cartSchema);
module.exports = Cart;
