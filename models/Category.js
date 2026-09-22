// models/Category.js
// Mongoose Category Schema and Model
// BTWA Module 3: Mongoose schema design

const mongoose = require("mongoose");

/**
 * Category Schema
 * Represents food categories like Pizza, Burger, Biryani, etc.
 * BTWA Module 3: Schema design, validation
 */
const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      unique: true,  // No duplicate categories
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    image: {
      type: String, // URL to category image
      default: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
    },
  },
  {
    timestamps: true, // BTWA Module 3: Auto timestamps
  }
);

// Index on createdAt for sorting
categorySchema.index({ createdAt: -1 });

const Category = mongoose.model("Category", categorySchema);
module.exports = Category;
