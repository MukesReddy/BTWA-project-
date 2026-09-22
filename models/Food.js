// models/Food.js
// Mongoose Food Schema and Model
// BTWA Module 3: Schema design, ObjectId references, arrays, indexes
// BTWA Module 2: Array fields, embedded data, object types

const mongoose = require("mongoose");

/**
 * Food Schema
 * Demonstrates multiple BTWA data types:
 * - String, Number, Boolean, Array, ObjectId reference, Date
 *
 * BTWA Module 2: Document structure with arrays and references
 * BTWA Module 3: Schema design, Mongoose, indexes
 */
const foodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Food name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    category: {
      // ObjectId reference to Category collection
      // BTWA Module 3: Mongoose references (relationships)
      // BTWA Module 7 (Mongoose): Populate
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    image: {
      type: String,
      default: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
    },
    ingredients: {
      // Array field (BTWA Module 2: Arrays in MongoDB)
      type: [String],
      default: [],
    },
    available: {
      type: Boolean,
      default: true,
    },
    rating: {
      type: Number,
      default: 4.0,
      min: [0, "Rating cannot be less than 0"],
      max: [5, "Rating cannot exceed 5"],
    },
  },
  {
    timestamps: true, // Auto createdAt and updatedAt (BTWA Module 3)
  }
);

// ─── MongoDB Indexes ──────────────────────────────────────────────────────────
// BTWA Module 3: Indexing for performance

// Text index on name and description for full-text search
// BTWA Module 2: Text search / regex queries
foodSchema.index({ name: "text", description: "text" });

// Compound index on category + available for filtered menu queries
foodSchema.index({ category: 1, available: 1 });

// Index on price for range filtering
foodSchema.index({ price: 1 });

// Index on rating for sorting
foodSchema.index({ rating: -1 });

const Food = mongoose.model("Food", foodSchema);
module.exports = Food;
