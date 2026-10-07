// models/User.js
// Mongoose User Schema and Model
// BTWA Module 3: Mongoose schema design, validation
// BTWA Module 10: Authentication, bcrypt password hashing

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

/**
 * Address sub-document schema (embedded document)
 * BTWA Module 2: Embedded documents in MongoDB
 */
const addressSchema = new mongoose.Schema({
  street: { type: String, trim: true },
  city:   { type: String, trim: true },
  state:  { type: String, trim: true },
  pincode: { type: String, trim: true },
});

/**
 * User Schema
 * BTWA Module 3: Schema design with validation, types, indexes
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,          // Creates a unique index automatically
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Never return password in queries by default
    },
    phone: {
      type: String,
      trim: true,
    },
    address: addressSchema, // Embedded document (BTWA Module 2)
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
    },
    // false = deactivated by an admin. Used instead of deleting users who have
    // placed orders, so order history keeps its owner. Login is refused.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Auto-creates createdAt and updatedAt (BTWA Module 3: Mongoose timestamps)
  }
);

// ─── Mongoose Indexes ─────────────────────────────────────────────────────────
// BTWA Module 3: MongoDB indexing
// email index is auto-created by unique: true above
// Additional index on role for admin queries
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

// ─── Mongoose Pre-Save Hook ───────────────────────────────────────────────────
// BTWA Module 10: bcrypt password hashing before save
// This runs automatically before every .save() call
userSchema.pre("save", async function () {
  // Only hash if password was modified (not on other updates)
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10); // Generate salt with 10 rounds
  this.password = await bcrypt.hash(this.password, salt); // Hash password
});

// ─── Instance Method: comparePassword ────────────────────────────────────────
// BTWA Module 10: bcrypt password comparison during login
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Create and export the model (BTWA Module 3: Mongoose models)
const User = mongoose.model("User", userSchema);
module.exports = User;
